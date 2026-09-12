"""校奈芙强化技能的原生护盾片段；不读写候选或修改客户端。"""
from wf_bianca_dragon_skill import block, command, value

SHIELD_RATIO = 0.1


def grant_barriers():
    """接在原 flag1 + Fever 真分支的 _grant_state() 后。

    A1 的主位、暗共鸣门由既有强化 flag 发放行保持。82 仅选暗主成员，
    86 仅选协力球，避免暗球重复获盾。CreateBarrier 原生按各受益者 maxHP
    计算，较大的新盾替换当前剩余盾值，不累加也不附加持续时间。
    """
    def recipients(binding, selector, elements):
        return command("FindAllSubjects", binding, selector, elements, [], [], [], [],
            ["DoNothing"], block(command("CreateBarrier", binding, value(SHIELD_RATIO),
                                       ["GenericBarrierHitEffect"])))

    return block(recipients(76, 82, [6]), recipients(77, 86, []))


def metadata():
    return {
        "ratio": SHIELD_RATIO,
        "max_hp_reference": "each_recipient",
        "targets": ["local_dark_primary_members", "all_skill_targetable_multiballs"],
        "gates": "existing A1 main + dark resonance flag; enhanced skill during Fever",
        "duration_frames": None,
        "overwrite": "native greater-than-current-remaining barrier; no addition",
        "required_capabilities": [],
    }
