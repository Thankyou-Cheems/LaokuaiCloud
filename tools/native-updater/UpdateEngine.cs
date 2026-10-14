using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace LaokuaiUpdater
{
    public enum ProbeResult { Baseline, Target, Invalid }

    // This engine writes only embedded-policy program paths. It never walks the profile tree.
    public sealed class UpdateEngine : IDisposable
    {
        const long FileLimit = 1073741824;
        const long TotalLimit = 4294967296;
        const int MetadataLimit = 2097152;
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = MetadataLimit, RecursionLimit = 32 };
        readonly HashSet<string> policy = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, ZipArchiveEntry> entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, Record> baseline = new Dictionary<string, Record>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, Record> target = new Dictionary<string, Record>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, Change> changes = new Dictionary<string, Change>(StringComparer.OrdinalIgnoreCase);
        readonly List<Record> archiveRecords = new List<Record>();
        readonly string packageSha;
        MemoryStream snapshot;
        ZipArchive archive;
        public string BaseVersion { get; private set; }
        public string TargetVersion { get; private set; }
#if UPDATER_TESTS
        internal static Action<int> TestAfterReplacement;
        internal static bool TestSimulateInterruption;
#endif
        sealed class Record { public string Path, Hash; public long Size; }
        sealed class Change { public string Path, Kind, Payload; public long[] Offsets; public bool BackedUp, Installed; }

        public UpdateEngine(Stream package, string expectedSha, string policyJson)
        {
            HashValue(expectedSha); packageSha = expectedSha;
            try
            {
                snapshot = new MemoryStream();
                CopyBounded(package, snapshot, 268435456);
                snapshot.Position = 0;
                if (Hash(snapshot) != expectedSha) throw new InvalidDataException("Update package hash mismatch.");
                snapshot.Position = 0;
                Dictionary<string, object> p = Object(json.DeserializeObject(policyJson));
                if (Number(p, "schema") != 1) throw new InvalidDataException("Unsupported program policy.");
                foreach (object item in Array(p, "paths"))
                {
                    string path = item as string; SafeRelative(path);
                    if (!policy.Add(path) || policy.Count > 1024) throw new InvalidDataException("Duplicate program policy.");
                }
                if (!policy.Contains("唠蒯云.exe") || !policy.Contains("resources/app.asar")) throw new InvalidDataException("Incomplete program policy.");
                archive = new ZipArchive(snapshot, ZipArchiveMode.Read, true);
                ReadIndex(); ReadManifest();
            }
            catch { Dispose(); throw; }
        }

        public void Dispose()
        {
            if (archive != null) { archive.Dispose(); archive = null; }
            if (snapshot != null) { snapshot.Dispose(); snapshot = null; }
        }

        public ProbeResult Probe(string directory)
        {
            try
            {
                string root = InstallRoot(directory);
                if (Matches(root, target) && Absent(root, baseline, target)) return ProbeResult.Target;
                if (Matches(root, baseline) && Absent(root, target, baseline)) return ProbeResult.Baseline;
            }
            catch { }
            return ProbeResult.Invalid;
        }

        public string Apply(string directory, Action<string> progress)
        {
            if (archive == null) throw new ObjectDisposedException("UpdateEngine");
            string root = InstallRoot(directory), work = null;
            string mutexName = "Local\\LaokuaiUpdate-" + HashBytes(Encoding.UTF8.GetBytes(root.ToUpperInvariant()));
            using (Mutex mutex = new Mutex(false, mutexName))
            {
                bool acquired = false;
                try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new IOException("An update is already in progress.");
                List<FileStream> guards = new List<FileStream>();
                List<Change> committed = new List<Change>();
                Dictionary<string, object> report = null;
                try
                {
                    foreach (Change change in changes.Values) { change.BackedUp = false; change.Installed = false; }
                    CheckInterrupted(root);
                    AssertAppStopped(root);
                    Emit(progress, "正在校验原程序");
                    foreach (Record record in baseline.Values)
                    {
                        string path = Under(root, record.Path); CheckPath(path);
                        FileStream guard = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                        guards.Add(guard);
                        if (guard.Length != record.Size || Hash(guard) != record.Hash) throw new InvalidDataException("Baseline program mismatch.");
                        guard.Position = 0;
                    }
                    if (!Absent(root, target, baseline)) throw new IOException("An added program path already exists.");
                    string parent = Path.GetDirectoryName(root);
                    CheckPath(parent);
                    work = Path.Combine(parent, ".laokuai-update-" + Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(work); CheckPath(work);
                    string stage = Path.Combine(work, "stage"), backup = Path.Combine(work, "backup"), payloads = Path.Combine(work, "payloads");
                    Directory.CreateDirectory(stage); Directory.CreateDirectory(backup); Directory.CreateDirectory(payloads);
                    report = new Dictionary<string, object> {
                        {"schema", 1}, {"engine", "laokuai-native-v1"}, {"installDirectory", root},
                        {"status", "staging"}, {"baseVersion", BaseVersion}, {"targetVersion", TargetVersion},
                        {"updateZipSha256", packageSha}, {"backupDirectory", backup},
                        {"userFiles", "not enumerated or modified"}
                    };
                    // A separate durable owner record lets another installation ignore a damaged report.
                    WriteJson(Path.Combine(work, "owner.json"), new Dictionary<string, object> {
                        {"engine", "laokuai-native-v1"}, {"installDirectory", root}
                    });
                    WriteJson(Path.Combine(work, "report.json"), report);
                    WriteJournal(work, committed);
                    Emit(progress, "正在准备更新程序");
                    foreach (Record record in archiveRecords)
                    {
                        string destination = Under(payloads, record.Path); CreateParent(destination);
                        using (Stream input = entries[record.Path].Open())
                        using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        { CopyExact(input, output, record.Size); output.Flush(true); }
                        Verify(destination, record);
                    }
                    foreach (Record record in target.Values)
                    {
                        string destination = Under(stage, record.Path); CreateParent(destination);
                        Change change;
                        if (!changes.TryGetValue(record.Path, out change) || change.Kind == "blocks")
                        {
                            string source = Under(root, record.Path); CheckPath(source);
                            File.Copy(source, destination, false);
                            if (change != null) ApplyBlocks(destination, Under(payloads, change.Payload), change);
                        }
                        else File.Copy(Under(payloads, change.Payload), destination, false);
                        Verify(destination, record);
                    }
                    foreach (FileStream guard in guards) guard.Dispose(); guards.Clear();
                    AssertAppStopped(root);
                    if (!Matches(root, baseline) || !Absent(root, target, baseline)) throw new IOException("Program changed during preparation.");
                    report["status"] = "replacing"; WriteJson(Path.Combine(work, "report.json"), report);
                    Emit(progress, "正在备份并替换程序");
                    foreach (Change change in changes.Values)
                    {
                        AssertAppStopped(root);
                        string destination = Under(root, change.Path), saved = Under(backup, change.Path);
                        CheckPath(destination); CheckPath(saved);
                        Record old;
                        if (baseline.TryGetValue(change.Path, out old)) Verify(destination, old);
                        else if (File.Exists(destination) || Directory.Exists(destination)) throw new IOException("An added program path already exists.");
                        committed.Add(change); WriteJournal(work, committed); // intent is durable before the first move
                        if (old != null)
                        {
                            CreateParent(saved); File.Move(destination, saved); change.BackedUp = true; WriteJournal(work, committed);
                        }
                        if (change.Kind != "delete")
                        {
                            CreateParent(destination); CheckPath(destination);
                            File.Move(Under(stage, change.Path), destination); change.Installed = true;
                        }
                        WriteJournal(work, committed);
#if UPDATER_TESTS
                        if (TestAfterReplacement != null) TestAfterReplacement(committed.Count);
#endif
                    }
                    Emit(progress, "正在验证更新");
                    if (!Matches(root, target) || !Absent(root, baseline, target)) throw new InvalidDataException("Updated program verification failed.");
                    report["status"] = "complete"; WriteJson(Path.Combine(work, "report.json"), report);
                    return work;
                }
                catch (Exception error)
                {
                    foreach (FileStream guard in guards) guard.Dispose(); guards.Clear();
                    if (work != null)
                    {
                        error.Data["RecoveryDirectory"] = work;
#if UPDATER_TESTS
                        if (TestSimulateInterruption) throw;
#endif
                        List<string> failures = new List<string>();
                        for (int i = committed.Count - 1; i >= 0; i--)
                        {
                            Change change = committed[i];
                            try
                            {
                                string destination = Under(root, change.Path), saved = Under(Path.Combine(work, "backup"), change.Path);
                                CheckPath(destination); CheckPath(saved);
                                if (change.Installed)
                                {
                                    Verify(destination, target[change.Path]); File.Delete(destination);
                                }
                                if (change.BackedUp)
                                {
                                    Verify(saved, baseline[change.Path]);
                                    if (File.Exists(destination) || Directory.Exists(destination)) throw new IOException("Rollback destination occupied.");
                                    CreateParent(destination); File.Copy(saved, destination, false); Verify(destination, baseline[change.Path]);
                                }
                            }
                            catch (Exception rollbackError) { failures.Add(rollbackError.Message); }
                        }
                        if (committed.Count > 0 && (!Matches(root, baseline) || !Absent(root, target, baseline))) failures.Add("Baseline restoration verification failed.");
                        if (report != null)
                        {
                            report["status"] = failures.Count > 0 ? "rollback-failed" : committed.Count > 0 ? "rolled-back" : "rejected";
                            report["failure"] = error.Message; report["rollbackFailures"] = failures;
                            try { WriteJson(Path.Combine(work, "report.json"), report); } catch { }
                        }
                    }
                    throw;
                }
                finally
                {
                    foreach (FileStream guard in guards) guard.Dispose();
                    mutex.ReleaseMutex();
                }
            }
        }

        void ReadIndex()
        {
            if (archive.Entries.Count > 1024) throw new InvalidDataException("Too many package entries.");
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            List<string> directories = new List<string>(); long total = 0;
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                bool directory = entry.FullName.EndsWith("/", StringComparison.Ordinal);
                string name = directory ? entry.FullName.Substring(0, entry.FullName.Length - 1) : entry.FullName;
                SafeRelative(name);
                if (!names.Add(name)) throw new InvalidDataException("Duplicate package path.");
                int attributes = entry.ExternalAttributes;
                if (((attributes >> 16) & 0xf000) == 0xa000 || (attributes & 0x400) != 0) throw new InvalidDataException("Redirecting package entry.");
                if (entry.Length < 0 || entry.Length > FileLimit || (total += entry.Length) > TotalLimit) throw new InvalidDataException("Oversized package.");
                if (directory) { if (entry.Length != 0) throw new InvalidDataException("Invalid directory entry."); directories.Add(name); }
                else entries.Add(name, entry);
            }
            foreach (string file in entries.Keys)
            {
                int slash = file.IndexOf('/');
                while (slash >= 0) { if (entries.ContainsKey(file.Substring(0, slash))) throw new InvalidDataException("Package file/directory collision."); slash = file.IndexOf('/', slash + 1); }
            }
            foreach (string directory in directories)
            {
                bool used = false; foreach (string file in entries.Keys) if (file.StartsWith(directory + "/", StringComparison.OrdinalIgnoreCase)) { used = true; break; }
                if (!used) throw new InvalidDataException("Unrelated package directory.");
            }
        }

        void ReadManifest()
        {
            ZipArchiveEntry entry;
            if (!entries.TryGetValue("update.json", out entry) || entry.Length > MetadataLimit) throw new InvalidDataException("Missing update manifest.");
            Dictionary<string, object> manifest;
            using (Stream input = entry.Open()) using (MemoryStream data = new MemoryStream())
            { CopyExact(input, data, entry.Length); manifest = Object(json.DeserializeObject(new UTF8Encoding(false, true).GetString(data.ToArray()))); }
            if (Number(manifest, "schema") != 1 || Text(manifest, "format") != "laokuai-fixed-blocks-v1" || Number(manifest, "blockSize") != 65536) throw new InvalidDataException("Unsupported update format.");
            BaseVersion = Text(manifest, "baseVersion"); TargetVersion = Text(manifest, "targetVersion");
            if (BaseVersion.Length > 128 || TargetVersion.Length > 128 || BaseVersion == TargetVersion) throw new InvalidDataException("Invalid update versions.");
            HashValue(Text(manifest, "baseZipSha256")); HashValue(Text(manifest, "targetZipSha256"));
            ReadSet(Array(manifest, "baseFiles"), baseline); ReadSet(Array(manifest, "targetFiles"), target);
            HashSet<string> declared = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "update.json" };
            HashSet<string> tools = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
                "updater/apply-incremental-update.ps1", "updater/apply-incremental-update.cmd",
                "updater/incremental-update-lib.ps1", "updater/incremental-program-paths.json" };
            foreach (object item in Array(manifest, "updaterFiles"))
            {
                Record record = ReadRecord(Object(item));
                if (!tools.Remove(record.Path) || record.Size > MetadataLimit) throw new InvalidDataException("Invalid updater entry.");
                Declare(record, declared);
            }
            if (tools.Count != 0) throw new InvalidDataException("Incomplete updater entries.");
            foreach (object item in Array(manifest, "changes"))
            {
                Dictionary<string, object> raw = Object(item);
                Change change = new Change { Path = Text(raw, "path"), Kind = Text(raw, "kind") };
                ProgramPath(change.Path);
                if (changes.ContainsKey(change.Path)) throw new InvalidDataException("Duplicate program change.");
                if (change.Kind == "delete")
                {
                    if (!baseline.ContainsKey(change.Path) || target.ContainsKey(change.Path)) throw new InvalidDataException("Invalid deletion.");
                }
                else
                {
                    if (!target.ContainsKey(change.Path) || (change.Kind != "replace" && change.Kind != "blocks")) throw new InvalidDataException("Invalid program change.");
                    change.Payload = Text(raw, "payload");
                    if (!Regex.IsMatch(change.Payload, "^payload/[0-9]{4}\\.bin$")) throw new InvalidDataException("Invalid payload path.");
                    Record payload = new Record { Path = change.Payload, Size = Number(raw, "payloadSize"), Hash = Text(raw, "payloadSha256") };
                    HashValue(payload.Hash); Declare(payload, declared);
                    List<long> offsets = new List<long>(); foreach (object value in Array(raw, "offsets")) offsets.Add(Integer(value));
                    if (offsets.Count > 16384) throw new InvalidDataException("Too many block offsets.");
                    change.Offsets = offsets.ToArray();
                    if (change.Kind == "replace") { if (offsets.Count != 0 || payload.Size != target[change.Path].Size) throw new InvalidDataException("Invalid replacement size."); }
                    else
                    {
                        if (!baseline.ContainsKey(change.Path) || baseline[change.Path].Size != target[change.Path].Size || offsets.Count == 0) throw new InvalidDataException("Invalid block baseline.");
                        long previous = -1, length = target[change.Path].Size, expected = 0;
                        foreach (long offset in offsets)
                        {
                            if (offset < 0 || offset <= previous || offset % 65536 != 0 || offset >= length) throw new InvalidDataException("Invalid block offset.");
                            previous = offset; expected += Math.Min(65536, length - offset);
                        }
                        if (expected != payload.Size) throw new InvalidDataException("Invalid block payload size.");
                    }
                }
                changes.Add(change.Path, change);
                if (changes.Count > 1024) throw new InvalidDataException("Too many changes.");
            }
            foreach (Record record in baseline.Values) if (!target.ContainsKey(record.Path) && !changes.ContainsKey(record.Path)) throw new InvalidDataException("Missing deletion.");
            foreach (Record record in target.Values)
            {
                Record old; bool changed = !baseline.TryGetValue(record.Path, out old) || old.Size != record.Size || old.Hash != record.Hash;
                if (changed != changes.ContainsKey(record.Path)) throw new InvalidDataException("Incomplete/redundant change set.");
            }
            foreach (string file in entries.Keys) if (!declared.Contains(file)) throw new InvalidDataException("Undeclared package file.");
        }

        void ReadSet(IEnumerable values, Dictionary<string, Record> set)
        {
            long total = 0;
            foreach (object value in values)
            {
                Record record = ReadRecord(Object(value)); ProgramPath(record.Path);
                if (set.ContainsKey(record.Path) || set.Count >= 1024 || (total += record.Size) > TotalLimit) throw new InvalidDataException("Invalid program set.");
                set.Add(record.Path, record);
            }
            if (!set.ContainsKey("唠蒯云.exe") || !set.ContainsKey("resources/app.asar")) throw new InvalidDataException("Incomplete program set.");
            foreach (string file in set.Keys)
            { int slash = file.IndexOf('/'); while (slash >= 0) { if (set.ContainsKey(file.Substring(0, slash))) throw new InvalidDataException("Program path collision."); slash = file.IndexOf('/', slash + 1); } }
        }

        Record ReadRecord(Dictionary<string, object> raw)
        {
            Record record = new Record { Path = Text(raw, "path"), Size = Number(raw, "size"), Hash = Text(raw, "sha256") };
            SafeRelative(record.Path); HashValue(record.Hash);
            if (record.Size < 0 || record.Size > FileLimit) throw new InvalidDataException("Invalid file size.");
            return record;
        }
        void Declare(Record record, HashSet<string> declared)
        {
            ZipArchiveEntry entry;
            if (record.Size < 0 || record.Size > FileLimit || !declared.Add(record.Path) || !entries.TryGetValue(record.Path, out entry) || entry.Length != record.Size) throw new InvalidDataException("Missing/invalid declared payload.");
            archiveRecords.Add(record);
        }
        void ProgramPath(string path) { SafeRelative(path); if (!policy.Contains(path)) throw new InvalidDataException("Path outside program policy."); }
        static Dictionary<string, object> Object(object value)
        { var result = value as Dictionary<string, object>; if (result == null) throw new InvalidDataException("Invalid JSON object."); return result; }
        static string Text(Dictionary<string, object> value, string key)
        { object raw; string result; if (!value.TryGetValue(key, out raw) || (result = raw as string) == null || result.Length == 0) throw new InvalidDataException("Missing string: " + key); return result; }
        static IEnumerable Array(Dictionary<string, object> value, string key)
        { object raw; if (!value.TryGetValue(key, out raw) || !(raw is object[])) throw new InvalidDataException("Missing array: " + key); return (object[])raw; }
        static long Number(Dictionary<string, object> value, string key)
        { object raw; if (!value.TryGetValue(key, out raw)) throw new InvalidDataException("Missing number: " + key); return Integer(raw); }
        static long Integer(object value)
        { if (value is int) return (int)value; if (value is long) return (long)value; throw new InvalidDataException("Noninteger number."); }
        static void HashValue(string value)
        { if (value == null || !Regex.IsMatch(value, "^[0-9a-f]{64}$")) throw new InvalidDataException("Invalid SHA256."); }
        static void SafeRelative(string path)
        {
            if (String.IsNullOrEmpty(path) || path.Length > 240 || path.StartsWith("/", StringComparison.Ordinal) || Regex.IsMatch(path, "[\\\\:\\x00-\\x1f<>\"|?*]")) throw new InvalidDataException("Unsafe relative path.");
            foreach (string part in path.Split('/'))
                if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(" ", StringComparison.Ordinal) || part.EndsWith(".", StringComparison.Ordinal) || Regex.IsMatch(part, "^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])($|\\.)", RegexOptions.IgnoreCase)) throw new InvalidDataException("Unsafe Windows path.");
        }
        static string Under(string root, string relative)
        {
            SafeRelative(relative); string path = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Path escaped directory.");
            return path;
        }
        static string InstallRoot(string directory)
        {
            string root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
            if (root.Length < 4 || !Directory.Exists(root)) throw new IOException("Installation directory missing.");
            string temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
            if (root.Equals(temp, StringComparison.OrdinalIgnoreCase) || root.StartsWith(temp + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Temporary installation directory refused.");
            CheckPath(root); return root;
        }
        static void CreateParent(string path) { string parent = Path.GetDirectoryName(path); CheckPath(parent); Directory.CreateDirectory(parent); CheckPath(parent); }
        static bool Matches(string root, Dictionary<string, Record> set)
        { try { foreach (Record record in set.Values) Verify(Under(root, record.Path), record); return true; } catch { return false; } }
        static bool Absent(string root, Dictionary<string, Record> other, Dictionary<string, Record> present)
        {
            foreach (string relative in other.Keys) if (!present.ContainsKey(relative)) { string path = Under(root, relative); CheckPath(path); if (File.Exists(path) || Directory.Exists(path)) return false; }
            return true;
        }
        static void Verify(string path, Record record)
        {
            CheckPath(path);
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                if (stream.Length != record.Size || Hash(stream) != record.Hash) throw new InvalidDataException("Program/payload verification failed.");
        }
        static string Hash(Stream stream)
        { using (SHA256 sha = SHA256.Create()) { return Hex(sha.ComputeHash(stream)); } }
        static string HashBytes(byte[] data)
        { using (SHA256 sha = SHA256.Create()) { return Hex(sha.ComputeHash(data)); } }
        static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
        static void CopyBounded(Stream input, Stream output, long limit)
        {
            byte[] buffer = new byte[65536]; long total = 0; int count;
            while ((count = input.Read(buffer, 0, buffer.Length)) != 0) { total += count; if (total > limit) throw new InvalidDataException("Oversized package."); output.Write(buffer, 0, count); }
        }
        static void CopyExact(Stream input, Stream output, long length)
        {
            byte[] buffer = new byte[65536]; long left = length;
            while (left > 0) { int count = input.Read(buffer, 0, (int)Math.Min(left, buffer.Length)); if (count == 0) throw new InvalidDataException("Truncated payload."); output.Write(buffer, 0, count); left -= count; }
            if (input.ReadByte() != -1) throw new InvalidDataException("Trailing payload bytes.");
        }
        static void ApplyBlocks(string destination, string payload, Change change)
        {
            using (FileStream input = new FileStream(payload, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (FileStream output = new FileStream(destination, FileMode.Open, FileAccess.Write, FileShare.None))
            {
                byte[] buffer = new byte[65536];
                foreach (long offset in change.Offsets)
                {
                    output.Position = offset; int left = (int)Math.Min(65536, output.Length - offset);
                    while (left > 0) { int count = input.Read(buffer, 0, Math.Min(left, buffer.Length)); if (count == 0) throw new InvalidDataException("Truncated block."); output.Write(buffer, 0, count); left -= count; }
                }
                if (input.ReadByte() != -1) throw new InvalidDataException("Trailing blocks."); output.Flush(true);
            }
        }
        static void Emit(Action<string> progress, string message) { if (progress != null) progress(message); }
        void WriteJson(string path, object value)
        {
            CheckPath(path); string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            byte[] data = new UTF8Encoding(false).GetBytes(json.Serialize(value));
            using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { stream.Write(data, 0, data.Length); stream.Flush(true); }
            if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
        }
        void WriteJournal(string work, List<Change> committed)
        {
            List<object> records = new List<object>();
            foreach (Change change in committed) records.Add(new Dictionary<string, object> { { "path", change.Path }, { "kind", change.Kind }, { "backedUp", change.BackedUp }, { "installed", change.Installed } });
            WriteJson(Path.Combine(work, "journal.json"), records);
        }
        void CheckInterrupted(string root)
        {
            int count = 0;
            foreach (string path in Directory.EnumerateDirectories(Path.GetDirectoryName(root), ".laokuai-update-*", SearchOption.TopDirectoryOnly))
            {
                if (++count > 256) throw new IOException("Too many recovery directories; manual review required.");
                if (!Regex.IsMatch(Path.GetFileName(path), "^\\.laokuai-update-[0-9a-f]{32}$")) continue;
                string reportPath = Path.Combine(path, "report.json");
                if (!File.Exists(reportPath)) continue;
                Dictionary<string, object> report;
                try
                {
                    string ownerPath = Path.Combine(path, "owner.json");
                    if (File.Exists(ownerPath))
                    {
                        CheckPath(ownerPath);
                        if (new FileInfo(ownerPath).Length > MetadataLimit) throw new InvalidDataException("Oversized recovery owner record.");
                        Dictionary<string, object> owner = Object(json.DeserializeObject(File.ReadAllText(ownerPath, Encoding.UTF8)));
                        if (Text(owner, "engine") != "laokuai-native-v1" || !String.Equals(Text(owner, "installDirectory"), root, StringComparison.OrdinalIgnoreCase)) continue;
                    }
                    CheckPath(reportPath);
                    if (new FileInfo(reportPath).Length > MetadataLimit) throw new InvalidDataException("Oversized recovery record.");
                    report = Object(json.DeserializeObject(File.ReadAllText(reportPath, Encoding.UTF8)));
                }
                catch (Exception cause)
                {
                    IOException error = new IOException("Cannot safely inspect a recovery record; manual review required.", cause);
                    error.Data["RecoveryDirectory"] = path; throw error;
                }
                object identity, engine;
                if (!report.TryGetValue("engine", out engine) || !System.Object.Equals(engine, "laokuai-native-v1") || !report.TryGetValue("installDirectory", out identity) || !(identity is string) || !String.Equals((string)identity, root, StringComparison.OrdinalIgnoreCase)) continue;
                string status = Text(report, "status");
                if (status != "complete" && status != "rolled-back" && status != "rejected")
                { IOException error = new IOException("An interrupted update needs manual recovery before continuing."); error.Data["RecoveryDirectory"] = path; throw error; }
            }
        }

        public static void AssertAppStopped(string directory)
        {
            string root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "唠蒯云", "easytier-cli", "easytier-core", "laokuai-community-broker", "audio-capture", "screen-capture", "squad-scope" };
            int current = Process.GetCurrentProcess().Id;
            foreach (Process process in Process.GetProcesses())
            {
                using (process)
                {
                    if (process.Id == current) continue;
                    string name = null;
                    try { name = process.ProcessName; } catch { continue; }
                    string executable;
                    try { executable = process.MainModule.FileName; }
                    catch { if (names.Contains(name)) throw new IOException("Please exit the application and its helpers before updating."); continue; }
                    if (executable.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Please exit the application and its helpers before updating.");
                }
            }
        }

        public static bool IsAllowedReparseTag(uint tag) { return (tag & 0xffff0fffU) == 0x9000001aU; }
        public static void AssertSafePath(string path) { CheckPath(path); }
        static void CheckPath(string path)
        {
            string current = Path.GetFullPath(path);
            while (!String.IsNullOrEmpty(current))
            {
                FileAttributes attributes;
                try { attributes = File.GetAttributes(current); }
                catch (FileNotFoundException) { current = Path.GetDirectoryName(current); continue; }
                catch (DirectoryNotFoundException) { current = Path.GetDirectoryName(current); continue; }
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    using (SafeFileHandle handle = CreateFile(current, 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero))
                    {
                        byte[] data = new byte[16384]; uint returned;
                        if (handle.IsInvalid || !DeviceIoControl(handle, 0x000900a8, IntPtr.Zero, 0, data, (uint)data.Length, out returned, IntPtr.Zero) || returned < 4) throw new IOException("Cannot validate redirected path.");
                        uint tag = BitConverter.ToUInt32(data, 0);
                        if (!IsAllowedReparseTag(tag)) throw new IOException("Redirected installation path refused.");
                    }
                }
                string next = Path.GetDirectoryName(current); if (next == current) break; current = next;
            }
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool DeviceIoControl(SafeFileHandle handle, uint code, IntPtr input, uint inputSize, byte[] output, uint outputSize, out uint returned, IntPtr overlapped);
    }
}
