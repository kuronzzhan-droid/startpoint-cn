"""第十一轮输出边界；前十轮、v34和任务文件只读。"""
import os
import sys
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUN1, RUN2, RUN3, RUN4, RUN5, RUN6, RUN7, RUN8, RUN9 = (ROOT.parent / name for name in ('run1', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7', 'run8', 'run9'))
RUN10 = ROOT.parent / 'run10'
BASE = RUN10 / 'v35j.swf'
BASE_SHA = '1414862f84a1895b0bea54613f92fd48a59d11544a6097ef4dd2627c0dfe2384'
V34 = Path(r'D:\WF\v34-r4-20261016\v34.swf')
V34_SHA = '3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a'
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'vendor'))


def check_baseline():
    declared = (BASE.parent / (BASE.name + '.sha256')).read_text(encoding='ascii').split()[0]
    actual = hashlib.sha256(BASE.read_bytes()).hexdigest()
    if declared != BASE_SHA or actual != declared:
        raise ValueError('输入 v35j 与 run10/v35j.swf.sha256 或固定 SHA 不符，停止')


def checked_output_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('拒绝写入 run11 以外: ' + str(path))
    return path


def output_path(path):
    path = checked_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
