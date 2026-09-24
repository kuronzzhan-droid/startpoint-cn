"""特克托每三次准备播一次新增台词；其他两次保留原版普通/强化分流。"""
CODE = 'super_robot_tailcoat'
PATH = f'character/{CODE}/voice/battle/skill_ready_alt_2'
CID = 139993


def ready(pool, slot, base):
    code = [('getlocal_0',), ('getproperty', 9733), ('getproperty', 15727),
            ('pushstring', pool.string(CODE)), ('ifne', 'END'),
            ('getlocal', 4), ('getproperty', 46), ('pushbyte', 0), ('ifne', 'END')]
    code += base.exists(pool, PATH) + [('iffalse', 'END')]
    for i in range(2):
        code += [('getlocal_0',), ('getproperty', slot), ('pushbyte', i), ('ifeq', f'OLD{i}')]
    code += base.select(pool, PATH) + [('getlocal_0',), ('pushbyte', 0),
            ('setproperty', slot), ('jump', 'END')]
    for i in range(2):
        code += [('label', f'OLD{i}'), ('getlocal_0',), ('pushbyte', i+1),
                 ('setproperty', slot), ('jump', 'END')]
    return code + [('label', 'END')]


def preload(pool):
    return [('getlocal', 5), ('getproperty', 7439), ('pushint', pool.integer(CID)),
            ('ifne', 'END'), ('getlocal', 5), ('getproperty', 7746),
            ('pushstring', pool.string(PATH)), ('callproperty', 8215, 1), ('iffalse', 'END'),
            ('getlocal_1',), ('pushstring', pool.string(PATH)), ('callpropvoid', 7784, 1), ('label', 'END')]
