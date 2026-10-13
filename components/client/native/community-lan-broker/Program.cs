// SPDX-License-Identifier: AGPL-3.0-or-later
// Portable, single-session ET executor. No service, shell, arbitrary command or remote IPC.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Collections;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

class FirewallWireRule {
    public int schemaVersion { get; set; }
    public string kind { get; set; }
    public string name { get; set; }
    public string program { get; set; }
    public string ownershipId { get; set; }
}
class FirewallWireFailure {
    public string operation { get; set; }
    public string name { get; set; }
    public string code { get; set; }
}
class FirewallWireRequest {
    public int schemaVersion { get; set; }
    public string operation { get; set; }
    public FirewallWireRule[] ensure { get; set; }
    public FirewallWireRule[] remove { get; set; }
}
class FirewallWireResponse {
    public int schemaVersion { get; set; }
    public List<string> installed { get; set; }
    public List<string> removed { get; set; }
    public List<FirewallWireFailure> failures { get; set; }
}

class Program {
    const string Ready = "LAOKUAI_BROKER_READY_V1";
    const string Stop = "LAOKUAI_OWNED_STOP_V1";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16384 };
    static readonly JavaScriptSerializer FirewallJson = new JavaScriptSerializer { MaxJsonLength = 65536 };
    static readonly Dictionary<string, string> Files = new Dictionary<string, string> {
        {"easytier-core.exe", "f716a1139d66800bbc75daa200b1c0c6eecccb97e88e13167fafb8d7d38bb81d"},
        {"easytier-cli.exe", "1ad46380937aab6dd7385ebb37bb458c94f8d1a3e68baf2e6c24ea973adc6411"},
        {"wintun.dll", "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce"},
        {"WinDivert64.sys", "8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2"}
    };
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime; public uint Flags; public UIntPtr Minimum, Maximum;
        public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    static bool Elevated() { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
    internal static NamedPipeClientStream CreateClientPipe(string name) {
        // A command read remains pending while core status is written. A synchronous
        // Windows pipe handle blocks that write behind the read and deadlocks startup.
        return new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
    }
    static string Sid() { return WindowsIdentity.GetCurrent().User.Value; }
    static void Require(bool condition) { if (!condition) throw new InvalidOperationException("broker-request-rejected"); }
    static string Hash(Stream stream) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    static string Line(TextReader input) {
        var b = new StringBuilder(); int c;
        while ((c = input.Read()) >= 0) { if (c == '\n') return b.ToString().TrimEnd('\r'); Require(b.Length < 16384); b.Append((char)c); }
        return b.Length == 0 ? null : b.ToString();
    }
    static string PathWithoutLinks(string value) {
        Require(!String.IsNullOrEmpty(value) && Regex.IsMatch(value, @"\A[A-Za-z]:[\\/]") && !Regex.IsMatch(value, "[\"\x00-\x1f]"));
        var full = Path.GetFullPath(value);
        for (var p = full; !String.IsNullOrEmpty(p); p = Path.GetDirectoryName(p)) {
            if (File.Exists(p) || Directory.Exists(p)) Require((File.GetAttributes(p) & FileAttributes.ReparsePoint) == 0);
        }
        return full;
    }
    static string TextValue(string line, string key) {
        var prefix = key + " = "; Require(line.StartsWith(prefix, StringComparison.Ordinal));
        var value = Json.Deserialize<string>(line.Substring(prefix.Length));
        Require(value != null && value.Length <= 256 && !Regex.IsMatch(value, "[\\\\\"\x00-\x1f]"));
        return value;
    }
    static string ValidateConfig(string text) {
        Require(text.Length < 8192);
        var lines = text.Replace("\r\n", "\n").Split(new[]{'\n'}, StringSplitOptions.RemoveEmptyEntries);
        Require(lines.Length == 17);
        var id = TextValue(lines[0], "instance_id"); Guid parsed;
        Require(Guid.TryParseExact(id, "D", out parsed));
        Require(TextValue(lines[1], "instance_name") == "laokuai-老蒯聊_5000_default");
        var ip = TextValue(lines[2], "ipv4");
        Require(Regex.IsMatch(ip, @"\A(?:\d{1,3}\.){3}\d{1,3}/24\z"));
        foreach (var octet in ip.Split('/')[0].Split('.')) Require(Int32.Parse(octet) <= 255);
        var octets = ip.Split('/')[0].Split('.'); var first = Int32.Parse(octets[0]); var second = Int32.Parse(octets[1]);
        Require(first == 10 || (first == 172 && second >= 16 && second <= 31) || (first == 192 && second == 168));
        Require(lines[3] == "dhcp = false" && lines[4] == "listeners = []" && lines[5] == "[network_identity]");
        Require(Regex.IsMatch(TextValue(lines[6], "network_name"), @"\A[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\z"));
        Require(lines[7] == "[secure_mode]" && lines[8] == "enabled = true");
        var key = TextValue(lines[9], "local_private_key");
        Require(Convert.FromBase64String(key).Length == 32 && Convert.ToBase64String(Convert.FromBase64String(key)) == key);
        Require(lines[10] == "[flags]" && TextValue(lines[11], "dev_name") == "lkc-" + id.Replace("-", ""));
        Require(lines[12] == "enable_exit_node = false" && lines[13] == "relay_network_whitelist = \"\"" && lines[14] == "[[peer]]");
        Require(TextValue(lines[15], "uri") == "tcp://124.221.119.113:11014");
        Require(TextValue(lines[16], "peer_public_key") == "iP6v39g6ghV7ziiJIV5gwcR+gGHYHz7f/cUEA3hiXyk=");
        return String.Join("\n", lines) + "\n";
    }
    static IntPtr Job() {
        var handle = CreateJobObject(IntPtr.Zero, null); Require(handle != IntPtr.Zero);
        var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
        var size = Marshal.SizeOf(limits); var memory = Marshal.AllocHGlobal(size);
        try { Marshal.StructureToPtr(limits, memory, false); Require(SetInformationJobObject(handle, 9, memory, (uint)size)); }
        catch { CloseHandle(handle); throw; } finally { Marshal.FreeHGlobal(memory); }
        return handle;
    }
    static int Execute(TextReader input, TextWriter output) {
        Require(Elevated()); output.WriteLine(Ready); output.Flush();
        using (var requests = new BlockingCollection<string>(8)) {
            var reader = Task.Factory.StartNew(() => {
                try { string line; while ((line = Line(input)) != null) requests.Add(line); }
                finally { requests.CompleteAdding(); }
            });
            foreach (var request in requests.GetConsumingEnumerable()) {
                if (request == Stop) continue;
                var result = ExecuteCore(request, requests, output);
                output.WriteLine("LAOKUAI_BROKER_FINISHED_V1 " + result); output.Flush();
            }
            GC.KeepAlive(reader); return 0;
        }
    }
    static int ExecuteCore(string request, BlockingCollection<string> requests, TextWriter output) {
        var value = Json.Deserialize<Dictionary<string, string>>(request);
        Require(value.Count == 4 && value.ContainsKey("directory") && value.ContainsKey("configFile") && value.ContainsKey("configSha256") && value.ContainsKey("portal"));
        var directory = PathWithoutLinks(value["directory"]); var source = PathWithoutLinks(value["configFile"]);
        Require(Regex.IsMatch(value["portal"], @"\A127\.0\.0\.1:[1-9][0-9]{0,4}\z") && Int32.Parse(value["portal"].Substring(10)) <= 65535);
        Require(Regex.IsMatch(value["configSha256"], @"\A[0-9a-f]{64}\z"));
        var held = new List<FileStream>(); string temporary = null; Process core = null; IntPtr job = IntPtr.Zero;
        try {
            foreach (var pair in Files) {
                var file = new FileStream(PathWithoutLinks(Path.Combine(directory, pair.Key)), FileMode.Open, FileAccess.Read, FileShare.Read);
                held.Add(file); Require(file.Length < 32 * 1024 * 1024 && Hash(file) == pair.Value);
            }
            foreach (var file in Directory.GetFiles(directory)) Require(Files.ContainsKey(Path.GetFileName(file)));
            string config;
            using (var file = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                Require(file.Length < 8192 && Hash(file) == value["configSha256"]); file.Position = 0;
                using (var reader = new StreamReader(file, Encoding.UTF8)) config = ValidateConfig(reader.ReadToEnd());
            }
            // Elevated loading must not search a directory writable by the ordinary UI.
            var parent = PathWithoutLinks(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData));
            temporary = Path.Combine(parent, "LaokuaiCloud-Session-" + Guid.NewGuid().ToString("N"));
            Require(!Directory.Exists(temporary));
            var security = new DirectorySecurity(); security.SetAccessRuleProtection(true, false);
            security.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
            foreach (var sid in new[]{"S-1-5-32-544", "S-1-5-18"}) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            Directory.CreateDirectory(temporary, security);
            foreach (var file in held) {
                file.Position = 0;
                using (var destination = new FileStream(Path.Combine(temporary, Path.GetFileName(file.Name)), FileMode.CreateNew, FileAccess.Write, FileShare.None)) file.CopyTo(destination);
            }
            var configFile = Path.Combine(temporary, "owned.toml"); File.WriteAllText(configFile, config, new UTF8Encoding(false));
            var start = new ProcessStartInfo(Path.Combine(temporary, "easytier-core.exe")) {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = temporary,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                Arguments = "--disable-env-parsing --rpc-portal " + value["portal"] + " --rpc-portal-whitelist 127.0.0.1/32 --console-log-level off --file-log-level off --laokuai-owned-stdin --config-file \"" + configFile + "\""
            };
            var remove = new List<string>(); foreach (string name in start.EnvironmentVariables.Keys) if (Regex.IsMatch(name, @"\A(ET_|RUST_LOG\z|RUST_BACKTRACE\z)", RegexOptions.IgnoreCase)) remove.Add(name);
            foreach (var name in remove) start.EnvironmentVariables.Remove(name);
            job = Job(); core = Process.Start(start);
            if (!AssignProcessToJobObject(job, core.Handle)) { core.Kill(); throw new InvalidOperationException(); }
            output.WriteLine("LAOKUAI_BROKER_STARTED_V1 " + core.Id); output.Flush();
            core.BeginErrorReadLine();
            var pump = Task.Factory.StartNew(() => {
                string line; while ((line = Line(core.StandardOutput)) != null) {
                    if (line == "LAOKUAI_OWNED_STOPPED_V1" || Regex.IsMatch(line, @"\ALAOKUAI_OWNED_NIC_V1 [0-9a-f-]{36} [0-9]{1,20} [0-9]{1,10}\z")) { output.WriteLine(line); output.Flush(); }
                }
            });
            while (!core.WaitForExit(100)) {
                string command; var received = requests.TryTake(out command);
                if (received) Require(command == Stop);
                if (!received && !requests.IsCompleted && !pump.IsFaulted) continue;
                try { core.StandardInput.WriteLine(Stop); core.StandardInput.Close(); } catch (IOException) {}
                if (!core.WaitForExit(4000)) { core.Kill(); core.WaitForExit(2000); }
                break;
            }
            pump.Wait(1000); return core.HasExited ? core.ExitCode : 1;
        } finally {
            if (core != null) { try { if (!core.HasExited) core.Kill(); core.WaitForExit(2000); } catch {} core.Dispose(); }
            if (job != IntPtr.Zero) CloseHandle(job);
            foreach (var file in held) file.Dispose();
            if (temporary != null && Directory.Exists(temporary)) {
                File.Delete(Path.Combine(temporary, "owned.toml"));
                foreach (var name in Files.Keys) File.Delete(Path.Combine(temporary, name));
                Directory.Delete(temporary);
            }
        }
    }
    static int Launch(int parentPid) {
        using (var parent = Process.GetProcessById(parentPid)) {
            var watcher = new Thread(() => { parent.WaitForExit(); Environment.Exit(1); }); watcher.IsBackground = true; watcher.Start();
            if (Elevated()) return Execute(Console.In, Console.Out);
            var pipeName = "laokuai-et-" + Guid.NewGuid().ToString("N"); var security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(Sid()), PipeAccessRights.FullControl, AccessControlType.Allow));
            using (var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 16384, 16384, security)) {
                var self = PathWithoutLinks(Process.GetCurrentProcess().MainModule.FileName);
                using (var seal = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var elevated = Process.Start(new ProcessStartInfo(self, "--elevated " + pipeName + " " + Process.GetCurrentProcess().Id + " " + Sid()) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden })) {
                    var wait = pipe.BeginWaitForConnection(null, null);
                    if (!wait.AsyncWaitHandle.WaitOne(90000)) return 1;
                    pipe.EndWaitForConnection(wait); uint client;
                    Require(GetNamedPipeClientProcessId(pipe.SafePipeHandle, out client) && client == elevated.Id);
                    using (var reader = new StreamReader(pipe, Encoding.UTF8, false, 16384, true))
                    using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 16384, true) { AutoFlush = true }) {
                        var input = Task.Factory.StartNew(() => { string line; while ((line = Line(Console.In)) != null) writer.WriteLine(line); writer.WriteLine(Stop); });
                        string reply; while ((reply = Line(reader)) != null) { Console.WriteLine(reply); Console.Out.Flush(); }
                        elevated.WaitForExit(7000); GC.KeepAlive(input); return elevated.HasExited ? elevated.ExitCode : 1;
                    }
                }
            }
        }
    }
    // Firewall changes are made through the Windows Firewall COM API.  The
    // broker is already running with the administrator token inherited from
    // the product; this path never starts a service or a second elevation.
    const int FirewallWireSchema = 2;
    const int FirewallProfileAll = unchecked((int)0x7fffffff);
    const int FirewallDirectionIn = 1;
    const int FirewallActionAllow = 1;
    const int FirewallProtocolAny = 256;
    const string FirewallPrefix = "LaokuaiCloud.Managed.v1.";
    const string FirewallGroup = "LaokuaiCloud";
    static string FirewallPath(string value) {
        Require(!String.IsNullOrEmpty(value) && Regex.IsMatch(value, @"\A[A-Za-z]:[\\/]") && !Regex.IsMatch(value, "[\"\\x00-\\x1f]"));
        var full = Path.GetFullPath(value).TrimEnd('\\', '/');
        Require(full.Length > 0 && full.Length < 32768);
        return full;
    }
    static string FirewallRuleName(string kind, string program) {
        Require(kind == "app" || kind == "easytier");
        var normalized = FirewallPath(program).ToLowerInvariant();
        using (var sha = SHA256.Create()) {
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(kind + "\0" + normalized));
            var hex = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
            return FirewallPrefix + kind + "." + hex.Substring(0, 24);
        }
    }
    static void ValidateFirewallRule(FirewallWireRule rule) {
        Require(rule != null && rule.schemaVersion == FirewallWireSchema && (rule.kind == "app" || rule.kind == "easytier"));
        var path = FirewallPath(rule.program);
        Require(rule.name == FirewallRuleName(rule.kind, path));
        Require(rule.name.StartsWith(FirewallPrefix, StringComparison.Ordinal) && rule.name.Length < 256);
        Require(rule.ownershipId != null && Regex.IsMatch(rule.ownershipId, @"\A[0-9a-f]{32}\z"));
    }
    static object ComProperty(object target, string name) {
        return target.GetType().InvokeMember(name, BindingFlags.GetProperty | BindingFlags.InvokeMethod, null, target, null);
    }
    static void SetComProperty(object target, string name, object value) {
        target.GetType().InvokeMember(name, BindingFlags.SetProperty, null, target, new[]{value});
    }
    static object ComCreate(string progId) {
        var type = Type.GetTypeFromProgID(progId, true);
        Require(type != null);
        return Activator.CreateInstance(type);
    }
    static List<object> FirewallRulesByName(object rules, string name) {
        // Item(name) alone cannot disambiguate duplicate names. Enumeration
        // errors must propagate; they must never be mistaken for absence.
        var matches = new List<object>();
        foreach (object rule in (IEnumerable)rules) {
            if (String.Equals(ComString(rule, "Name"), name, StringComparison.OrdinalIgnoreCase)) matches.Add(rule);
        }
        return matches;
    }
    static int ComInt(object target, string name) { return Convert.ToInt32(ComProperty(target, name)); }
    static bool ComBool(object target, string name) { return Convert.ToBoolean(ComProperty(target, name)); }
    static string ComString(object target, string name) { return Convert.ToString(ComProperty(target, name)); }
    static bool OwnedFirewallRule(object current, FirewallWireRule expected) {
        try {
            return String.Equals(ComString(current, "Name"), expected.name, StringComparison.Ordinal)
                && String.Equals(ComString(current, "ApplicationName"), FirewallPath(expected.program), StringComparison.OrdinalIgnoreCase)
                && ComInt(current, "Direction") == FirewallDirectionIn
                && ComInt(current, "Action") == FirewallActionAllow
                && ComInt(current, "Profiles") == FirewallProfileAll
                && ComInt(current, "Protocol") == FirewallProtocolAny
                && ComBool(current, "Enabled")
                && String.Equals(ComString(current, "Grouping"), FirewallGroup, StringComparison.Ordinal)
                && String.Equals(ComString(current, "Description"), FirewallDescription(expected), StringComparison.Ordinal)
                && String.Equals(ComString(current, "InterfaceTypes"), "All", StringComparison.OrdinalIgnoreCase)
                && !ComBool(current, "EdgeTraversal")
                && String.IsNullOrEmpty(ComString(current, "ServiceName"))
                && ComString(current, "LocalAddresses") == "*" && ComString(current, "RemoteAddresses") == "*";
        } catch { return false; }
    }
    static string FirewallDescription(FirewallWireRule rule) {
        return "LaokuaiCloud managed inbound v2; owner=" + rule.ownershipId;
    }
    static void AddOwnedFirewallRule(object rules, FirewallWireRule expected, Func<object> createRule) {
        var rule = createRule();
        SetComProperty(rule, "Name", expected.name);
        SetComProperty(rule, "Description", FirewallDescription(expected));
        SetComProperty(rule, "ApplicationName", FirewallPath(expected.program));
        SetComProperty(rule, "Direction", FirewallDirectionIn);
        SetComProperty(rule, "Action", FirewallActionAllow);
        SetComProperty(rule, "Profiles", FirewallProfileAll);
        SetComProperty(rule, "Protocol", FirewallProtocolAny);
        SetComProperty(rule, "Enabled", true);
        SetComProperty(rule, "InterfaceTypes", "All");
        SetComProperty(rule, "Grouping", FirewallGroup);
        SetComProperty(rule, "EdgeTraversal", false);
        SetComProperty(rule, "LocalAddresses", "*");
        SetComProperty(rule, "RemoteAddresses", "*");
        rules.GetType().InvokeMember("Add", BindingFlags.InvokeMethod, null, rules, new object[]{rule});
    }
    static bool RemoveOwnedFirewallRule(object rules, FirewallWireRule expected) {
        var matches = FirewallRulesByName(rules, expected.name);
        if (matches.Count == 0) return true;
        // This check is mandatory: a same-name explicit block or foreign rule
        // is reported and preserved, never deleted by cleanup.
        if (matches.Count != 1 || !OwnedFirewallRule(matches[0], expected)) return false;
        rules.GetType().InvokeMember("Remove", BindingFlags.InvokeMethod, null, rules, new object[]{expected.name});
        return FirewallRulesByName(rules, expected.name).Count == 0;
    }
    static FirewallWireFailure Failure(string operation, string name, string code) {
        return new FirewallWireFailure { operation = operation, name = name, code = code };
    }
    static int FirewallCommand(TextReader input, TextWriter output) {
        Require(Elevated());
        var line = Line(input);
        Require(line != null && line.Length <= 65536);
        var request = FirewallJson.Deserialize<FirewallWireRequest>(line);
        Require(request != null && request.schemaVersion == FirewallWireSchema
            && (request.operation == "reconcile" || request.operation == "cleanup")
            && request.ensure != null && request.remove != null
            && request.ensure.Length <= 4 && request.remove.Length <= 64);
        if (request.operation == "cleanup") Require(request.ensure.Length == 0);
        foreach (var rule in request.ensure) { ValidateFirewallRule(rule); Require(File.Exists(rule.program)); }
        foreach (var rule in request.remove) ValidateFirewallRule(rule);
        var policy = ComCreate("HNetCfg.FwPolicy2");
        var rules = ComProperty(policy, "Rules");
        var response = ApplyFirewallRequest(rules, request);
        output.WriteLine(FirewallJson.Serialize(response)); output.Flush(); return 0;
    }
    static FirewallWireResponse ApplyFirewallRequest(object rules, FirewallWireRequest request, Func<object> createRule = null) {
        if (createRule == null) createRule = () => ComCreate("HNetCfg.FWRule");
        var response = new FirewallWireResponse { schemaVersion = FirewallWireSchema,
            installed = new List<string>(), removed = new List<string>(), failures = new List<FirewallWireFailure>() };
        foreach (var rule in request.ensure) {
            try {
                var matches = FirewallRulesByName(rules, rule.name);
                if (matches.Count == 0) {
                    AddOwnedFirewallRule(rules, rule, createRule);
                    matches = FirewallRulesByName(rules, rule.name);
                }
                if (matches.Count != 1 || !OwnedFirewallRule(matches[0], rule)) { response.failures.Add(Failure("ensure", rule.name, "ownership-mismatch")); continue; }
                response.installed.Add(rule.name);
            } catch { response.failures.Add(Failure("ensure", rule.name, "com-add-failed")); }
        }
        foreach (var rule in request.remove) {
            // Retain a prior path if its replacement could not be verified.
            if (request.operation == "reconcile") {
                bool replacement = false;
                foreach (var next in request.ensure) if (next.kind == rule.kind && response.installed.Contains(next.name)) replacement = true;
                if (!replacement) { response.failures.Add(Failure("remove", rule.name, "replacement-unavailable")); continue; }
            }
            try {
                if (RemoveOwnedFirewallRule(rules, rule)) response.removed.Add(rule.name);
                else response.failures.Add(Failure("remove", rule.name, "ownership-mismatch"));
            } catch { response.failures.Add(Failure("remove", rule.name, "com-remove-failed")); }
        }
        return response;
    }
    // Pure CLR fixture for the same production COM reflection/ownership paths.
    // No COM activation, firewall reads/writes, token/UAC or native runtime.
    class FakeFirewallRule {
        public string Name { get; set; }
        public string Description { get; set; }
        public string ApplicationName { get; set; }
        public string Grouping { get; set; }
        public string InterfaceTypes { get; set; }
        public string ServiceName { get; set; }
        public string LocalAddresses { get; set; }
        public string RemoteAddresses { get; set; }
        public int Profiles { get; set; }
        public int Protocol { get; set; }
        public int Direction { get; set; }
        public int Action { get; set; }
        public bool Enabled { get; set; }
        public bool EdgeTraversal { get; set; }
    }
    class FakeFirewallRules : IEnumerable {
        public List<object> Values = new List<object>();
        public int Adds, Removes;
        public void Add(object rule) { Values.Add(rule); Adds++; }
        public void Remove(string name) { Values.RemoveAll(rule => ComString(rule, "Name") == name); Removes++; }
        public IEnumerator GetEnumerator() { return Values.GetEnumerator(); }
    }
    static void FirewallSelfTest() {
        var expected = new FirewallWireRule { schemaVersion = 2, kind = "app", program = @"C:\唠蒯云\唠蒯云.exe", ownershipId = new String('a', 32) };
        expected.name = FirewallRuleName(expected.kind, expected.program);
        ValidateFirewallRule(expected);
        var rules = new FakeFirewallRules();
        var reconcile = new FirewallWireRequest { schemaVersion = 2, operation = "reconcile", ensure = new[]{expected}, remove = new FirewallWireRule[0] };
        Require(ApplyFirewallRequest(rules, reconcile, () => new FakeFirewallRule()).installed.Count == 1 && rules.Adds == 1);
        Require(ApplyFirewallRequest(rules, reconcile, () => new FakeFirewallRule()).installed.Count == 1 && rules.Adds == 1 && rules.Removes == 0);
        var created = (FakeFirewallRule)rules.Values[0];
        var edits = new Action<FakeFirewallRule>[] {
            rule => rule.Action = 0, rule => rule.Direction = 2, rule => rule.Enabled = false,
            rule => rule.Profiles = 3, rule => rule.Protocol = 6, rule => rule.ApplicationName = @"C:\foreign.exe",
            rule => rule.Grouping = "third-party", rule => rule.Description = "foreign-owner", rule => rule.InterfaceTypes = "Lan",
            rule => rule.EdgeTraversal = true, rule => rule.ServiceName = "foreign-service", rule => rule.RemoteAddresses = "10.0.0.1",
            rule => rule.LocalAddresses = "10.0.0.1"
        };
        var cleanup = new FirewallWireRequest { schemaVersion = 2, operation = "cleanup", ensure = new FirewallWireRule[0], remove = new[]{expected} };
        foreach (var edit in edits) {
            var fresh = new FakeFirewallRules();
            ApplyFirewallRequest(fresh, reconcile, () => new FakeFirewallRule());
            edit((FakeFirewallRule)fresh.Values[0]);
            Require(ApplyFirewallRequest(fresh, cleanup).failures.Count == 1 && fresh.Removes == 0 && fresh.Values.Count == 1);
            Require(ApplyFirewallRequest(fresh, reconcile, () => new FakeFirewallRule()).failures.Count == 1 && fresh.Adds == 1);
        }
        rules.Values.Add(created);
        Require(ApplyFirewallRequest(rules, cleanup).failures.Count == 1 && rules.Removes == 0);
        rules.Values.RemoveAt(1);
        Require(ApplyFirewallRequest(rules, cleanup).removed.Count == 1 && rules.Removes == 1 && rules.Values.Count == 0);
        Require(ApplyFirewallRequest(rules, cleanup).removed.Count == 1 && rules.Removes == 1);
        // Failed replacement must leave the old rule in place.
        var old = new FirewallWireRule { schemaVersion = 2, kind = "app", program = @"D:\old\唠蒯云.exe", ownershipId = new String('b', 32) };
        old.name = FirewallRuleName(old.kind, old.program);
        var moved = new FakeFirewallRules();
        AddOwnedFirewallRule(moved, old, () => new FakeFirewallRule());
        AddOwnedFirewallRule(moved, expected, () => new FakeFirewallRule());
        ((FakeFirewallRule)moved.Values[1]).Action = 0;
        reconcile.remove = new[]{old};
        Require(ApplyFirewallRequest(moved, reconcile, () => new FakeFirewallRule()).failures.Count == 2 && moved.Removes == 0);
        Console.WriteLine("PASS firewall CLR fixture: create/verify/idempotence, 13 property collisions, duplicates, ownership cleanup, failed replacement; no host firewall access");
    }
    static int Main(string[] args) {
        try {
            Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 1 && args[0] == "--check") { Console.Write(Elevated() ? "approved" : "ordinary"); return 0; }
            if (args.Length == 1 && args[0] == "--firewall") return FirewallCommand(Console.In, Console.Out);
            if (args.Length == 1 && args[0] == "--firewall-self-test") { FirewallSelfTest(); return 0; }
            if (args.Length == 1 && args[0] == "--dns-policy") { Require(Elevated()); return CommunityDnsPolicy.Command(Console.In, Console.Out); }
            if (args.Length == 1 && args[0] == "--dns-policy-self-test") { CommunityDnsPolicy.SelfTest(); return 0; }
            if (args.Length == 1 && args[0] == "--self-test") { SelfTest(); return 0; }
            if (args.Length == 2 && args[0] == "--parent") return Launch(Int32.Parse(args[1]));
            if (args.Length == 4 && args[0] == "--elevated") {
                Require(Elevated() && args[3] == Sid() && Regex.IsMatch(args[1], @"\Alaokuai-et-[0-9a-f]{32}\z"));
                using (var pipe = CreateClientPipe(args[1])) {
                    pipe.Connect(10000); uint server;
                    Require(GetNamedPipeServerProcessId(pipe.SafePipeHandle, out server) && server == UInt32.Parse(args[2]));
                    using (var reader = new StreamReader(pipe, Encoding.UTF8, false, 16384, true))
                    using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 16384, true) { AutoFlush = true }) return Execute(reader, writer);
                }
            }
            return 2;
        } catch (System.ComponentModel.Win32Exception e) { return e.NativeErrorCode == 1223 ? 1223 : 1; }
        catch { return 1; } // No untrusted path, config, key or native output in diagnostics.
    }
    static void SelfTest() {
        var id = "11111111-1111-4111-8111-111111111111";
        var text = "instance_id = \"" + id + "\"\ninstance_name = \"laokuai-老蒯聊_5000_default\"\nipv4 = \"10.77.1.2/24\"\ndhcp = false\nlisteners = []\n[network_identity]\nnetwork_name = \"test-network\"\n[secure_mode]\nenabled = true\nlocal_private_key = \"" + Convert.ToBase64String(new byte[32]) + "\"\n[flags]\ndev_name = \"lkc-" + id.Replace("-", "") + "\"\nenable_exit_node = false\nrelay_network_whitelist = \"\"\n[[peer]]\nuri = \"tcp://124.221.119.113:11014\"\npeer_public_key = \"iP6v39g6ghV7ziiJIV5gwcR+gGHYHz7f/cUEA3hiXyk=\"\n";
        Require(ValidateConfig(text) == text);
        foreach (var bad in new[]{text + "[proxy]\n", text.Replace("false", "true"), text.Replace("11014", "11015"), text.Replace("10.77.1.2", "127.0.0.1"), text.Replace("listeners = []", "listeners = [\"tcp://0.0.0.0:1\"]"), text.Replace("lkc-", "foreign-")}) {
            var rejected = false; try { ValidateConfig(bad); } catch { rejected = true; } Require(rejected);
        }
        Console.WriteLine("PASS broker config: one valid and six rejected; no elevation, process, pipe or native execution");
    }
}
