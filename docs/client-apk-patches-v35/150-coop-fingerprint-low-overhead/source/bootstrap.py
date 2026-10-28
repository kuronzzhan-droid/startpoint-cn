"""Round 18: fixed run17 inputs; writes remain inside run18."""
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_DIR = Path(r'<WORKDIR>\outputs\apk\v35-generic-20261018\run17')
BASE = BASE_DIR / 'v35q.swf'
BASE_SHA = 'f3032a18e4f44c107c8f433f5c94b9f2a02b4fc1732f5c6f60aa30b3af4ef0c3'
LOCAL = BASE_DIR / 'v35q-local-wf.swf'
LOCAL_SHA = '6e6c15a07b4ebccd4eba8bb2c2dcf16680a3187f9844b8326376997d85075e9a'
INPUTS = {'test': (BASE, BASE_SHA, 'v35r.swf'),
          'local': (LOCAL, LOCAL_SHA, 'v35r-local-wf.swf')}
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'vendor'))
sys.path.append(str(ROOT / 'inherited'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check_baseline():
    for name, (path, expected, _) in INPUTS.items():
        actual = sha(path.read_bytes())
        declared = path.with_suffix('.swf.sha256').read_text(encoding='ascii').split()
        if actual != expected or declared != [expected, path.name]:
            raise ValueError(f'{name} 输入SHA或相邻SHA声明不符，停止')


def checked_output_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('拒绝写入run18以外: ' + str(path))
    return path


def output_path(path):
    path = checked_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def source_evidence():
    """Bind reusable offline evidence to all generators, checkers and fixtures."""
    names = ('bootstrap.py', 'build.py', 'framework.py', 'static_check.py', 'integrity.py',
             'baseline-locks.json')
    paths = {ROOT / name for name in names}
    for pattern in ('fp_*.py', 'test_*.py', 'verify*.py', 'input-structs-*.json'):
        paths.update(ROOT.glob(pattern))
    paths.update(p for p in ROOT.glob('*.py') if p.name != 'delivery.py')
    paths.update((ROOT / 'vendor').rglob('*.py'))
    paths.update((ROOT / 'inherited').rglob('*.py'))
    paths.update((ROOT / 'inherited').glob('*.json'))
    paths.update((ROOT / 'scale-evidence').glob('*spec*.json'))
    return {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in sorted(paths)}
