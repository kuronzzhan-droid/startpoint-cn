"""Themed unknown rivens 16000901..16000919 behave exactly like 16000000.

Two mechanical insert kinds, each placed immediately before an existing branch
(the inserted block only rewrites one operand of that comparison):

T1  instance test  `id >= 16000001 && id <= 16000999` (ifgt / ifle on 16000999):
    for themed ids the bound becomes -1, so the test fails the same way it fails
    for 16000000 (for every ifgt site the lower-bound branch and the upper-bound
    branch share one "not an instance" target; asserted in classify()).
T2  unknown test   `id == 16000000` (ifeq / ifne):
    themed ids are compared as 16000000.

Group tests `16000000 <= id <= 16000999` (riven tab / inventory group / soul page)
already include 16000901..16000919 and are left untouched; so are loops that
iterate 16000001..16000999 over weapon_rivens records (themed cards never have
a record), fragment tests (16000900) and pure save/transport ingestion.
"""
import asm
from r2_common import (ops_of, int_value, mn, t1_block, t2_block, themed_jump,
                       UNKNOWN, LOWER, UPPER, label_index)
import opwalk_enc

# Pure ingestion / ExBoost (re-forge needs a weapon_rivens record; themed never has one)
# and record-id loops / encoded weapon-list rows (built from records only).
SKIP_METHODS = {
    'PlayerLogic/applyCommonResponse', 'ExBoostDrawRealRemote/successHandler',
    'ExBoostSelectRealRemote/successHandler', 'BattleQuestFinishLoadingTask/processQuestFinish',
    'BattleQuestFinishRealRemote/successHandler', 'RealRemoteService/earlySuccessHandler',
    'ExBoostWindow/buttonClicked', 'ExBoostWindow/canChangeStateBySwipe',
    'ExBoostWindow/characterExBoostDrawRemoteInput', 'ExBoostWindow/characterExBoostSelectRemoteInput',
    'ExBoostWindow/needShowSideArrow', 'ExBoostWindow/run', 'ExBoostWindowView/onApplyExBoostInformation',
    'ExBoostWindowView/setupButtons', 'EquipmentListScene/openDetailDialog',
    'EquipmentListScene/getFilteredEquipmentList', 'InitializeRealRemote/loadSuccessHandler',
}
T2_SKIP = {'ItemCategoryKindTools$/getUiStringId'}   # 16000000 there is the group key, not an item

# Frozen expectation on riven-wt-1008092 (method -> (T1 count, T2 count)).
EXPECTED = {
    'AbilitySoulDetailDialog/initialize': (8, 1),
    'AbilitySoulInUseDialog/getAbilitySoul': (1, 1),
    'AbilitySoulInUseDialog/getInUseAbilitySoul': (1, 1),
    'AbilitySoulListScene/abilitySoulClicked': (4, 0),
    'AbilitySoulListScene/reuseAbilitySoulFromAnotherCharacterHandler': (2, 0),
    'AbilitySoulListScene/useAbilitySoulHandler': (2, 0),
    'AbilitySoulRemoveDialog/getWillRemoveAbilitySoul': (1, 1),
    'AbilitySoulReuseFromAnotherCharacterDialog/getInUseAbilitySoul': (1, 1),
    'AbilitySoulReuseFromAnotherCharacterDialog/getRemoveAbilitySoul': (1, 1),
    'AbilitySoulSellDialog/initialize': (1, 1),
    'AbilitySoulThumbnailListRepository/translate': (1, 0),
    'AbilitySoulUseDialog/getAbilitySoul': (1, 1),
    'BattleCharacterLogic/getAbilitySoulAbility': (1, 0),
    'BattleHeaderReadRestore$/readString': (3, 2),
    'DialogAbilitySoulDetailView/run': (1, 0),
    'EquipmentListTableItemView/apply': (2, 0),
    'EquipmentUpgradeAbilitySoulGenerateResultDialog/initialize': (1, 1),
    'GeneralAbilitySoulLogic/getAbility': (1, 0),
    'GeneralDialog/buttonClicked': (1, 0),
    'GeneralDialog/update': (1, 0),
    'ItemLogic/get_name': (1, 0),
    'MultiBattleRoomScene/serverMessage_Mates': (1, 1),
    'MultiBattleRoomScene/serverMessage_Start': (1, 1),
    'MultiQuestStartLoadingTask/remoteFinishedHandler': (1, 1),
    'PanelInnerContentItemListTableView/apply': (6, 0),
    'PanelInnerContentItemListTableView/draw': (8, 0),
    'PanelInnerContentItemListTableView/run': (1, 0),
    'PartyLogic/getBattleParty': (1, 0),
    'PartyTranslator/translate': (1, 0),
    'SingleBattleRestoreLoadingTask/restoreInput': (3, 2),
}
BRANCH_T1 = ('ifgt', 'ifle')
BRANCH_T2 = ('ifeq', 'ifne')


def _operand(ops, k):
    """Local whose value is compared at push index k (skips the 16000200 `pop` idiom)."""
    j = k - 1
    if ops[j].name == 'pop' and ops[j - 1].name == 'pushint':
        j -= 2
    o = ops[j]
    if o.name == 'getlocal':
        return o.args[0]
    if o.name.startswith('getlocal_'):
        return int(o.name[-1])
    return None


def classify(e, label):
    abc = e.abc
    ops = ops_of(e, label)
    back = {o.target for i, o in enumerate(ops) if o.target is not None and o.target <= i}
    t1, t2 = [], []
    for k, o in enumerate(ops[:-1]):
        v = int_value(abc, o)
        if o.name != 'pushint' or v not in (UPPER, UNKNOWN):
            continue
        br = ops[k + 1]
        local = _operand(ops, k)
        if local is None:
            continue
        if v == UPPER and br.name in BRANCH_T1:
            if any(k - 4 <= t <= k - 1 for t in back):
                continue                      # loop condition over record ids
            lower = None
            for j in range(k - 2, max(0, k - 10), -1):
                if int_value(abc, ops[j]) in (LOWER, UNKNOWN) and ops[j + 1].name == 'iflt' \
                        and _operand(ops, j) == local:
                    lower = (int_value(abc, ops[j]), ops[j + 1].target)
                    break
            if not lower or lower[0] != LOWER:
                continue                      # group test (already includes themed)
            if br.name == 'ifgt':
                assert br.target == lower[1], (label, k, 'upper/lower targets differ')
            t1.append(k + 1)
        elif v == UNKNOWN and br.name in BRANCH_T2:
            t2.append(k + 1)
    return t1, t2


def _candidates(e, labels):
    """Every method whose code pushes 16000000 or 16000999 (byte prefilter)."""
    abc = e.abc
    idx = [i for i, v in enumerate(abc.ints) if i and v in (UNKNOWN, UPPER)]
    needles = [b'\x2d' + opwalk_enc.u30(i) for i in idx]
    return {label for label, i in labels.items() if any(n in abc.bodies[i][5] for n in needles)}


def queue_themed(q):
    e = q.e
    found = {}
    labels = label_index(e.abc)
    for label in sorted(_candidates(e, labels)):
        if label in SKIP_METHODS:
            continue
        t1, t2 = classify(e, label)
        if label in T2_SKIP:
            t2 = []
        if not t1 and not t2:
            continue
        found[label] = (len(t1), len(t2))
        for at in t1:
            q.add('themed-T1', label, at, t1_block(e), asm.FORBID, 'instance bound -1 for 16000901..919')
        for at in t2:
            q.add('themed-T2', label, at, t2_block(e), asm.FORBID, 'compare 16000901..919 as 16000000')
    assert found == EXPECTED, {'unexpected': {k: v for k, v in found.items() if EXPECTED.get(k) != v},
                               'missing': sorted(set(EXPECTED) - set(found))}
    title = queue_detail_title(q)
    return {'sites': {k: {'T1': v[0], 'T2': v[1]} for k, v in found.items()},
            'T1_total': sum(v[0] for v in found.values()), 'T2_total': sum(v[1] for v in found.values()),
            'skipped_methods': sorted(SKIP_METHODS), 'detail_title': title}


def queue_detail_title(q):
    """AbilitySoulDetailDialog: themed unknown keeps the unknown description but
    shows its own name (soul master name) instead of the fixed 「未知裂罅」."""
    e = q.e
    label = 'AbilitySoulDetailDialog/initialize'
    ops = ops_of(e, label)
    hits = [i for i, o in enumerate(ops) if o.name == 'pushstring'
            and e.abc.strings[o.args[0]] == '未知裂罅'.encode()]
    assert len(hits) == 1, hits
    k = hits[0]
    assert ops[k + 1].name == 'setlocal'
    title_local = ops[k + 1].args[0]
    assert ops[2].name == 'getlocal_1' and mn(e, ops[3]) == 'id' and ops[4].name == 'setlocal'
    ident = ops[4].args[0]
    at = k + 2   # first instruction of the shared content builder (also a jump target)
    code = [*themed_jump(e, ident, 'themed', 'done'), ('label', 'themed'),
            ('getlocal_1',), ('callproperty', e.q('get_name'), 0), ('setlocal', title_local),
            ('label', 'done')]
    q.add('themed-title', label, at, code, asm.ENTER, 'themed unknown detail title = own name')
    return {'method': label, 'at': at, 'title_local': title_local, 'id_local': ident}
