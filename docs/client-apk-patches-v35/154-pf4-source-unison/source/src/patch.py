"""v35o→PF4：仅插入指令，所有原方法均可逆拼接还原。"""
import asm
from . import selectors, sources

TARGETS = ['MemberImpl/startPowerFlip', 'MemberImpl/wfxPfChainExecute',
           'BattleFlipperImpl/update', 'BattleFlipperView/draw']
MARKERS = [(selectors.TOTALIZER, 'wfxPf4SelectRow')]
MARKERS += [(selectors.MEMBER, name) for name in
            ('wfxPf4State', 'wfxPf4ReadyState', 'wfxPf4Action', 'wfxPf4ChainId')]
MARKERS += [(selectors.BATTLE, name) for name in
            ('wfxPf4SourceId', 'wfxPf4SourceConfig', 'wfxPf4SourceCache',
             'wfxPf4Display', 'wfxPf4DisplayCache', 'wfxPf4DisplayCached')]


def calls(e, label, name):
    return [i for i, ins in enumerate(asm.decode(e.body(label)[5]))
            if ins.name in ('callproperty', 'callpropvoid')
            and e.abc.mn_name(ins.args[0]) == name]


def display_expr(e, display, view=False):
    q = e.q
    actor = [('getlocal', 23)] if view else [('getlocal_0',)]
    return [('getlex', q(selectors.BATTLE)), *actor, ('getproperty', q('battle')),
            *actor, ('getproperty', q('globalLogic')), ('getproperty', q('logicAssets')),
            ('callproperty', display, 2)]


def install_start(e, helpers):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    start = TARGETS[0]
    config_at = calls(e, start, 'wfxPfConfig')
    assert config_at == [3]
    # The state is frozen before the main action can synchronously change a checker.
    # config is a fresh Array from wfxPfConfig; its original 0..2 entries stay intact.
    e.insert(start, 5, [
        ('getlocal_0',), ('getlocal_2',), ('callproperty', helpers['ready'], 1),
        ('setlocal', 21), ('getlocal', 20), ('iffalse', 'NO_CHAIN'),
        ('getlocal', 20), ('getlocal', 21),
        ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
        ('label', 'NO_CHAIN')])
    at = calls(e, start, 'wfxPf4Config')
    assert len(at) == 1
    e.insert(start, at[0] + 1, [
        ('pop',), ('getlocal', 21), ('dup',), ('iftrue', 'READY'),
        ('pop',), n(2147483647), ('newarray', 1), ('jump', 'DONE'),
        ('label', 'READY'), n(2), ('getproperty', x), ('newarray', 1),
        ('label', 'DONE')])
    main = calls(e, start, 'wfxPfMainOverride')
    assert len(main) == 2
    # Only the first (special Lv4) result is replaced; ordinary Lv1..3 is untouched.
    e.insert(start, main[0] + 1, [
        ('pop',), ('getlocal_0',), ('getlocal', 21), ('pushfalse',),
        ('callproperty', helpers['action'], 2)])


def install_chain(e, helpers):
    label = TARGETS[1]
    at = calls(e, label, 'wfxPfSelect')
    assert len(at) == 1
    # Select level4 semantically, while native level remains 3 for physical DSL slot,
    # ActionKind, address, damage multiplier and all lifecycle/statistics code.
    e.insert(label, at[0] + 1, [
        ('getlocal_0',), ('swap',), ('getlocal', 9), ('getlocal_1',),
        ('callproperty', helpers['chain'], 3)])


def install_visual(e, display, cached):
    label = TARGETS[2]
    at = calls(e, label, 'getPowerFlipOverrides')
    assert len(at) == 1
    # The native ten-frame activation check and previous-level animation logic stay.
    e.insert(label, at[0] + 1, [('pop',), *display_expr(e, display)])
    for label, view in ((TARGETS[2], False), (TARGETS[3], True)):
        indexes = calls(e, label, 'wfxPf4Config')
        assert len(indexes) == (1 if view else 3)
        for at in indexes:
            # Read only the last ten-frame qualification snapshot. Never rescan
            # checkers while rendering or while interpolating a previous charge.
            e.insert(label, at + 1, [
                *display_expr(e, cached, view), ('dup',), ('iftrue', 'SOURCE'),
                ('pop',), ('jump', 'DONE'), ('label', 'SOURCE'), ('swap',), ('pop',),
                ('label', 'DONE')])


def build(e):
    source_id = sources.install_source_id(e)
    sources.install_config(e, source_id)
    select = selectors.install_row(e)
    helpers = selectors.install_member(e, select)
    display, cached = sources.install_display(e)
    install_start(e, helpers)
    install_chain(e, helpers)
    install_visual(e, display, cached)
    return {
        'targets': TARGETS,
        'capability': 'pf-lv4-source-v2',
        'state': '[mainLv4ActionId, unisonLv4ActionId, threshold, color] or null',
        'config_priority': 'main Lv4 source, else unison Lv4 source; source key -> leader key -> defaults',
        'force_type': 'arg & 1 excludes the unison override from available PF4 sources',
        'snapshot': 'startPowerFlip local21; appended code36 config[3]; main and chain share ready state',
        'visual_snapshot': 'original ten-frame gate refreshes per-battle threshold/color; update/draw only read it',
        'preload': 'unchanged run12 reachable-ability/extra-leader traversal already loads all three physical slots',
    }
