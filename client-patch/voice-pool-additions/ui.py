"""追加准备音的独立试听按钮；不把同一录音的 matched 别名重复列出。"""
TARGET = 'CharacterVoiceLogic/createVoicePathMap'
BASE_SHA = 'b437ee928489d4d8e954ef4cbd1b1cb0955ab9da73eeedfd92640c81c80f26e3'
INSERT_AT = 253
ROSTER = {
    129992: ('unicorn_lancer_rose', ['skill_ready'] + [f'skill_ready_alt_{i}' for i in range(1, 6)]),
    139993: ('super_robot_tailcoat', ['skill_ready', 'matched_skill_ready', 'skill_ready_alt_2']),
    159998: ('samurai_robot_plum', ['skill_ready', 'matched_skill_ready', 'skill_ready_alt_2', 'skill_ready_alt_3']),
}


def block(pool):
    out = []
    for cid, (code, leaves) in ROSTER.items():
        out += [('getlocal_2',), ('getproperty', 7439), ('pushint', pool.integer(cid)),
                ('ifne', f'ROLE{cid}'), ('newarray', 0), ('coerce', 6), ('setlocal', 21)]
        for i, leaf in enumerate(leaves):
            path = pool.string(f'character/{code}/voice/battle/{leaf}')
            out += [('getlocal_2',), ('getproperty', 7746), ('pushstring', path),
                    ('callproperty', 8215, 1), ('iffalse', f'NEXT{cid}_{i}'),
                    ('getlocal', 21), ('pushstring', path), ('callpropvoid', 65, 1),
                    ('label', f'NEXT{cid}_{i}')]
        out += [('jump', 'END'), ('label', f'ROLE{cid}')]
    return out + [('label', 'END')]
