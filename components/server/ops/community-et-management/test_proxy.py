"""Linux fixture sockets only; never contacts the deployed RPC/core or reads credentials."""
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE=Path(__file__).with_name('proxy.py')
spec=importlib.util.spec_from_file_location('management_proxy',SOURCE)
p=importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class ListenerLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='lkc-proxy-test-')
        self.addCleanup(self.temp.cleanup)
        p.UID=os.getuid()
        p.SOCKET=str(Path(self.temp.name)/'management.sock')
        self.path=Path(p.SOCKET)

    def stale(self):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
            s.bind(p.SOCKET)
            os.chmod(p.SOCKET,0o600)

    def test_restart_preserves_directory_and_ledger(self):
        ledger=Path(self.temp.name)/'member-ledger.json'
        ledger.write_text('{"fixture":"unchanged"}')
        inode=Path(self.temp.name).stat().st_ino
        self.stale()
        for _ in range(2):
            with p.management_listener():
                with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as probe: probe.connect(p.SOCKET)
                self.assertEqual(self.path.stat().st_mode & 0o777,0o600)
            self.assertFalse(self.path.exists())
        self.assertEqual(Path(self.temp.name).stat().st_ino,inode)
        self.assertEqual(ledger.read_text(),'{"fixture":"unchanged"}')

    def test_duplicate_owner_cannot_remove_live_socket(self):
        with p.management_listener():
            inode=self.path.stat().st_ino
            with self.assertRaises(BlockingIOError):
                with p.management_listener(): pass
            self.assertEqual(self.path.stat().st_ino,inode)

    def test_live_socket_without_lock_is_preserved(self):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as live:
            live.bind(p.SOCKET);os.chmod(p.SOCKET,0o600);live.listen(1)
            inode=self.path.stat().st_ino
            with self.assertRaisesRegex(RuntimeError,'listener-already-active'):
                with p.management_listener(): pass
            self.assertEqual(self.path.stat().st_ino,inode)

    def test_regular_file_is_preserved(self):
        self.path.write_text('fixture')
        with self.assertRaisesRegex(RuntimeError,'unsafe-existing-socket'):
            with p.management_listener(): pass
        self.assertEqual(self.path.read_text(),'fixture')

    def test_symlink_is_preserved(self):
        target=Path(self.temp.name)/'target';target.write_text('fixture')
        self.path.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError,'unsafe-existing-socket'):
            with p.management_listener(): pass
        self.assertTrue(self.path.is_symlink());self.assertEqual(target.read_text(),'fixture')

    def test_wrong_socket_mode_is_preserved(self):
        self.stale();os.chmod(p.SOCKET,0o666)
        with self.assertRaisesRegex(RuntimeError,'unsafe-existing-socket'):
            with p.management_listener(): pass
        self.assertTrue(self.path.exists())

    def test_socket_replacement_is_not_removed_on_exit(self):
        with p.management_listener():
            self.path.unlink();self.path.write_text('replacement')
        self.assertEqual(self.path.read_text(),'replacement')

    def test_sigterm_stale_socket_recovers_on_next_process(self):
        script="import importlib.util,os,sys; s=importlib.util.spec_from_file_location('proxy',sys.argv[1]); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.UID=os.getuid();m.SOCKET=sys.argv[2];m.serve()"
        for _ in range(2):
            child=subprocess.Popen([sys.executable,'-I','-c',script,str(SOURCE),p.SOCKET],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                ready=False;until=time.monotonic()+3
                while time.monotonic()<until and child.poll() is None:
                    try:
                        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as probe: probe.connect(p.SOCKET);ready=True;break
                    except OSError:time.sleep(.02)
                self.assertTrue(ready,'management channel failed to restart')
            finally:
                if child.poll() is None:child.terminate()
                child.wait(timeout=3)

if __name__=='__main__': unittest.main()
