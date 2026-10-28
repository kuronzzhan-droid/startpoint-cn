"""第十六轮：固定双输入，全部输出限制在run16。"""
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_DIR = Path(r'<WORKDIR>\outputs\apk\v35-generic-20261018\run15')
BASE = BASE_DIR / 'v35o.swf'
BASE_SHA = 'ec493123861924e5b51f73ab0de93cb046cdf491024771be9c6a387d5dd6a7de'
LOCAL = BASE_DIR / 'v35o-local-wf.swf'
LOCAL_SHA = 'c17eb3b266baa39fd4abcdde5f3f1521bf46867d0a5ce0ec093b4f947a713024'
INPUTS = {'test': (BASE, BASE_SHA, 'v35p.swf'),
          'local': (LOCAL, LOCAL_SHA, 'v35p-local-wf.swf')}
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'vendor'))


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
        raise ValueError('拒绝写入run16以外: ' + str(path))
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
    paths.update((ROOT / 'vendor').rglob('*.py'))
    return {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in sorted(paths)}
