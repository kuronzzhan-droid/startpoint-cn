"""Copy a native Condition without rerunning application or accumulation."""
from .common import BCD, COND

# Exact native constructor order. Content is the native immutable value tree;
# there are no Member/Battle/slot/closure references in any of its 42 variants.
FIELDS = (
    'id', '_originalTimeLimit', 'addedTime', 'timeLimit', 'restFlipLimit',
    'restPowerFlipLimit', 'restEndPowerFlipLimit', 'endPowerFlipAcceptedLevels',
    'maxAccumulation', 'content', 'cancelable', 'isEternal', 'statsBattleId',
    'originMemberIndex', 'shouldCountForMission', 'isFromHostile', 'extensionId',
    'magnificationFromPrimary', 'magnificationFromOther', 'linkedTrialId',
    'hitCountCheck', 'discriminationKey', 'isQuestInitial',
)


def build(c):
    code = [('getlex', c.q(COND))]
    for field in FIELDS:
        if field in ('linkedTrialId', 'hitCountCheck'):
            # Native member/player-ball conditions cannot have enemy trials.
            # Snapshot excludes such unexpected objects rather than retaining
            # a strong reference into the old enemy/battle graph.
            code += [('pushnull',)]
        else:
            code += [('getlocal_1',), c.get(field)]
            if field == 'addedTime':
                code += [('getlocal_2',), ('add_i',)]
            elif field == 'endPowerFlipAcceptedLevels':
                code += [c.e.number(0), c.call('http://adobe.com/AS3/2006/builtin::slice', 1)]
    code += [('construct', len(FIELDS)), ('coerce', c.q(COND)), ('setlocal_3',)]
    for field in ('consumedCount', 'blinkFrameCount'):
        code += [('getlocal_3',), ('getlocal_1',), c.get(field), c.put(field)]
    code += [('getlocal_3',), ('returnvalue',)]
    c.add(BCD, 'wfxStageClone', COND, [COND, 'int'], code, 4, static=True)
