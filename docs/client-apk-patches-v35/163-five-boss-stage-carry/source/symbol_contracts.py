"""Explicit receiver contracts reviewed against the native continuation code."""
BCD = "pinball.common.data.battle.restore::BattleContinuationData"
COND = "pinball.common.data.character.condition::Condition"
SLOT = "pinball.scene.battle.battle.condition::ConditionSlot"
SQUAD = "pinball.scene.battle.battle.squad::SquadImpl"
MEMBER = "pinball.scene.battle.battle.squad.member::MemberImpl"
OPTION = "haxe.ds::Option"
ORDERED = "pinball.common.ds::OrderedMap"
STRINGMAP = "haxe.ds::StringMap"
ITERATOR = "haxe.ds._StringMap::StringMapKeysIterator"
BUILTIN = "http://adobe.com/AS3/2006/builtin::"
CONSTRUCTOR_FIELDS = (
    "id", "_originalTimeLimit", "addedTime", "timeLimit", "restFlipLimit",
    "restPowerFlipLimit", "restEndPowerFlipLimit", "endPowerFlipAcceptedLevels",
    "maxAccumulation", "content", "cancelable", "isEternal", "statsBattleId",
    "originMemberIndex", "shouldCountForMission", "isFromHostile", "extensionId",
    "magnificationFromPrimary", "magnificationFromOther", "linkedTrialId",
    "hitCountCheck", "discriminationKey", "isQuestInitial",
)


def receivers(label, symbol):
    if label.endswith("/wfxStageClone"):
        if symbol in (*CONSTRUCTOR_FIELDS, "consumedCount", "blinkFrameCount"):
            return [(COND, False)]
        if symbol == BUILTIN + "slice":
            return [("Array", False)]
    slot_helpers = ("/wfxStageSnapshot", "/wfxStageRestore")
    if label.endswith(slot_helpers):
        if symbol in ("conditions", "getConditionByIndex", "frameCount", "applicationResolver",
                      "invisibleSlot", "setCondition", "addRefreshCount", "wfxStageSnapshot", "wfxStageRestore"):
            return [(SLOT, False)]
        if symbol in ("isQuestInitial", "linkedTrialId", "hitCountCheck", "hasExpired", "id"):
            return [(COND, False)]
        if symbol == "_keys":
            return [(ORDERED, False)]
        if symbol in ("keys", "get", "set"):
            return [(STRINGMAP, False)]
        if symbol in ("hasNext", "next"):
            return [(ITERATOR, False)]
        if symbol == "wfxStageClone":
            return [(BCD, True)]
    if label.endswith(("/wfxStageCapture", "/wfxStageApply")):
        if symbol == "members":
            return [(SQUAD, False)]
        if symbol == "params":
            return [(OPTION, False)]
        if symbol == "index":
            return [(OPTION, False), (MEMBER, False)]
        if symbol == "conditionSlot":
            return [(SQUAD, False), (MEMBER, False)]
        if symbol in ("wfxStageSnapshot", "wfxStageRestore"):
            return [(SLOT, False)]
        if symbol == "wfxStageStates":
            return [(BCD, True)]
    if symbol in ("length", BUILTIN + "push", BUILTIN + "sort"):
        return [("Array", False)]
    raise ValueError(f"no reviewed receiver contract: {label} -> {symbol}")
