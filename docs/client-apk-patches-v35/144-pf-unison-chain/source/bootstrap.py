"""第十二轮离线双输入与输出边界。"""
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_DIR = Path(r'<WORKDIR>\outputs\apk\hell-pumpkin-20261020\swf')
BASE = BASE_DIR / 'v35k-pa.swf'
BASE_SHA = '6ff86f5f84d06dc5b5ff98be9df0c3eb7475de5daea7dfdd4dee653120bd8efb'
LOCAL = BASE_DIR / 'v35k3-local-wf-pa.swf'
LOCAL_SHA = '0266fe47423bcc1c466d6b4aacf9d53f3865fc693db0ebfc490b8c9de51c9ca6'
INPUTS = {'test': (BASE, BASE_SHA, 'v35l.swf'),
          'local': (LOCAL, LOCAL_SHA, 'v35l-local-wf.swf')}
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'vendor'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check_baseline():
    for name, (path, expected, _) in INPUTS.items():
        actual = sha(path.read_bytes())
        declared = path.with_suffix('.swf.sha256').read_text(encoding='ascii').split()[0]
        if actual != expected or declared != expected:
            raise ValueError(f'{name} 输入 SHA 或同目录 SHA 声明不符，停止')


def checked_output_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('拒绝写入 run12 以外: ' + str(path))
    return path


def output_path(path):
    path = checked_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
