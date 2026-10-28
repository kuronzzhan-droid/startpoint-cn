"""码36动作生命周期：仅有明确 context 标记的动作改变命令75/108。"""
import hashlib
import asm
from . import address, movement

TARGET = 'ActionEvaluator/evalCommand'
LOCKS = {TARGET: {
    'sha': 'da225036264d7261f207f3048eb28226337bfde261a84ee70803628de8f9c05a',
    'header': [109, 191, 1, 2],
}, **movement.LOCKS}
ADDED = ['ActionEvaluator/wfxPfLifecycleCommand', address.HELPER] + movement.ADDED


def build(e):
    body = e.body(TARGET)
    lock = LOCKS[TARGET]
    assert hashlib.sha256(body[5]).hexdigest() == lock['sha']
    assert body[1:5] == lock['header']
    address.install(e)
    movement.install(e)
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    chain, paired = e.newq('wfxPfChain'), e.newq('wfxPfPaired')
    # locals: command=1, command kind=2, context=3, is chain=4,
    # suppressor=5, level=6, duration=7, remaining=8.
    code = [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_1',), ('getproperty', q('index')), ('setlocal_2',),
        ('getlocal_2',), n(75), ('ifeq', 'CHECK'),
        ('getlocal_2',), n(108), ('ifne', 'LEGACY'),
        ('label', 'CHECK'),
        ('getlocal_0',), ('callproperty', q('get_context'), 0), ('setlocal_3',),
        ('pushfalse',), ('setlocal', 4),
        ('getlocal_3',), e.string('wfxPfChain'),
        ('callproperty', q('hasOwnProperty'), 1), ('iffalse', 'PAIR'),
        ('getlocal_3',), ('getproperty', chain), ('convert_b',), ('setlocal', 4),
        ('label', 'PAIR'),
        ('getlocal', 4), ('iftrue', 'HANDLED'),
        ('getlocal_2',), n(108), ('ifeq', 'LEGACY'),
        ('getlocal_3',), e.string('wfxPfPaired'),
        ('callproperty', q('hasOwnProperty'), 1), ('iffalse', 'LEGACY'),
        ('getlocal_3',), ('getproperty', paired), ('iffalse', 'LEGACY'),
        ('label', 'HANDLED'),
        ('getlocal_2',), n(108), ('ifeq', 'DONE'),
        # Invalid PF context/level retains the original ClientError path.
        ('getlocal_3',), ('getproperty', q('kind')), ('getproperty', q('index')),
        n(5), ('ifne', 'LEGACY'),
        ('getlocal_3',), ('getproperty', q('kind')), ('getproperty', q('params')),
        n(1), ('getproperty', x), ('convert_i',), ('setlocal', 6),
        ('getlocal', 6), n(0), ('iflt', 'LEGACY'),
        ('getlocal', 6), n(3), ('ifgt', 'LEGACY'),
        ('getlocal_0',), ('callproperty', q('get_zone'), 0),
        ('getproperty', q('powerFlipSuppressor')), ('setlocal', 5),
        ('getlocal_1',), ('getproperty', q('params')), n(0), ('getproperty', x),
        ('convert_i',), ('setlocal', 7),
        ('getlocal', 5), ('getproperty', q('suppressFrame')),
        ('getlocal', 5), ('getproperty', q('currentFrame')), ('subtract_i',),
        ('setlocal', 8),
        ('getlocal', 7), ('getlocal', 8), ('ifge', 'SUPPRESS'),
        ('getlocal', 8), ('setlocal', 7),
        ('label', 'SUPPRESS'),
        ('getlocal', 5), ('getlocal', 6), ('getlocal', 7),
        ('callpropvoid', q('suppress'), 2),
        ('label', 'DONE'), ('pushtrue',), ('returnvalue',),
        ('label', 'LEGACY'), ('pushfalse',), ('returnvalue',),
    ]
    helper = e.add_method('pinball.scene.battle.battle.action::ActionEvaluator', 'wfxPfLifecycleCommand',
                          'Boolean', ['Object'], code, 9)
    e.insert(TARGET, 2, [
        ('getlocal_0',), ('getlocal_1',), ('callproperty', helper, 1),
        ('iffalse', 'NATIVE'), ('returnvoid',), ('label', 'NATIVE'),
    ])
    return {'targets': [TARGET, movement.DISPOSE], 'added': ADDED,
            'context_fields': {'wfxPfChain': '链动作=true',
                               'wfxPfPaired': '主动作有码36且有合击=true'},
            'notify': '只忽略链动作108；主动作原108保持',
            'suppress': '配对主动作/链动作均 max(现有截止帧,当前帧+新时长)'}


apply = build
