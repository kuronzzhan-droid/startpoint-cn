"""Use original MemberImpl.startPowerFlip without Squad's terminate path."""
from .common import HEAD, PF, TYPE, OPTION, at, field


def power_flip_logic(e, x):
    q = e.q
    return HEAD + [
        *field(0, 'source', q), ('getproperty', q('specialityType')), ('setlocal_1',),
        ('getlocal_1',), ('iffalse', 'NONE'),
        *field(1, 'index', q), ('pushbyte', 0), ('ifne', 'NONE'),
        ('getlex', q(PF)), ('getlex', q(TYPE)),
        *field(1, 'params', q), ('pushbyte', 0), ('getproperty', x),
        ('callproperty', q('getPowerFlipActionId'), 1),
        *field(0, 'source', q), ('getproperty', q('element')),
        *field(0, 'logicAssets', q), ('construct', 3), ('returnvalue',),
        ('label', 'NONE'), ('pushnull',), ('returnvalue',),
    ]


def find_partner(e, x):
    # id=1; list node=2; candidate squad=3; metadata=4; member option=5.
    q = e.q
    return HEAD + [
        # Main members have an exact native origin (index, kind=0). Do not
        # accidentally attribute their parent's summons to a summon holder.
        *field(0, 'squad', q), ('callproperty', q('isPrimary'), 0), ('iffalse', 'NONE'),
        *field(0, 'squadManager', q), ('callproperty', q('getActiveMultiballSquads'), 0),
        ('getproperty', q('h')), ('setlocal_2',),
        ('label', 'LOOP'), ('avm_label',), ('getlocal_2',), ('iffalse', 'NONE'),
        *field(2, 'item', q), ('setlocal_3',), *field(2, 'next', q), ('setlocal_2',),
        *field(3, 'squadManager', q), *field(0, 'squadManager', q), ('ifstrictne', 'LOOP'),
        *field(3, 'kind', q), ('getproperty', q('index')),
        ('pushbyte', 1), ('ifne', 'LOOP'),
        ('getlocal_3',), ('callproperty', q('isActive'), 0), ('iffalse', 'LOOP'),
        ('getlocal_3',), ('callproperty', q('willRemove'), 0), ('iftrue', 'LOOP'),
        *field(3, 'kind', q), ('getproperty', q('params')),
        ('pushbyte', 0), ('getproperty', x), ('setlocal', 4),
        *field(4, 'id', q), ('getlocal_1',), ('ifne', 'LOOP'),
        *field(4, 'originMemberIndex', q), *field(0, 'originMemberIndex', q), ('ifne', 'LOOP'),
        *field(4, 'originMemberKind', q), ('pushbyte', 0), ('ifne', 'LOOP'),
        ('getlocal_3',), ('callproperty', q('getFirstMember'), 0), ('setlocal', 5),
        *field(5, 'index', q), ('pushbyte', 0), ('ifne', 'LOOP'),
        *field(5, 'params', q), ('pushbyte', 0), ('getproperty', x), ('setlocal', 5),
        ('getlocal', 5), ('callproperty', q('isDead'), 0), ('iftrue', 'LOOP'),
        ('getlocal', 5), ('returnvalue',),
        ('label', 'NONE'), ('pushnull',), ('returnvalue',),
    ]


def execute(e, x, logic_method, find_method, notify_method):
    # spec=1; primary squad=2; partner=3; own logic=4; partner logic=5.
    q = e.q
    return HEAD + [
        ('getlocal_0',), ('callproperty', q('isDead'), 0), ('iftrue', 'RETURN'),
        *field(0, 'squad', q), ('callproperty', q('isActive'), 0), ('iffalse', 'RETURN'),
        ('getlocal_0',), ('callproperty', logic_method, 0), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'RETURN'),
        ('getlocal_0',), *at(1, 2, x), ('callproperty', find_method, 1), ('setlocal_3',),
        ('pushnull',), ('setlocal', 5), ('getlocal_3',), ('iffalse', 'FALLBACK'),
        ('getlocal_3',), ('callproperty', logic_method, 0), ('setlocal', 5),
        ('getlocal', 5), ('iftrue', 'START'),
        ('pushnull',), ('setlocal_3',),
        ('label', 'FALLBACK'), *at(1, 3, x), ('pushbyte', 1), ('bitand',), ('iffalse', 'RETURN'),
        ('label', 'START'), ('getlocal_0',), ('getlocal', 4), *at(1, 1, x),
        ('getlex', q(OPTION)), ('getproperty', q('None')),
        ('callpropvoid', q('startPowerFlip'), 3),
        ('getlocal_3',), ('iffalse', 'NOTIFY'),
        ('getlocal_3',), ('getlocal', 5), *at(1, 1, x),
        ('getlex', q(OPTION)), ('getproperty', q('None')),
        ('callpropvoid', q('startPowerFlip'), 3),
        # The native primary count does not traverse summon squads. Advance the
        # partner's own PF-limited conditions/totalizer once, without team events.
        *field(3, 'squad', q), ('callpropvoid', q('countUpPowerFlip'), 0),
        ('label', 'NOTIFY'), *field(0, 'squad', q), ('getlocal_2',),
        ('ifstricteq', 'TEAM'), *field(0, 'squad', q),
        ('callpropvoid', q('countUpPowerFlip'), 0),
        ('label', 'TEAM'), ('getlocal_2',), *at(1, 1, x),
        ('callpropvoid', notify_method, 1),
        ('label', 'RETURN'), ('returnvoid',),
    ]


def notify(e):
    """Exactly one native PF event set per successful pair/fallback invocation."""
    q = e.q
    code = HEAD + [
        ('getlocal_0',), ('callpropvoid', q('countUpPowerFlip'), 0),
        *field(0, 'battleAbilityTrigger', q), ('pushbyte', 0), ('pushbyte', 1),
        ('pushtrue',), ('callpropvoid', q('countUp'), 3),
    ]
    for lv, kinds in ((1, (6, 19)), (2, (7, 19, 18)), (3, (8, 18))):
        code += [('getlocal_1',), ('pushbyte', lv), ('ifne', f'NEXT{lv}')]
        for kind in kinds:
            code += [*field(0, 'battleAbilityTrigger', q), ('pushbyte', kind),
                     ('pushbyte', 1), ('pushtrue',), ('callpropvoid', q('countUp'), 3)]
        code += [('jump', 'NOTIFY'), ('label', f'NEXT{lv}')]
    return code + [
        ('label', 'NOTIFY'), *field(0, 'battleAbilityTrigger', q), ('getlocal_1',),
        ('callpropvoid', q('notifyFlipExecuted'), 1), ('returnvoid',),
    ]
