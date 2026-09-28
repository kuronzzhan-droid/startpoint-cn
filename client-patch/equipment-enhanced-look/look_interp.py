"""有限 AVM2 解释器（私有副本）：执行装备强化外观前后的真实字节码。

以私有模块名 ``equipment_enhanced_look_desc_base`` 按路径**重新执行一份**
``equipment-description-override/desc_interp.py``（它又以私有名导入 ``equipment-rules/avm_interp.py``；
两个文件都**不改一个字**，也不影响它们各自测试里加载的模块对象），然后只在这份私有副本上替换两处值语义：

* ``_to_int``：字符串按 AS3 ``Number(String)``（ECMA-262 StringToNumber：去首尾空白，空串 0，
  ``0x`` 十六进制，``Infinity``，十进制字面量，其余 NaN）再做 ToInt32（NaN/±Infinity -> 0，按 2^32 取模）。
  原实现用 Python ``float()``：会接受 ``1_000``、``inf``、``nan``，且对 ``inf`` 抛 OverflowError —— 与 AVM 不同，
  而第二图标档的等级校验 ``String(int(s)) === s`` 恰好依赖这条语义。
* ``_array_member``：补 ``indexOf``（原生 ``ItemThumbnailTools.getRarityFrameIndex`` 对 ``ENHANCED_FRAME_ENABLE_RARITY``
  调用它）。

``LookInterp`` 就是这份私有副本里的 ``DescInterp``；指令循环一字未改，遇到未支持的指令仍然直接报错。
"""
from __future__ import annotations

import importlib.util
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DESC_PATH = HERE.parent / 'equipment-description-override' / 'desc_interp.py'
PRIVATE = 'equipment_enhanced_look_desc_base'


def _load_private():
    if PRIVATE in sys.modules:
        return sys.modules[PRIVATE]
    spec = importlib.util.spec_from_file_location(PRIVATE, DESC_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[PRIVATE] = module
    spec.loader.exec_module(module)
    return module


desc = _load_private()
base = desc.base
AvmThrow, Cls, slice_method, GLOBALS = desc.AvmThrow, desc.Cls, desc.slice_method, desc.GLOBALS

_WHITESPACE = '\t\n\v\f\r              ' \
              '    　﻿'
_DECIMAL = re.compile(r'[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
_HEX = re.compile(r'0[xX][0-9a-fA-F]+')


def string_to_number(text: str) -> float:
    """AS3 ``Number(text)``。"""
    s = text.strip(_WHITESPACE)
    if s == '':
        return 0.0
    if _HEX.fullmatch(s):
        return float(int(s[2:], 16))
    if s in ('Infinity', '+Infinity'):
        return math.inf
    if s == '-Infinity':
        return -math.inf
    if _DECIMAL.fullmatch(s):
        return float(s)
    return math.nan


def to_int32(value) -> int:
    """AS3 ``int(value)``：ToNumber 后 ToInt32。"""
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, str):
        value = string_to_number(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return 0
        value = math.trunc(value)
    return base._i32(int(value))


_original_array_member = desc._array_member


def _array_member(obj, name):
    if name == 'indexOf':
        return lambda needle, start=0: next((i for i in range(int(start), len(obj)) if obj[i] == needle), -1)
    return _original_array_member(obj, name)


# 只改私有副本的模块全局：它的 DescInterp.run / lookup 在这份副本的 __dict__ 里查这两个名字。
desc._to_int = to_int32
desc._array_member = _array_member
LookInterp = desc.DescInterp
lookup = desc.lookup
to_string = desc.to_string
