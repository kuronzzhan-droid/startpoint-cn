"""在旧 equipment-rules 六助手上逐指令叠加，不改战斗能力汇总入口。"""
import asm
from .config import build as config_build, q, dyn

PREFIX = 'BattleCharacterLogic/'
TARGETS = [PREFIX + n for n in ('wfIsCursedSoul', 'wfIsDecaySoul',
           'wfTierAbility', 'wfEquipmentRule', 'wfPreloadEquipmentTiers')]
HELPERS = [PREFIX + n for n in ('wfxEquipmentConfig', 'wfxEquipmentParam')]


def param_call(e, param, field, default, soul=False):
    identity = [('getlocal_2',), ('getproperty', q(e, 'id')), ('convert_i',)] if soul else [('getlocal', 4)]
    return [('getlocal_0',), *identity, ('pushbyte', field), e.number(default),
            ('callproperty', param, 3)]


def build(e):
    config, param = config_build(e)
    m = dyn(e)
    for name, field in [('wfIsCursedSoul', 0), ('wfIsDecaySoul', 1)]:
        e.insert(PREFIX + name, 2, [
            ('getlocal_0',), ('getlocal_1',), ('callproperty', config, 1),
            ('dup',), ('iffalse', 'OLD'), ('pushbyte', field), ('getproperty', m),
            ('pushbyte', 0), ('greaterthan',), ('returnvalue',),
            ('label', 'OLD'), ('pop',)])
    # Old comparisons remain intact; replace only their scalar stack inputs.
    e.insert(PREFIX + 'wfEquipmentRule', 15,
             [('pop',), *param_call(e, param, 0, 2)])
    e.insert(PREFIX + 'wfEquipmentRule', 33,
             [('pop',), *param_call(e, param, 2, 4)])
    tier(e, config, param)
    # Old preloader already tries n=1..3 for weapon and soul. The new tier
    # prologue suppresses n>=off, and these two insertions add n=4,5 as needed.
    for at, peek, prefix in [(24, 2, 'W'), (81, 3, 'S')]:
        code = []
        for n in (4, 5):
            end = prefix + str(n)
            code += [('getlocal_0',), ('getlocal_3',), ('getproperty', q(e, 'id')),
                     ('convert_i',), ('callproperty', config, 1), ('dup',),
                     ('iffalse', end + 'NULL'), ('pushbyte', 2), ('getproperty', m),
                     ('pushbyte', n), ('ifle', end), ('getlocal_0',),
                     ('getlocal', peek), ('getlocal_3',), ('pushbyte', n),
                     ('callproperty', q(e, 'wfTierAbility'), 3), ('setlocal', 4),
                     ('getlocal', 4), ('iffalse', end), ('getlocal_1',),
                     ('pushnull',), ('getlocal', 4), ('call', 1), ('pop',),
                     ('jump', end), ('label', end + 'NULL'), ('pop',),
                     ('label', end)]
        # The anchor is just after the old decay-membership guard. Empty slots
        # and non-decay branches bypass it; missing n=3 never hides n=4/5.
        e.insert(PREFIX + 'wfPreloadEquipmentTiers', at, code)


def tier(e, config, param):
    label = PREFIX + 'wfTierAbility'
    body = e.body(label)
    ins = asm.decode(body[5])
    get_master = q(e, 'pinball.asset.logic:ILogicAssetContainer::getMasterTable')
    maybe = q(e, 'pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe')
    calls = [i for i, x in enumerate(ins) if x.name == 'callproperty' and x.args[0] == get_master]
    if calls != [15, 68]:
        raise asm.AsmError('wfTierAbility table anchors changed: ' + repr(calls))
    for i in calls:
        ins[i].args[0] = maybe
    changed, _ = asm.encode(ins)
    staged = list(body)
    staged[5] = changed
    additions = [(2, asm.assemble([
        ('getlocal_0',), ('getlocal_2',), ('getproperty', q(e, 'id')),
        ('convert_i',), ('callproperty', config, 1), ('setlocal', 10),
        ('getlocal', 10), ('iffalse', 'OLD'), ('getlocal_3',), ('getlocal', 10),
        ('pushbyte', 2), ('getproperty', dyn(e)), ('iflt', 'OLD'),
        ('pushnull',), ('returnvalue',), ('label', 'OLD')]), asm.ENTER)]
    additions.append((13, asm.assemble([
        ('getlocal', 5), ('iftrue', 'HAVE_ASSET'), ('pushnull',),
        ('returnvalue',), ('label', 'HAVE_ASSET')]), asm.ENTER))
    for at in (6, 62):
        additions.append((at, asm.assemble([('pop',), *param_call(e, param, 1, 1000, True)]), asm.ENTER))
    for at in (16, 69):
        additions.append((at, asm.assemble([
            ('dup',), ('iftrue', 'HAVE'), ('pop',), ('pushnull',),
            ('returnvalue',), ('label', 'HAVE')]), asm.ENTER))
    # Reject wrapped tier keys before get/construct. Number arithmetic is exact
    # for these int32 products; old valid values are unchanged.
    for at, index in ((7, 4), (63, 9)):
        ins[at].op = asm.MNEMONICS['multiply']
        ins[at + 1].op = asm.MNEMONICS['add']
        additions.append((at + 2, asm.assemble([
            ('dup',), ('convert_i',), ('dup',), ('setlocal', 11),
            ('ifne', 'BAD'), ('getlocal', 11), ('pushbyte', 0), ('ifgt', 'VALID'),
            ('label', 'BAD'), ('pushnull',), ('returnvalue',),
            ('label', 'VALID'), ('getlocal', 11)]), asm.ENTER))
    staged[5] = asm.encode(ins)[0]
    additions.sort(key=lambda x: x[0])
    raw, exceptions, _, recovery = asm.splice_many(staged, additions)
    e.replace(label, raw, exceptions)
    e.report[label]['instruction_edits'] = {
        'safe_table_calls': calls, 'number_arithmetic': [7, 8, 63, 64],
        'insertions': recovery,
        'reason': '动态步长与失效档；未加载表返回null；拒绝分档键整数溢出'}
