"""有限 AVM2 解释器：执行觉醒专属素材补丁前后的真实字节码。

不另写解释器，也不复制：按路径以 v1 的同一个模块名 ``equipment_enhanced_look_interp`` 加载
``equipment-enhanced-look/look_interp.py``（它再以私有名重新执行 ``equipment-description-override/desc_interp.py``，
后者以私有名导入 ``equipment-rules/avm_interp.py``；三个文件都**不改一个字**）。与编成槽框补丁
（``equipment-enhanced-party-frame/party_interp.py``）拿到的是同一个模块对象。

本补丁插入段用到的指令（``add`` 字符串拼 int、``convert_i`` / ``convert_s``、``ifstrictne``、``ifngt``、
``getlex``、``coerce``、``returnvalue``）与原方法体里的 ``findproperty`` / ``astype`` / ``lookupswitch``
都在原循环里；``convert_i`` 对字符串走 v1 私有副本里的 AS3 ``Number(String)`` + ToInt32 语义
（「规范十进制正整数」判定 ``String(int(s)) === s`` 依赖它）。遇到未支持的指令仍然直接报错。
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
AwakenInterp = look.LookInterp
to_int32 = look.to_int32
