"""Run CLI tools quietly; keep ADL's GUI semantics on a private Windows desktop.

The desktop is never made active. This does not modify AIR, its license, or its
splash screen. Windows children belong to a per-call kill-on-close job.
"""
from __future__ import annotations

import contextlib
import ctypes
import locale
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from ctypes import wintypes as w

_OPTIONS = {"stdin", "input", "stdout", "stderr", "capture_output", "cwd",
            "timeout", "text", "encoding", "errors", "universal_newlines",
            "env", "check", "shell"}


def run(args, *, isolate_gui=None, **kwargs):
    """A bounded subset of subprocess.run; unsupported options fail explicitly.

    ADL/adl64 executables are automatically isolated on Windows. Passing
    isolate_gui=True also permits testing other GUI executables. File redirects
    must have a real fileno(); shell execution is deliberately unsupported.
    """
    unknown = kwargs.keys() - _OPTIONS
    if unknown:
        raise TypeError("unsupported quiet_process.run options: " + ", ".join(sorted(unknown)))
    if kwargs.get("shell"):
        raise ValueError("quiet_process.run does not support shell=True")
    if isinstance(args, (str, bytes, os.PathLike)):
        raise TypeError("quiet_process.run requires an argument sequence")
    args = [os.fsdecode(arg) for arg in args]
    if not args:
        raise ValueError("empty command")
    adl = os.path.basename(args[0]).lower() in {"adl", "adl.exe", "adl64", "adl64.exe"}
    # An explicit False must not turn off ADL's isolation accidentally.
    isolated = adl or bool(isolate_gui)
    if os.name != "nt":
        if isolated:
            raise OSError("GUI desktop isolation requires Windows")
        return subprocess.run(args, **kwargs)
    return _run_windows(args, isolated, kwargs)


def run_gui(args, **kwargs):
    return run(args, isolate_gui=True, **kwargs)


if os.name == "nt":
    import msvcrt

    class STARTUPINFO(ctypes.Structure):
        _fields_ = [("cb", w.DWORD), ("lpReserved", w.LPWSTR), ("lpDesktop", w.LPWSTR),
                    ("lpTitle", w.LPWSTR), ("dwX", w.DWORD), ("dwY", w.DWORD),
                    ("dwXSize", w.DWORD), ("dwYSize", w.DWORD),
                    ("dwXCountChars", w.DWORD), ("dwYCountChars", w.DWORD),
                    ("dwFillAttribute", w.DWORD), ("dwFlags", w.DWORD),
                    ("wShowWindow", w.WORD), ("cbReserved2", w.WORD),
                    ("lpReserved2", ctypes.POINTER(w.BYTE)), ("hStdInput", w.HANDLE),
                    ("hStdOutput", w.HANDLE), ("hStdError", w.HANDLE)]

    class STARTUPINFOEX(ctypes.Structure):
        _fields_ = [("StartupInfo", STARTUPINFO), ("lpAttributeList", ctypes.c_void_p)]

    class PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [("hProcess", w.HANDLE), ("hThread", w.HANDLE),
                    ("dwProcessId", w.DWORD), ("dwThreadId", w.DWORD)]

    class JOB_BASIC_LIMIT(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64),
                    ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", w.DWORD),
                    ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t),
                    ("ActiveProcessLimit", w.DWORD), ("Affinity", ctypes.c_size_t),
                    ("PriorityClass", w.DWORD), ("SchedulingClass", w.DWORD)]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in
                    ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                     "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class JOB_EXTENDED_LIMIT(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", JOB_BASIC_LIMIT), ("IoInfo", IO_COUNTERS),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t)]

    class JOB_ACCOUNTING(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int64) for name in
                    ("TotalUserTime", "TotalKernelTime", "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime")]
        _fields_ += [(name, w.DWORD) for name in
                     ("TotalPageFaultCount", "TotalProcesses", "ActiveProcesses", "TotalTerminatedProcesses")]

    _kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    _user = ctypes.WinDLL("user32", use_last_error=True)

    def _bind(lib, name, restype, *argtypes):
        fn = getattr(lib, name)
        fn.restype, fn.argtypes = restype, list(argtypes)
        return fn

    _CreateDesktop = _bind(_user, "CreateDesktopW", w.HANDLE, w.LPCWSTR,
                           w.LPCWSTR, ctypes.c_void_p, w.DWORD, w.DWORD, ctypes.c_void_p)
    _CloseDesktop = _bind(_user, "CloseDesktop", w.BOOL, w.HANDLE)
    _CloseHandle = _bind(_kernel, "CloseHandle", w.BOOL, w.HANDLE)
    _CreateJob = _bind(_kernel, "CreateJobObjectW", w.HANDLE, ctypes.c_void_p, w.LPCWSTR)
    _SetJob = _bind(_kernel, "SetInformationJobObject", w.BOOL, w.HANDLE,
                   ctypes.c_int, ctypes.c_void_p, w.DWORD)
    _QueryJob = _bind(_kernel, "QueryInformationJobObject", w.BOOL, w.HANDLE,
                     ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p)
    _AssignJob = _bind(_kernel, "AssignProcessToJobObject", w.BOOL, w.HANDLE, w.HANDLE)
    _TerminateJob = _bind(_kernel, "TerminateJobObject", w.BOOL, w.HANDLE, w.UINT)
    _TerminateProcess = _bind(_kernel, "TerminateProcess", w.BOOL, w.HANDLE, w.UINT)
    _Wait = _bind(_kernel, "WaitForSingleObject", w.DWORD, w.HANDLE, w.DWORD)
    _ExitCode = _bind(_kernel, "GetExitCodeProcess", w.BOOL, w.HANDLE, ctypes.POINTER(w.DWORD))
    _ResumeThread = _bind(_kernel, "ResumeThread", w.DWORD, w.HANDLE)
    _CurrentProcess = _bind(_kernel, "GetCurrentProcess", w.HANDLE)
    _GetStdHandle = _bind(_kernel, "GetStdHandle", w.HANDLE, w.DWORD)
    _DuplicateHandle = _bind(_kernel, "DuplicateHandle", w.BOOL, w.HANDLE, w.HANDLE,
                             w.HANDLE, ctypes.POINTER(w.HANDLE), w.DWORD, w.BOOL, w.DWORD)
    _InitializeAttributes = _bind(_kernel, "InitializeProcThreadAttributeList", w.BOOL,
                                  ctypes.c_void_p, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.c_size_t))
    _UpdateAttribute = _bind(_kernel, "UpdateProcThreadAttribute", w.BOOL, ctypes.c_void_p,
                            w.DWORD, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t,
                            ctypes.c_void_p, ctypes.c_void_p)
    _DeleteAttributes = _bind(_kernel, "DeleteProcThreadAttributeList", None, ctypes.c_void_p)
    _CreateProcess = _bind(_kernel, "CreateProcessW", w.BOOL, w.LPCWSTR, w.LPWSTR,
                          ctypes.c_void_p, ctypes.c_void_p, w.BOOL, w.DWORD,
                          ctypes.c_void_p, w.LPCWSTR, ctypes.POINTER(STARTUPINFOEX),
                          ctypes.POINTER(PROCESS_INFORMATION))


def _checked(result):
    if not result:
        raise ctypes.WinError(ctypes.get_last_error())
    return result


def _stop_job(job, process):
    _checked(_TerminateJob(job, 124))
    if process:
        if _Wait(process, 10000) == 0xFFFFFFFF:
            raise ctypes.WinError(ctypes.get_last_error())
    until = time.monotonic() + 10
    while True:
        info = JOB_ACCOUNTING()
        _checked(_QueryJob(job, 1, ctypes.byref(info), ctypes.sizeof(info), None))
        if not info.ActiveProcesses:
            return
        if time.monotonic() >= until:
            raise OSError("timed out waiting for the private process job to terminate")
        time.sleep(0.01)


def _run_windows(args, isolated, options):
    opts = dict(options)
    opts.pop("shell", None)
    check = opts.pop("check", False)
    timeout = opts.pop("timeout", None)
    if timeout is not None:
        timeout = float(timeout)
        if not math.isfinite(timeout):
            raise ValueError("timeout must be finite")
    cwd = opts.pop("cwd", None)
    cwd = os.path.abspath(os.fsdecode(cwd)) if cwd is not None else None
    env = opts.pop("env", None)
    text = opts.pop("text", None)
    universal = opts.pop("universal_newlines", None)
    if text is not None and universal is not None and bool(text) != bool(universal):
        raise ValueError("text and universal_newlines disagree")
    encoding, errors = opts.pop("encoding", None), opts.pop("errors", None)
    text_mode = bool(text or universal or encoding or errors)
    encoding = encoding or ("utf-8" if sys.flags.utf8_mode else locale.getencoding())
    errors = errors or "strict"
    capture = opts.pop("capture_output", False)
    stdout, stderr, stdin = (opts.pop(name, None) for name in ("stdout", "stderr", "stdin"))
    if stdin == subprocess.STDOUT:
        raise ValueError("stdin cannot be STDOUT")
    if stdout == subprocess.STDOUT:
        raise ValueError("stdout cannot be STDOUT")
    if capture:
        if stdout is not None or stderr is not None:
            raise ValueError("stdout/stderr cannot be used with capture_output")
        stdout = stderr = subprocess.PIPE
    data = opts.pop("input", None)
    supplied_input = data is not None
    if supplied_input and stdin is not None:
        raise ValueError("stdin and input may not be used together")
    if supplied_input:
        stdin = subprocess.PIPE
    if data is not None:
        if text_mode:
            data = data.encode(encoding, errors)
        elif not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError("binary input must be bytes-like")
    assert not opts
    requested_program = args[0]
    if os.path.dirname(requested_program):
        program = os.path.abspath(os.path.join(cwd or os.getcwd(), requested_program))
    else:
        program = shutil.which(requested_program, path=None if env is None else env.get("PATH"))
        if program is None:
            raise FileNotFoundError(2, "executable not found", requested_program)
    # CreateProcess cannot safely execute batch files without a shell.
    if os.path.splitext(program)[1].lower() in {".bat", ".cmd"}:
        raise ValueError("batch files require an explicit command interpreter")
    command = ctypes.create_unicode_buffer(subprocess.list2cmdline(args))
    environment = None
    if env is not None:
        entries = []
        for key, value in sorted(env.items(), key=lambda item: os.fsdecode(item[0]).upper()):
            key, value = os.fsdecode(key), os.fsdecode(value)
            if "\0" in key + value or "=" in key:
                raise ValueError("invalid environment entry")
            entries.append(key + "=" + value)
        environment = ctypes.create_unicode_buffer("\0".join(entries) + "\0\0")
    process = PROCESS_INFORMATION()
    assigned = False
    job = desktop = None
    attributes = None
    attributes_initialized = False
    desktop_name = None
    inherited = []
    with contextlib.ExitStack() as stack:
        captures = {}

        def std_handle(spec, name, std_id):
            if spec == subprocess.PIPE:
                stream = stack.enter_context(tempfile.TemporaryFile(mode="w+b"))
                if name == "stdin":
                    if data is not None:
                        stream.write(data)
                    stream.seek(0)
                else:
                    captures[name] = stream
                original = msvcrt.get_osfhandle(stream.fileno())
            elif spec == subprocess.DEVNULL:
                stream = stack.enter_context(open(os.devnull, "rb" if name == "stdin" else "wb"))
                original = msvcrt.get_osfhandle(stream.fileno())
            elif spec is None:
                original = _GetStdHandle(std_id & 0xFFFFFFFF)
                if not original or original == ctypes.c_void_p(-1).value:
                    stream = stack.enter_context(open(os.devnull, "rb" if name == "stdin" else "wb"))
                    original = msvcrt.get_osfhandle(stream.fileno())
            else:
                fd = spec if isinstance(spec, int) else spec.fileno()
                original = msvcrt.get_osfhandle(fd)
            duplicate = w.HANDLE()
            _checked(_DuplicateHandle(_CurrentProcess(), original, _CurrentProcess(),
                                      ctypes.byref(duplicate), 0, True, 2))
            inherited.append(duplicate.value)
            return duplicate.value

        try:
            si = STARTUPINFOEX()
            si.StartupInfo.cb = ctypes.sizeof(si)
            si.StartupInfo.dwFlags = 0x100 | 0x80  # std handles; no startup cursor
            si.StartupInfo.hStdInput = std_handle(stdin, "stdin", -10)
            si.StartupInfo.hStdOutput = std_handle(stdout, "stdout", -11)
            si.StartupInfo.hStdError = (si.StartupInfo.hStdOutput if stderr == subprocess.STDOUT
                                       else std_handle(stderr, "stderr", -12))
            if isolated:
                desktop_name = "CodexAIR_" + uuid.uuid4().hex
                desktop = _checked(_CreateDesktop(desktop_name, None, None, 0, 0x01FF, None))
                si.StartupInfo.lpDesktop = desktop_name
            size = ctypes.c_size_t()
            _InitializeAttributes(None, 1, 0, ctypes.byref(size))
            attributes = ctypes.create_string_buffer(size.value)
            _checked(_InitializeAttributes(attributes, 1, 0, ctypes.byref(size)))
            attributes_initialized = True
            si.lpAttributeList = ctypes.cast(attributes, ctypes.c_void_p)
            handles = (w.HANDLE * len(inherited))(*inherited)
            _checked(_UpdateAttribute(attributes, 0, 0x20002, handles,
                                      ctypes.sizeof(handles), None, None))
            job = _checked(_CreateJob(None, None))
            limits = JOB_EXTENDED_LIMIT()
            limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
            _checked(_SetJob(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
            flags = 0x4 | 0x80000 | 0x08000000  # suspended, extended info, no console
            if env is not None:
                flags |= 0x400
            _checked(_CreateProcess(program, command, None, None, True, flags, environment,
                                    cwd, ctypes.byref(si), ctypes.byref(process)))
            _checked(_AssignJob(job, process.hProcess))
            assigned = True
            if _ResumeThread(process.hThread) == 0xFFFFFFFF:
                raise ctypes.WinError(ctypes.get_last_error())
            milliseconds = 0xFFFFFFFF if timeout is None else min(0xFFFFFFFE, max(0, math.ceil(timeout * 1000)))
            result = _Wait(process.hProcess, milliseconds)
            if result == 0xFFFFFFFF:
                raise ctypes.WinError(ctypes.get_last_error())
            timed_out = result == 0x102
            code = w.DWORD()
            if not timed_out:
                _checked(_ExitCode(process.hProcess, ctypes.byref(code)))
            # Also close descendants left behind after the command's own exit.
            _stop_job(job, process.hProcess)
            output = {}
            for name, stream in captures.items():
                stream.seek(0)
                output[name] = stream.read()
            if timed_out:
                raise subprocess.TimeoutExpired(args, timeout, output.get("stdout"), output.get("stderr"))
            if text_mode:
                output = {name: value.decode(encoding, errors).replace("\r\n", "\n").replace("\r", "\n")
                          for name, value in output.items()}
            completed = subprocess.CompletedProcess(args, code.value, output.get("stdout"), output.get("stderr"))
            completed.pid = process.dwProcessId
            completed.background_desktop = desktop_name
            if check:
                completed.check_returncode()
            return completed
        finally:
            if process.hProcess:
                if assigned:
                    # This covers KeyboardInterrupt, decoding errors, and every API failure.
                    _TerminateJob(job, 124)
                else:
                    _TerminateProcess(process.hProcess, 124)
                _Wait(process.hProcess, 10000)
            for handle in (process.hThread, process.hProcess, job):
                if handle:
                    _CloseHandle(handle)
            if attributes_initialized:
                _DeleteAttributes(attributes)
            for handle in inherited:
                _CloseHandle(handle)
            if desktop:
                _CloseDesktop(desktop)


def _main():
    import argparse
    import sys
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    parsed = parser.parse_args()
    command = parsed.command
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        parser.error("a command is required after --")
    try:
        result = run(command, timeout=parsed.timeout, capture_output=True)
    except subprocess.TimeoutExpired as error:
        if error.output:
            sys.stdout.buffer.write(error.output)
        if error.stderr:
            sys.stderr.buffer.write(error.stderr)
        print("quiet_process: command timed out", file=sys.stderr)
        return 124
    if result.stdout:
        sys.stdout.buffer.write(result.stdout)
    if result.stderr:
        sys.stderr.buffer.write(result.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(_main())
