// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the production client-pipe factory without elevation, ET, or a driver.
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class BrokerPipeTests {
    static void Require(bool condition, string message) {
        if (!condition) throw new Exception(message);
    }
    static Task<string> PendingRead(StreamReader reader) {
        var entered = new ManualResetEventSlim(false);
        var read = Task.Factory.StartNew(() => { entered.Set(); return reader.ReadLine(); }, TaskCreationOptions.LongRunning);
        Require(entered.Wait(1000), "command reader did not start");
        // Let the blocking Windows read enter the kernel before the opposite write.
        Thread.Sleep(100);
        return read;
    }
    static void ReplyWhileReading(StreamReader serverReader, StreamWriter clientWriter, string line) {
        var reply = Task.Factory.StartNew(() => serverReader.ReadLine(), TaskCreationOptions.LongRunning);
        var write = Task.Factory.StartNew(() => clientWriter.WriteLine(line), TaskCreationOptions.LongRunning);
        Require(reply.Wait(1500) && reply.Result == line && write.Wait(1500), "status blocked behind pending command read: " + line);
    }
    static void Main() {
        var watchdog = new Thread(() => { Thread.Sleep(20000); Console.Error.WriteLine("FAIL duplex watchdog"); Environment.Exit(2); });
        watchdog.IsBackground = true; watchdog.Start();
        try {
            var name = "laokuai-et-test-" + Guid.NewGuid().ToString("N");
            using (var server = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 16384, 16384)) {
                var connected = server.BeginWaitForConnection(null, null);
                using (var client = Program.CreateClientPipe(name)) {
                    client.Connect(2000); server.EndWaitForConnection(connected);
                    var sr = new StreamReader(server, Encoding.UTF8, false, 16384, true);
                    var sw = new StreamWriter(server, new UTF8Encoding(false), 16384, true) { AutoFlush = true };
                    var cr = new StreamReader(client, Encoding.UTF8, false, 16384, true);
                    var cw = new StreamWriter(client, new UTF8Encoding(false), 16384, true) { AutoFlush = true };
                    ReplyWhileReading(sr, cw, "LAOKUAI_BROKER_READY_V1");
                    for (var session = 0; session < 3; session++) {
                        var command = PendingRead(cr);
                        ReplyWhileReading(sr, cw, "LAOKUAI_BROKER_STARTED_V1 123");
                        sw.WriteLine("LAOKUAI_OWNED_STOP_V1");
                        Require(command.Wait(1500) && command.Result == "LAOKUAI_OWNED_STOP_V1", "stop command not delivered");
                        var next = PendingRead(cr);
                        ReplyWhileReading(sr, cw, "LAOKUAI_OWNED_STOPPED_V1");
                        ReplyWhileReading(sr, cw, "LAOKUAI_BROKER_FINISHED_V1 0");
                        sw.WriteLine("next-session");
                        Require(next.Wait(1500) && next.Result == "next-session", "session reuse failed");
                    }
                }
            }
            Console.WriteLine("PASS actual Windows broker pipe: readiness, concurrent startup/status, graceful stop, three reused sessions; no UAC/ET/driver");
            Environment.Exit(0);
        } catch (Exception error) {
            Console.Error.WriteLine("FAIL " + error.Message);
            // A regression can leave a synchronous kernel read blocked. Do not wait
            // for Dispose on that handle; the fixture process owns every resource.
            Environment.Exit(1);
        }
    }
}
