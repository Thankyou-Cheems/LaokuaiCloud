using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using LaokuaiUpdater;

// Fixture compiled with the actual engine/discovery and hidden production Form.
// Only a test-owned child is launched; no product, desktop scan or network is used.
internal static class NativeUpdaterTests
{
    private static string Root;
    private static string Policy;
    private static int Passed;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly Encoding Utf8 = new UTF8Encoding(false);
    private static void IgnoreProgress(string message) { }

    // Create actual .lnk files with the OS Unicode API. PowerShell's WScript
    // TargetPath setter fails with E_INVALIDARG on the en-US CI runner, including
    // existing targets; production reads remain covered by Discovery below.
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink { }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr findData, uint flags);
        void GetIDList(out IntPtr itemList);
        void SetIDList(IntPtr itemList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int count);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int count);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int count);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    private static void CreateShortcut(string name, string target, string arguments)
    {
        Console.WriteLine("[NativeUpdater] create Unicode shortcut fixture: " + name);
        object link = new ShellLink();
        try
        {
            IShellLinkW unicode = (IShellLinkW)link;
            unicode.SetPath(Path.GetFullPath(target));
            unicode.SetArguments(arguments);
            ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(Path.Combine(Root, name), true);
            Assert(File.Exists(Path.Combine(Root, name)), "Unicode shortcut was not saved: " + name);
        }
        finally { Marshal.FinalReleaseComObject(link); }
    }

    private sealed class Fixture
    {
        internal string Directory;
        internal string Zip;
        internal Dictionary<string, byte[]> Base;
        internal Dictionary<string, byte[]> Target;
        internal Dictionary<string, object> Manifest;
        internal Dictionary<string, byte[]> Entries;
    }

    private static string Hash(byte[] bytes)
    {
        using (SHA256 sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private static void Run(string name, Action test)
    {
        try { test(); Passed++; Console.WriteLine("PASS " + name); }
        catch (Exception error) { Console.Error.WriteLine("FAIL " + name + ": " + error.Message); throw; }
        finally { UpdateEngine.TestAfterReplacement = null; UpdateEngine.TestSimulateInterruption = false; }
    }

    private static Exception Rejected(Action action)
    {
        try { action(); }
        catch (Exception error) { return error; }
        throw new Exception("operation unexpectedly accepted invalid fixture");
    }

    private static string FilePath(string directory, string relative)
    {
        return Path.Combine(directory, relative.Replace('/', Path.DirectorySeparatorChar));
    }

    private static void WriteFiles(string directory, Dictionary<string, byte[]> files)
    {
        foreach (KeyValuePair<string, byte[]> item in files)
        {
            string path = FilePath(directory, item.Key);
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, item.Value);
        }
    }

    private static void AssertFiles(string directory, Dictionary<string, byte[]> files)
    {
        foreach (KeyValuePair<string, byte[]> item in files)
        {
            string path = FilePath(directory, item.Key);
            Assert(File.Exists(path), "missing expected file: " + item.Key);
            Assert(Hash(File.ReadAllBytes(path)) == Hash(item.Value), "unexpected file bytes: " + item.Key);
        }
    }

    private static Dictionary<string, object> Record(string path, byte[] bytes)
    {
        return new Dictionary<string, object> { { "path", path }, { "size", bytes.LongLength }, { "sha256", Hash(bytes) } };
    }

    private static Fixture NewFixture(string name, string installDirectory = null)
    {
        Fixture f = new Fixture();
        string work = Path.Combine(Root, name);
        System.IO.Directory.CreateDirectory(work);
        f.Directory = installDirectory ?? Path.Combine(work, "中文 安装目录");
        f.Zip = Path.Combine(work, "synthetic-update.zip");
        byte[] oldExe = Enumerable.Repeat((byte)0x21, 131072).ToArray();
        byte[] newExe = (byte[])oldExe.Clone();
        for (int i = 65536; i < newExe.Length; i++) newExe[i] = 0x31;
        f.Base = new Dictionary<string, byte[]> {
            { "唠蒯云.exe", oldExe }, { "resources/app.asar", Utf8.GetBytes("old app") },
            { "chrome_100_percent.pak", new byte[] { 1, 2, 3 } }, { "icudtl.dat", new byte[] { 9 } }
        };
        f.Target = new Dictionary<string, byte[]> {
            { "唠蒯云.exe", newExe }, { "resources/app.asar", Utf8.GetBytes("new application") },
            { "locales/zh-CN.pak", new byte[] { 4, 5, 6 } }, { "icudtl.dat", new byte[] { 9 } }
        };
        byte[] block = new byte[65536]; Array.Copy(newExe, 65536, block, 0, block.Length);
        f.Entries = new Dictionary<string, byte[]> {
            { "payload/0001.bin", block }, { "payload/0002.bin", f.Target["resources/app.asar"] },
            { "payload/0003.bin", f.Target["locales/zh-CN.pak"] }
        };
        object[] changes = {
            Change("唠蒯云.exe", "blocks", "payload/0001.bin", block, new long[] { 65536 }),
            Change("resources/app.asar", "replace", "payload/0002.bin", f.Target["resources/app.asar"], new long[0]),
            Change("locales/zh-CN.pak", "replace", "payload/0003.bin", f.Target["locales/zh-CN.pak"], new long[0]),
            new Dictionary<string, object> { { "path", "chrome_100_percent.pak" }, { "kind", "delete" } }
        };
        List<object> updaterFiles = new List<object>();
        foreach (string tool in new string[] { "apply-incremental-update.ps1", "apply-incremental-update.cmd", "incremental-update-lib.ps1", "incremental-program-paths.json" })
        {
            string path = "updater/" + tool;
            byte[] bytes = Utf8.GetBytes("synthetic metadata only; never executed");
            f.Entries.Add(path, bytes); updaterFiles.Add(Record(path, bytes));
        }
        f.Manifest = new Dictionary<string, object> {
            { "schema", 1 }, { "format", "laokuai-fixed-blocks-v1" }, { "blockSize", 65536 },
            { "baseVersion", "synthetic.1" }, { "targetVersion", "synthetic.2" },
            { "baseZipSha256", new string('a', 64) }, { "targetZipSha256", new string('b', 64) },
            { "baseFiles", f.Base.Select(p => Record(p.Key, p.Value)).ToArray() },
            { "targetFiles", f.Target.Select(p => Record(p.Key, p.Value)).ToArray() },
            { "changes", changes }, { "updaterFiles", updaterFiles.ToArray() }
        };
        WriteFiles(f.Directory, f.Base);
        WriteFiles(f.Directory, Protected());
        Build(f);
        return f;
    }

    private static Dictionary<string, object> Change(string path, string kind, string payload, byte[] bytes, long[] offsets)
    {
        return new Dictionary<string, object> { { "path", path }, { "kind", kind }, { "payload", payload },
            { "payloadSize", bytes.LongLength }, { "payloadSha256", Hash(bytes) }, { "offsets", offsets } };
    }

    private static Dictionary<string, byte[]> Protected()
    {
        return new Dictionary<string, byte[]> {
            { "profile/中文 账号.json", Utf8.GetBytes("synthetic private account") },
            { "config/settings.json", Utf8.GetBytes("synthetic saved preferences") },
            { "unknown.bin", new byte[] { 0, 19, 255 } }
        };
    }

    private static void Build(Fixture f)
    {
        f.Entries["update.json"] = Utf8.GetBytes(Json.Serialize(f.Manifest));
        if (File.Exists(f.Zip)) File.Delete(f.Zip);
        using (FileStream output = File.Create(f.Zip))
        using (ZipArchive zip = new ZipArchive(output, ZipArchiveMode.Create))
            foreach (KeyValuePair<string, byte[]> item in f.Entries)
                using (Stream stream = zip.CreateEntry(item.Key).Open()) stream.Write(item.Value, 0, item.Value.Length);
    }

    private static UpdateEngine Engine(Fixture f, string expectedHash = null)
    {
        using (FileStream input = File.OpenRead(f.Zip))
            return new UpdateEngine(input, expectedHash ?? Hash(File.ReadAllBytes(f.Zip)), Policy);
    }

    private static void AssertBase(Fixture f)
    {
        AssertFiles(f.Directory, f.Base); AssertFiles(f.Directory, Protected());
        Assert(!File.Exists(FilePath(f.Directory, "locales/zh-CN.pak")), "addition survived a rejected or rolled-back update");
    }

    private static Dictionary<string, string> Snapshot(string directory)
    {
        return System.IO.Directory.GetFiles(directory, "*", SearchOption.AllDirectories)
            .ToDictionary(path => path.Substring(directory.Length), path => Hash(File.ReadAllBytes(path)), StringComparer.OrdinalIgnoreCase);
    }

    private static void AssertSnapshot(string directory, Dictionary<string, string> before)
    {
        Dictionary<string, string> after = Snapshot(directory);
        Assert(before.Count == after.Count && before.All(item => after.ContainsKey(item.Key) && after[item.Key] == item.Value), "rejection changed installation snapshot");
    }

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--fixture-wait") { Thread.Sleep(30000); return 0; }
            if (args.Length != 2 && args.Length != 6) throw new Exception("fixture root, policy, and optional real base/update/target/hash required");
            Root = Path.GetFullPath(args[0]); Policy = File.ReadAllText(args[1]);
            Run("successful update matches every target file and preserves account/configuration", delegate {
                Fixture f = NewFixture("success");
                using (UpdateEngine engine = Engine(f))
                {
                    Assert(engine.Probe(f.Directory) == ProbeResult.Baseline, "fresh baseline was not identified");
                    string recovery = engine.Apply(f.Directory, IgnoreProgress);
                    Assert(System.IO.Directory.Exists(recovery), "recovery evidence missing");
                    Assert(engine.Probe(f.Directory) == ProbeResult.Target, "complete target was not identified");
                }
                AssertFiles(f.Directory, f.Target); AssertFiles(f.Directory, Protected());
                Assert(!File.Exists(FilePath(f.Directory, "chrome_100_percent.pak")), "declared deletion not applied");
            });
            Run("wrong baseline and already-target installs are never modified", delegate {
                Fixture f = NewFixture("wrong-base"); File.WriteAllText(FilePath(f.Directory, "resources/app.asar"), "unrecognized", Utf8);
                Dictionary<string, string> before = Snapshot(f.Directory);
                using (UpdateEngine engine = Engine(f)) { Assert(engine.Probe(f.Directory) == ProbeResult.Invalid, "wrong base accepted"); Rejected(delegate { engine.Apply(f.Directory, IgnoreProgress); }); }
                AssertSnapshot(f.Directory, before); AssertFiles(f.Directory, Protected());
                Fixture target = NewFixture("already-target");
                using (UpdateEngine engine = Engine(target))
                {
                    engine.Apply(target.Directory, IgnoreProgress); before = Snapshot(target.Directory);
                    Rejected(delegate { engine.Apply(target.Directory, IgnoreProgress); });
                }
                AssertSnapshot(target.Directory, before);
            });
            Run("package checksum mismatch refuses the archive without touching install", delegate {
                Fixture f = NewFixture("zip-sha"); Rejected(delegate { using (UpdateEngine engine = Engine(f, new string('0', 64))) { } }); AssertBase(f);
            });
            Run("escaping archive paths and duplicate case names are refused", delegate {
                foreach (string path in new string[] { "../outside.bin", "/outside.bin", "C:/outside.bin", "payload\\outside.bin", "payload/a:stream", "payload/NUL.txt" })
                {
                    Fixture f = NewFixture("unsafe-" + Guid.NewGuid().ToString("N")); f.Entries.Add(path, new byte[] { 1 }); Build(f);
                    Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } }); AssertBase(f);
                }
                Fixture duplicate = NewFixture("duplicate"); duplicate.Entries.Add("UPDATE.JSON", duplicate.Entries["update.json"]); Build(duplicate);
                Rejected(delegate { using (UpdateEngine engine = Engine(duplicate)) { } }); AssertBase(duplicate);
                Assert(!File.Exists(Path.Combine(Root, "outside.bin")), "archive escaped fixture");
            });
            Run("non-program manifest paths and undeclared payloads are refused", delegate {
                Fixture f = NewFixture("non-whitelist"); ((Dictionary<string, object>)((Dictionary<string, object>[])f.Manifest["targetFiles"])[0])["path"] = "profile/account.json"; Build(f);
                Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } }); AssertBase(f);
                f = NewFixture("undeclared"); f.Entries.Add("payload/0999.bin", new byte[] { 8 }); Build(f);
                Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } }); AssertBase(f);
            });
            Run("missing payload, corrupted payload and invalid block offset are refused", delegate {
                foreach (string mode in new string[] { "missing", "corrupt", "offset", "target-hash" })
                {
                    Fixture f = NewFixture(mode);
                    if (mode == "missing") f.Entries.Remove("payload/0001.bin");
                    if (mode == "corrupt") f.Entries["payload/0001.bin"][0] ^= 1;
                    if (mode == "offset") ((Dictionary<string, object>)((object[])f.Manifest["changes"])[0])["offsets"] = new long[] { 999999999 };
                    if (mode == "target-hash") ((Dictionary<string, object>[])f.Manifest["targetFiles"])[0]["sha256"] = new string('0', 64);
                    Build(f); Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } }); AssertBase(f);
                }
            });
            Run("unknown addition destination and locked program file are preserved", delegate {
                Fixture f = NewFixture("unknown-addition"); string added = FilePath(f.Directory, "locales/zh-CN.pak"); System.IO.Directory.CreateDirectory(Path.GetDirectoryName(added)); File.WriteAllText(added, "unknown owner", Utf8);
                Dictionary<string, string> before = Snapshot(f.Directory);
                Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } }); AssertSnapshot(f.Directory, before);
                f = NewFixture("locked-program");
                using (FileStream locked = new FileStream(FilePath(f.Directory, "唠蒯云.exe"), FileMode.Open, FileAccess.Read, FileShare.None))
                    Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } });
                AssertBase(f);
            });
            Run("failure after replacement rolls back all managed files and preserves private files", delegate {
                Fixture f = NewFixture("rollback");
                int reached = 0;
                UpdateEngine.TestAfterReplacement = delegate(int replacements) { reached = replacements; if (replacements == 2) throw new IOException("synthetic replacement fault"); };
                using (UpdateEngine engine = Engine(f))
                {
                    Rejected(delegate { engine.Apply(f.Directory, IgnoreProgress); });
                    Assert(reached == 2, "replacement fault checkpoint was never reached"); AssertBase(f);
                    UpdateEngine.TestAfterReplacement = null;
                    engine.Apply(f.Directory, IgnoreProgress);
                }
                AssertFiles(f.Directory, f.Target); AssertFiles(f.Directory, Protected());
            });
            Run("interrupted journal refuses another update and retains recovery material", delegate {
                Fixture f = NewFixture("interrupted");
                UpdateEngine.TestSimulateInterruption = true;
                int reached = 0;
                UpdateEngine.TestAfterReplacement = delegate(int replacements) { reached = replacements; if (replacements == 1) throw new IOException("synthetic interruption"); };
                Exception interrupted = Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } });
                Assert(reached == 1, "interruption checkpoint was never reached");
                UpdateEngine.TestSimulateInterruption = false; UpdateEngine.TestAfterReplacement = null;
                Dictionary<string, string> partial = Snapshot(f.Directory);
                Exception next = Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } });
                AssertSnapshot(f.Directory, partial); AssertFiles(f.Directory, Protected());
                object recovery = next.Data["RecoveryDirectory"] ?? interrupted.Data["RecoveryDirectory"];
                Assert(recovery is string && System.IO.Directory.Exists((string)recovery), "interrupted recovery directory not identified");
                Assert(File.Exists(Path.Combine((string)recovery, "journal.json")), "journal was not retained");
            });
            Run("installation junction refuses redirection without changing its target", delegate {
                Fixture f = NewFixture("junction-case", Path.Combine(Root, "junction-target"));
                using (UpdateEngine engine = Engine(f)) Rejected(delegate { engine.Apply(Path.Combine(Root, "junction-install"), IgnoreProgress); });
                AssertBase(f);
            });
            Run("discovery finds Chinese-space installs and preserves ambiguous candidates", delegate {
                string search = Path.Combine(Root, "discovery-root");
                Fixture first = NewFixture("discovery-a", Path.Combine(search, "中文 空格 A"));
                Fixture second = NewFixture("discovery-b", Path.Combine(search, "中文 空格 B"));
                List<string> candidates = Discovery.FindCandidates(new string[] { search }, 2, 512);
                Assert(candidates.Count == 2, "discovery hid an ambiguous or valid install");
                Assert(candidates.Any(p => string.Equals(p, first.Directory, StringComparison.OrdinalIgnoreCase)) && candidates.Any(p => string.Equals(p, second.Directory, StringComparison.OrdinalIgnoreCase)), "discovery returned the wrong directories");
                Assert(Discovery.IsCandidateDirectory(first.Directory), "Chinese-space installation was not recognized");
                Assert(!Discovery.IsCandidateDirectory(Path.Combine(Root, "junction-install")), "junction candidate accepted");
                Assert(UpdateEngine.IsAllowedReparseTag(0x9000001au) && UpdateEngine.IsAllowedReparseTag(0x9000f01au), "OneDrive cloud tags were rejected");
                Assert(!UpdateEngine.IsAllowedReparseTag(0xa0000003u) && !UpdateEngine.IsAllowedReparseTag(0xa000000cu), "junction/symlink tags were allowed");
                Assert(Discovery.SelectUniqueCandidate(candidates) == null, "ambiguous candidates were silently selected");
                Assert(String.Equals(Discovery.SelectUniqueCandidate(new string[] { first.Directory, first.Directory }), first.Directory, StringComparison.OrdinalIgnoreCase), "same directory duplicate was not deduplicated");
                NewFixture("shortcut", Path.Combine(Root, "shortcut-target"));
                string shortcutExe = Path.Combine(Root, "shortcut-target", "唠蒯云.exe");
                string wrongExe = Path.Combine(Root, "shortcut-target", "not-the-app.exe");
                File.WriteAllBytes(wrongExe, new byte[] { 0x21 });
                CreateShortcut("正常 中文链接.lnk", shortcutExe, "");
                CreateShortcut("带参数.lnk", shortcutExe, "--fixture-argument");
                CreateShortcut("非应用.lnk", wrongExe, "");
                CreateShortcut("重定向.lnk", Path.Combine(Root, "junction-install", "唠蒯云.exe"), "");
                Assert(String.Equals(Discovery.ReadShortcutTargetDirectory(Path.Combine(Root, "正常 中文链接.lnk")), Path.Combine(Root, "shortcut-target"), StringComparison.OrdinalIgnoreCase), "safe local shortcut not recognized");
                foreach (string link in new string[] { "带参数.lnk", "非应用.lnk", "重定向.lnk" })
                    Assert(Discovery.ReadShortcutTargetDirectory(Path.Combine(Root, link)) == null, "unsafe shortcut accepted: " + link);
                NewFixture("recovery-discovery", Path.Combine(search, ".laokuai-update-synthetic"));
                Assert(Discovery.FindCandidates(new string[] { search }, 2, 512).Count == 2, "recovery backup was offered as an application installation");
            });
            Run("running fixture process is refused and is never terminated by updater", delegate {
                Fixture f = NewFixture("running-process");
                string childPath = Path.Combine(f.Directory, "fixture-running.exe");
                File.Copy(System.Reflection.Assembly.GetExecutingAssembly().Location, childPath);
                using (Process child = Process.Start(new ProcessStartInfo(childPath, "--fixture-wait") { UseShellExecute = false, CreateNoWindow = true }))
                {
                    try
                    {
                        Thread.Sleep(100);
                        Rejected(delegate { using (UpdateEngine engine = Engine(f)) { engine.Apply(f.Directory, IgnoreProgress); } });
                        Assert(!child.HasExited, "updater terminated the running process"); AssertBase(f);
                    }
                    finally { if (!child.HasExited) { child.Kill(); child.WaitForExit(5000); } }
                }
            });
            Run("hidden production Form follows single, multiple, target and backup selection rules", VerifyForms);
            if (args.Length == 6) Run("real archived baseline and delta match every independent target ZIP file", delegate { VerifyReal(args[2], args[3], args[4], args[5]); });
            Console.WriteLine("PASS native updater: " + Passed + " real-engine/discovery fixture groups; no user app, desktop or network used.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }

    private static void HiddenForm(Fixture package, string[] roots, Action<UpdaterForm> verify)
    {
        HiddenFormUntil(package, roots, delegate(UpdaterForm form) { verify(form); return true; });
    }

    private static void HiddenFormUntil(Fixture package, string[] roots, Func<UpdaterForm, bool> verify)
    {
        Exception failure = null;
        using (UpdaterForm form = new UpdaterForm(roots, delegate { return Engine(package); }))
        using (System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer())
        {
            form.Opacity = 0; form.ShowInTaskbar = false;
            DateTime deadline = DateTime.UtcNow.AddSeconds(15);
            timer.Interval = 20;
            timer.Tick += delegate {
                try
                {
                    if (DateTime.UtcNow > deadline) throw new Exception("hidden Form operation timed out");
                    if (form.TestBusy) return;
                    if (!verify(form)) return;
                    timer.Stop(); form.Close();
                }
                catch (Exception error) { failure = error; timer.Stop(); form.Close(); }
            };
            form.Shown += delegate { timer.Start(); };
            Application.Run(form);
        }
        if (failure != null) throw failure;
    }

    private static void VerifyForms()
    {
        Fixture single = NewFixture("form-single");
        int phase = 0, recoveryDirectories = 0;
        Dictionary<string, string> singleTarget = null;
        HiddenFormUntil(single, new string[] { single.Directory }, delegate(UpdaterForm form) {
            if (phase == 0)
            {
                Assert(form.TestStatus.Contains("更新完成"), "single valid baseline did not auto-update");
                AssertFiles(single.Directory, single.Target); AssertFiles(single.Directory, Protected());
                singleTarget = Snapshot(single.Directory);
                recoveryDirectories = System.IO.Directory.GetDirectories(Path.GetDirectoryName(single.Directory), ".laokuai-update-*").Length;
                form.TestChoose(0); form.TestApplySelection(); phase = 1;
                return false;
            }
            Assert(form.TestStatus.Contains("无需更新"), "complete result directory was reapplied instead of searched");
            AssertSnapshot(single.Directory, singleTarget);
            Assert(System.IO.Directory.GetDirectories(Path.GetDirectoryName(single.Directory), ".laokuai-update-*").Length == recoveryDirectories, "re-search created a second update journal");
            Assert(String.IsNullOrEmpty(form.TestRecoveryDirectory), "old recovery display survived a new read-only search");
            return true;
        });
        string multiRoot = Path.Combine(Root, "form 多目录");
        Fixture a = NewFixture("form-a", Path.Combine(multiRoot, "旧版 A"));
        Fixture b = NewFixture("form-b", Path.Combine(multiRoot, "旧版 B"));
        HiddenForm(a, new string[] { multiRoot }, delegate(UpdaterForm form) {
            Assert(form.TestChoiceCount == 2 && form.TestSelectedIndex == -1, "multiple baselines were silently selected");
            AssertBase(a); AssertBase(b);
            using (System.Drawing.Bitmap bitmap = new System.Drawing.Bitmap(form.Width, form.Height))
            {
                form.DrawToBitmap(bitmap, new System.Drawing.Rectangle(System.Drawing.Point.Empty, form.Size));
                bitmap.Save(Path.Combine(Root, "multi-choice.png"), System.Drawing.Imaging.ImageFormat.Png);
            }
        });
        using (UpdateEngine engine = Engine(a)) engine.Apply(a.Directory, IgnoreProgress);
        HiddenForm(b, new string[] { multiRoot }, delegate(UpdaterForm form) {
            Assert(form.TestChoiceCount == 1 && form.TestSelectedIndex == -1, "target plus old backup auto-selected the old directory");
            AssertFiles(a.Directory, a.Target); AssertBase(b);
        });
        Dictionary<string, string> targetBefore = Snapshot(a.Directory);
        HiddenForm(a, new string[] { a.Directory }, delegate(UpdaterForm form) {
            Assert(form.TestStatus.Contains("无需更新"), "target-only install was not reported as already updated");
            Assert(form.TestChoiceCount == 0, "target-only install offered a write selection");
            AssertSnapshot(a.Directory, targetBefore);
        });
    }

    private static void VerifyReal(string baseZip, string deltaZip, string targetZip, string expectedHash)
    {
        string install = Path.Combine(Root, "真实 包测试 中文 空格");
        System.IO.Directory.CreateDirectory(install);
        ZipFile.ExtractToDirectory(baseZip, install);
        WriteFiles(install, Protected());
        string recovery;
        using (FileStream input = File.OpenRead(deltaZip))
        using (UpdateEngine engine = new UpdateEngine(input, expectedHash, Policy))
        {
            Assert(engine.Probe(install) == ProbeResult.Baseline, "real archive baseline was not identified");
            recovery = engine.Apply(install, IgnoreProgress);
        }
        int checkedFiles = 0;
        using (ZipArchive archive = ZipFile.OpenRead(targetZip))
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                if (entry.FullName.EndsWith("/", StringComparison.Ordinal)) continue;
                using (Stream input = entry.Open())
                using (MemoryStream bytes = new MemoryStream())
                {
                    input.CopyTo(bytes);
                    string actual = FilePath(install, entry.FullName);
                    Assert(File.Exists(actual) && Hash(File.ReadAllBytes(actual)) == Hash(bytes.ToArray()), "real target mismatch: " + entry.FullName);
                    checkedFiles++;
                }
            }
        Assert(checkedFiles > 0, "real target ZIP had no files"); AssertFiles(install, Protected());
        File.WriteAllText(Path.Combine(Root, "real-result.json"), Json.Serialize(new Dictionary<string, object> {
            { "status", "complete" }, { "targetFilesChecked", checkedFiles }, { "deltaSha256", expectedHash },
            { "privateFixturePreserved", true }, { "userAppLaunched", false }, { "recoveryDirectory", recovery }
        }), Utf8);
        Console.WriteLine("PASS real target ZIP comparison: " + checkedFiles + " independent files, synthetic account/config preserved");
    }
}

namespace LaokuaiUpdater
{
    // Only the test executable compiles this metadata; production embeds the frozen package metadata.
    internal static class EmbeddedUpdate
    {
        internal const string ExpectedSha = "synthetic injected package";
        internal const string BaseVersion = "synthetic.1";
        internal const string TargetVersion = "synthetic.2";
        internal const string SourceUrl = "https://github.com/Thankyou-Cheems/LaokuaiCloud";
    }
}
