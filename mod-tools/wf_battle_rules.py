"""通用战斗补丁的配置编码；纯函数，不登记设备能力、不发布数据。"""
from __future__ import annotations

GAUGE_CAP = 'gauge-gain-rules-v1'
DAMAGE_CAP = 'damage-type-rules-v1'
GAINS = {'opening': 1, 'movement': 2, 'skill': 4, 'ability': 8,
         'combo_ability': 16, 'skill_triggered_ability': 32, 'other_action': 64}
ORIGINS = {'character': 256, 'leader': 512, 'weapon': 1024,
           'soul': 2048, 'ex': 4096}
OWNERS = {'self': 16384, 'other': 32768}
TRIGGERS = {'self': 65536, 'other': 131072}
SOURCES = {'any': 0, 'skill': 1, 'ability': 2, 'power_flip': 3, 'direct': 4}
DESTINATIONS = {'skill': 1, 'ability': 2, 'direct': 4, 'pf1': 31, 'pf2': 32, 'pf3': 33}
TARGETS = {'self': 0, 'others': 1, 'leader': 2, 'second': 3, 'third': 4, 'party': 5}
GROUP_MASKS = (127, 7936, 49152, 196608)
KNOWN_MASK = sum(GROUP_MASKS)


def _flags(values, mapping):
    result = 0
    for value in values:
        if value not in mapping:
            raise ValueError(f'unknown selection: {value}')
        result |= mapping[value]
    return result


def gauge_mask(gains, *, origins=(), owners=(), triggers=()):
    """同组任选其一，组间同时满足；关系均相对于实际收到加槽的角色。"""
    mask = (_flags(gains, GAINS) | _flags(origins, ORIGINS)
            | _flags(owners, OWNERS) | _flags(triggers, TRIGGERS))
    validate_code(423, mask)
    return mask


def damage_rule(source, destination):
    if source not in SOURCES or destination not in DESTINATIONS:
        raise ValueError('unknown source/destination damage type')
    return SOURCES[source]*100 + DESTINATIONS[destination]


def segment_override(destination):
    if destination not in DESTINATIONS:
        raise ValueError('unknown destination damage type')
    return 100 + DESTINATIONS[destination]


def validate_code(content, code):
    if type(code) is not int or code < 0:
        raise ValueError('规则必须为非负整数，不能使用 Decimal 倍率')
    if content == 423:
        if not code & GROUP_MASKS[0] or code & ~KNOWN_MASK:
            raise ValueError('加槽限制必须选择至少一种加槽类型，且不能含未知标记位')
        if code & 2 and code & (KNOWN_MASK ^ 127):
            raise ValueError('移动充能没有武器或施技者来源；请拆成独立规则')
    elif content == 424:
        if code//100 not in SOURCES.values() or code % 100 not in DESTINATIONS.values():
            raise ValueError('伤害映射必须是 source*100+destination 的单次转换')
    else:
        raise ValueError('unsupported battle rule content')


def row_problems(table, row, blocks):
    col = blocks.get('during_content')
    if col is None or len(row) <= col or row[blocks['precondition1']-1] != '1':
        return []
    if row[col] not in ('423', '424') or table != 'ability':
        return []
    try:
        text = row[col+9]
        if not text.isascii() or not text.isdigit():
            raise ValueError('规则编码必须为十进制整数')
        validate_code(int(row[col]), int(text))
    except (ValueError, IndexError) as exc:
        return [f'c{col+9} 战斗规则编码错误：{exc}']
    return []


def make_row(donor, string_id, content, code, *, target='self', groups='(None)'):
    """复用持续能力母行，清除 HP 门槛；只在 ability 表写入新词条。"""
    validate_code(content, code)
    if len(donor) != 126 or donor[5] != '1' or donor[85] != '(None)' or donor[97] != '0':
        raise ValueError('需要 126 列、无累积触发、始终生效的 ability 母行')
    if any(donor[i] != '0' for i in (6, 13, 20)) or target not in TARGETS:
        raise ValueError('母行不能带前置条件；目标必须为受支持的成员范围')
    # Native parseAt111 maps an empty string to Some([]), which matches nobody.
    # Only the literal (None) means an unrestricted party/others target.
    groups = groups or '(None)'
    row = list(donor)
    # During kind 0 is HpHigh, not Always: discard the donor's HP threshold.
    row[98], row[99], row[100], row[101] = '0', '', '0', '0'
    row[113], row[114] = '0', '0'
    row[0], row[109], row[110], row[111], row[118] = (
        string_id, str(content), str(TARGETS[target]), groups, str(code))
    row[108] = 'false'
    return row
