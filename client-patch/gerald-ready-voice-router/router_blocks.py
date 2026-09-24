"""Gerald's four ready lines share one pool; no gameplay/Fever flag is touched."""
CODE = 'unicorn_lancer_rose'
CID = 129992
READY_NEXT = 'geraldReadyNext'
BASE_PATH = f'character/{CODE}/voice/battle/skill_ready'
ALT_PATHS = [BASE_PATH + f'_alt_{i}' for i in range(1, 4)]


def exists(pool, path):
    return [('getlocal_0',), ('getproperty', 9733), ('getproperty', 9604),
            ('getproperty', 7746), ('pushstring', pool.string(path)),
            ('callproperty', 8215, 1)]


def select(pool, path):
    return [('getlex', 79), ('pushstring', pool.string(path)),
            ('callproperty', 241, 1), ('coerce', 79), ('setlocal', 4)]


def ready_block(pool, slot, count=4):
    if not 2 <= count <= 16:
        raise ValueError('ready pool must contain 2..16 recordings')
    paths = [BASE_PATH + f'_alt_{i}' for i in range(1, count)]
    code = [('getlocal_0',), ('getproperty', 9733), ('getproperty', 15727),
            ('pushstring', pool.string(CODE)), ('ifne', 'END')]
    # If the base asset is unavailable, retain the original Option and counter.
    code += exists(pool, BASE_PATH) + [('iffalse', 'END')]
    # Canonical base is also the fallback when the requested alternate is absent.
    code += select(pool, BASE_PATH)
    for index in range(count - 1):
        code += [('getlocal_0',), ('getproperty', slot), ('pushbyte', index),
                 ('ifeq', f'PICK{index}')]
    code += [('jump', f'PICK{count - 1}')]
    for index in range(count):
        code += [('label', f'PICK{index}'), ('getlocal_0',),
                 ('pushbyte', (index + 1) % count), ('setproperty', slot)]
        if index:
            path = paths[index - 1]
            code += exists(pool, path) + [('iffalse', 'END')]
            code += select(pool, path)
        code += [('jump', 'END')]
    return code + [('label', 'END')]


def preload_block(pool, count=4):
    # Native main-character + playsSoundEffect + playsSkillReady branch remains.
    code = [('getlocal', 5), ('getproperty', 7439),
            ('pushint', pool.integer(CID)), ('ifne', 'END')]
    for index, path in enumerate(BASE_PATH + f'_alt_{i}' for i in range(1, count)):
        code += [('getlocal', 5), ('getproperty', 7746),
                 ('pushstring', pool.string(path)), ('callproperty', 8215, 1),
                 ('iffalse', f'NEXT{index}'), ('getlocal_1',),
                 ('pushstring', pool.string(path)), ('callpropvoid', 7784, 1),
                 ('label', f'NEXT{index}')]
    return code + [('label', 'END')]
