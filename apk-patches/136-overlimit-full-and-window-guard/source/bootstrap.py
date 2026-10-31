"""第八轮输出边界；前七轮、v34和任务文件只读。"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUN1, RUN2, RUN3, RUN4, RUN5, RUN6, RUN7 = (ROOT.parent / name for name in ('run1', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7'))
BASE = RUN7 / 'v35g.swf'
BASE_SHA = '960757dbaf599b5d4978b95670b9bbe3e76fac5cfd29045b8c9c0dd1a1ca0870'
V34 = Path(r'D:\WF\v34-r4-20261016\v34.swf')
V34_SHA = '3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a'
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(ROOT / 'vendor'))


def checked_output_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('拒绝写入 run8 以外: ' + str(path))
    return path


def output_path(path):
    path = checked_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
