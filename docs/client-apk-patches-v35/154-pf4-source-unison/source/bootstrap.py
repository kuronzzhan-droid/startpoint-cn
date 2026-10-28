"""TASK19PF4 双输入与写入边界；导入历史工具时禁止外部 pycache。"""
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_DIR = Path(r'<WORKDIR>\outputs\apk\v35-generic-20261018\run15')
INPUTS = {
    'test': (BASE_DIR / 'v35o.swf', 'ec493123861924e5b51f73ab0de93cb046cdf491024771be9c6a387d5dd6a7de', 'v35-pf4.swf'),
    'local': (BASE_DIR / 'v35o-local-wf.swf', 'c17eb3b266baa39fd4abcdde5f3f1521bf46867d0a5ce0ec093b4f947a713024', 'v35-pf4-local-wf.swf'),
}
BASE, BASE_SHA, _ = INPUTS['test']
LOCAL, LOCAL_SHA, _ = INPUTS['local']
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'vendor'))
sys.path.insert(0, str(ROOT))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check_baseline():
    for name, (path, expected, _) in INPUTS.items():
        declared = path.with_suffix('.swf.sha256').read_text(encoding='ascii').split()
        if sha(path.read_bytes()) != expected or declared != [expected, path.name]:
            raise ValueError(name + ' 输入 SHA 或同目录声明不符，停止')


def checked_output_path(path, roots=None):
    value = Path(path).resolve()
    if not value.is_relative_to(ROOT):
        raise ValueError('只允许写当前 run19pf4 内: ' + str(value))
    return value


def output_path(path, roots=None):
    value = checked_output_path(path)
    value.parent.mkdir(parents=True, exist_ok=True)
    return value
