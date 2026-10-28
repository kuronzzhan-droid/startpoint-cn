"""配对PF的移动时长取大，以及较短动作回收后归还同次同成员移动权。"""
CLASS = 'pinball.scene.battle.battle.action::ActionEvaluator'
DISPOSE = 'ActionEvaluator/dispose'
LOCKS = {DISPOSE: {
    'sha': 'ffce29a95d06a282d5cf473dd2678af9db6219b0f4aae79d7a2f543fb6df4bb4',
    'header': [2, 2, 1, 2]}}
ADDED = ['ActionEvaluator/' + n for n in
         ['wfxPfPairedContext', 'wfxPfMovementFrames', 'wfxPfRestoreMovement']]


def install(e):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    marker = e.add_method(CLASS, 'wfxPfPairedContext', 'Boolean', ['Object'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_1',), e.string('wfxPfChain'),
        ('callproperty', q('hasOwnProperty'), 1), ('iffalse', 'PAIR'),
        ('getlocal_1',), ('getproperty', e.newq('wfxPfChain')), ('iftrue', 'YES'),
        ('label', 'PAIR'), ('getlocal_1',), e.string('wfxPfPaired'),
        ('callproperty', q('hasOwnProperty'), 1), ('iffalse', 'NO'),
        ('getlocal_1',), ('getproperty', e.newq('wfxPfPaired')), ('iftrue', 'YES'),
        ('label', 'NO'), ('pushfalse',), ('returnvalue',),
        ('label', 'YES'), ('pushtrue',), ('returnvalue',),
    ], 2)
    frames = e.add_method(CLASS, 'wfxPfMovementFrames', 'int', ['int', '*'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_0',), ('callproperty', q('get_context'), 0), ('setlocal_3',),
        ('getlocal_0',), ('getlocal_3',), ('callproperty', marker, 1), ('iffalse', 'DONE'),
        ('getlocal_3',), ('getproperty', q('type')), ('getproperty', q('index')),
        n(2), ('ifne', 'DONE'),
        ('getlocal_3',), ('getproperty', q('type')), ('getproperty', q('params')),
        n(0), ('getproperty', x), ('setlocal', 4),
        ('getlocal', 4), ('getlocal_2',), ('ifstrictne', 'DONE'),
        ('getlocal', 4), ('getproperty', q('state')), ('setlocal', 5),
        ('getlocal', 5), ('getproperty', q('index')), n(2), ('ifne', 'DONE'),
        ('getlocal', 5), ('getproperty', q('params')), n(0), ('getproperty', x),
        ('convert_i',), ('getlocal', 4), ('getproperty', q('stateFrame')),
        ('subtract_i',), ('setlocal', 6),
        ('getlocal_1',), ('getlocal', 6), ('ifge', 'DONE'),
        ('getlocal', 6), ('setlocal_1',),
        ('label', 'DONE'), ('getlocal_1',), ('returnvalue',),
    ], 7)
    restore = e.add_method(CLASS, 'wfxPfRestoreMovement', 'void', [], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_0',), ('callproperty', q('get_context'), 0), ('setlocal_1',),
        ('getlocal_0',), ('getlocal_1',), ('callproperty', marker, 1), ('iffalse', 'DONE'),
        ('getlocal_1',), ('getproperty', q('type')), ('getproperty', q('index')),
        n(2), ('ifne', 'DONE'),
        ('getlocal_1',), ('getproperty', q('type')), ('getproperty', q('params')),
        n(0), ('getproperty', x), ('setlocal_2',),
        ('getlocal_2',), ('getproperty', q('movingRightController')),
        ('getproperty', q('primaryMovingRight')), ('setlocal_3',),
        ('getlocal_3',), ('getproperty', q('index')), n(0), ('ifne', 'DONE'),
        ('getlocal_3',), ('getproperty', q('params')), n(0), ('getproperty', x),
        ('getlocal_0',), ('getproperty', q('movementId')), ('ifne', 'DONE'),
        ('getlocal_0',), ('getproperty', q('manager')), ('getproperty', q('evaluators')),
        ('getproperty', q('h')), ('setlocal', 4),
        ('label', 'LOOP'), ('avm_label',), ('getlocal', 4), ('pushnull',), ('ifeq', 'DONE'),
        ('getlocal', 4), ('getproperty', q('item')), ('setlocal', 5),
        ('getlocal', 4), ('getproperty', q('next')), ('setlocal', 4),
        ('getlocal', 5), ('getlocal_0',), ('ifstricteq', 'LOOP'),
        ('getlocal', 5), ('callproperty', q('get_executor'), 0),
        ('getlocal_0',), ('callproperty', q('get_executor'), 0), ('ifstrictne', 'LOOP'),
        ('getlocal', 5), ('callproperty', q('get_context'), 0), ('setlocal', 6),
        ('getlocal_0',), ('getlocal', 6), ('callproperty', marker, 1), ('iffalse', 'LOOP'),
        ('getlocal', 6), ('getproperty', q('executionCount')),
        ('getlocal_1',), ('getproperty', q('executionCount')), ('ifne', 'LOOP'),
        ('getlocal', 5), ('callproperty', q('willRemove'), 0), ('iftrue', 'LOOP'),
        ('getlocal', 5), ('callproperty', q('get_action'), 0),
        ('getproperty', q('params')), n(0), ('getproperty', x), ('convert_i',),
        ('setlocal', 7),
        ('getlocal', 7), n(2), ('ifeq', 'RESTORE'),
        ('getlocal', 7), n(3), ('ifne', 'LOOP'),
        ('label', 'RESTORE'),
        ('getlocal_2',), ('getlocal', 5), ('getproperty', q('movementId')),
        ('getlex', q('pinball.battle.action.dsl._ActionDslMovementPriority::ActionDslMovementPriority_Impl_')),
        ('getlocal', 7), ('callproperty', q('getPriorityLevel'), 1),
        ('callpropvoid', q('updateMovementId'), 2),
        ('label', 'DONE'), ('returnvoid',),
    ], 8)
    e.insert(DISPOSE, 2, [('getlocal_0',), ('callpropvoid', restore, 0)])
    # 两个原生 duration 已在栈顶；局部20为本命令真实目标对象。
    for at in [1457, 1541]:
        e.insert('ActionEvaluator/evalCommand', at, [
            ('getlocal_0',), ('swap',), ('getlocal', 20),
            ('callproperty', frames, 2)])
    return {'frames': frames, 'restore': restore, 'marker': marker}
