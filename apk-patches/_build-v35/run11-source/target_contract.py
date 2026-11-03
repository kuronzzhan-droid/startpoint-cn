"""TASK11 经输入字节码核对的目标集合；独立于构造器运行结果。"""
GROUPS = ('direct_count', 'heal_any')
EXPECTED_CHANGED = {
    'MemberImpl/scheduleDirectAttack',
    'ConditionSlot$/wfxSpec',
    'MemberImpl/wfxHealSample',
    'UniqueConditionLogic/wfxSuperPreload',
    'MemberImpl$/wfxHealDamageTick',
}
EXPECTED_ADDED = {
    'MemberImpl/wfxDirectTargetCount',
    'MemberImpl/wfxHealAnyValue',
    'MemberImpl/wfxHealAnyDamage',
    'MemberImpl/wfxHealAnyFever',
    'MemberImpl/wfxHealAnyMembers',
    'MemberImpl/wfxHealAnySample',
    'MemberImpl$/wfxHealAnyCTQueue',
    'MemberImpl$/wfxHealAnyCTTick',
    'MemberImpl/wfxHealAnyCTRecord',
}
