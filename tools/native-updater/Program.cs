using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

namespace LaokuaiUpdater
{
    internal static class Program
    {
#if !UPDATER_TESTS
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new UpdaterForm());
        }
#endif
    }

    internal sealed class UpdaterForm : Form
    {
        private enum Operation { Search, Folder, Apply }
        private enum Outcome { Choices, Current, Missing, Running, Complete, Failed }
        private sealed class Request { public Operation Operation; public string Directory; }
        private sealed class Result
        {
            public Outcome Outcome;
            public List<string> Directories = new List<string>();
            public string Directory, RecoveryDirectory;
            public bool PackageFailure;
            public int MatchingInstallations;
            public string FailureReason;
        }

        private readonly BackgroundWorker worker = new BackgroundWorker();
        private readonly Label status = new Label();
        private readonly ListBox installations = new ListBox();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Button action = new Button();
        private readonly Button browse = new Button();
        private readonly TextBox recovery = new TextBox();
        private readonly Label recoveryLabel = new Label();
        private readonly Button details = new Button();
        private UpdateEngine engine;
        private string retryDirectory;
        private bool applying, closeWhenIdle, choosingOldVersion;
        private string failureReason;
#if UPDATER_TESTS
        private List<string> testRoots;
        private Func<UpdateEngine> testEngineFactory;
        internal UpdaterForm(IEnumerable<string> roots, Func<UpdateEngine> engineFactory) : this()
        {
            testRoots = new List<string>(roots); testEngineFactory = engineFactory;
        }
        internal bool TestBusy { get { return worker.IsBusy; } }
        internal string TestStatus { get { return status.Text; } }
        internal int TestChoiceCount { get { return installations.Items.Count; } }
        internal int TestSelectedIndex { get { return installations.SelectedIndex; } }
        internal string TestRecoveryDirectory { get { return recovery.Text; } }
        internal void TestChoose(int index) { installations.SelectedIndex = index; }
        internal void TestApplySelection() { OnAction(this, EventArgs.Empty); }
#endif

        private static string ShortVersion(string version)
        {
            int lastDot = version.LastIndexOf('.');
            return lastDot >= 0 ? version.Substring(lastDot) : version;
        }

        public UpdaterForm()
        {
            Text = "唠蒯云 · 更新至 " + ShortVersion(EmbeddedUpdate.TargetVersion);
            Font = new Font("Microsoft YaHei UI", 9F);
            ClientSize = new Size(640, 340);
            MinimumSize = new Size(520, 340);
            StartPosition = FormStartPosition.CenterScreen;
            Label title = new Label { Text = "更新唠蒯云", Font = new Font(Font.FontFamily, 15F, FontStyle.Bold), AutoSize = true, Location = new Point(20, 16) };
            Label note = new Label { Text = "自动查找旧版 " + ShortVersion(EmbeddedUpdate.BaseVersion) + "，更新至 " + ShortVersion(EmbeddedUpdate.TargetVersion) + "，并保留账号与配置。", AutoSize = true, Location = new Point(20, 54) };
            status.SetBounds(20, 88, 600, 45); status.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            status.Text = "正在查找原应用目录……";
            installations.SetBounds(20, 136, 600, 82); installations.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            installations.HorizontalScrollbar = true; installations.SelectionMode = SelectionMode.One;
            progress.SetBounds(20, 228, 600, 12); progress.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            progress.Style = ProgressBarStyle.Marquee;
            action.SetBounds(20, 252, 130, 32); action.Text = "重新查找";
            browse.SetBounds(160, 252, 130, 32); browse.Text = "选择原应用文件夹";
            action.Click += OnAction; browse.Click += OnBrowse;
            details.SetBounds(300, 252, 90, 32); details.Text = "失败详情"; details.Visible = false;
            details.Click += delegate { MessageBox.Show(this, failureReason, "失败详情（请保留恢复资料）", MessageBoxButtons.OK, MessageBoxIcon.Information); };
            installations.SelectedIndexChanged += delegate { if (!worker.IsBusy) action.Enabled = installations.SelectedIndex >= 0 || retryDirectory != null; };
            recoveryLabel.SetBounds(20, 292, 80, 20); recoveryLabel.Text = "恢复资料："; recoveryLabel.Visible = false;
            recovery.SetBounds(102, 288, 390, 25); recovery.ReadOnly = true; recovery.Visible = false;
            recovery.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            LinkLabel license = new LinkLabel { Text = "源码与许可", AutoSize = true, Location = new Point(520, 300), Anchor = AnchorStyles.Right | AnchorStyles.Bottom };
            license.LinkClicked += delegate { ShowLicense(); };
            Controls.AddRange(new Control[] { title, note, status, installations, progress, action, browse, details, recoveryLabel, recovery, license });
            worker.WorkerReportsProgress = true; worker.WorkerSupportsCancellation = true;
            worker.DoWork += Work;
            worker.ProgressChanged += delegate(object sender, ProgressChangedEventArgs e) { status.Text = Convert.ToString(e.UserState); };
            worker.RunWorkerCompleted += Completed;
            Shown += delegate { StartWork(Operation.Search, null); };
            FormClosing += OnClosingAttempt;
            FormClosed += delegate { if (engine != null) engine.Dispose(); worker.Dispose(); };
        }

        private void InitializeEngine()
        {
            if (engine != null) return;
#if UPDATER_TESTS
            if (testEngineFactory != null) { engine = testEngineFactory(); return; }
#endif
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream package = assembly.GetManifestResourceStream("update.zip"))
            using (Stream policy = assembly.GetManifestResourceStream("program-paths.json"))
            {
                if (package == null || policy == null) throw new InvalidDataException();
                using (StreamReader reader = new StreamReader(policy, Encoding.UTF8))
                    engine = new UpdateEngine(package, EmbeddedUpdate.ExpectedSha, reader.ReadToEnd());
            }
            if (engine.BaseVersion != EmbeddedUpdate.BaseVersion || engine.TargetVersion != EmbeddedUpdate.TargetVersion)
            {
                engine.Dispose(); engine = null; throw new InvalidDataException();
            }
        }

        private void StartWork(Operation operation, string directory)
        {
            if (worker.IsBusy) return;
            applying = operation == Operation.Apply;
            action.Enabled = browse.Enabled = installations.Enabled = false;
            progress.Visible = true;
            status.Text = applying ? "正在准备更新，请稍候……" : "正在检查原应用目录……";
            worker.RunWorkerAsync(new Request { Operation = operation, Directory = directory });
        }

        private void Work(object sender, DoWorkEventArgs e)
        {
            Request request = (Request)e.Argument;
            Result result = new Result();
            try
            {
                InitializeEngine();
                if (request.Operation == Operation.Apply)
                {
                    result.Directory = request.Directory;
                    try { UpdateEngine.AssertAppStopped(request.Directory); }
                    catch (Exception error) { result.Outcome = Outcome.Running; result.FailureReason = error.Message; e.Result = result; return; }
                    result.RecoveryDirectory = engine.Apply(request.Directory, delegate(string message) { worker.ReportProgress(0, message); });
                    result.Outcome = Outcome.Complete; e.Result = result; return;
                }
                List<string> candidates;
                if (request.Operation == Operation.Folder) candidates = new List<string> { request.Directory };
#if UPDATER_TESTS
                else if (testRoots != null) candidates = Discovery.FindCandidates(testRoots, Discovery.MaximumDepth, Discovery.MaximumDirectories);
#endif
                else candidates = Discovery.FindDefaultCandidates(Assembly.GetExecutingAssembly().Location);
                bool hasCurrent = false;
                foreach (string candidate in candidates)
                {
                    if (worker.CancellationPending) { e.Cancel = true; return; }
                    worker.ReportProgress(0, "正在核对原程序版本，请稍候……");
                    ProbeResult probe = engine.Probe(candidate);
                    if (probe == ProbeResult.Baseline) result.Directories.Add(candidate);
                    if (probe == ProbeResult.Target) hasCurrent = true;
                    if (probe == ProbeResult.Baseline || probe == ProbeResult.Target) result.MatchingInstallations++;
                }
                result.Outcome = result.Directories.Count > 0 ? Outcome.Choices : hasCurrent ? Outcome.Current : Outcome.Missing;
            }
            catch (Exception error)
            {
                result.Outcome = Outcome.Failed;
                result.PackageFailure = engine == null;
                result.RecoveryDirectory = error.Data["RecoveryDirectory"] as string;
                result.FailureReason = error.Message;
                if (error.InnerException != null) result.FailureReason += Environment.NewLine + error.InnerException.Message;
            }
            e.Result = result;
        }

        private void Completed(object sender, RunWorkerCompletedEventArgs e)
        {
            applying = false; progress.Visible = false;
            action.Enabled = browse.Enabled = installations.Enabled = true;
            if (closeWhenIdle) { Close(); return; }
            if (e.Cancelled) return;
            Result result = e.Error == null ? e.Result as Result : null;
            if (result == null) result = new Result { Outcome = Outcome.Failed };
            installations.Items.Clear(); installations.SelectedIndex = -1; retryDirectory = null;
            choosingOldVersion = false;
            recovery.Text = String.Empty;
            recovery.Visible = recoveryLabel.Visible = false;
            action.Text = "重新查找";
            action.Enabled = true;
            failureReason = result.FailureReason;
            details.Visible = !String.IsNullOrEmpty(failureReason);
            if (result.Outcome == Outcome.Choices)
            {
                foreach (string directory in result.Directories) installations.Items.Add(directory);
                string only = Discovery.SelectUniqueCandidate(result.Directories);
                if (only != null && result.MatchingInstallations == 1) { StartWork(Operation.Apply, only); return; }
                choosingOldVersion = true;
                status.Text = "找到多份安装（可能包含新版或备份），请明确选择要更新的旧版目录。";
                action.Text = "更新选中的旧版"; action.Enabled = false;
            }
            else if (result.Outcome == Outcome.Current)
                status.Text = "找到的唠蒯云已经是 " + ShortVersion(EmbeddedUpdate.TargetVersion) + "，无需更新。";
            else if (result.Outcome == Outcome.Missing)
                status.Text = "没有找到可更新的完整 " + ShortVersion(EmbeddedUpdate.BaseVersion) + "。请选择原应用文件夹。";
            else if (result.Outcome == Outcome.Running)
            {
                retryDirectory = result.Directory;
                status.Text = "唠蒯云仍在运行。请从托盘退出应用，然后点“重试”。";
                action.Text = "重试";
            }
            else if (result.Outcome == Outcome.Complete)
            {
                status.Text = "更新完成，账号与配置已保留。请自行打开下方应用目录。";
                installations.Items.Add(result.Directory);
            }
            else
                status.Text = result.PackageFailure ? "更新包校验未通过，请重新获取此更新包。" :
                    "更新未完成。请保留恢复资料；关闭应用后可重试，或联系提供更新包的人。";
            if (!String.IsNullOrEmpty(result.RecoveryDirectory))
            {
                recovery.Text = result.RecoveryDirectory;
                recovery.Visible = recoveryLabel.Visible = true;
            }
        }

        private void OnAction(object sender, EventArgs e)
        {
            if (retryDirectory != null) { StartWork(Operation.Folder, retryDirectory); return; }
            if (choosingOldVersion && installations.SelectedItem != null) { StartWork(Operation.Apply, Convert.ToString(installations.SelectedItem)); return; }
            StartWork(Operation.Search, null);
        }

        private void OnBrowse(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择包含“唠蒯云.exe”的原应用文件夹。";
                dialog.ShowNewFolderButton = false;
                if (dialog.ShowDialog(this) == DialogResult.OK) StartWork(Operation.Folder, dialog.SelectedPath);
            }
        }

        private void OnClosingAttempt(object sender, FormClosingEventArgs e)
        {
            if (!worker.IsBusy) return;
            e.Cancel = true;
            if (applying) status.Text = "正在更新，请等待完成后再关闭窗口。";
            else { closeWhenIdle = true; worker.CancelAsync(); status.Text = "正在结束检查，请稍候……"; }
        }

        private void ShowLicense()
        {
            using (Form dialog = new Form())
            {
                dialog.Text = "唠蒯云更新器 · 源码与许可"; dialog.Size = new Size(680, 480); dialog.StartPosition = FormStartPosition.CenterParent;
                RichTextBox text = new RichTextBox { Dock = DockStyle.Fill, ReadOnly = true, DetectUrls = false, Font = Font };
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("updater-license.txt"))
                    if (stream != null) using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) text.Text = reader.ReadToEnd();
                LinkLabel source = new LinkLabel { Text = "查看此更新器的对应源码", Dock = DockStyle.Bottom, Height = 30, TextAlign = ContentAlignment.MiddleCenter };
                source.LinkClicked += delegate
                {
                    try { Process.Start(new ProcessStartInfo(EmbeddedUpdate.SourceUrl) { UseShellExecute = true }); }
                    catch (Exception) { MessageBox.Show(dialog, "暂时无法打开浏览器。", "源码", MessageBoxButtons.OK, MessageBoxIcon.Information); }
                };
                dialog.Controls.Add(text); dialog.Controls.Add(source); dialog.ShowDialog(this);
            }
        }
    }
}
