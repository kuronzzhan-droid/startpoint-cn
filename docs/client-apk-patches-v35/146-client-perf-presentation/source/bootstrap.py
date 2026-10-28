"""第十四轮（客户端纯表现层性能）双输入锁与 run14 输出边界。"""
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_DIR = Path(r'<WORKDIR>\v35-generic-20261018\run13')
BASE = BASE_DIR / 'v35m.swf'
BASE_SHA = '372c89f51a94dd44e4fd0407b93dbc6f2219dd4f5cf9d2398af9560360ca3899'
LOCAL = BASE_DIR / 'v35m-local-wf.swf'
LOCAL_SHA = '6ef98649f779a2718f5cb966180eab26d2edb0afff900a5e70c5a7821b42529a'
INPUTS = {'test': (BASE, BASE_SHA, 'v35n.swf'),
          'local': (LOCAL, LOCAL_SHA, 'v35n-local-wf.swf')}
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'vendor'))
sys.path.insert(0, str(ROOT))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check_baseline():
    for name, (path, expected, _) in INPUTS.items():
        actual = sha(path.read_bytes())
        declared = path.with_suffix('.swf.sha256').read_text(encoding='ascii').split()
        if actual != expected or declared != [expected, path.name]:
            raise ValueError(f'{name} 输入 SHA 或同目录 SHA 声明不符，停止')


def checked_output_path(path, roots=None):
    path = Path(path).resolve()
    allowed = [ROOT] + list(roots or [])
    if not any(path.is_relative_to(Path(r).resolve()) for r in allowed):
        raise ValueError('拒绝写入允许目录以外: ' + str(path))
    return path


def output_path(path, roots=None):
    path = checked_output_path(path, roots)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
