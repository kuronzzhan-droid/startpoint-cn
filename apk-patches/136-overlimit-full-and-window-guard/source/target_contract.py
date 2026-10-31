"""TASK8 固定修改范围；独立于构造报告的验收白名单。"""
EXPECTED_CHANGED = {
    'OwnedOverLimitLogic/getOwnAwakingCrystalToOverLimit',
    'OwnedOverLimitLogic/getAwakingCrystalToOverLimit',
    'OwnedOverLimitLogic/getOverLimitState',
    'OwnedCharacterLogic/getPossibleOverLimitCountByItem',
    'OverLimitWindow/getOverLimitState',
    'OverLimitWindow/run',
    'OverLimitWindow/getStatusInformation',
    'ExpodOverLimitByItemDialog/getDescription',
    'GeneralCharacterLogic/getPedestalImagePath',
    'GeneralCharacterLogic/getHalfPedestalImagePath',
    'OverLimitWindowView/onApplyOverLimitStatusInformation',
}
EXPECTED_ADDED = {
    'GeneralCharacterLogic/wfxOverlimitFull',
    'GeneralCharacterLogic/wfxAllManaNodesLearned',
}
GROUPS = ('materials', 'pedestals', 'window')
