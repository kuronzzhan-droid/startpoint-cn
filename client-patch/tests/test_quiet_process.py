"""Windows process/desktop integration checks using only disposable children."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quiet_process as qp


def command(source, *args):
    return [sys.executable, "-u", "-c", source, *map(str, args)]


def desktop_name():
    user = ctypes.WinDLL("user32", use_last_error=True)
    user.OpenInputDesktop.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
    user.OpenInputDesktop.restype = ctypes.c_void_p
    user.GetUserObjectInformationW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p,
                                              ctypes.c_uint32, ctypes.c_void_p]
    user.CloseDesktop.argtypes = [ctypes.c_void_p]
    handle = user.OpenInputDesktop(0, False, 1)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        name = ctypes.create_unicode_buffer(256)
        if not user.GetUserObjectInformationW(handle, 2, name, ctypes.sizeof(name), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return name.value
    finally:
        user.CloseDesktop(handle)


def assert_exited(test, pid):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x100000, False, pid)
    if handle:
        try:
            test.assertEqual(kernel.WaitForSingleObject(handle, 1000), 0, f"process {pid} remains alive")
        finally:
            kernel.CloseHandle(handle)
    else:
        test.assertEqual(ctypes.get_last_error(), 87)


GUI_CHILD = r'''
import ctypes, json, os
from ctypes import wintypes as w
u = ctypes.WinDLL('user32', use_last_error=True)
k = ctypes.WinDLL('kernel32', use_last_error=True)
u.GetThreadDesktop.argtypes=[w.DWORD]; u.GetThreadDesktop.restype=w.HANDLE
k.GetCurrentThreadId.restype=w.DWORD
u.GetUserObjectInformationW.argtypes=[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD,ctypes.c_void_p]
u.CreateWindowExW.argtypes=[w.DWORD,w.LPCWSTR,w.LPCWSTR,w.DWORD,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,w.HWND,w.HMENU,w.HINSTANCE,ctypes.c_void_p]
u.CreateWindowExW.restype=w.HWND
u.IsWindowVisible.argtypes=[w.HWND]; u.IsWindowVisible.restype=w.BOOL
u.DestroyWindow.argtypes=[w.HWND];u.DestroyWindow.restype=w.BOOL
u.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)];u.GetWindowThreadProcessId.restype=w.DWORD
desktop=u.GetThreadDesktop(k.GetCurrentThreadId())
name=ctypes.create_unicode_buffer(256)
assert u.GetUserObjectInformationW(desktop,2,name,ctypes.sizeof(name),None)
# Built-in STATIC class needs no registered callback or GUI framework.
window=u.CreateWindowExW(0,'STATIC','Codex disposable desktop test',0x10000000|0x00CF0000,0,0,120,80,None,None,None,None)
if not window: raise ctypes.WinError(ctypes.get_last_error())
pid=w.DWORD();u.GetWindowThreadProcessId(window,ctypes.byref(pid))
print(json.dumps({'desktop':name.value,'hwnd':window,'visible':bool(u.IsWindowVisible(window)),'window_pid':pid.value,'pid':os.getpid()}),flush=True)
assert u.DestroyWindow(window)
'''


@unittest.skipUnless(os.name == "nt", "Windows desktop/process tests")
class QuietProcessTests(unittest.TestCase):
    def test_capture_unicode_and_nonzero(self):
        result = qp.run(command("import sys; print('Hello \\u4e2d\\u6587'); print('error',file=sys.stderr);sys.exit(7)"),
                        capture_output=True, encoding="utf-8", env=dict(os.environ, PYTHONIOENCODING="utf-8"))
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, "Hello 中文\n")
        self.assertEqual(result.stderr, "error\n")
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            qp.run(command("import sys;print('bad');sys.exit(3)"), capture_output=True, text=True, check=True)
        self.assertEqual(caught.exception.returncode, 3)
        self.assertEqual(caught.exception.output, "bad\n")

    def test_large_capture_no_pipe_deadlock(self):
        result = qp.run(command("import sys;sys.stdout.buffer.write(b'x'*2000000);sys.stderr.buffer.write(b'y'*2000000)"),
                        capture_output=True, timeout=10)
        self.assertEqual(result.stdout, b"x" * 2000000)
        self.assertEqual(result.stderr, b"y" * 2000000)

    def test_stdin_merge_file_cwd_and_env(self):
        with tempfile.TemporaryDirectory(prefix="CodexQuiet_") as directory:
            target = Path(directory) / "redirect.bin"
            env = dict(os.environ, CODEX_QUIET_TEST="yes", PYTHONIOENCODING="utf-8")
            with target.open("wb") as output:
                result = qp.run(command("import os,sys;print(os.getcwd());print(os.getenv('CODEX_QUIET_TEST'));print(sys.stdin.read());print('err',file=sys.stderr)"),
                                input="test 中文", encoding="utf-8", stdout=output, stderr=subprocess.STDOUT,
                                cwd=directory, env=env)
            self.assertEqual(result.returncode, 0)
            self.assertIsNone(result.stdout)
            content = target.read_text(encoding="utf-8")
            self.assertIn(directory, content)
            self.assertIn("test 中文", content)
            self.assertIn("yes", content)
            self.assertIn("err", content)

    def test_timeout_kills_child_tree_and_keeps_bytes(self):
        with tempfile.TemporaryDirectory(prefix="CodexQuietTree_") as directory:
            pid_file = Path(directory) / "child.json"
            source = "import os,sys,subprocess,time,json; c=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']);open(sys.argv[1],'w').write(json.dumps([os.getpid(),c.pid]));print('before timeout',flush=True);print('stderr before timeout',file=sys.stderr,flush=True);time.sleep(120)"
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                qp.run(command(source, pid_file), timeout=1, capture_output=True, text=True)
            self.assertEqual(caught.exception.output, b"before timeout\r\n")
            self.assertEqual(caught.exception.stderr, b"stderr before timeout\r\n")
            for pid in json.loads(pid_file.read_text()):
                assert_exited(self, pid)

    def test_success_also_cleans_orphan_child(self):
        source = "import sys,subprocess; c=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']);print(c.pid,flush=True)"
        result = qp.run(command(source), capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        assert_exited(self, int(result.stdout.strip()))

    def test_interrupt_also_kills_running_child_tree(self):
        with tempfile.TemporaryDirectory(prefix="CodexQuietInterrupt_") as directory:
            pid_file = Path(directory) / "child.json"
            source = "import os,sys,subprocess,time,json; c=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']);open(sys.argv[1],'w').write(json.dumps([os.getpid(),c.pid]));time.sleep(120)"
            original_wait = qp._Wait
            interrupted = False
            def interrupt_once(handle, milliseconds):
                nonlocal interrupted
                if not interrupted:
                    interrupted = True
                    until = time.monotonic() + 5
                    while not pid_file.exists() and time.monotonic() < until:
                        time.sleep(0.01)
                    raise KeyboardInterrupt
                return original_wait(handle, milliseconds)
            with mock.patch.object(qp, "_Wait", interrupt_once):
                with self.assertRaises(KeyboardInterrupt):
                    qp.run(command(source, pid_file), capture_output=True)
            for pid in json.loads(pid_file.read_text()):
                assert_exited(self, pid)

    def test_real_visible_window_is_on_private_desktop(self):
        before = desktop_name()
        result = qp.run_gui(command(GUI_CHILD), capture_output=True, text=True, check=True, timeout=10)
        evidence = json.loads(result.stdout)
        self.assertTrue(evidence["desktop"].startswith("CodexAIR_"))
        self.assertNotEqual(evidence["desktop"], before)
        self.assertTrue(evidence["hwnd"])
        self.assertTrue(evidence["visible"])
        self.assertEqual(evidence["pid"], evidence["window_pid"])
        self.assertEqual(desktop_name(), before)
        self.assertEqual(result.background_desktop, evidence["desktop"])
        self.assertEqual(result.pid, evidence["pid"])

    def test_exception_and_repeated_calls_do_not_leak_handles(self):
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        kernel.GetProcessHandleCount.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        def count():
            value = ctypes.c_uint32()
            if not kernel.GetProcessHandleCount(kernel.GetCurrentProcess(), ctypes.byref(value)):
                raise ctypes.WinError(ctypes.get_last_error())
            return value.value
        # Warm tempfile/interpreter caches before measuring our owned handles.
        qp.run(command("pass"), capture_output=True)
        before = count()
        for _ in range(3):
            result = qp.run_gui(command("pass"), capture_output=True)
            self.assertEqual(result.returncode, 0)
            with self.assertRaises(OSError):
                qp.run_gui(command("pass"), cwd="Z:/CodexQuietNonexistent9e7f1840", capture_output=True)
            with self.assertRaises(UnicodeDecodeError):
                qp.run_gui(command("import sys;sys.stdout.buffer.write(b'\\xff')"), capture_output=True, encoding="utf-8")
        self.assertLessEqual(count(), before + 1)

    def test_cli_preserves_streams_and_exit_code(self):
        module = Path(qp.__file__)
        result = qp.run([sys.executable, str(module), "--timeout", "5", "--", *command("import sys;print('cli-out');print('cli-err',file=sys.stderr);sys.exit(4)")],
                        capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 4)
        self.assertEqual(result.stdout, "cli-out\n")
        self.assertEqual(result.stderr, "cli-err\n")

    def test_validation_and_missing_executable(self):
        with self.assertRaises(TypeError):
            qp.run(command("pass"), unexpected=True)
        with self.assertRaises(ValueError):
            qp.run(command("pass"), shell=True)
        with self.assertRaises(ValueError):
            qp.run(command("pass"), capture_output=True, stdout=subprocess.PIPE)
        with self.assertRaises(FileNotFoundError):
            qp.run(["Codex-Nonexistent-Executable-9e7f1840.exe"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
