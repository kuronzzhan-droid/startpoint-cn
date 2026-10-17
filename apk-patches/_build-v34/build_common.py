"""Offline tooling paths and workspace-confined process outputs."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / 'r4-src/client-patch'
SDK = Path(r'D:\WF\_archive\kept\AIRSDK_51.1.4.1')
JAVA = Path(r'D:\WF\runtimes\android-toolchain\jdk\jdk-17.0.19+10\bin\java.exe')
FFDEC = Path(r'D:\WF\_archive\kept\ffdec_26.2.1\ffdec.jar')
ZIPALIGN = Path(r'D:\WF\runtimes\android-toolchain\sdk\build-tools\34.0.0\zipalign.exe')


def environment():
    temp = ROOT / 'temp'
    temp.mkdir(exist_ok=True)
    env = os.environ.copy()
    env.update(PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1',
               TEMP=str(temp), TMP=str(temp),
               STARPOINT_AIR_SDK=str(SDK), STARPOINT_JAVA=str(JAVA),
               STARPOINT_FFDEC_JAR=str(FFDEC),
               JAVA_TOOL_OPTIONS=f'-Djava.io.tmpdir={temp} -Duser.home={temp}')
    return env


def run(name, command, timeout=600):
    logs = ROOT / 'logs'
    logs.mkdir(exist_ok=True)
    result = subprocess.run([str(x) for x in command], cwd=ROOT,
                            env=environment(), capture_output=True, timeout=timeout)
    (logs / f'{name}.log').write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f'{name} failed ({result.returncode}); see logs/{name}.log')
    print(name, 'passed', flush=True)
    return result


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
