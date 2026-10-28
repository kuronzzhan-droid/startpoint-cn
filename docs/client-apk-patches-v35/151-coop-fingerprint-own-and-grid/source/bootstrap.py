"""第二十轮：固定 run18 输入，全部写入限定 run20。"""
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_DIR = ROOT.parent / 'run18'
BASE = BASE_DIR / 'v35r.swf'
BASE_SHA = 'ce5e1b4d62ae879c6f204d70be7785aad3515076b0a28647e3a9d416dbb13040'
LOCAL = BASE_DIR / 'v35r-local-wf.swf'
LOCAL_SHA = '85fe384921785e6842ff7a9f385d2b41de6eb5dcda933dc1ec924c8e2079aef2'
INPUTS = {'test': (BASE, BASE_SHA, 'v35s.swf'),
          'local': (LOCAL, LOCAL_SHA, 'v35s-local-wf.swf')}
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
os.environ['TEMP'] = str(ROOT / 'work' / 'tmp')
os.environ['TMP'] = os.environ['TEMP']
sys.path.insert(0, str(ROOT / 'vendor'))
sys.path.append(str(ROOT / 'inherited'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check_baseline():
    for name, (path, expected, _) in INPUTS.items():
        declared = path.with_suffix('.swf.sha256').read_text(encoding='ascii').split()
        if sha(path.read_bytes()) != expected or declared != [expected, path.name]:
            raise ValueError(f'{name} 输入SHA或相邻SHA声明不符')


def checked_output_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('拒绝写入run20以外: ' + str(path))
    return path


def output_path(path):
    path = checked_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def source_evidence():
    paths = set(ROOT.glob('*.py')) | {ROOT / 'baseline-locks.json'}
    paths.update((ROOT / 'vendor').rglob('*.py'))
    paths.update((ROOT / 'inherited').rglob('*.py'))
    paths.update((ROOT / 'inherited').glob('*.json'))
    paths.update((ROOT / 'scale-evidence').glob('*spec*.json'))
    return {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in sorted(paths)}
