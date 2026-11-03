"""第九轮输出边界；前八轮、v34和任务文件只读。"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUN1, RUN2, RUN3, RUN4, RUN5, RUN6, RUN7, RUN8 = (ROOT.parent / name for name in ('run1', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7', 'run8'))
BASE = RUN8 / 'v35h.swf'
BASE_SHA = 'f1c3260d470f46a4364baddb85af48dc34a5c299bb025d123be085ad6f04e573'
V34 = Path(r'D:\WF\v34-r4-20261016\v34.swf')
V34_SHA = '3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a'
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'vendor'))


def checked_output_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('拒绝写入 run9 以外: ' + str(path))
    return path


def output_path(path):
    path = checked_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
