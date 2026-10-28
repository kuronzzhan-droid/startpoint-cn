"""第十五轮（镜像战斗跳过纯统计计算）双输入锁与 run14 输出边界。"""
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_DIR = Path(r'<WORKDIR>\v35-generic-20261018\run14')
BASE = BASE_DIR / 'v35n.swf'
BASE_SHA = '1c145e2709d7f8716c9abd817d30632b6fc6700791d1168855c8e46b2154c676'
LOCAL = BASE_DIR / 'v35n-local-wf.swf'
LOCAL_SHA = 'c8ec7da4fdf394d1314726e17e53fb23f8c204f8b0038f3b96baeab6ce985a6c'
INPUTS = {'test': (BASE, BASE_SHA, 'v35o.swf'),
          'local': (LOCAL, LOCAL_SHA, 'v35o-local-wf.swf')}
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
