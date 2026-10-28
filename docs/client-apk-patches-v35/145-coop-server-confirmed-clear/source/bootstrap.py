"""第十三轮离线双输入锁与 run13 输出边界。"""
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# 归档源仍绑定这两个原始输入，不依赖归档所在目录深度。
BASE_DIR = Path(r'<WORKDIR>\v35-generic-20261018\run12')
BASE = BASE_DIR / 'v35l.swf'
BASE_SHA = '48e9eaf76b5d7e3a822a440f36c47056d98bfeeebebd7978ca13371c0facdb1a'
LOCAL = BASE_DIR / 'v35l-local-wf.swf'
LOCAL_SHA = 'aeab3079b2f988e3decf0cde9d21db72e72455baf5441fd265d344c5272ac8b6'
INPUTS = {'test': (BASE, BASE_SHA, 'v35m.swf'),
          'local': (LOCAL, LOCAL_SHA, 'v35m-local-wf.swf')}
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
            raise ValueError(f'{name} 输入 SHA 或同目录 SHA 声明不符，停止')


def checked_output_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('拒绝写入 run13 以外: ' + str(path))
    return path


def output_path(path):
    path = checked_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
