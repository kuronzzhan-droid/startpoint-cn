"""有限 AVM2 解释器：执行编成装备槽强化框覆盖前后的真实字节码。

不另写解释器，也不复制：按路径以 v1 的同一个模块名 ``equipment_enhanced_look_interp`` 加载
``equipment-enhanced-look/look_interp.py``（它再以私有名重新执行 ``equipment-description-override/desc_interp.py``，
后者以私有名导入 ``equipment-rules/avm_interp.py``；三个文件都**不改一个字**）。同一进程里先后跑 v1 与本补丁的测试时，
两边拿到的是同一个模块对象，不会把 v1 的值语义替换执行两遍。

本补丁插入段用到的指令（``findpropstrict``/``constructprop``、``setproperty``、``ifstricteq``、``pushnull``、
``pushtrue``/``pushfalse``、``jump``、方法闭包 ``getproperty``）都在原循环里；显示对象用带属性的 Python 对象模拟，
``getproperty`` / ``setproperty`` 对非 dict 对象走 ``getattr`` / ``setattr``。遇到未支持的指令仍然直接报错。
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOOK_PATH = HERE.parent / 'equipment-enhanced-look' / 'look_interp.py'
LOOK_MODULE = 'equipment_enhanced_look_interp'


def _load_look():
    if LOOK_MODULE in sys.modules:
        return sys.modules[LOOK_MODULE]
    spec = importlib.util.spec_from_file_location(LOOK_MODULE, LOOK_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[LOOK_MODULE] = module
    spec.loader.exec_module(module)
    return module


look = _load_look()
AvmThrow, Cls, slice_method = look.AvmThrow, look.Cls, look.slice_method
PartyInterp = look.LookInterp
