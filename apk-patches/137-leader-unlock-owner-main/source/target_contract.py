"""TASK9 固定修改范围；最终构建前与独立链路审阅对齐。"""
EXPECTED_CHANGED = {
    'BattleCharacterLogic/getInstantAbiltyCountWithoutLimit',
    'TriggerableAbilityDialogAllAbilitiesGenerator/addAbility',
    'BattleCharacterLogic/wfxPartyMask',
    'BattleCharacterLogic/getElement',
}
EXPECTED_ADDED = {
    'BattleCharacterLogic/wfxOwnerMainUnlocked',
    'AbilityDisabledReasonResolver/wfxOwnAbilityUnlocked',
    'AbilityDisabledReasonResolver/wfxResolveOwnPrecondition',
    'AbilityDisabledReasonResolver/wfxResolveOwnAbility',
    'BattleCharacterLogic/wfxElementBeforeOwnerMain',
    'BattleCharacterLogic/wfxCachedElementBeforeOwnerMain',
    'BattlePartyLogic/wfxSameElementBeforeOwnerMain',
}
GROUPS = ('owner_main',)
