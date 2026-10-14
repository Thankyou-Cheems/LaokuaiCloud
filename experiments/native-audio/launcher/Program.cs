using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Laokuai.NativeAudioLab
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--self-test")
                return SelfTests.Run();
            bool render = args.Length == 2 && args[0] == "--render-ui" && Path.IsPathRooted(args[1]);
            if (args.Length != 0 && !render) return 2;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (LabForm form = new LabForm(render))
            {
                if (render)
                {
                    form.ShowInTaskbar = false;
                    form.StartPosition = FormStartPosition.Manual;
                    form.Location = new Point(-32000, -32000);
                    form.Opacity = 0;
                    form.Show();
                    Application.DoEvents();
                    form.CreateControl();
                    form.PerformLayout();
                    using (Bitmap bitmap = new Bitmap(form.Width, form.Height))
                    {
                        form.DrawToBitmap(bitmap, new Rectangle(0, 0, form.Width, form.Height));
                        bitmap.Save(args[1], System.Drawing.Imaging.ImageFormat.Png);
                    }
                    form.Hide();
                    return 0;
                }
                Application.Run(form);
            }
            return 0;
        }
    }

    internal static class Contract
    {
        public const int Port = 39177;
        public static bool IsEtAddress(string value)
        {
            if (String.IsNullOrWhiteSpace(value)) return false;
            string[] parts = value.Split('.');
            if (parts.Length != 4) return false;
            for (int i = 0; i < 4; ++i)
            {
                int part;
                if (!Int32.TryParse(parts[i], NumberStyles.None, CultureInfo.InvariantCulture, out part)
                    || part < 0 || part > 255 || parts[i] != part.ToString(CultureInfo.InvariantCulture)) return false;
            }
            int last = Int32.Parse(parts[3], CultureInfo.InvariantCulture);
            return parts[0] == "10" && parts[1] == "203" && parts[2] == "217" && last > 0 && last < 255;
        }

        public static bool IsKey(string value)
        {
            if (value == null || value.Length != 64) return false;
            bool anyNonzero = false;
            foreach (char c in value)
            {
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
                if (c != '0') anyNonzero = true;
            }
            return anyNonzero;
        }

        public static List<string> ParsePeers(string value, string local)
        {
            string[] values = (value ?? "").Split(new char[] { ',', ';', '\r', '\n', ' ', '\t', '，', '；' }, StringSplitOptions.RemoveEmptyEntries);
            if (values.Length == 0 || values.Length > 11) throw new ArgumentException("请输入 1 至 11 个对方 ET IPv4。");
            List<string> peers = new List<string>();
            foreach (string peer in values)
            {
                if (!IsEtAddress(peer)) throw new ArgumentException("对方地址须为 10.203.217.1 至 10.203.217.254，填写 IPv4，无需端口。");
                if (peer == local) throw new ArgumentException("对方列表不能包含本机地址。");
                if (peers.Contains(peer)) throw new ArgumentException("对方地址重复，请每位参与者填写一次。");
                peers.Add(peer);
            }
            return peers;
        }

        public static string BuildInput(string local, List<string> peers, string key)
        {
            if (!IsEtAddress(local) || peers == null || peers.Count == 0 || peers.Count > 11 || !IsKey(key))
                throw new ArgumentException("实验参数无效。");
            ParsePeers(String.Join(",", peers.ToArray()), local);
            List<string> endpoints = new List<string>();
            foreach (string peer in peers) endpoints.Add(peer + ":" + Port);
            return "LAOKUAI_NATIVE_AUDIO_V1\n" + local + "\n" + Port + "\n" + String.Join(",", endpoints.ToArray())
                + "\n" + key.ToLowerInvariant() + "\nduplex\n-1\n-1\nstart\n";
        }

        public static string NewKey()
        {
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            StringBuilder result = new StringBuilder(64);
            foreach (byte b in bytes) result.Append(b.ToString("x2", CultureInfo.InvariantCulture));
            Array.Clear(bytes, 0, bytes.Length);
            return result.ToString();
        }
    }

    internal sealed class Telemetry
    {
        public string Event;
        public string ErrorCode;
        public bool Muted;
        public string InputApi;
        public string OutputApi;
        public readonly Dictionary<string, double> Counters = new Dictionary<string, double>();
        public static Telemetry Parse(string line)
        {
            if (String.IsNullOrEmpty(line) || line.Length > 16384) return null;
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = 16384, RecursionLimit = 10 };
                Dictionary<string, object> data = serializer.Deserialize<Dictionary<string, object>>(line);
                object eventValue;
                if (data == null || !data.TryGetValue("event", out eventValue) || !(eventValue is string)) return null;
                string type = (string)eventValue;
                if (type != "ready" && type != "stats" && type != "error" && type != "stopped") return null;
                Telemetry result = new Telemetry { Event = type };
                object muted;
                if (data.TryGetValue("muted", out muted) && muted is bool) result.Muted = (bool)muted;
                // Only trusted enum identifiers are displayed. Never expose arbitrary helper output or stdin data.
                object code;
                if (type == "error" && data.TryGetValue("code", out code) && code is string)
                {
                    string candidate = (string)code;
                    string[] knownErrors = { "invalid-arguments", "invalid-config", "invalid-command", "host-failure", "udp-init", "udp-open", "udp-exclusive", "udp-bind", "udp-nonblocking", "udp-options", "udp-runtime", "audio-init", "audio-enumeration", "audio-device", "audio-format", "audio-open", "audio-start", "audio-inactive" };
                    if (Array.IndexOf(knownErrors, candidate) >= 0) result.ErrorCode = candidate;
                }
                result.InputApi = SafeApi(data, "inputHostApi"); result.OutputApi = SafeApi(data, "outputHostApi");
                string[] allowed = { "peerCount", "peers", "processCalls", "inputFrames", "outputActiveFrames", "packetsSent", "bytesSent", "packetsReceived", "bytesReceived", "rejectedPackets", "processErrors", "clippedSamples", "authRejected", "replayRejected", "udpSent", "udpReceived", "captureRms", "playbackRms", "transportRejected", "sendFailures", "captureUnderflows", "captureOverflows", "playbackUnderflows", "playbackOverflows", "inputDevice", "outputDevice", "inputChannels", "outputChannels" };
                foreach (string name in allowed)
                {
                    object raw;
                    double numeric;
                    if (!data.TryGetValue(name, out raw) || raw == null || raw is string || raw is bool) continue;
                    if (Double.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out numeric)
                        && !Double.IsNaN(numeric) && !Double.IsInfinity(numeric) && numeric >= 0)
                        result.Counters[name] = numeric;
                }
                return result;
            }
            catch (Exception) { return null; }
        }
        private static string SafeApi(Dictionary<string, object> data, string field)
        {
            object value;
            if (!data.TryGetValue(field, out value) || !(value is string)) return "未知 API";
            string[] known = { "Windows WASAPI", "Windows DirectSound", "MME", "Windows WDM-KS", "ASIO" };
            return Array.IndexOf(known, (string)value) >= 0 ? (string)value : "未知 API";
        }
        public double Number(string name) { double value; return Counters.TryGetValue(name, out value) ? value : 0; }
    }

    internal sealed class LabForm : Form
    {
        private readonly ComboBox localAddress = new ComboBox();
        private readonly Button refresh = new Button();
        private readonly TextBox peers = new TextBox();
        private readonly TextBox key = new TextBox();
        private readonly Button generate = new Button();
        private readonly Button copy = new Button();
        private readonly Button start = new Button();
        private readonly Button stop = new Button();
        private readonly Button mute = new Button();
        private readonly Label status = new Label();
        private readonly Label rates = new Label();
        private readonly Label counts = new Label();
        private readonly Label health = new Label();
        private readonly Label captureText = new Label();
        private readonly Label playbackText = new Label();
        private readonly Label devices = new Label();
        private readonly ProgressBar capture = new ProgressBar();
        private readonly ProgressBar playback = new ProgressBar();
        private readonly Timer freshness = new Timer();
        private Process helper;
        private bool stopping;
        private bool closing;
        private bool isMuted;
        private long previousTime;
        private double previousSent;
        private double previousReceived;
        private long lastTelemetry;
        private long startedTime;
        private string lastError;
        private readonly bool renderOnly;

        public LabForm(bool render)
        {
            renderOnly = render;
            Text = "唠蒯云 · 原生音频实验";
            ClientSize = new Size(930, 785);
            MinimumSize = new Size(946, 824);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9F);
            BackColor = Color.FromArgb(246, 247, 249);
            BuildLayout();
            refresh.Click += delegate { RefreshAddresses(); };
            generate.Click += delegate { key.Text = Contract.NewKey(); };
            copy.Click += delegate
            {
                if (!Contract.IsKey(key.Text.Trim())) { ShowError("请先生成或粘贴有效的 64 位实验密钥。"); return; }
                try { Clipboard.SetText(key.Text.Trim()); status.Text = "实验密钥已复制；请仅分享给本次参与者，使用后可清空剪贴板。"; }
                catch (Exception) { ShowError("剪贴板暂不可用，请手动复制密钥。"); }
            };
            start.Click += delegate { StartAudio(); };
            stop.Click += delegate { StopAudio(false); };
            mute.Click += delegate
            {
                if (helper == null || stopping) return;
                try
                {
                    helper.StandardInput.WriteLine(isMuted ? "unmute" : "mute");
                    helper.StandardInput.Flush();
                    mute.Enabled = false; // Wait for helper acknowledgement; the UI does not assume capture has stopped.
                    status.Text = "正在等待 helper 确认静音状态…";
                }
                catch (Exception) { StopAudio(false); }
            };
            FormClosing += OnFormClosing;
            freshness.Interval = 1000;
            freshness.Tick += delegate
            {
                if (helper != null && !stopping && lastTelemetry == 0 && SecondsSince(startedTime) > 10)
                {
                    lastError = "helper 超过 10 秒未确认就绪"; StopAudio(false); return;
                }
                if (helper != null && !stopping && lastTelemetry != 0 && SecondsSince(lastTelemetry) > 3)
                {
                    rates.Text = "遥测已超过 3 秒未更新 · 当前收发未知";
                    capture.Value = 0; playback.Value = 0;
                    captureText.Text = "输入电平：未知"; playbackText.Text = "输出电平：未知";
                }
            };
            if (renderOnly)
            {
                localAddress.Items.Add("10.203.217.示例（仅布局）"); localAddress.SelectedIndex = 0;
            }
            else { RefreshAddresses(); freshness.Start(); }
        }
        protected override bool ShowWithoutActivation { get { return renderOnly; } }

        private static Label LabelFor(string text)
        {
            return new Label { Text = text, AutoSize = false, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(3) };
        }
        private static TableLayoutPanel Grid(int rows)
        {
            TableLayoutPanel panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = rows, Padding = new Padding(12), Margin = new Padding(0) };
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            return panel;
        }
        private static GroupBox Group(string title, Control content)
        {
            GroupBox group = new GroupBox { Text = title, Dock = DockStyle.Fill, Padding = new Padding(8), Margin = new Padding(0, 0, 0, 8) };
            group.Controls.Add(content); return group;
        }
        private void BuildLayout()
        {
            TableLayoutPanel root = Grid(7); root.Padding = new Padding(20);
            int[] heights = { 42, 60, 157, 123, 69, 230, 64 };
            foreach (int height in heights) root.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
            Label title = LabelFor("原生音频 · ET 虚拟地址实验"); title.Font = new Font(Font.FontFamily, 19F, FontStyle.Bold); title.ForeColor = Color.FromArgb(28, 41, 58);
            root.Controls.Add(title, 0, 0);
            Label intro = LabelFor("先打开原唠蒯云完成联机，但退出语音频道；请戴耳机。\r\n打开本面板不会采集或发送音频。点击「开始音频」才启用麦克风、播放与 UDP。");
            intro.ForeColor = Color.FromArgb(107, 63, 15); root.Controls.Add(intro, 0, 1);

            TableLayoutPanel addressGrid = Grid(3); addressGrid.Padding = new Padding(2); addressGrid.ColumnCount = 2;
            addressGrid.ColumnStyles.Clear(); addressGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 118)); addressGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            addressGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 34)); addressGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); addressGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
            addressGrid.Controls.Add(LabelFor("本机 ET IPv4"), 0, 0);
            TableLayoutPanel localGrid = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = new Padding(0) };
            localGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); localGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 88));
            localAddress.DropDownStyle = ComboBoxStyle.DropDownList; localAddress.Dock = DockStyle.Fill; localAddress.Margin = new Padding(3, 4, 8, 3);
            refresh.Text = "刷新地址"; refresh.Dock = DockStyle.Fill; localGrid.Controls.Add(localAddress, 0, 0); localGrid.Controls.Add(refresh, 1, 0);
            addressGrid.Controls.Add(localGrid, 1, 0);
            addressGrid.Controls.Add(LabelFor("对方 ET IPv4\r\n最多 11 个"), 0, 1);
            peers.Multiline = true; peers.ScrollBars = ScrollBars.Vertical; peers.Dock = DockStyle.Fill; peers.MaxLength = 512;
            addressGrid.Controls.Add(peers, 1, 1);
            Label network = LabelFor("每行一个或逗号分隔 · 全员 UDP 39177 · 通过 ET 虚拟 IP，物理路径由 ET 决定"); addressGrid.Controls.Add(network, 0, 2); addressGrid.SetColumnSpan(network, 2);
            root.Controls.Add(Group("1  ·  参与者（本机 + 对方，最多 12 人）", addressGrid), 0, 2);

            TableLayoutPanel keyGrid = Grid(3); keyGrid.Padding = new Padding(2);
            keyGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 30)); keyGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 31)); keyGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            key.Dock = DockStyle.Fill; key.MaxLength = 64; key.Font = new Font("Consolas", 9F); keyGrid.Controls.Add(key, 0, 0);
            FlowLayoutPanel keyButtons = new FlowLayoutPanel { Dock = DockStyle.Fill, Margin = new Padding(0) };
            generate.Text = "创建随机密钥"; generate.Size = new Size(124, 27); copy.Text = "复制密钥"; copy.Size = new Size(100, 27);
            keyButtons.Controls.Add(generate); keyButtons.Controls.Add(copy); keyButtons.Controls.Add(new Label { Text = "或粘贴双方共享的 64 位十六进制密钥", AutoSize = true, Margin = new Padding(10, 6, 0, 0) });
            keyGrid.Controls.Add(keyButtons, 0, 1); keyGrid.Controls.Add(LabelFor("仅用于本次实验，内存保留；不保存到文件。此处不填写社区密码或账号凭据。"), 0, 2);
            root.Controls.Add(Group("2  ·  一次性实验密钥", keyGrid), 0, 3);

            devices.Text = "输入 / 输出：Windows 默认设备（helper 优先 WASAPI，共享模式）\r\nOpus 32 kbps / 48 kHz / 单声道 · 10 ms 回调 / 20 ms 编码块 · 配置缓冲 120 ms\r\n在 Windows 设置中选择设备后，停止并重新开始；尚未打开或枚举音频设备。";
            devices.Dock = DockStyle.Fill; devices.TextAlign = ContentAlignment.MiddleLeft;
            root.Controls.Add(devices, 0, 4);

            TableLayoutPanel statsGrid = Grid(6); statsGrid.Padding = new Padding(2);
            foreach (int height in new int[] { 31, 33, 29, 29, 38, 29 }) statsGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
            rates.Text = "发送：未开始　　接收：未开始"; rates.Dock = DockStyle.Fill; rates.TextAlign = ContentAlignment.MiddleLeft; rates.Font = new Font(Font.FontFamily, 11F, FontStyle.Bold);
            statsGrid.Controls.Add(rates, 0, 0); counts.Text = "累计包数：未开始"; counts.Dock = DockStyle.Fill; counts.TextAlign = ContentAlignment.MiddleLeft; statsGrid.Controls.Add(counts, 0, 1);
            statsGrid.Controls.Add(MeterRow(captureText, capture, "输入电平：未采集"), 0, 2);
            statsGrid.Controls.Add(MeterRow(playbackText, playback, "输出电平：未采集"), 0, 3);
            health.Text = "音频回调 / 鉴权拒绝 / 重放拒绝：未开始"; health.Dock = DockStyle.Fill; health.TextAlign = ContentAlignment.MiddleLeft; statsGrid.Controls.Add(health, 0, 4);
            statsGrid.Controls.Add(LabelFor("AoO 丢包：未采集　　实际缓冲：未采集（120 ms 为配置值）"), 0, 5);
            root.Controls.Add(Group("3  ·  helper 实际遥测（收发不代表已听到音频）", statsGrid), 0, 5);

            TableLayoutPanel bottom = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2, Margin = new Padding(0) };
            bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 342)); bottom.RowStyles.Add(new RowStyle(SizeType.Absolute, 32)); bottom.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            status.Text = "未开始 · 麦克风与 UDP 均关闭"; status.Dock = DockStyle.Fill; status.TextAlign = ContentAlignment.MiddleLeft; status.AutoEllipsis = true;
            bottom.Controls.Add(status, 0, 0);
            FlowLayoutPanel commands = new FlowLayoutPanel { Dock = DockStyle.Fill, Margin = new Padding(0) };
            start.Text = "开始音频"; start.Size = new Size(110, 29); start.BackColor = Color.FromArgb(223, 239, 233);
            mute.Text = "静音麦克风"; mute.Size = new Size(110, 29); mute.Enabled = false; stop.Text = "停止"; stop.Size = new Size(98, 29); stop.Enabled = false;
            commands.Controls.Add(start); commands.Controls.Add(mute); commands.Controls.Add(stop); bottom.Controls.Add(commands, 1, 0);
            Label firewall = LabelFor("开始后 Windows 可能提示防火墙权限，仅涉及实验 helper；请自行决定。本面板不自动提权或修改规则。"); firewall.Font = new Font(Font.FontFamily, 8F); bottom.Controls.Add(firewall, 0, 1); bottom.SetColumnSpan(firewall, 2);
            root.Controls.Add(bottom, 0, 6); Controls.Add(root);
        }

        private static Control MeterRow(Label label, ProgressBar bar, string initial)
        {
            TableLayoutPanel row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = new Padding(0) };
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 240)); row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            label.Text = initial; label.Dock = DockStyle.Fill; label.TextAlign = ContentAlignment.MiddleLeft; bar.Dock = DockStyle.Fill; bar.Maximum = 100; bar.Margin = new Padding(3, 7, 3, 6);
            row.Controls.Add(label, 0, 0); row.Controls.Add(bar, 1, 0); return row;
        }

        private void RefreshAddresses()
        {
            string previous = localAddress.SelectedItem as string; localAddress.Items.Clear();
            try
            {
                List<string> found = new List<string>();
                foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (adapter.OperationalStatus != OperationalStatus.Up) continue;
                    foreach (UnicastIPAddressInformation address in adapter.GetIPProperties().UnicastAddresses)
                    {
                        string value = address.Address.ToString();
                        if (Contract.IsEtAddress(value) && !found.Contains(value)) found.Add(value);
                    }
                }
                found.Sort(StringComparer.Ordinal); foreach (string value in found) localAddress.Items.Add(value);
                if (previous != null && found.Contains(previous)) localAddress.SelectedItem = previous;
                else if (found.Count > 0) localAddress.SelectedIndex = 0;
                status.Text = found.Count == 0 ? "未发现本机 ET 地址；先完成原唠蒯云联机，再刷新。" : "未开始 · 选择地址不会创建连接或采集音频";
            }
            catch (Exception) { status.Text = "无法读取本机网卡地址，请稍后刷新。"; }
        }

        private void SetRunningControls(bool running)
        {
            localAddress.Enabled = peers.Enabled = key.Enabled = refresh.Enabled = generate.Enabled = copy.Enabled = !running;
            start.Enabled = !running; stop.Enabled = running; mute.Enabled = running && !stopping;
        }
        private void ShowError(string message) { MessageBox.Show(this, message, "实验参数", MessageBoxButtons.OK, MessageBoxIcon.Information); }

        private void StartAudio()
        {
            if (helper != null || renderOnly) return;
            string local = localAddress.SelectedItem as string;
            if (!Contract.IsEtAddress(local)) { ShowError("未选择有效的本机 ET IPv4，请先打开原唠蒯云完成联机并刷新。"); return; }
            string input;
            try { input = Contract.BuildInput(local, Contract.ParsePeers(peers.Text, local), key.Text.Trim()); }
            catch (ArgumentException error) { ShowError(error.Message); return; }
            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "laokuai-native-audio.exe");
            if (!File.Exists(path)) { ShowError("同目录缺少 laokuai-native-audio.exe，请使用完整实验包。"); return; }
            Process owned = new Process();
            owned.StartInfo = new ProcessStartInfo(path, "--stdio") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
            owned.EnableRaisingEvents = true;
            owned.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
            {
                Telemetry parsed = Telemetry.Parse(args.Data);
                if (parsed != null) Post(delegate { if (helper == owned && (!stopping || parsed.Event == "error")) ApplyTelemetry(parsed); });
            };
            owned.ErrorDataReceived += delegate { }; // Drain stderr without persisting or exposing arbitrary content.
            owned.Exited += delegate { Post(delegate { if (helper == owned && !stopping) { if (lastError == null) lastError = "helper 已退出"; StopAudio(false); } }); };
            helper = owned; stopping = false; previousTime = 0; lastTelemetry = 0; isMuted = false; lastError = null; startedTime = Stopwatch.GetTimestamp();
            SetRunningControls(true); mute.Enabled = false; status.Text = "正在启动音频；等待 helper 确认…";
            try
            {
                if (!owned.Start()) throw new InvalidOperationException();
                owned.BeginOutputReadLine(); owned.BeginErrorReadLine();
                owned.StandardInput.Write(input); owned.StandardInput.Flush();
            }
            catch (Exception) { lastError = "helper 启动失败"; StopAudio(false); }
            finally { input = null; }
        }

        private void ApplyTelemetry(Telemetry telemetry)
        {
            lastTelemetry = Stopwatch.GetTimestamp();
            if (telemetry.Event == "error")
            {
                lastError = "helper 错误" + (telemetry.ErrorCode == null ? "（未识别错误码）" : "：" + telemetry.ErrorCode);
                StopAudio(false); return;
            }
            if (telemetry.Event == "stopped") { StopAudio(false); return; }
            isMuted = telemetry.Muted; mute.Text = isMuted ? "取消麦克风静音" : "静音麦克风"; mute.Enabled = true;
            status.Text = isMuted ? "运行中 · 麦克风已静音（仍接收播放）" : "运行中 · 麦克风已启用";
            if (telemetry.Event == "ready")
            {
                devices.Text = "实际输入：" + DescribeDevice(telemetry, "input", telemetry.InputApi) + "　实际输出：" + DescribeDevice(telemetry, "output", telemetry.OutputApi)
                    + "\r\nOpus 32 kbps / 48 kHz / 单声道 · 10 ms 回调 / 20 ms 编码块 · 配置缓冲 120 ms"
                    + "\r\n输入可降单声道，输出可复制到设备多声道；切换系统设备后，停止并重新开始。";
            }
            if (telemetry.Event != "stats") return;
            long now = Stopwatch.GetTimestamp();
            double sent = telemetry.Number("bytesSent"), received = telemetry.Number("bytesReceived");
            if (previousTime != 0)
            {
                double seconds = (now - previousTime) / (double)Stopwatch.Frequency;
                if (seconds > 0 && sent >= previousSent && received >= previousReceived)
                    rates.Text = String.Format(CultureInfo.InvariantCulture, "发送：{0:F1} KiB/s　　接收：{1:F1} KiB/s　　对方：{2:0} 人", (sent - previousSent) / seconds / 1024, (received - previousReceived) / seconds / 1024, telemetry.Number("peers"));
                else rates.Text = "收发计数基线重置；等待下一次遥测";
            }
            else rates.Text = "已收到累计计数；等待下一次遥测计算每秒收发";
            previousTime = now; previousSent = sent; previousReceived = received;
            counts.Text = String.Format(CultureInfo.InvariantCulture, "累计包：发 {0:0} / 收 {1:0}　UDP：发 {2:0} / 收 {3:0}　拒绝：{4:0}", telemetry.Number("packetsSent"), telemetry.Number("packetsReceived"), telemetry.Number("udpSent"), telemetry.Number("udpReceived"), telemetry.Number("rejectedPackets"));
            SetMeter(captureText, capture, "输入", telemetry, "captureRms"); SetMeter(playbackText, playback, "输出", telemetry, "playbackRms");
            health.Text = String.Format(CultureInfo.InvariantCulture, "回调 {0:0} · 活跃输出帧 {1:0} · 处理错误 {2:0} · 鉴权 / 重放拒绝 {3:0} / {4:0}\r\n输入欠载 / 溢出 {5:0} / {6:0} · 输出欠载 / 溢出 {7:0} / {8:0} · 发送失败 {9:0}", telemetry.Number("processCalls"), telemetry.Number("outputActiveFrames"), telemetry.Number("processErrors"), telemetry.Number("authRejected"), telemetry.Number("replayRejected"), telemetry.Number("captureUnderflows"), telemetry.Number("captureOverflows"), telemetry.Number("playbackUnderflows"), telemetry.Number("playbackOverflows"), telemetry.Number("sendFailures"));
        }
        private static string DescribeDevice(Telemetry telemetry, string prefix, string api)
        {
            if (!telemetry.Counters.ContainsKey(prefix + "Device") || !telemetry.Counters.ContainsKey(prefix + "Channels")) return "未知";
            return String.Format(CultureInfo.InvariantCulture, "#{0:0} / {1} / {2:0} 声道", telemetry.Number(prefix + "Device"), api, telemetry.Number(prefix + "Channels"));
        }
        private static void SetMeter(Label text, ProgressBar bar, string name, Telemetry telemetry, string field)
        {
            double level;
            if (!telemetry.Counters.TryGetValue(field, out level) || level > 1) { text.Text = name + "电平：未知"; bar.Value = 0; return; }
            text.Text = name + "电平：" + (level <= 0 ? "静音 / -∞ dBFS" : (20 * Math.Log10(level)).ToString("F1", CultureInfo.InvariantCulture) + " dBFS");
            bar.Value = (int)Math.Max(0, Math.Min(100, (20 * Math.Log10(Math.Max(level, 0.001)) + 60) * 100 / 60));
        }
        private static double SecondsSince(long timestamp) { return (Stopwatch.GetTimestamp() - timestamp) / (double)Stopwatch.Frequency; }
        private void Post(Action action)
        {
            try { if (!IsDisposed && IsHandleCreated) BeginInvoke(action); } catch (InvalidOperationException) { }
        }
        private void StopAudio(bool closeAfter)
        {
            closing = closing || closeAfter;
            if (stopping) return;
            if (helper == null) { if (closing) Close(); return; }
            stopping = true; stop.Enabled = false; mute.Enabled = false; status.Text = "正在静音并停止本次 helper…";
            Process owned = helper;
            Task.Factory.StartNew(delegate
            {
                bool exited = false;
                try
                {
                    if (!owned.HasExited)
                    {
                        owned.StandardInput.WriteLine("mute"); owned.StandardInput.WriteLine("stop"); owned.StandardInput.Flush();
                        exited = owned.WaitForExit(1800);
                        if (!exited) { owned.Kill(); exited = owned.WaitForExit(1000); }
                    }
                    else exited = true;
                }
                catch (InvalidOperationException) { exited = true; }
                catch (Exception)
                {
                    try { if (!owned.HasExited) { owned.Kill(); exited = owned.WaitForExit(1000); } else exited = true; } catch (Exception) { }
                }
                Post(delegate
                {
                    if (!exited)
                    {
                        stopping = false; stop.Enabled = true;
                        status.Text = "本次 helper 未确认退出，请再次停止；窗口保留进程引用。";
                        closing = false; return;
                    }
                    if (helper == owned) helper = null;
                    owned.Dispose(); stopping = false; SetRunningControls(false); mute.Enabled = false;
                    status.Text = lastError == null ? "已停止 · 本次 helper 已退出；麦克风与 UDP 关闭" : "已停止 · " + lastError;
                    rates.Text = "发送：已停止　　接收：已停止"; capture.Value = playback.Value = 0;
                    captureText.Text = "输入电平：已停止"; playbackText.Text = "输出电平：已停止";
                    if (closing) Close();
                });
            });
        }
        private void OnFormClosing(object sender, FormClosingEventArgs args)
        {
            if (helper != null) { args.Cancel = true; StopAudio(true); return; }
            freshness.Stop(); key.Clear();
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) freshness.Dispose();
            base.Dispose(disposing);
        }
    }

    internal static class SelfTests
    {
        private static void Check(bool condition) { if (!condition) throw new InvalidOperationException("Self-test failed."); }
        private static void Reject(Action action)
        {
            bool rejected = false; try { action(); } catch (ArgumentException) { rejected = true; } Check(rejected);
        }
        public static int Run()
        {
            try
            {
                Check(Contract.IsEtAddress("10.203.217.1") && Contract.IsEtAddress("10.203.217.254"));
                foreach (string bad in new string[] { "127.0.0.1", "10.203.217.0", "10.203.217.255", "10.203.217.01", "10.203.217.2:39177", "10.203.218.2", "10.203.217.2\nstop" }) Check(!Contract.IsEtAddress(bad));
                string testKey = new string('a', 64); Check(Contract.IsKey(testKey)); Check(!Contract.IsKey(new string('z', 64))); Check(!Contract.IsKey(new string('0', 64))); Check(!Contract.IsKey(testKey + "\n"));
                Check(Contract.IsKey(Contract.NewKey()));
                List<string> peers = Contract.ParsePeers("10.203.217.2，10.203.217.3\r\n10.203.217.4", "10.203.217.1"); Check(peers.Count == 3);
                Reject(delegate { Contract.ParsePeers("10.203.217.1", "10.203.217.1"); });
                Reject(delegate { Contract.ParsePeers("10.203.217.2,10.203.217.2", "10.203.217.1"); });
                Reject(delegate { Contract.ParsePeers("", "10.203.217.1"); });
                List<string> eleven = new List<string>(); for (int i = 2; i <= 12; i++) eleven.Add("10.203.217." + i); Check(Contract.ParsePeers(String.Join(",", eleven.ToArray()), "10.203.217.1").Count == 11);
                eleven.Add("10.203.217.13"); Reject(delegate { Contract.ParsePeers(String.Join(",", eleven.ToArray()), "10.203.217.1"); });
                string wire = Contract.BuildInput("10.203.217.1", peers, testKey);
                Check(wire.Split('\n').Length == 10 && wire.StartsWith("LAOKUAI_NATIVE_AUDIO_V1\n10.203.217.1\n39177\n") && wire.EndsWith("\nduplex\n-1\n-1\nstart\n"));
                Check(Telemetry.Parse("not json") == null && Telemetry.Parse("{\"event\":\"unknown\"}") == null);
                Telemetry stats = Telemetry.Parse("{\"event\":\"stats\",\"bytesSent\":128,\"captureRms\":0.25,\"peers\":2,\"muted\":true,\"key\":\"secret\",\"processErrors\":-1}");
                Check(stats != null && stats.Muted && stats.Number("bytesSent") == 128 && stats.Number("captureRms") == .25 && !stats.Counters.ContainsKey("key") && !stats.Counters.ContainsKey("processErrors"));
                foreach (string error in new string[] { "invalid-config", "audio-init", "udp-bind", "audio-device", "udp-runtime" })
                    Check(Telemetry.Parse("{\"event\":\"error\",\"code\":\"" + error + "\"}").ErrorCode == error);
                Check(Telemetry.Parse("{\"event\":\"error\",\"code\":\"anything-secret\"}").ErrorCode == null);
                Check(Telemetry.Parse("{\"event\":\"error\",\"code\":\"" + testKey + "\"}").ErrorCode == null);
                return 0;
            }
            catch (Exception) { return 1; }
        }
    }
}
