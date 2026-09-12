"""狮子准备音展示：旧音单列，两条最新音单列，不展示旧音状态别名。"""
TARGET = 'CharacterVoiceLogic/createVoicePathMap'
BODY_SHA = '1e9b3d58f3c2409cac476f6267f83f9d9100263f208c1984b88eb9f436224e03'
INSERT_AT = 213
PATHS = [f'character/lion_swordman_reborn/voice/battle/{leaf}' for leaf in
         ('skill_ready', 'matched_skill_ready', 'skill_ready_alt_1', 'matched_skill_ready_alt_1')]
STRING_IDS = (93145, 93146, 93147, 93148)


def exists(index, absent):
    return [('getlocal_2',), ('getproperty', 7746), ('pushstring', STRING_IDS[index]),
            ('callproperty', 8215, 1), ('iffalse', absent)]


def append(index):
    return [('getlocal', 21), ('pushstring', STRING_IDS[index]), ('callpropvoid', 65, 1)]


def block():
    code = [('getlocal_2',), ('getproperty', 7439), ('pushint', 5756), ('ifne', 'END'),
            ('newarray', 0), ('coerce', 6), ('setlocal', 21)]
    code += exists(0, 'OLD_ALIAS') + append(0) + [('jump', 'ALTS'), ('label', 'OLD_ALIAS')]
    code += exists(1, 'ALTS') + append(1) + [('label', 'ALTS')]
    for index in (2, 3):
        code += exists(index, f'NEXT{index}') + append(index) + [('label', f'NEXT{index}')]
    return code + [('label', 'END')]
