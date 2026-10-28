"""Small AVM2 helpers; no character ids and no mutable cached combo base."""


def install(e):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    base = e.newq('wfxComboBase')
    effective = e.newq('wfxComboEffective')
    cls = 'pinball.scene.battle.battle::ComboCalculatorImpl'
    # locals: 1=max, 2=manager, 3=node, 4=squad, 5=members,
    # 6=member index, 7=option/member, 8=rows, 9=row index, 10=value.
    code = [
        ('getlocal_0',), ('pushscope',), n(0), ('setlocal_1',),
        ('getlocal_0',), ('getproperty', q('squadManager')), ('setlocal_2',),
        ('getlocal_2',), ('iffalse', 'DONE'),
        ('getlocal_2',), ('getproperty', q('primary')), ('iffalse', 'DONE'),
        ('getlocal_2',), ('callproperty', q('pinball.scene.battle.battle.squad:SquadManager::getActiveSquads'), 0),
        ('dup',), ('setlocal_3',), ('iffalse', 'DONE'),
        ('getlocal_3',), ('getproperty', q('h')), ('setlocal_3',),
        ('label', 'SQUAD'), ('avm_label',), ('getlocal_3',), ('iffalse', 'DONE'),
        ('getlocal_3',), ('getproperty', q('item')), ('setlocal', 4),
        ('getlocal_3',), ('getproperty', q('next')), ('setlocal_3',),
        ('getlocal', 4), ('iffalse', 'SQUAD'),
        ('getlocal', 4), ('getproperty', q('squadManager')), ('getlocal_2',), ('ifstrictne', 'SQUAD'),
        ('getlocal', 4), ('callproperty', q('isActive'), 0), ('iffalse', 'SQUAD'),
        ('getlocal', 4), ('getproperty', q('members')), ('setlocal', 5),
        ('getlocal', 5), ('iffalse', 'SQUAD'), n(0), ('setlocal', 6),
        ('label', 'MEMBER'), ('avm_label',), ('getlocal', 6), ('getlocal', 5), ('getproperty', q('length')), ('ifge', 'SQUAD'),
        ('getlocal', 5), ('getlocal', 6), ('getproperty', x), ('setlocal', 7), ('inclocal_i', 6),
        ('getlocal', 7), ('iffalse', 'MEMBER'),
        ('getlocal', 7), ('getproperty', q('index')), n(0), ('ifne', 'MEMBER'),
        ('getlocal', 7), ('getproperty', q('params')), n(0), ('getproperty', x), ('setlocal', 7),
        ('getlocal', 7), ('iffalse', 'MEMBER'),
        ('getlocal', 7), ('getproperty', q('conditionSlot')), ('dup',), ('setlocal', 7), ('iffalse', 'MEMBER'),
        ('getlocal', 7), n(41), ('pushtrue',), ('callproperty', q('wfxRows'), 2), ('setlocal', 8),
        n(0), ('setlocal', 9),
        ('label', 'ROW'), ('avm_label',), ('getlocal', 9), ('getlocal', 8), ('getproperty', q('length')), ('ifge', 'MEMBER'),
        ('getlocal', 8), ('getlocal', 9), ('getproperty', x), n(4), ('getproperty', x),
        ('convert_i',), ('setlocal', 10), ('inclocal_i', 9),
        ('getlocal', 10), ('getlocal_1',), ('ifle', 'ROW'),
        ('getlocal', 10), ('setlocal_1',), ('jump', 'ROW'),
        ('label', 'DONE'), ('getlocal_1',), ('returnvalue',),
    ]
    e.add_method(cls, 'wfxComboBase', 'int', [], code, 11)
    # The zero-base branch returns the original masked integer byte-for-byte.
    # The ordinary combo remains the only stored value; effective values never
    # enter addCombo/setCombo/expire/restriction/statistics or timer accounting.
    code = [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_0',), ('callproperty', base, 0), ('setlocal_2',),
        ('getlocal_2',), ('iftrue', 'ADD'), ('getlocal_1',), ('returnvalue',),
        ('label', 'ADD'),
        ('getlex', q('pinball.common.mask::MaskGeneral')), ('getproperty', q('maskBit')),
        ('getlocal_1',), ('bitxor',), ('getlocal_2',), ('add_i',),
        ('getlex', q('pinball.common.mask::MaskGeneral')), ('getproperty', q('maskBit')),
        ('bitxor',), ('convert_i',), ('returnvalue',),
    ]
    e.add_method(cls, 'wfxComboEffective', 'int', ['int'], code, 3)
    return effective
