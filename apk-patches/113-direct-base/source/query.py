"""WFX 状态查询层：只追加到已有 ConditionSlot，按 uid 缓存。"""
CS = 'pinball.scene.battle.battle.condition::ConditionSlot'
UCT = 'pinball.master.generated::UniqueConditionTable'
ASSET = 'pinball.asset.logic::ILogicAssetContainer'


def symbols(e):
    def exact(name):
        hits = [i for i in range(1, len(e.abc.multinames))
                if e.abc.multinames[i][0] == 7 and e.abc.mn_name(i) == name]
        assert len(hits) == 1, (name, hits)
        return hits[0]
    q = e.q
    return dict(q=q, exact=exact,
                mnl=next(i for i, x in enumerate(e.abc.multinames) if x[0] == 0x1b),
                split=exact('http://adobe.com/AS3/2006/builtin::split'),
                push=exact('http://adobe.com/AS3/2006/builtin::push'),
                maybe=exact('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'),
                exists=exact('pinball.master.runtime:MasterMap::exists'),
                get=exact('pinball.master.runtime:MasterMap::get'))


def install_spec(e, m):
    q, x = m['q'], m['mnl']
    cache = e.add_slot(CS, 'wfxSpecCache', 'Object', static=True)
    asset = e.add_slot(CS, 'wfxSpecAsset', 'Object', static=True)
    # 缺主表时不写 null；主表可用之后缺键/非wfx才写入 null 哨兵。
    code = [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_2',), ('iffalse', 'NONE'),
        ('getlocal_0',), ('getproperty', asset), ('getlocal_2',), ('ifstricteq', 'CACHE'),
        ('getlocal_0',), ('getlocal_2',), ('setproperty', asset),
        ('getlocal_0',), ('newobject', 0), ('setproperty', cache),
        ('label', 'CACHE'), ('getlocal_0',), ('getproperty', cache), ('setlocal_3',),
        ('getlocal_1',), ('convert_s',), ('setlocal', 7),
        ('getlocal', 7), ('getlocal_3',), ('in',), ('iffalse', 'READ'),
        ('getlocal_3',), ('getlocal', 7), ('getproperty', x), ('returnvalue',),
        ('label', 'READ'), ('getlocal_2',), ('getlex', q(UCT)),
        ('callproperty', m['maybe'], 1), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NONE'),
        ('getlocal', 4), ('coerce', q(UCT)), ('callproperty', q('get_data'), 0),
        ('coerce', q('pinball.master.runtime::MasterMap')), ('setlocal', 4),
        ('pushnull',), ('setlocal', 5),
        ('getlocal', 4), ('getlocal_1',), ('callproperty', m['exists'], 1), ('iffalse', 'SAVE'),
        ('getlocal', 4), ('getlocal_1',), ('callproperty', m['get'], 1), ('setlocal', 6),
        ('getlocal', 6), ('iffalse', 'SAVE'),
        ('getlocal', 6), ('getproperty', q('string_id')), ('setlocal', 6),
        ('getlocal', 6), ('iffalse', 'SAVE'),
        ('getlocal', 6), e.string(':'), ('callproperty', m['split'], 1), ('setlocal', 6),
        ('getlocal', 6), ('getproperty', q('length')), e.number(6), ('iflt', 'SAVE'),
        ('getlocal', 6), e.number(0), ('getproperty', x), e.string('wfx'), ('ifne', 'SAVE'),
    ]
    # 严格整数校验；value 可以负数，code/arg/flags 不可负。禁止全局 parseInt。
    for n in range(1, 5):
        code += [('getlocal', 6), e.number(n), ('getproperty', x), e.string(''), ('ifeq', 'SAVE'),
                 ('getlocal', 6), e.number(n), ('getproperty', x), ('convert_d',), ('setlocal', 8),
                 ('getlocal', 8), ('getlocal', 8), ('convert_i',), ('ifne', 'SAVE')]
        if n != 3:
            code += [('getlocal', 8), e.number(0), ('iflt', 'SAVE')]
    for n in range(1, 5):
        code += [('getlocal', 6), e.number(n), ('getproperty', x), ('convert_i',)]
    code += [('newarray', 4), ('setlocal', 5),
             ('label', 'SAVE'), ('getlocal_3',), ('getlocal', 7), ('getlocal', 5), ('setproperty', x),
             ('getlocal', 5), ('returnvalue',),
             ('label', 'NONE'), ('pushnull',), ('returnvalue',)]
    return e.add_method(CS, 'wfxSpec', 'Array', ['int', ASSET], code, 9, static=True)


def install_collect(e, m, spec):
    q, x = m['q'], m['mnl']
    # wfxCollect(code,out) 只扫描本物理槽；out 每行 [arg,total,flags,layers,value]。
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('getproperty', q('conditions')), ('setlocal_3',),
            ('getlocal_3',), ('iffalse', 'DONE'),
            ('getlocal_3',), ('getproperty', q('_keys')), ('setlocal', 4),
            ('getlocal', 4), ('getproperty', q('length')), ('iffalse', 'DONE'),
            e.number(0), ('setlocal', 5),
            ('label', 'LOOP'), ('avm_label',),
            ('getlocal_3',), ('getproperty', q('map')), ('getlocal', 4), ('getlocal', 5),
            ('getproperty', x), ('callproperty', q('get'), 1), ('setlocal', 6),
            ('getlocal', 6), ('iffalse', 'NEXT'),
            ('getlocal', 6), ('getproperty', q('content')), ('setlocal', 7),
            ('getlocal', 7), ('getproperty', q('index')), e.number(31), ('ifne', 'NEXT'),
            ('getlex', q(CS)), ('getlocal', 7), ('getproperty', q('params')),
            e.number(0), ('getproperty', x), ('convert_i',),
            ('getlocal_0',), ('getproperty', q('asset')), ('callproperty', spec, 2), ('setlocal', 7),
            ('getlocal', 7), ('iffalse', 'NEXT'),
            ('getlocal', 7), e.number(0), ('getproperty', x), ('getlocal_1',), ('ifne', 'NEXT'),
            ('getlocal', 6), ('callproperty', q('get_currentAccumulation'), 0), ('convert_i',), ('setlocal', 8),
            ('getlocal', 8), e.number(0), ('ifle', 'NEXT'),
            ('getlocal_2',),
            ('getlocal', 7), e.number(1), ('getproperty', x),
            ('getlocal', 7), e.number(2), ('getproperty', x), ('getlocal', 8), ('multiply',),
            ('getlocal', 7), e.number(3), ('getproperty', x),
            ('getlocal', 8), ('getlocal', 7), e.number(2), ('getproperty', x),
            ('newarray', 5), ('callpropvoid', m['push'], 1),
            ('label', 'NEXT'), ('inclocal_i', 5),
            ('getlocal', 5), ('getlocal', 4), ('getproperty', q('length')), ('iflt', 'LOOP'),
            ('label', 'DONE'), ('returnvoid',)]
    return e.add_method(CS, 'wfxCollect', 'void', ['int', 'Array'], code, 9)


def install_rows(e, m, collect):
    q, x = m['q'], m['mnl']
    code = [('getlocal_0',), ('pushscope',), ('newarray', 0), ('setlocal_3',),
            ('getlocal_0',), ('getlocal_1',), ('getlocal_3',), ('callpropvoid', collect, 2),
            ('getlocal_0',), ('getproperty', q('invisibleSlot')), ('setlocal', 4),
            ('getlocal', 4), ('iffalse', 'SQUAD'),
            ('getlocal', 4), ('getlocal_0',), ('ifstricteq', 'SQUAD'),
            ('getlocal', 4), ('getlocal_1',), ('getlocal_3',), ('callpropvoid', collect, 2),
            ('label', 'SQUAD'), ('getlocal_2',), ('iffalse', 'DONE'),
            ('getlocal_0',), ('getproperty', q('squadSlot')), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'DONE'),
            ('getlocal', 5), ('getproperty', q('index')), e.number(0), ('ifne', 'DONE'),
            ('getlocal', 5), ('getproperty', q('params')), e.number(0), ('getproperty', x), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'DONE'),
            ('getlocal', 5), ('getlocal_0',), ('ifstricteq', 'DONE'),
            ('getlocal', 5), ('getlocal', 4), ('ifstricteq', 'DONE'),
            ('getlocal', 5), ('getlocal_1',), ('getlocal_3',), ('callpropvoid', collect, 2),
            ('getlocal', 5), ('getproperty', q('invisibleSlot')), ('setlocal', 6),
            ('getlocal', 6), ('iffalse', 'DONE'),
            ('getlocal', 6), ('getlocal_0',), ('ifstricteq', 'DONE'),
            ('getlocal', 6), ('getlocal', 4), ('ifstricteq', 'DONE'),
            ('getlocal', 6), ('getlocal', 5), ('ifstricteq', 'DONE'),
            ('getlocal', 6), ('getlocal_1',), ('getlocal_3',), ('callpropvoid', collect, 2),
            ('label', 'DONE'), ('getlocal_3',), ('returnvalue',)]
    return e.add_method(CS, 'wfxRows', 'Array', ['int', 'Boolean'], code, 7)


def install_sum(e, m, rows):
    q, x = m['q'], m['mnl']
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('getlocal_1',), ('pushtrue',), ('callproperty', rows, 2), ('setlocal_3',),
            e.number(0), ('setlocal', 4), e.number(0), ('setlocal', 5), ('jump', 'CHECK'),
            ('label', 'LOOP'), ('avm_label',),
            ('getlocal_3',), ('getlocal', 4), ('getproperty', x), ('setlocal', 6),
            ('getlocal_2',), e.number(-1), ('ifeq', 'ADD'),
            ('getlocal', 6), e.number(0), ('getproperty', x), ('getlocal_2',), ('ifne', 'NEXT'),
            ('label', 'ADD'),
            ('getlocal', 5), ('getlocal', 6), e.number(1), ('getproperty', x), ('add',), ('setlocal', 5),
            ('label', 'NEXT'), ('inclocal_i', 4),
            ('label', 'CHECK'), ('getlocal', 4), ('getlocal_3',), ('getproperty', q('length')), ('iflt', 'LOOP'),
            ('getlocal', 5), ('returnvalue',)]
    return e.add_method(CS, 'wfxSum', 'Number', ['int', 'int'], code, 7)


def build(e):
    m = symbols(e)
    m['spec'] = install_spec(e, m)
    m['collect'] = install_collect(e, m, m['spec'])
    m['rows'] = install_rows(e, m, m['collect'])
    m['sum'] = install_sum(e, m, m['rows'])
    return m
