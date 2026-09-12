"""Lion's native normal/matched ready choices each gain one optional alternate."""
CODE = 'lion_swordman_reborn'
CID = 119996
NORMAL_SLOT = 'lionReadyNormalNext'
MATCHED_SLOT = 'lionReadyMatchedNext'
BASE_PATHS = [f'character/{CODE}/voice/battle/{name}'
              for name in ('skill_ready', 'matched_skill_ready')]
ALT_PATHS = [path + '_alt_1' for path in BASE_PATHS]


def ready_block(pool, slots):
    code = [('getlocal_0',), ('getproperty', 9733), ('getproperty', 15727),
            ('pushstring', pool.string(CODE)), ('ifne', 'END'),
            ('getlocal', 4), ('getproperty', 46), ('pushbyte', 0), ('ifne', 'END')]
    # Native switching/matched selection has already run. Route only its exact
    # selected path, so None, fallback and any future unrelated path stay intact.
    for index, path in enumerate(BASE_PATHS):
        code += [('getlocal', 4), ('getproperty', 80), ('pushbyte', 0),
                 ('getproperty', 14), ('pushstring', pool.string(path)), ('ifeq', f'PICK{index}')]
    code += [('jump', 'END')]
    for index, name in enumerate((NORMAL_SLOT, MATCHED_SLOT)):
        slot = slots[name]
        code += [('label', f'PICK{index}'), ('getlocal_0',), ('getproperty', slot),
                 ('pushbyte', 0), ('ifeq', f'FIRST{index}'),
                 ('getlocal_0',), ('pushbyte', 0), ('setproperty', slot),
                 ('getlocal_0',), ('getproperty', 9733), ('getproperty', 9604),
                 ('getproperty', 7746), ('pushstring', pool.string(ALT_PATHS[index])),
                 ('callproperty', 8215, 1), ('iffalse', 'END'),
                 ('getlex', 79), ('pushstring', pool.string(ALT_PATHS[index])),
                 ('callproperty', 241, 1), ('coerce', 79), ('setlocal', 4), ('jump', 'END'),
                 ('label', f'FIRST{index}'), ('getlocal_0',), ('pushbyte', 1),
                 ('setproperty', slot), ('jump', 'END')]
    return code + [('label', 'END')]


def preload_block(pool):
    # Existing main-character, sound permit and ready permit branches enclose
    # this insertion. Loading extra assets does not change any play permission.
    code = [('getlocal', 5), ('getproperty', 7439),
            ('pushint', pool.integer(CID)), ('ifne', 'END')]
    for index, path in enumerate(ALT_PATHS):
        code += [('getlocal', 5), ('getproperty', 7746), ('pushstring', pool.string(path)),
                 ('callproperty', 8215, 1), ('iffalse', f'NEXT{index}'),
                 ('getlocal_1',), ('pushstring', pool.string(path)), ('callpropvoid', 7784, 1),
                 ('label', f'NEXT{index}')]
    return code + [('label', 'END')]
