"""保留斩铁原生普通/强化两条，另外两条各占四次准备中的一次。"""
CODE = 'samurai_robot_plum'
CID = 159998
PATHS = [f'character/{CODE}/voice/battle/skill_ready_alt_{i}' for i in (2, 3)]


def ready(pool, slot, base):
    out = [('getlocal_0',), ('getproperty', 9733), ('getproperty', 15727),
           ('pushstring', pool.string(CODE)), ('ifne', 'END'),
           ('getlocal', 4), ('getproperty', 46), ('pushbyte', 0), ('ifne', 'END')]
    for i in range(3):
        out += [('getlocal_0',), ('getproperty', slot), ('pushbyte', i), ('ifeq', f'SLOT{i}')]
    out += [('jump', 'SLOT3')]
    for i in range(4):
        out += [('label', f'SLOT{i}'), ('getlocal_0',), ('pushbyte', (i+1)%4), ('setproperty', slot)]
        if i >= 2:
            out += base.exists(pool, PATHS[i-2]) + [('iffalse', 'END')] + base.select(pool, PATHS[i-2])
        out += [('jump', 'END')]
    return out + [('label', 'END')]


def preload(pool):
    out = [('getlocal', 5), ('getproperty', 7439), ('pushint', pool.integer(CID)), ('ifne', 'END')]
    for i, path in enumerate(PATHS):
        out += [('getlocal', 5), ('getproperty', 7746), ('pushstring', pool.string(path)),
                ('callproperty', 8215, 1), ('iffalse', f'NEXT{i}'), ('getlocal_1',),
                ('pushstring', pool.string(path)), ('callpropvoid', 7784, 1), ('label', f'NEXT{i}')]
    return out + [('label', 'END')]
