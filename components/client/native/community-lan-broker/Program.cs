// SPDX-License-Identifier: AGPL-3.0-or-later
// Portable ET executor and user-requested fixed app restart. No service or arbitrary command.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Net.NetworkInformation;
using System.Net.Sockets;
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
class TunFirewallScope {
    public string guid { get; set; }
    public string luid { get; set; }
    public int ifIndex { get; set; }
    public string localAddress { get; set; }
    public string remoteSubnet { get; set; }
    public string interfaceAlias { get; set; }
}
class TunFirewallRule : TunFirewallScope {
    public int schemaVersion { get; set; }
    public string name { get; set; }
    public string ownershipId { get; set; }
}
class TunFirewallRequest {
    public int schemaVersion { get; set; }
    public string operation { get; set; }
    public TunFirewallScope evidence { get; set; }
    public TunFirewallRule[] rules { get; set; }
}
class TunFirewallResponse {
    public int schemaVersion { get; set; }
    public TunFirewallScope scope { get; set; }
    public List<string> installed { get; set; }
    public List<string> removed { get; set; }
    public List<FirewallWireFailure> failures { get; set; }
}
class TunFirewallNotReadyException : Exception {}

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
    static string Line(TextReader input, int maximum = 16384) {
        var b = new StringBuilder(); int c;
        while ((c = input.Read()) >= 0) { if (c == '\n') return b.ToString().TrimEnd('\r'); Require(b.Length < maximum); b.Append((char)c); }
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

    // Independent ICMP protocol/ledger: legacy app and core rules remain v2.
    const string TunFirewallPrefix = "LaokuaiCloud.OwnedTun.Icmp.v1.";
    [DllImport("iphlpapi.dll")] static extern uint ConvertInterfaceLuidToGuid(ref ulong luid, out Guid guid);
    [DllImport("iphlpapi.dll")] static extern uint ConvertInterfaceLuidToIndex(ref ulong luid, out uint index);
    static uint TunIpv4(string value) {
        Require(value != null && Regex.IsMatch(value, @"\A(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}\z"));
        uint result = 0;
        foreach (var piece in value.Split('.')) { uint octet; Require(UInt32.TryParse(piece, out octet) && octet <= 255); result = (result << 8) | octet; }
        return result;
    }
    static bool TunPrivateIpv4(ulong value) {
        return (value >= 0x0a000000 && value <= 0x0affffff) || (value >= 0xac100000 && value <= 0xac1fffff) || (value >= 0xc0a80000 && value <= 0xc0a8ffff);
    }
    static void ValidateTunScope(TunFirewallScope scope, bool alias) {
        Guid guid; ulong luid;
        Require(scope != null && scope.guid != null && Regex.IsMatch(scope.guid, @"\A[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\z")
            && Guid.TryParse(scope.guid, out guid) && guid != Guid.Empty);
        Require(scope.luid != null && Regex.IsMatch(scope.luid, @"\A[1-9][0-9]{0,19}\z") && UInt64.TryParse(scope.luid, out luid) && luid > 0 && scope.ifIndex > 0);
        var local = TunIpv4(scope.localAddress); Require(TunPrivateIpv4(local));
        Require(scope.remoteSubnet != null); var parts = scope.remoteSubnet.Split('/'); int prefix;
        Require(parts.Length == 2 && Regex.IsMatch(parts[1], @"\A([1-9]|[12][0-9]|3[0-2])\z") && Int32.TryParse(parts[1], out prefix));
        prefix = Int32.Parse(parts[1]); var network = TunIpv4(parts[0]); var size = 1UL << (32 - prefix);
        Require(network % size == 0 && TunPrivateIpv4(network) && TunPrivateIpv4(network + size - 1) && local >= network && local < network + size);
        if (alias) Require(!String.IsNullOrEmpty(scope.interfaceAlias) && scope.interfaceAlias.Length <= 256 && !Regex.IsMatch(scope.interfaceAlias, @"[\x00-\x1f]"));
    }
    static string TunFirewallRuleName(TunFirewallScope scope) {
        ValidateTunScope(scope, true);
        var identity = String.Join("\0", new[]{scope.guid, scope.luid, scope.ifIndex.ToString(System.Globalization.CultureInfo.InvariantCulture), scope.interfaceAlias, scope.localAddress, scope.remoteSubnet});
        using (var sha = SHA256.Create()) return TunFirewallPrefix + BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-", "").ToLowerInvariant().Substring(0, 24);
    }
    static void ValidateTunRule(TunFirewallRule rule) {
        Require(rule != null && rule.schemaVersion == 1); ValidateTunScope(rule, true);
        Require(rule.name == TunFirewallRuleName(rule) && rule.ownershipId != null && Regex.IsMatch(rule.ownershipId, @"\A[0-9a-f]{32}\z"));
    }
    static TunFirewallScope ResolveTunScope(TunFirewallScope expected) {
        ValidateTunScope(expected, false);
        // LUID/GUID/index come from the exact owned child receipt. Never select
        // an adapter by its alias, a renderer field, or the EasyTier brand.
        ulong luid = UInt64.Parse(expected.luid); Guid guid; uint index;
        Require(ConvertInterfaceLuidToGuid(ref luid, out guid) == 0 && guid.ToString("D") == expected.guid);
        Require(ConvertInterfaceLuidToIndex(ref luid, out index) == 0 && index == expected.ifIndex);
        TunFirewallScope result = null;
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces()) {
            Guid candidate;
            if (!Guid.TryParse(nic.Id, out candidate) || candidate != guid) continue;
            Require(result == null);
            var properties = nic.GetIPProperties(); var ipv4 = properties.GetIPv4Properties();
            var addresses = new List<string>();
            foreach (var address in properties.UnicastAddresses) if (address.Address.AddressFamily == AddressFamily.InterNetwork) addresses.Add(address.Address.ToString());
            result = ResolveTunInterface(expected, candidate.ToString("D"), ipv4 == null ? expected.ifIndex : ipv4.Index,
                nic.Name, nic.OperationalStatus == OperationalStatus.Up && ipv4 != null, addresses.ToArray());
        }
        if (result == null) throw new TunFirewallNotReadyException(); return result;
    }
    static TunFirewallScope ResolveTunInterface(TunFirewallScope expected, string guid, int index, string alias, bool up, string[] addresses) {
        // Identity mismatches are permanent failures. Only a verified NIC's
        // pending operational state / IPv4 assignment receives a retry code.
        Require(guid == expected.guid && index == expected.ifIndex);
        if (!up || Array.IndexOf(addresses, expected.localAddress) < 0) throw new TunFirewallNotReadyException();
        var result = new TunFirewallScope { guid = expected.guid, luid = expected.luid, ifIndex = expected.ifIndex,
            localAddress = expected.localAddress, remoteSubnet = expected.remoteSubnet, interfaceAlias = alias };
        ValidateTunScope(result, true); return result;
    }
    static string TunFirewallDescription(TunFirewallRule rule) {
        return "LaokuaiCloud owned TUN ICMPv4 echo v1; owner=" + rule.ownershipId + "; guid=" + rule.guid + "; luid=" + rule.luid + "; index=" + rule.ifIndex;
    }
    static bool TunFirewallInterface(object rule, string alias) {
        var values = ComProperty(rule, "Interfaces") as Array;
        return values != null && values.Length == 1 && Convert.ToString(values.GetValue(0)) == alias;
    }
    static bool OwnedTunFirewallRule(object current, TunFirewallRule expected) {
        try {
            return ComString(current, "Name") == expected.name && ComString(current, "Description") == TunFirewallDescription(expected)
                && String.IsNullOrEmpty(ComString(current, "ApplicationName")) && String.IsNullOrEmpty(ComString(current, "ServiceName"))
                && ComInt(current, "Direction") == FirewallDirectionIn && ComInt(current, "Action") == FirewallActionAllow
                && ComInt(current, "Profiles") == FirewallProfileAll && ComInt(current, "Protocol") == 1
                && ComString(current, "IcmpTypesAndCodes") == "8:*" && ComBool(current, "Enabled") && !ComBool(current, "EdgeTraversal")
                && ComString(current, "Grouping") == FirewallGroup && ComString(current, "InterfaceTypes") == "All"
                && TunFirewallInterface(current, expected.interfaceAlias)
                && TunSameLocalAddress(ComString(current, "LocalAddresses"), expected.localAddress)
                && TunSameSubnet(ComString(current, "RemoteAddresses"), expected.remoteSubnet);
        } catch { return false; }
    }
    static bool TunSameLocalAddress(string current, string expected) {
        // FWRule canonicalizes a single IPv4 setter to /255.255.255.255.
        // Only these exact single-host equivalents preserve the address scope.
        return current == expected || current == expected + "/32" || current == expected + "/255.255.255.255";
    }
    static bool TunSameSubnet(string current, string expected) {
        // Windows can return a dotted netmask after a CIDR setter. Accept only
        // its exact semantic equivalent; no lists, keywords, ranges or '*'.
        if (current == expected) return true;
        var parts = expected.Split('/'); int prefix = Int32.Parse(parts[1]);
        uint mask = prefix == 32 ? UInt32.MaxValue : UInt32.MaxValue << (32 - prefix);
        var dotted = String.Join(".", new[]{(mask >> 24).ToString(), ((mask >> 16) & 255).ToString(), ((mask >> 8) & 255).ToString(), (mask & 255).ToString()});
        return current == parts[0] + "/" + dotted;
    }
    static void AddOwnedTunFirewallRule(object rules, TunFirewallRule expected, Func<object> createRule) {
        var rule = createRule();
        SetComProperty(rule, "Name", expected.name); SetComProperty(rule, "Description", TunFirewallDescription(expected));
        SetComProperty(rule, "Direction", FirewallDirectionIn); SetComProperty(rule, "Action", FirewallActionAllow);
        SetComProperty(rule, "Profiles", FirewallProfileAll); SetComProperty(rule, "Protocol", 1);
        SetComProperty(rule, "IcmpTypesAndCodes", "8:*"); SetComProperty(rule, "InterfaceTypes", "All");
        // INetFwRule.Interfaces uses friendly names; GUID is resolved and
        // revalidated immediately before this setter, and retained in owner metadata.
        SetComProperty(rule, "Interfaces", new object[]{expected.interfaceAlias});
        SetComProperty(rule, "Grouping", FirewallGroup); SetComProperty(rule, "EdgeTraversal", false);
        SetComProperty(rule, "LocalAddresses", expected.localAddress); SetComProperty(rule, "RemoteAddresses", expected.remoteSubnet);
        SetComProperty(rule, "Enabled", true);
        rules.GetType().InvokeMember("Add", BindingFlags.InvokeMethod, null, rules, new object[]{rule});
    }
    static TunFirewallResponse ApplyTunFirewallRequest(object rules, TunFirewallRequest request, Func<object> createRule, Func<TunFirewallScope, TunFirewallScope> resolve) {
        var response = new TunFirewallResponse { schemaVersion = 1, installed = new List<string>(), removed = new List<string>(), failures = new List<FirewallWireFailure>() };
        foreach (var rule in request.rules) {
            ValidateTunRule(rule);
            var operation = request.operation == "ensure" ? "ensure" : "remove";
            try {
                if (operation == "ensure") Require(resolve(rule).interfaceAlias == rule.interfaceAlias);
                var matches = FirewallRulesByName(rules, rule.name);
                if (operation == "ensure" && matches.Count == 0) {
                    AddOwnedTunFirewallRule(rules, rule, createRule); matches = FirewallRulesByName(rules, rule.name);
                }
                if (matches.Count > 1 || (matches.Count == 1 && !OwnedTunFirewallRule(matches[0], rule))) {
                    response.failures.Add(Failure(operation, rule.name, "ownership-mismatch")); continue;
                }
                if (operation == "ensure") { Require(matches.Count == 1); response.installed.Add(rule.name); }
                else {
                    // Cleanup works after the owned adapter has disappeared;
                    // authority is the full ledger handle and exact rule shape.
                    if (matches.Count == 1) rules.GetType().InvokeMember("Remove", BindingFlags.InvokeMethod, null, rules, new object[]{rule.name});
                    Require(FirewallRulesByName(rules, rule.name).Count == 0); response.removed.Add(rule.name);
                }
            } catch (TunFirewallNotReadyException) { response.failures.Add(Failure(operation, rule.name, "tun-not-ready")); }
            catch { response.failures.Add(Failure(operation, rule.name, operation == "ensure" ? "tun-prepare-failed" : "com-remove-failed")); }
        }
        return response;
    }
    static TunFirewallResponse ResolveTunFirewallRequest(TunFirewallRequest request, Func<TunFirewallScope, TunFirewallScope> resolve) {
        var response = new TunFirewallResponse { schemaVersion = 1, installed = new List<string>(), removed = new List<string>(), failures = new List<FirewallWireFailure>() };
        try { response.scope = resolve(request.evidence); }
        catch (TunFirewallNotReadyException) { response.failures.Add(Failure("ensure", "owned-tun-firewall", "tun-not-ready")); }
        catch { response.failures.Add(Failure("ensure", "owned-tun-firewall", "tun-scope-unverified")); }
        return response;
    }
    static int TunFirewallCommand(TextReader input, TextWriter output) {
        Require(Elevated()); var line = Line(input, 65536); Require(line != null && line.Length <= 65536);
        var request = FirewallJson.Deserialize<TunFirewallRequest>(line);
        Require(request != null && request.schemaVersion == 1 && (request.operation == "resolve" || request.operation == "ensure" || request.operation == "remove")
            && request.rules != null && request.rules.Length <= 64);
        TunFirewallResponse response;
        if (request.operation == "resolve") {
            Require(request.rules.Length == 0);
            response = ResolveTunFirewallRequest(request, ResolveTunScope);
        } else {
            foreach (var rule in request.rules) ValidateTunRule(rule);
            var policy = ComCreate("HNetCfg.FwPolicy2");
            response = ApplyTunFirewallRequest(ComProperty(policy, "Rules"), request, () => ComCreate("HNetCfg.FWRule"), ResolveTunScope);
        }
        output.WriteLine(FirewallJson.Serialize(response)); output.Flush(); return 0;
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
        public object Interfaces { get; set; }
        public string IcmpTypesAndCodes { get; set; }
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
    static void TunFirewallSelfTest() {
        var expected = new TunFirewallRule { schemaVersion = 1, guid = "11111111-1111-1111-1111-111111111111", luid = "1234", ifIndex = 17,
            interfaceAlias = "唠蒯云 TUN", localAddress = "10.126.0.3", remoteSubnet = "10.126.0.0/24", ownershipId = new String('c', 32) };
        expected.name = TunFirewallRuleName(expected); ValidateTunRule(expected);
        var ensure = new TunFirewallRequest { schemaVersion = 1, operation = "ensure", rules = new[]{expected} };
        var remove = new TunFirewallRequest { schemaVersion = 1, operation = "remove", rules = new[]{expected} };
        Func<TunFirewallScope, TunFirewallScope> resolve = scope => scope;
        var rules = new FakeFirewallRules();
        Require(ApplyTunFirewallRequest(rules, ensure, () => new FakeFirewallRule(), resolve).installed.Count == 1 && rules.Adds == 1);
        Require(ApplyTunFirewallRequest(rules, ensure, () => new FakeFirewallRule(), resolve).installed.Count == 1 && rules.Adds == 1);
        var rule = (FakeFirewallRule)rules.Values[0];
        Require(rule.Protocol == 1 && rule.IcmpTypesAndCodes == "8:*" && rule.LocalAddresses == expected.localAddress
            && rule.RemoteAddresses == expected.remoteSubnet && TunFirewallInterface(rule, expected.interfaceAlias));
        var edits = new Action<FakeFirewallRule>[] {
            current => current.Action = 0, current => current.Direction = 2, current => current.Enabled = false,
            current => current.Profiles = 3, current => current.Protocol = 6, current => current.ApplicationName = @"C:\foreign.exe",
            current => current.Grouping = "foreign", current => current.Description = "foreign-owner", current => current.InterfaceTypes = "Lan",
            current => current.EdgeTraversal = true, current => current.ServiceName = "foreign", current => current.RemoteAddresses = "*",
            current => current.LocalAddresses = "*", current => current.Interfaces = new object[]{"private CheemsTier"},
            current => current.Interfaces = new object[]{expected.interfaceAlias, "Ethernet"}, current => current.Interfaces = null,
            current => current.IcmpTypesAndCodes = "*", current => current.IcmpTypesAndCodes = "0:*"
        };
        foreach (var edit in edits) {
            var fresh = new FakeFirewallRules(); ApplyTunFirewallRequest(fresh, ensure, () => new FakeFirewallRule(), resolve);
            edit((FakeFirewallRule)fresh.Values[0]);
            Require(ApplyTunFirewallRequest(fresh, remove, null, null).failures.Count == 1 && fresh.Removes == 0);
            Require(ApplyTunFirewallRequest(fresh, ensure, () => new FakeFirewallRule(), resolve).failures.Count == 1 && fresh.Adds == 1);
        }
        rule.RemoteAddresses = "10.126.0.0/255.255.255.0";
        foreach (var local in new[]{"10.126.0.3", "10.126.0.3/32", "10.126.0.3/255.255.255.255"}) {
            rule.LocalAddresses = local; Require(OwnedTunFirewallRule(rule, expected));
        }
        foreach (var local in new[]{"10.126.0.3/24", "10.126.0.3/255.255.255.0", "10.126.0.3,10.126.0.5", "*"}) {
            rule.LocalAddresses = local; Require(!OwnedTunFirewallRule(rule, expected));
        }
        rule.LocalAddresses = "10.126.0.3/255.255.255.255";
        rules.Values.Add(rule); Require(ApplyTunFirewallRequest(rules, remove, null, null).failures.Count == 1 && rules.Removes == 0);
        rules.Values.RemoveAt(1);
        // No adapter resolution during removal: stale owned handles can be cleaned after TUN exit.
        Require(ApplyTunFirewallRequest(rules, remove, null, scope => { throw new Exception("adapter gone"); }).removed.Count == 1 && rules.Removes == 1);
        Require(ApplyTunFirewallRequest(rules, remove, null, null).removed.Count == 1 && rules.Removes == 1);
        var missing = new FakeFirewallRules();
        Require(ApplyTunFirewallRequest(missing, ensure, () => new FakeFirewallRule(), scope => { throw new Exception("adapter unavailable"); }).failures.Count == 1 && missing.Adds == 0);
        Require(ApplyTunFirewallRequest(missing, ensure, () => new FakeFirewallRule(), scope => new TunFirewallScope {interfaceAlias = "renamed"}).failures.Count == 1 && missing.Adds == 0);
        var deferred = ApplyTunFirewallRequest(missing, ensure, () => new FakeFirewallRule(), scope => {throw new TunFirewallNotReadyException();});
        Require(deferred.failures.Count == 1 && deferred.failures[0].code == "tun-not-ready" && missing.Adds == 0);
        var resolving = new TunFirewallRequest {schemaVersion = 1, operation = "resolve", evidence = expected, rules = new TunFirewallRule[0]};
        var notReady = ResolveTunFirewallRequest(resolving, scope => ResolveTunInterface(scope, scope.guid, scope.ifIndex, scope.interfaceAlias, true, new string[0]));
        Require(notReady.failures.Count == 1 && notReady.failures[0].code == "tun-not-ready");
        var down = ResolveTunFirewallRequest(resolving, scope => ResolveTunInterface(scope, scope.guid, scope.ifIndex, scope.interfaceAlias, false, new[]{scope.localAddress}));
        Require(down.failures.Count == 1 && down.failures[0].code == "tun-not-ready");
        foreach (var identity in new[]{"guid", "index"}) {
            var mismatch = ResolveTunFirewallRequest(resolving, scope => ResolveTunInterface(scope, identity == "guid" ? "22222222-2222-2222-2222-222222222222" : scope.guid,
                identity == "index" ? scope.ifIndex + 1 : scope.ifIndex, scope.interfaceAlias, false, new string[0]));
            Require(mismatch.failures.Count == 1 && mismatch.failures[0].code == "tun-scope-unverified");
        }
        Require(ResolveTunFirewallRequest(resolving, scope => ResolveTunInterface(scope, scope.guid, scope.ifIndex, scope.interfaceAlias, true, new[]{scope.localAddress})).scope != null);
        foreach (var subnet in new[]{"0.0.0.0/0", "10.126.0.1/24", "10.126.1.0/24", "10.0.0.0/7", "192.168.0.0/15", "*"}) {
            var original = expected.remoteSubnet; expected.remoteSubnet = subnet; bool rejected = false;
            try { ValidateTunScope(expected, true); } catch { rejected = true; }
            expected.remoteSubnet = original; Require(rejected);
        }
        Console.WriteLine("PASS scoped TUN firewall CLR fixture: " + expected.name + "; exact ICMP/alias/local/subnet, idempotence, 18 collisions, duplicate protection, retained-interface cleanup, invalid and renamed adapters; no host firewall access");
    }
    static int Main(string[] args) {
        try {
            Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 1 && args[0] == "--check") { Console.Write(Elevated() ? "approved" : "ordinary"); return 0; }
            if (args.Length == 1 && args[0] == "--restart-app-self-test") { AppRestartSelfTest(); return 0; }
            if (args.Length == 3 && args[0] == "--restart-app-path-check") {
                using (var seal = new RestartBundleSeal(args[1], args[2])) {
                    AppRestartInfo(seal.Executable, seal.Helper, "{\"userDataDirectory\":null,\"cleanupNetworkRules\":false}");
                    Console.WriteLine("PASS restart bundle read-only path seal: executable/helper and ancestor final paths match; no UAC or app launch");
                    return 0;
                }
            }
            if (args.Length == 2 && args[0] == "--restart-app") return RestartApp(Int32.Parse(args[1]));
            if (args.Length == 1 && args[0] == "--firewall") return FirewallCommand(Console.In, Console.Out);
            if (args.Length == 1 && args[0] == "--firewall-self-test") { FirewallSelfTest(); return 0; }
            if (args.Length == 1 && args[0] == "--firewall-tun") return TunFirewallCommand(Console.In, Console.Out);
            if (args.Length == 1 && args[0] == "--firewall-tun-self-test") { TunFirewallSelfTest(); return 0; }
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
    // Only the actual invoking application in this fixed bundle can be restarted.
    // The executable is obtained from its process handle, never from request text.
    static int RestartApp(int parentPid) {
        Require(parentPid > 0);
        using (var own = Process.GetCurrentProcess())
        using (var query = new System.Management.ManagementObject("Win32_Process.Handle='" + own.Id + "'")) {
            query.Get(); Require(Convert.ToInt32(query["ParentProcessId"]) == parentPid);
            using (var parent = Process.GetProcessById(parentPid)) {
                Require(!parent.HasExited);
                using (var bundle = new RestartBundleSeal(parent.MainModule.FileName, own.MainModule.FileName)) {
                    var executable = bundle.Executable;
                    var helper = bundle.Helper;
                    var start = AppRestartInfo(executable, helper, Line(Console.In));
                    string launchKey;
                    using (var identity = new MemoryStream(Encoding.UTF8.GetBytes(executable.ToLowerInvariant()))) launchKey = Hash(identity);
                    using (var mutex = new Mutex(false, @"Local\LaokuaiCloud.AppRestart." + launchKey)) {
                        var held = false;
                        try {
                            try { held = mutex.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
                            if (!held) { Console.Write("busy"); return 0; }
                            // Holding both files prevents replacement while UAC is pending.
                            using (var appSeal = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read))
                            using (var helperSeal = new FileStream(helper, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                                Require(!parent.HasExited);
                                try {
                                    using (var started = Process.Start(start)) { Require(started != null); }
                                    Console.Write("started"); return 0;
                                } catch (System.ComponentModel.Win32Exception error) {
                                    if (error.NativeErrorCode != 1223) throw;
                                    Console.Write("cancelled"); return 0;
                                }
                            }
                        } finally { if (held) mutex.ReleaseMutex(); }
                    }
                }
            }
        }
    }
    [StructLayout(LayoutKind.Sequential)] struct RestartAttributeTag { public uint Attributes, Tag; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct RestartFindData {
        public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh, SizeHigh, SizeLow, Tag, Reserved;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=14)] public string Alternate;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, out RestartAttributeTag info, uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindFirstFileW(string path, out RestartFindData data);
    [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr handle);
    // Official WinNT.h constants, verified against Microsoft's SDK metadata:
    // https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/winnt.h
    const uint RestartCloudTag = 0x9000001A, RestartCloudVariantMask = 0x0000F000, RestartNameSurrogate = 0x20000000;
    const uint RestartReparseAttribute = 0x400, RestartDirectoryAttribute = 0x10;
    const uint RestartOfflineAttribute = 0x1000, RestartRecallDataAttribute = 0x400000;
    static bool AllowedRestartEntry(uint attributes, uint tag) {
        if ((attributes & RestartReparseAttribute) != 0 && ((tag & RestartNameSurrogate) != 0
            || (tag & ~RestartCloudVariantMask) != RestartCloudTag)) return false;
        // A directory can virtualize unrelated children while our executable is
        // fully local. Only executable/helper leaves must need no data recall.
        return (attributes & RestartDirectoryAttribute) != 0
            || (attributes & (RestartOfflineAttribute | RestartRecallDataAttribute)) == 0;
    }
    sealed class RestartBundleSeal : IDisposable {
        readonly List<SafeFileHandle> held = new List<SafeFileHandle>();
        public readonly string Executable, Helper;
        public RestartBundleSeal(string executable, string helper) {
            try { Executable = SealPath(executable); Helper = SealPath(helper); }
            catch { Dispose(); throw; }
        }
        string SealPath(string value) {
            Require(!String.IsNullOrEmpty(value) && Regex.IsMatch(value, @"\A[A-Za-z]:[\\/]")
                && !Regex.IsMatch(value, "[\"\x00-\x1f]") && value.IndexOf(':', 2) < 0);
            var full = Path.GetFullPath(value); var ancestors = new Stack<string>();
            for (var path = full; !String.IsNullOrEmpty(path); path = Path.GetDirectoryName(path)) ancestors.Push(path);
            while (ancestors.Count > 0) {
                var path = ancestors.Pop();
                // READ_ATTRIBUTES, share read only, no write/delete. OPEN_REPARSE_POINT
                // queries the tag itself; BACKUP_SEMANTICS also opens directories.
                // Keep every ancestor handle open so paths cannot be renamed
                // after validation and before ShellExecute resolves the target.
                var handle = CreateFileW(path, 0x80, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                held.Add(handle); Require(!handle.IsInvalid);
                RestartAttributeTag info;
                Require(GetFileInformationByHandleEx(handle, 9, out info, 8)); // FileAttributeTagInfo
                Require(AllowedRestartEntry(info.Attributes, info.Tag));
                var final = new StringBuilder(32768); var length = GetFinalPathNameByHandleW(handle, final, 32768, 0);
                Require(length > 0 && length < 32768 && String.Equals(final.ToString(), @"\\?\" + path, StringComparison.OrdinalIgnoreCase));
                // Cloud providers can hide their tag in the handle view while
                // retaining it in directory metadata. Validate that view too:
                // WIN32_FIND_DATA.dwReserved0 is the tag when REPARSE_POINT is set.
                // https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ns-minwinbase-win32_find_dataw
                if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) {
                    RestartFindData found; var search = FindFirstFileW(path, out found);
                    Require(search != new IntPtr(-1));
                    try {
                        Require(AllowedRestartEntry(found.Attributes, found.Tag));
                    } finally { FindClose(search); }
                }
                if (path == full) Require((info.Attributes & RestartDirectoryAttribute) == 0);
            }
            return full;
        }
        public void Dispose() { foreach (var handle in held) handle.Dispose(); held.Clear(); }
    }
    static ProcessStartInfo AppRestartInfo(string executable, string helper, string request) {
        Require(request != null && request.Length < 16384);
        executable = Path.GetFullPath(executable); helper = Path.GetFullPath(helper);
        Require(Regex.IsMatch(executable, @"\A[A-Za-z]:[\\/]") && !Regex.IsMatch(executable, "[\"\x00-\x1f]")
            && String.Equals(Path.GetExtension(executable), ".exe", StringComparison.OrdinalIgnoreCase));
        var directory = Path.GetDirectoryName(executable);
        Require(String.Equals(helper, Path.Combine(directory, "resources", "community-lan-helper", "laokuai-community-broker.exe"), StringComparison.OrdinalIgnoreCase));
        var values = Json.Deserialize<Dictionary<string, object>>(request);
        Require(values.Count == 2 && values.ContainsKey("userDataDirectory") && values.ContainsKey("cleanupNetworkRules")
            && values["cleanupNetworkRules"] is bool && (values["userDataDirectory"] == null || values["userDataDirectory"] is string));
        var arguments = "--laokuai-admin-restarted";
        if (values["userDataDirectory"] != null) {
            var profile = (string)values["userDataDirectory"];
            Require(profile.Length < 32768 && Regex.IsMatch(profile, @"\A[A-Za-z]:[\\/]") && !Regex.IsMatch(profile, "[\"\x00-\x1f]"));
            // Always quote a Windows argv token, doubling trailing backslashes.
            arguments += " \"--user-data-dir=" + Regex.Replace(profile, @"(\\+)\z", "$1$1") + "\"";
        }
        if ((bool)values["cleanupNetworkRules"]) arguments += " --cleanup-network-rules";
        return new ProcessStartInfo(executable, arguments) {
            UseShellExecute = true, Verb = "runas", WorkingDirectory = directory,
            WindowStyle = ProcessWindowStyle.Normal
        };
    }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    static string[] RestartTestArgv(string arguments) {
        int count; var memory = CommandLineToArgvW("fixture.exe " + arguments, out count); Require(memory != IntPtr.Zero);
        try {
            var values = new string[count - 1];
            for (var index = 1; index < count; index++) values[index - 1] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, index * IntPtr.Size));
            return values;
        } finally { LocalFree(memory); }
    }
    static void AppRestartSelfTest() {
        for (uint variant = 0; variant < 16; variant++) Require(AllowedRestartEntry(0x420, RestartCloudTag | (variant << 12)));
        Require(AllowedRestartEntry(0x80, 0) && AllowedRestartEntry(0x400410, RestartCloudTag));
        foreach (var tag in new uint[]{0xA000000C, 0xA0000003, 0xA0000019, 0x8000001B, 0x9000001C, 0x9001001A}) Require(!AllowedRestartEntry(0x420, tag));
        Require(!AllowedRestartEntry(0x1420, RestartCloudTag) && !AllowedRestartEntry(0x400420, RestartCloudTag));
        var executable = @"C:\绿色 目录\唠蒯云.exe";
        var helper = @"C:\绿色 目录\resources\community-lan-helper\laokuai-community-broker.exe";
        var request = Json.Serialize(new Dictionary<string, object> {{"userDataDirectory", @"D:\中文 & $ 数据\"}, {"cleanupNetworkRules", true}});
        var info = AppRestartInfo(executable, helper, request);
        Require(info.FileName == executable && info.WorkingDirectory == @"C:\绿色 目录" && info.UseShellExecute && info.Verb == "runas");
        Require(info.Arguments == "--laokuai-admin-restarted \"--user-data-dir=D:\\中文 & $ 数据\\\\\" --cleanup-network-rules");
        var parsed = RestartTestArgv(info.Arguments);
        Require(parsed.Length == 3 && parsed[0] == "--laokuai-admin-restarted"
            && parsed[1] == @"--user-data-dir=D:\中文 & $ 数据\" && parsed[2] == "--cleanup-network-rules");
        var rootProfile = AppRestartInfo(executable, helper, Json.Serialize(new Dictionary<string, object> {{"userDataDirectory", @"C:\"}, {"cleanupNetworkRules", false}}));
        Require(RestartTestArgv(rootProfile.Arguments)[1] == @"--user-data-dir=C:\");
        Require(AppRestartInfo(executable, helper, "{\"userDataDirectory\":null,\"cleanupNetworkRules\":false}").Arguments == "--laokuai-admin-restarted");
        foreach (var bad in new[]{"{\"userDataDirectory\":\"relative\",\"cleanupNetworkRules\":false}",
            "{\"userDataDirectory\":\"C:\\\\x\\\" --inspect\",\"cleanupNetworkRules\":false}",
            "{\"userDataDirectory\":null,\"cleanupNetworkRules\":\"true\"}",
            "{\"userDataDirectory\":null,\"cleanupNetworkRules\":false,\"executable\":\"cmd.exe\"}"}) {
            var rejected = false; try { AppRestartInfo(executable, helper, bad); } catch { rejected = true; } Require(rejected);
        }
        var wrongBundle = false; try { AppRestartInfo(executable, @"C:\other\resources\community-lan-helper\laokuai-community-broker.exe", request); } catch { wrongBundle = true; } Require(wrongBundle);
        Console.WriteLine("PASS fixed app restart: Chinese/space paths, whitelist, profile, maintenance, runas settings, foreign bundle rejected; no UAC or process launch");
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
