"""Only summer Bai's voice selection; never modify the gameplay switching flag."""
CODE = 'white_tiger_summer'
CID = 149990
READY_NORMAL = 'wtsReadyNormalNext'
READY_FEVER = 'wtsReadyFeverNext'
ALT_PATHS = [f'character/{CODE}/voice/battle/{x}_alt_1'
             for x in ('skill_ready', 'matched_skill_ready')]


def character_guard(pool):
    return [('getlocal_0',), ('getproperty', 9733),
            ('getproperty', 15727), ('pushstring', pool.string(CODE)),
            ('ifne', 'END')]


def skill_block(pool):
    return [('getlocal_3',), ('getproperty', 15727),
            ('pushstring', pool.string(CODE)), ('ifne', 'END'),
            ('getlocal_0',), ('getproperty', 27234),
            ('callproperty', 42786, 0), ('iffalse', 'NORMAL'),
            ('getlocal_3',), ('getproperty', 16674), ('jump', 'SELECT'),
            ('label', 'NORMAL'), ('getlocal_3',), ('getproperty', 16676),
            ('label', 'SELECT'), ('coerce', 6), ('setlocal', 8),
            ('label', 'END')]


def ready_phase_block(pool):
    # Resolve ZoneManager from this HUD's gear, as other HUDs do. No cast to a
    # particular Member implementation, no gameplay flag or shared state change.
    return character_guard(pool) + [
        ('getlocal_0',), ('getproperty', 6117), ('getlex', 40885),
        ('pushnull',), ('callproperty', 6114, 2), ('coerce', 40885),
        ('callproperty', 42786, 0), ('convert_b',), ('setlocal_3',),
        ('label', 'END')]


def ready_alternate_block(pool, slots):
    code = character_guard(pool)
    code += [('getlocal', 4), ('getproperty', 46), ('pushbyte', 0),
             ('ifne', 'END'), ('getlocal_3',), ('iftrue', 'FEVER')]
    for phase, name in [('NORMAL', READY_NORMAL), ('FEVER', READY_FEVER)]:
        slot = slots[name]
        if phase == 'FEVER':
            code += [('label', 'FEVER')]
        # int slots default to zero. Flip a 0/1 toggle, never an unbounded count.
        code += [('getlocal_0',), ('getproperty', slot), ('pushbyte', 0),
                 ('ifeq', phase + '_FIRST'),
                 ('getlocal_0',), ('pushbyte', 0), ('setproperty', slot),
                 ('getlocal_0',), ('getproperty', 9733),
                 ('getproperty', 9604), ('getproperty', 7746),
                 ('getlocal', 4), ('getproperty', 80), ('pushbyte', 0),
                 ('getproperty', 14), ('pushstring', pool.string('_alt_1')),
                 ('add',), ('coerce', 11), ('callproperty', 8215, 1),
                 ('iffalse', 'END'), ('getlex', 79),
                 ('getlocal', 4), ('getproperty', 80), ('pushbyte', 0),
                 ('getproperty', 14), ('pushstring', pool.string('_alt_1')),
                 ('add',), ('coerce', 11), ('callproperty', 241, 1),
                 ('coerce', 79), ('setlocal', 4), ('jump', 'END'),
                 ('label', phase + '_FIRST'), ('getlocal_0',),
                 ('pushbyte', 1), ('setproperty', slot), ('jump', 'END')]
    return code + [('label', 'END')]


def preload_block(pool):
    # In the native main-character + playsSoundEffect + playsSkillReady branch.
    code = [('getlocal', 5), ('getproperty', 7439),
            ('pushint', pool.integer(CID)), ('ifne', 'END')]
    for i, path in enumerate(ALT_PATHS):
        code += [('getlocal', 5), ('getproperty', 7746),
                 ('pushstring', pool.string(path)), ('callproperty', 8215, 1),
                 ('iffalse', f'NEXT{i}'), ('getlocal_1',),
                 ('pushstring', pool.string(path)), ('callpropvoid', 7784, 1),
                 ('label', f'NEXT{i}')]
    return code + [('label', 'END')]
