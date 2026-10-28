"""四个原生方法精确拼接；快照只随此执行生成的攻击对象流转。"""
import hashlib

EMIT = 'ActionEvaluator/addImpactToSubject'
NORMAL = 'NormalAttackCalculator/_calculate'
FIXED = 'FixedAttackCalculator/calculate'
RATIO = 'RatioAttackCalculator/calculate'
LOCKS = {
    EMIT: {'sha': '2cd4d6fee6d01e91a67829603085af9270298c361b492fa6dedab72c707e9a02',
           'header': [20, 18, 1, 2]},
    NORMAL: {'sha': '60f34403fc68edd1d79572b02dd4ac271a9fe171094129a15efe6fb130566807',
             'header': [90, 131, 1, 2]},
    FIXED: {'sha': 'f4d7217dd88a8438cbfeef3d3e786cb13c94574afbd81ae50478ad509b19602d',
            'header': [90, 13, 1, 1]},
    RATIO: {'sha': 'cf85c5318181e552c94108e944288bcb2e39f657be44af6c07d08b534cf7b7f4',
            'header': [90, 13, 1, 1]},
}
STAMP = 'ActionEvaluator/wfxPfStampDamage'
SCALE = 'NormalAttackCalculator$/wfxPfScaleDamage'
ADDED = [STAMP, SCALE]


def build(e):
    for label, lock in LOCKS.items():
        body = e.body(label)
        assert hashlib.sha256(body[5]).hexdigest() == lock['sha'], label
        assert body[1:5] == lock['header'], label
    q, n = e.q, e.number
    field = e.newq('wfxPfDamageScale')
    chain = e.newq('wfxPfChain')
    index = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    # No new property is written on a legacy payload, including explicitly false markers.
    stamp = [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_0',), ('callproperty', q('get_context'), 0), ('setlocal_2',),
        ('getlocal_2',), e.string('wfxPfChain'),
        ('callproperty', q('hasOwnProperty'), 1), ('iffalse', 'DONE'),
        ('getlocal_2',), ('getproperty', chain), ('iffalse', 'DONE'),
        ('getlocal_2',), e.string('wfxPfDamageScale'),
        ('callproperty', q('hasOwnProperty'), 1), ('iffalse', 'DONE'),
        ('getlocal_1',), ('getproperty', q('content')), ('setlocal_3',),
        ('getlocal_3',), ('getproperty', q('index')), n(0), ('iflt', 'DONE'),
        ('getlocal_3',), ('getproperty', q('index')), n(2), ('ifgt', 'DONE'),
        ('getlocal_3',), ('getproperty', q('params')), n(0), ('getproperty', index),
        ('getlocal_2',), ('getproperty', field), ('setproperty', field),
        ('label', 'DONE'), ('returnvoid',),
    ]
    stamp_q = e.add_method('pinball.scene.battle.battle.action::ActionEvaluator',
                          'wfxPfStampDamage', 'void', ['Object'], stamp, 4)
    # Raw damage is already Decimal100/Number. Native rounding stays Number too;
    # an int32 rate never goes through int(raw damage), avoiding wraparound.
    scale = [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_2',), e.string('wfxPfDamageScale'),
        ('callproperty', q('hasOwnProperty'), 1), ('iffalse', 'SAME'),
        ('getlocal_2',), ('getproperty', field), ('convert_d',), ('setlocal_3',),
        ('getlocal_3',), n(0), ('ifle', 'SAME'),
        ('getlocal_3',), n(1), ('ifeq', 'SAME'),
        ('getlex', q('pinball.common.math._Decimal100::Decimal100_Impl_')),
        ('getlocal_1',), ('getlocal_3',), ('multiply',),
        ('callproperty', q('fromRaw'), 1), ('returnvalue',),
        ('label', 'SAME'), ('getlocal_1',), ('returnvalue',),
    ]
    scale_q = e.add_method('pinball.online.battle.impact.attack::NormalAttackCalculator',
                          'wfxPfScaleDamage', 'Number', ['Number', 'Object'],
                          scale, 4, static=True)
    e.insert(EMIT, 2, [
        ('getlocal_0',), ('getlocal_3',), ('callpropvoid', stamp_q, 1),
    ])
    for target, at, value in [(NORMAL, 2651, 121), (FIXED, 167, 11), (RATIO, 208, 11)]:
        e.insert(target, at, [
            ('getlex', q('pinball.online.battle.impact.attack::NormalAttackCalculator')),
            ('getlocal', value), ('getlocal_2',), ('callproperty', scale_q, 2),
            ('convert_d',), ('setlocal', value),
        ])
    return {'targets': list(LOCKS), 'added': ADDED,
            'field': 'context.wfxPfDamageScale -> attack.wfxPfDamageScale',
            'rounding': 'Decimal100.fromRaw (native Number Math.round), after final damage modifiers',
            'stats': 'normal damage scaled before stats / result / reduction diagnostic'}


apply = build
