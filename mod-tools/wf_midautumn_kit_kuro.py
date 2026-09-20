# -*- coding: utf-8 -*-
"""中秋批次 kit：黑 139991 ``outlaw_panther_moon``（雷 · 拳 · 直击辅助）。

轴线：**把「Fever 中」当门，把全队直击的段数与倍率一次性抬起来，再用段数回喂 Fever**。

- 队长技／词条的主轴全部挂在持续触发 4（Fever 中）下：全队(雷)直击伤害 400%＋120%＋80%、
  攻击力 200%＋50%＋45%＋骰运每层 12%。
- 技能「博饼·满堂彩」把判定区改成**按直接攻击伤害判定**（``CreateHitArea`` params[23] = 4），
  并给队伍全员及协力球发两条状态：直击伤害 UP ＋ **3 段追加直接攻击**。
- 3 段让全队的 Fever 点／连击／「编成直接攻击≥N」计数一起 ×3，回喂黑自己的
  724（非 Fever 时每 45 次直击 → Fever 槽 +12%）与固有状态「骰运」（每 35 次 +1 层，上限 6）。

由 ``python mod-tools/wf_midautumn_build.py --char kuro --step kit`` 调用 :func:`build`。
只经 ``KitContext`` 写 ``work/character_packs/ma-kuro/``；live store / ``assets/`` / ``.cdn`` /
设备 / 存档一律不碰，不发布、不 git。

设计稿：``work/character_packs/midautumn-20260920/design/kuro.{md,json}``。
17 行方案（donor + 逐格改 + ``wf_describe`` 回读）全部内联在本模块，设计稿在场时逐条互校
（:func:`design_crosscheck`）——设计稿在 gitignore 的 ``work/`` 下，缺失时不阻塞。

落地内容
--------
- ``character`` 行 c9–c16 语音路由（kind 1 ConditionExist / 条件种类 28 固有 → ``<code>_voice_ready``）
  ＋ c18 队长技名；``character_text`` 与 ``action_skill`` 两档文案由 ``tables`` 依 :data:`TEXTS` 写，
  本模块只断言不漂移。
- 队长技 4 行、词条 6 键 13 条：官方／live donor 行 + 逐格改，逐行过 ``wf_client_legality``
  （合法性 / 声明块字段 / 元素列）并与登记的面板文案逐字比对。
- 固有状态 ``13999101``「骰运」（8 位 ID，上限 **6**，不是 ``(None)``）。
- ``action_skill`` 两档能量 c4/c5 = 母本原值 490/490 与 490/440（零改动）。
- 两棵技能 DSL：母本 ``outlaw_panther_ny22$_1/_2`` 整树，只做 S1–S4 四处改动
  （判定区 buffTargetAs、``CreateNormalAttack`` 倍率、``CreateCondition`` 的 AC、追加第二条 ``CreateCondition``）。
  **不新增构造名、不改命令顺序、不动判定区形状**；4 条 ``ShowEffect`` 全部直接引用官方路径，
  零克隆零图集增量。
- ``switched_action_skill`` ``<code>_voice_ready``（matched_skill_ready 的路由目标）。
- 像素/特效交付件：``B/pixel/kuro/install.json`` 在场才装，缺失静默跳过。

**无 ``custom_ability_string``、无 ``desc_override``、无 422、无 722。**
唯一的 APK 补丁 kind 是 724（``kyubi-fever-ratio-v1``），且**只在 ability 表**（写进队长表 = C7050）。
"""
from __future__ import annotations

import copy
import json
from typing import Any

import wf_midautumn_kitlib as KL
import wf_midautumn_specs as MS

KEY = "kuro"
CID = 139991
CID_S = "139991"
CODE = "outlaw_panther_moon"
TEMPLATE_ID = 231069
TEMPLATE_CODE = "outlaw_panther_ny22"
ELEMENT = 2                      # 内部 ElementKind：2 = 雷（Yellow）
ELEMENT_TOKEN = "Yellow"
PF_TYPE = 1                      # 拳
STANCE = "Supporter"

UID = MS.unique_condition_id(CID, 1)          # "13999101"：8 位（裁决 §1，7 位撞过基诺维段）
VOICE_KEY = CODE + "_voice_ready"

CHARACTER = KL.CHARACTER
ACTION = KL.ACTION

TEXTS = {
    "name": "黑",
    "furigana": "HEI",
    "title": "月下博饼的黑豹",
    "profile": "中秋夜的长街上，黑支起一张矮几，摆出朱漆骰碗，招呼路过的人来赌一把月饼。"
               "这位看似只顾摇骰起哄的猫族长老，却在每次开碗时数清了场上有几个人在笑——"
               "他想改变的世界，就是这样一个谁都能笑着掷一次骰子的地方。",
    "skill1": "博饼·满堂彩",
    "desc1": "手托朱漆骰碗原地摇转，对周围的敌人持续造成雷属性伤害（以直接攻击伤害判定）"
             "／赋予队伍全员及协力球直接攻击伤害提升与追加直接攻击效果",
    "skill2": "博饼·满堂彩＋",
    "desc2": "手托朱漆骰碗原地摇转，对周围的敌人持续造成雷属性伤害（以直接攻击伤害判定）"
             "／赋予队伍全员及协力球直接攻击伤害提升与追加直接攻击效果",
    "leader": "今宵手气正旺",
    "cv": "AI 合成配音",
}

SPEC = {
    "required_capabilities": ("kyubi-fever-ratio-v1",),   # 词条 1399913#0 的 kind 724
    "extra_keys": {KL.UNIQUE: (UID,), KL.SWITCHED: (VOICE_KEY,)},
}

#: character c9–c16：kind 1 ConditionExist，条件种类 **28**（固有状态）、条件 id = 骰运。
#: 首次技能发动后骰运常驻（A4#1 一次 +2 层）⇒ 开局与开局后各听得到一种「技能准备好」台词。
VOICE_ROUTE = {"kind": 1, "condition_kind": "28", "condition_id": UID}


class KuroError(KL.KitError):
    """本角色 kit 的断言失败。"""


# ------------------------------------------------------------------ 固有状态

#: 官方 ``unique_condition[11]`` ``unique_blackflower_wiz_smr22``「能量吸取」整行，
#: 只改 c0/c1/c2/c4；c3 起逐列相同（常驻 99999999、不可驱散、入棺不清除）。
UNIQUE_DONOR = "11"
UNIQUE_NAME = "骰运"
#: **上限 6**（博饼六颗骰子）。写 ``(None)`` 会被读成上限 1，during 134 的叠层全部失效
#: （记忆 ``wf-unique-cap-none-trap``）；``KL.unique_row`` 也硬拒 ``(None)``。
UNIQUE_CAP = "6"
UNIQUE_ICON = f"battle/common/unique_condition/unique_{CODE}_dice_luck"
UNIQUE_ICON_LOGICAL = UNIQUE_ICON + ".png"
#: 取 alpha 与尺寸的官方画框 donor（就是固有状态行的 donor 自己的图标）。
#: manifest 门禁要求「被表引用的资产必须在 roots.common 里声明」⇒ 图标**必须进包**，
#: 引用官方路径当回落是过不了的（实测：`validate_manifest: referenced asset is not declared`）。
UNIQUE_ICON_FRAME = "battle/common/unique_condition/unique_blackflower_wiz_smr22.png"

#: 图标配色（设计稿 §5）：夜靛底 ＋ 金边 ＋ 立体金骰子（五点面）＋ 极细月牙。
ICON_INK = (0x22, 0x1E, 0x1A)          # 夜靛
ICON_GOLD = (0xBA, 0x9E, 0x46)         # 金边 / 骰身
ICON_GOLD_LIGHT = (0xD8, 0xBC, 0x66)   # 骰子受光面
ICON_GOLD_DARK = (0x7E, 0x68, 0x2C)    # 骰子背光面
ICON_PIP = (0xFF, 0xF4, 0xC0)          # 骰点 / 月牙
ICON_SCALE = 8                         # PIL 8× 画 + LANCZOS 缩（设计稿 §5）


# ------------------------------------------------------------------ 行方案
# 每条 =（donor 键#记录号（0 基）, 逐格改, 面板预期文案）。
# donor 默认取官方基线（``.cdn/cn`` OfficialBaseline），``live:`` 前缀才取 live store
# （只有 724 那条：补丁 kind 在官方全表零行，唯一可抄的形状是自制 149989 希尔媞·校园）。

LEADER: tuple[tuple[str, dict[int, str], str], ...] = (
    # L1 Fever 中 → 全队(雷) 直击伤害 400%（裁决 §2「直击队长全队直击 300–400%」带顶）
    ('151171#1', {0: CODE, 1: '0', 3: '1', 4: '0', 11: '0', 18: '0', 83: '(None)', 95: '4',
                  106: 'false', 107: '1', 108: '5', 109: ELEMENT_TOKEN, 111: '400000', 112: '400000'},
     '持续·Fever → 赋予全队(雷) Direct伤害 400%'),
    # L2 同一个 Fever 门下的全队攻击力 200%（L1+L2 = 600%，落在主轴合计 490–650% 内）
    ('151171#0', {0: CODE, 1: '0', 3: '1', 4: '0', 11: '0', 18: '0', 83: '(None)', 95: '4',
                  106: 'false', 107: '0', 108: '5', 109: ELEMENT_TOKEN, 111: '200000', 112: '200000'},
     '持续·Fever → 赋予全队(雷) 攻击力 200%'),
    # L3 把 L1/L2 的门自己延长：官方 ★3 黑本人的队长行，数值不动
    ('331004#1', {0: CODE, 1: '0', 3: '0', 4: '0', 11: '0', 18: '0', 25: '0', 37: '(None)',
                  44: '0', 45: '56', 49: '25000', 50: '25000'},
     '自身 Fever时间延长 25%'),
    # L4 Fever 引擎：非 Fever 时任一雷属性角色发动技能 → 追加 Fever 点 50
    #    724 不能进队长表（= C7050），队长层的 Fever 回转只能用官方 213
    ('131164#3', {0: CODE, 1: '0', 3: '0', 4: '2', 7: '600000', 8: '600000', 9: ELEMENT_TOKEN,
                  11: '186', 18: '0', 25: '23', 26: '7', 27: ELEMENT_TOKEN, 28: '100000',
                  29: '100000', 32: '(None)', 33: '0', 37: '(None)', 44: '0', 45: '213',
                  49: '5000000', 50: '5000000'},
     '雷·编成≥6 且 非Fever 时: 技能发动≥1 → 自身 追加Fever点 5000%'),
)

#: 一键内 c2（雕像组）必须单值（裁决 §8：官方 790 个多记录键 0 个混用，``KL.check_ability_key``
#: 也硬卡）。选组规则＝**该键用到的每个 kind 在官方基线上都有这一组的先例**，多个候选取
#: 「最小先例数最大」的，并列时取母本 231069 用过的组。官方实测（I=瞬发内容 / D=持续内容）：
#:
#: ======== ============== ===============================================================
#: 键       组             官方先例
#: ======== ============== ===============================================================
#: 1399911  attack_common  I211 = 31、D1 = 33
#: 1399912  attack_common  I0 = 61、D0 = 210
#: 1399913  attack_common  D1 = 33、D0 = 210（I724 是 APK 补丁 kind，官方全表零行）
#: 1399914  condition      I461 = 7（全表最高）
#: 1399915  action_skill   D3 = 7、I226 = 4
#: 1399916  special        D0 = 12、I69 = 2；母本 2310693（I226＋I55 混 kind）同样挂 special
#: ======== ============== ===============================================================
STATUE_GROUPS = {'1399911': 'attack_common', '1399912': 'attack_common', '1399913': 'attack_common',
                 '1399914': 'condition', '1399915': 'action_skill', '1399916': 'special'}

ABILITY: dict[str, tuple[tuple[str, dict[int, str], str], ...]] = {
    # 1 自充 ＋ Fever 门下的全队直击基础档
    '1399911': (
        ('2310694#0', {0: 'outlaw_panther_moon_1', 1: 'true', 2: 'attack_common', 3: '0', 5: '0',
                       6: '0', 13: '0', 20: '0', 27: '0', 39: '(None)', 46: '0', 47: '211',
                       48: '0', 51: '100000', 52: '100000'},
         '自身 技能槽 100%'),
        ('1511472#0', {0: 'outlaw_panther_moon_1', 1: 'true', 2: 'attack_common', 3: '0', 5: '1',
                       6: '0', 13: '0', 20: '0', 85: '(None)', 97: '4', 108: 'false', 109: '1',
                       110: '5', 111: 'Yellow', 113: '80000', 114: '80000'},
         '持续·Fever → 赋予全队(雷) Direct伤害 80%'),
    ),
    # 2 「开碗见彩」技能命中给 15 秒状态攻击力（CT 20 秒）＋ 吃到追加直击状态后再叠一层攻击
    '1399912': (
        ('1610693#0', {0: 'outlaw_panther_moon_2', 1: 'true', 2: 'attack_common', 3: '0', 5: '0',
                       6: '0', 13: '0', 20: '0', 27: '107', 28: '0', 30: '100000', 31: '100000',
                       34: '(None)', 35: '1200', 39: '(None)', 46: '0', 47: '0', 48: '5',
                       49: 'Yellow', 51: '80000', 52: '80000', 57: '90000000', 58: '90000000',
                       59: '100000', 60: '100000', 61: '(None)', 62: '(None)', 63: '(None)',
                       64: '(None)', 65: '(None)', 67: '0', 72: 'false', 74: '1', 75: '0'},
         '技能Hit≥1(CT20秒) → 赋予全队(雷) 状态攻击力 80%(15秒)×1次'),
        ('2310872#1', {0: 'outlaw_panther_moon_2', 1: 'true', 2: 'attack_common', 3: '0', 5: '1',
                       6: '0', 13: '0', 20: '0', 85: '(None)', 97: '73', 98: '0', 108: 'false',
                       109: '0', 110: '5', 111: 'Yellow', 113: '45000', 114: '45000'},
         '持续·状态追加直接攻击 → 赋予全队(雷) 攻击力 45%'),
    ),
    # 3 Ⓜ 主位核心：724 Fever 回转 ＋ Fever 门下全队直击 ＋ 骰运每层全队攻击
    '1399913': (
        ('live:1499893#1', {0: 'outlaw_panther_moon_3', 1: 'false', 2: 'attack_common', 3: '0',
                            5: '0', 6: '2', 9: '600000', 10: '600000', 11: 'Yellow', 13: '186',
                            20: '0', 27: '20', 28: '7', 29: 'Yellow', 30: '4500000',
                            31: '4500000', 34: '(None)', 35: '0', 39: '(None)', 46: '0',
                            47: '724', 51: '12000', 52: '12000'},
         '雷·编成≥6 且 非Fever 时: 编成直接攻击≥45 → 自身 Fever槽增减(上限比例) 12%'),
        ('1511472#0', {0: 'outlaw_panther_moon_3', 1: 'false', 2: 'attack_common', 3: '0', 5: '1',
                       6: '0', 13: '0', 20: '0', 85: '(None)', 97: '4', 108: 'false', 109: '1',
                       110: '5', 111: 'Yellow', 113: '120000', 114: '120000'},
         '持续·Fever → 赋予全队(雷) Direct伤害 120%'),
        ('1611233#2', {0: 'outlaw_panther_moon_3', 1: 'false', 2: 'attack_common', 3: '0', 5: '1',
                       6: '0', 13: '0', 20: '0', 85: '(None)', 97: '134', 98: '0', 100: '100000',
                       101: '100000', 102: '6', 104: UID, 108: 'false', 109: '0', 110: '5',
                       111: 'Yellow', 113: '12000', 114: '12000'},
         '持续·状态累积计数固有≥1(限6次)[固有13999101] → 赋予全队(雷) 攻击力 12%'),
    ),
    # 4 骰运叠层：技能发动 +2 层、雷属性直击合计每 35 次 +1 层
    '1399914': (
        ('1611231#0', {0: 'outlaw_panther_moon_4', 1: 'true', 2: 'condition', 3: '0', 5: '0',
                       6: '0', 13: '0', 20: '0', 27: '23', 28: '0', 30: '100000', 31: '100000',
                       34: '(None)', 35: '0', 39: '(None)', 46: '0', 47: '461', 48: '0',
                       51: '200000', 52: '200000', 59: '100000', 60: '100000', 68: UID,
                       74: '1', 75: '0'},
         '技能发动≥1 → 自身 状态固有 200%×1次'),
        ('1611231#0', {0: 'outlaw_panther_moon_4', 1: 'true', 2: 'condition', 3: '0', 5: '0',
                       6: '0', 13: '0', 20: '0', 27: '20', 28: '7', 29: 'Yellow', 30: '3500000',
                       31: '3500000', 34: '(None)', 35: '0', 39: '(None)', 46: '0', 47: '461',
                       48: '0', 51: '100000', 52: '100000', 59: '100000', 60: '100000',
                       68: UID, 74: '1', 75: '0'},
         '编成直接攻击≥35 → 自身 状态固有 100%×1次'),
    ),
    # 5 Fever 门下的全队充能（给 Fever 中的技能循环提速）＋ 击杀追加连击
    '1399915': (
        ('1510633#1', {0: 'outlaw_panther_moon_5', 1: 'true', 2: 'action_skill', 3: '0', 5: '1',
                       6: '0', 9: '', 10: '', 11: '', 13: '0', 20: '0', 85: '(None)', 97: '4',
                       108: 'false', 109: '3', 110: '5', 111: 'Yellow', 113: '12000',
                       114: '12000'},
         '持续·Fever → 赋予全队(雷) 技能槽充能 12%'),
        ('2310693#0', {0: 'outlaw_panther_moon_5', 1: 'true', 2: 'action_skill', 3: '0', 5: '0',
                       6: '0', 11: '', 13: '0', 20: '0', 27: '10', 30: '100000', 31: '100000',
                       34: '(None)', 35: '0', 39: '(None)', 46: '0', 47: '226', 51: '500000',
                       52: '500000'},
         '击杀敌人≥1 → 自身 追加连击 5'),
    ),
    # 6 副位友好档：Fever 门下全队攻击 ＋ 全队麻痹无效（麻痹中的成员不产生直击 ⇒ 真收益）
    '1399916': (
        ('1511473#0', {0: 'outlaw_panther_moon_6', 1: 'true', 2: 'special', 3: '0', 5: '1',
                       6: '0', 9: '', 10: '', 11: '', 13: '0', 20: '0', 85: '(None)', 97: '4',
                       108: 'false', 109: '0', 110: '5', 111: 'Yellow', 113: '50000',
                       114: '50000'},
         '持续·Fever → 赋予全队(雷) 攻击力 50%'),
        ('1411833#3', {0: 'outlaw_panther_moon_6', 1: 'true', 2: 'special', 3: '0', 5: '0',
                       6: '0', 13: '0', 20: '0', 27: '0', 30: '', 31: '', 34: '', 36: '',
                       39: '(None)', 46: '0', 47: '69', 48: '5', 49: 'Yellow'},
         '赋予全队(雷) 麻痹无效'),
    ),
}

#: 这两个 kind 写进队长表 = C7050（裁决 §2、框架 §10.3）。只许出现在 ability 表。
ABILITY_ONLY_KINDS = ("422", "724", "713")
#: 瞬发常驻型段数/取最大值类 kind，与「取最大值类 × 连击触发同键」会撞 C2308
#: （记忆 ``wf-direct-attack-and-buffcount-kinds``）。本套件段数统一走技能 DSL，词条层零行。
C2308_KINDS = ("201", "202", "521")

#: 队长／词条的 kind 列（layout 见设计稿 plan.*.layout）。
LEADER_KIND_COLUMNS = (25, 45, 95, 107)
ABILITY_KIND_COLUMNS = (27, 47, 97, 109)


# ------------------------------------------------------------------ 技能

#: ``action_skill`` c4/c5：母本 231069 原值，零改动（★5 辅助带内）。
SKILL_ENERGY = {"1": ("490", "490"), "2": ("490", "440")}

#: ``CreateNormalAttack`` 下标 6（倍率）：旧 → 新。15 段 × 2.7 = 40.5 倍（裁决 §2「辅助技能 36–50×」）。
SKILL_MULTIPLIER = {
    "1": ([{"min": 0.5333333333333333, "max": 0.5333333333333333}], [{"min": 1.8, "max": 1.8}]),
    "2": ([{"min": 0.6933333333333334, "max": 0.8}], [{"min": 2.34, "max": 2.7}]),
}

#: ``FindAllSubjects(33)`` 下 ``CreateCondition`` 的 AC 列表：旧（母本 PF 伤害）→ 新（直击伤害）。
#: arity 完全相同（3 参），只换构造名与数值。
SKILL_DIRECT_AC = {
    "1": (["ACPowerFlipDamage", [{"min": 720, "max": 720}], [{"min": 0.3, "max": 0.3}],
           [{"min": 1, "max": 1}]],
          ["ACDirectDamage", [{"min": 900, "max": 900}], [{"min": 1.0, "max": 1.0}],
           [{"min": 1, "max": 1}]]),
    "2": (["ACPowerFlipDamage", [{"min": 900, "max": 900}], [{"min": 0.4, "max": 0.5}],
           [{"min": 1, "max": 1}]],
          ["ACDirectDamage", [{"min": 1200, "max": 1200}], [{"min": 1.2, "max": 1.5}],
           [{"min": 1, "max": 1}]]),
}

#: 追加的第二条 ``CreateCondition`` 的 AC：全队＋协力球 **3 段**追加直接攻击。
#: 形状逐格抄 live 149988 ``scutum_valentine`` 的 ``CreateCondition 204``
#: （官方 20 处 ACAdditionalDirectAttack 全是 subject -17／2 段；>2 段且发给一群人的先例只有它）。
SKILL_ADDITIONAL_AC = {
    "1": ["ACAdditionalDirectAttack", [{"min": 900, "max": 900}], [{"min": 3, "max": 3}],
          [{"min": 0.8, "max": 0.8}], [{"min": 1, "max": 1}]],
    "2": ["ACAdditionalDirectAttack", [{"min": 1200, "max": 1200}], [{"min": 3, "max": 3}],
          [{"min": 0.85, "max": 1.0}], [{"min": 1, "max": 1}]],
}

#: ``CreateHitArea`` 命令列表下标 24（= params[23] buffTargetAs）：0 自动 → **4 按直接攻击伤害判定**。
#: 先例：live 169992 ``blackflower_wiz_yukata`` 两档各两处判定区实读 = 4（记忆 ``wf-persistent-field-direct-damage``）。
HITAREA_BUFF_TARGET_SLOT = 24
HITAREA_BUFF_TARGET_AS = 4

#: 母本整树的命令计数指纹：任何一项对不上都说明母本漂移或改错了结构。
DONOR_COMMAND_COUNTS = {
    "StopBall": 1, "ShowEffect": 4, "CreateHitArea": 1, "ShakeCamera": 1,
    "CreateNormalAttack": 1, "FindAllSubjects": 1, "CreateCondition": 1,
}

OFFICIAL_EFFECT_PREFIX = f"battle/effect/skill_unique/{TEMPLATE_CODE}/"


# ------------------------------------------------------------------ DSL 工具

def _walk(node):
    yield node
    if isinstance(node, list):
        for child in node:
            yield from _walk(child)
    elif isinstance(node, dict):
        for child in node.values():
            yield from _walk(child)


def _command_slots(node, name: str, out: list | None = None) -> list[tuple[list, int]]:
    """找出 ``["Command", [<name>, …]]`` 在其父列表里的位置，返回 ``[(父列表, 下标), …]``。"""
    out = [] if out is None else out
    if isinstance(node, list):
        for index, child in enumerate(node):
            if (isinstance(child, list) and len(child) == 2 and child[0] == "Command"
                    and isinstance(child[1], list) and child[1] and child[1][0] == name):
                out.append((node, index))
            _command_slots(child, name, out)
    elif isinstance(node, dict):
        for child in node.values():
            _command_slots(child, name, out)
    return out


def _command_counts(tree) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in _walk(tree):
        if (isinstance(node, list) and len(node) == 2 and node[0] == "Command"
                and isinstance(node[1], list) and node[1] and isinstance(node[1][0], str)):
            counts[node[1][0]] = counts.get(node[1][0], 0) + 1
    return counts


def effect_paths(tree) -> list[str]:
    """树里所有 ``SpecifyEffectDirectly`` 的特效路径。"""
    return [node[1] for node in _walk(tree)
            if isinstance(node, list) and len(node) == 2
            and node[0] == "SpecifyEffectDirectly" and isinstance(node[1], str)]


def mutate_tree(tree, level: str):
    """母本整树 → 本角色的树（S1–S4）。返回 ``(tree, evidence)``；结构不符直接抛错。"""
    counts = _command_counts(tree)
    if counts != DONOR_COMMAND_COUNTS:
        raise KuroError(f"donor skill tree {level} drifted: commands {counts} "
                        f"!= {DONOR_COMMAND_COUNTS}")
    if not (isinstance(tree, list) and len(tree) == 12 and tree[0] == "ActionDsl"):
        raise KuroError(f"donor skill tree {level}: unexpected root {tree[:2]!r}")
    if tree[1] != 2 or tree[10] != 0:
        # tree[10] = buffTargetAs（记忆 ``wf-dsl-damage-attribution-bufftargetas``）：
        # 0 = 自动。伤害归属由判定区那一格（S1）决定，根头保持 0。
        raise KuroError(f"donor root header {level}: movementPriority={tree[1]} "
                        f"buffTargetAs={tree[10]}, expected 2/0")

    # --- S1 CreateHitArea params[23] buffTargetAs：0 → 4（按直接攻击伤害判定）
    (ha_parent, ha_index), = _command_slots(tree, "CreateHitArea")
    hit_area = ha_parent[ha_index][1]
    if len(hit_area) != 27:
        raise KuroError(f"donor CreateHitArea has {len(hit_area)} slots, expected 27")
    if hit_area[HITAREA_BUFF_TARGET_SLOT] != 0:
        raise KuroError(f"donor CreateHitArea[{HITAREA_BUFF_TARGET_SLOT}] "
                        f"{hit_area[HITAREA_BUFF_TARGET_SLOT]!r} != 0")
    if hit_area[14] != ["CalculatedUsingMaxNumOfHits", 15]:
        raise KuroError(f"donor CreateHitArea hit budget drifted: {hit_area[14]!r}")
    hit_area[HITAREA_BUFF_TARGET_SLOT] = HITAREA_BUFF_TARGET_AS

    # --- S2 CreateNormalAttack 下标 6（倍率）
    (cna_parent, cna_index), = _command_slots(tree, "CreateNormalAttack")
    cna = cna_parent[cna_index][1]
    if cna[2] != 255:
        # 255 = 随自身属性。DSL 显式元素码只有 CreateNormalAttack[2] 有 +1 偏移
        # （记忆 ``wf-dsl-element-code-offset``），255 是哨兵，这一格不动。
        raise KuroError(f"CreateNormalAttack element slot {cna[2]!r} != 255")
    before_mult, after_mult = SKILL_MULTIPLIER[level]
    if cna[6] != before_mult:
        raise KuroError(f"CreateNormalAttack multiplier {cna[6]!r} != donor {before_mult!r}")
    cna[6] = copy.deepcopy(after_mult)

    # --- S3 FindAllSubjects(33) 下 CreateCondition 的 AC 列表：PF 伤害 → 直击伤害
    (fas_parent, fas_index), = _command_slots(tree, "FindAllSubjects")
    find_all = fas_parent[fas_index][1]
    if find_all[1] != 3 or find_all[2] != 33:
        raise KuroError(f"donor FindAllSubjects binding/selector {find_all[1:3]!r} != [3, 33]")
    (cc_parent, cc_index), = _command_slots(tree, "CreateCondition")
    donor_cmd = cc_parent[cc_index]
    body = donor_cmd[1]
    if len(body) != 13:
        raise KuroError(f"donor CreateCondition has {len(body)} slots, expected 13")
    if body[1] != find_all[1]:
        # CHA p1 必须 = 所在 FindAll 的绑定 id（记忆 ``wf-dsl-subject-lookup-map``）
        raise KuroError(f"CreateCondition subject {body[1]!r} != FindAllSubjects binding {find_all[1]!r}")
    if body[10] != 3:
        # 下标 10 = 付与对象种类：选择器 33/82 写 3（记忆 ``wf-createcondition-target-kind``）；
        # 错配 = 施法 C16102。母本这条已经是 3，整条克隆 ⇒ 原样保留。
        raise KuroError(f"donor CreateCondition target kind {body[10]!r} != 3")
    if body[12] is not False:
        raise KuroError(f"donor CreateCondition forceApply {body[12]!r} != False")
    before_ac, after_ac = SKILL_DIRECT_AC[level]
    if body[2] != [before_ac]:
        raise KuroError(f"CreateCondition AC {body[2]!r} != donor [{before_ac!r}]")
    # 下标 2 是 **AC 列表**（母本是 ``[[ACPowerFlipDamage, …]]`` 一条）：直接塞裸 AC
    # 会把嵌套层吃掉一层，往返自检抓不到，进战斗才炸。
    body[2] = [copy.deepcopy(after_ac)]

    # --- S4 同一个 Block 内追加第二条 CreateCondition（3 段追加直接攻击）
    extra = copy.deepcopy(donor_cmd)
    extra[1][2] = [copy.deepcopy(SKILL_ADDITIONAL_AC[level])]
    cc_parent.insert(cc_index + 1, extra)

    # --- 特效：全部还是官方母本路径（零克隆、零图集增量）
    paths = effect_paths(tree)
    stray = [p for p in paths if not p.startswith(OFFICIAL_EFFECT_PREFIX)]
    if stray:
        raise KuroError(f"skill {level} references non-official effect paths: {stray}")
    if len(paths) != DONOR_COMMAND_COUNTS["ShowEffect"]:
        raise KuroError(f"skill {level} has {len(paths)} effect refs, expected "
                        f"{DONOR_COMMAND_COUNTS['ShowEffect']}")

    after = _command_counts(tree)
    expect_after = dict(DONOR_COMMAND_COUNTS, CreateCondition=2)
    if after != expect_after:
        raise KuroError(f"mutated skill tree {level}: commands {after} != {expect_after}")

    evidence = {
        "level": level,
        "hit_area_buff_target_as": {"before": 0, "after": HITAREA_BUFF_TARGET_AS,
                                    "slot": HITAREA_BUFF_TARGET_SLOT},
        "create_normal_attack": {"before": before_mult, "after": copy.deepcopy(cna[6])},
        "create_condition": {"direct": {"before": before_ac, "after": after_ac},
                             "additional": copy.deepcopy(SKILL_ADDITIONAL_AC[level]),
                             "target_kind": body[10], "subject": body[1]},
        "effect_refs": paths,
    }
    return tree, evidence


def donor_program(ctx, level: str) -> str:
    """母本技能程序路径：母本是 ★4 ⇒ ``rare4/``（``program_path`` 用的是本角色的 ★5）。"""
    import wf_seasonal7_common as S7C
    row = S7C.csv_split(ctx.official_flat(CHARACTER)[str(TEMPLATE_ID)])[0]
    rarity = row[2]
    if rarity != "4":
        raise KuroError(f"template {TEMPLATE_ID} rarity {rarity!r} != '4' (donor path would drift)")
    return f"battle/action/skill/action/rare{rarity}/{TEMPLATE_CODE}${TEMPLATE_CODE}_{level}"


# ------------------------------------------------------------------ 固有状态图标

def draw_icon(frame):
    """48×48「骰运」图标：8× 画 + LANCZOS 缩，**alpha 一格不改**（沿用官方画框 donor）。

    夜靛底 ``#221E1A`` ＋ 2px 金边，正中一颗立体金骰子（五点面朝前，点 ``#FFF4C0``），
    骰子左上挑一弯极细月牙。四角透明由 ``frame`` 的 alpha 保证。
    """
    from PIL import Image, ImageDraw

    if frame.size != (48, 48):
        raise KuroError(f"unique_condition icon frame is {frame.size}, expected (48, 48)")
    scale = ICON_SCALE
    size = 48 * scale
    canvas = Image.new("RGB", (size, size), ICON_INK)
    draw = ImageDraw.Draw(canvas)

    def box(x0, y0, x1, y1):
        return [x0 * scale, y0 * scale, x1 * scale, y1 * scale]

    # 金边：2px（1× 口径）的圆角外框
    draw.rounded_rectangle(box(0, 0, 47.9, 47.9), radius=10 * scale,
                           outline=ICON_GOLD, width=2 * scale)
    # 月牙：整圆挖掉一个偏移的圆 ⇒ 极细的一弯，压在骰子左上、由骰子盖住一角
    draw.ellipse(box(3.5, 3.0, 15.0, 14.5), fill=ICON_PIP)
    draw.ellipse(box(5.9, 1.4, 17.4, 12.9), fill=ICON_INK)
    # 骰子：背光面（偏移一点的暗金）→ 骰身 → 受光面
    draw.rounded_rectangle(box(14.2, 14.6, 36.0, 36.4), radius=5 * scale, fill=ICON_GOLD_DARK)
    draw.rounded_rectangle(box(13.0, 13.4, 34.8, 35.2), radius=5 * scale, fill=ICON_GOLD)
    draw.rounded_rectangle(box(14.4, 14.8, 33.4, 24.0), radius=3 * scale, fill=ICON_GOLD_LIGHT)
    # 五点面：四角 + 正中
    for cx, cy in ((18.4, 18.8), (29.4, 18.8), (23.9, 24.3), (18.4, 29.8), (29.4, 29.8)):
        draw.ellipse(box(cx - 2.1, cy - 2.1, cx + 2.1, cy + 2.1), fill=ICON_PIP)

    small = canvas.resize((48, 48), Image.LANCZOS)
    out = small.convert("RGBA")
    out.putalpha(frame.getchannel("A"))
    return out


def install_unique_icon(ctx) -> dict[str, Any]:
    """把「骰运」图标写进包。像素代理已经交付同路径的件时原样保留，不覆盖。

    manifest 门禁要求被表引用的资产在 ``roots.common`` 里声明 ⇒ 这张图必须进包
    （引用官方路径过不了门禁）。
    """
    import hashlib

    staged = ctx.pack.pkg_path("common", UNIQUE_ICON_LOGICAL)
    owner = (ctx.pack.owned_record("common", UNIQUE_ICON_LOGICAL) or {}).get("owner")
    if staged.is_file() and owner == "pixel":
        data = staged.read_bytes()
        return {"logical": UNIQUE_ICON_LOGICAL, "source": "pixel", "owner": owner,
                "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}

    raw = ctx.official_read(UNIQUE_ICON_FRAME)
    if raw is None:
        raise KuroError(f"official baseline lacks the icon frame donor {UNIQUE_ICON_FRAME}")
    frame = ctx.png_open(raw)
    data = ctx.png_store_bytes(draw_icon(frame))
    ctx.write_asset("common", UNIQUE_ICON_LOGICAL, data)
    back = ctx.png_open(staged.read_bytes())
    if back.size != (48, 48):
        raise KuroError(f"unique_condition icon is {back.size}, expected (48, 48)")
    if back.getchannel("A").tobytes() != frame.getchannel("A").tobytes():
        raise KuroError("unique_condition icon alpha differs from the official frame donor")
    return {"logical": UNIQUE_ICON_LOGICAL, "source": "kit", "frame_donor": UNIQUE_ICON_FRAME,
            "size": list(back.size), "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "why": "kit 自画（PIL 8× + LANCZOS，alpha 沿用官方画框）。像素代理若交付同路径的件，"
                   "install_staged_assets 会以 owner=pixel 写进去，本函数就不再覆盖"}


# ------------------------------------------------------------------ 自查断言

def guard_rows(leader_rows, ability_rows) -> dict[str, Any]:
    """裁决 §8 / 设计稿 §14 的两条硬自查：724 只在 ability 表；词条里没有 201/202/521。"""
    for index, row in enumerate(leader_rows):
        hit = [row[col] for col in LEADER_KIND_COLUMNS if row[col] in ABILITY_ONLY_KINDS]
        if hit:
            raise KuroError(f"leader#{index}: kind {hit} 只许写 ability 表，写进队长表 = C7050")
    for key, rows in ability_rows.items():
        for index, row in enumerate(rows):
            hit = [row[col] for col in ABILITY_KIND_COLUMNS if row[col] in C2308_KINDS]
            if hit:
                raise KuroError(f"ability {key}#{index}: kind {hit} 会与取最大值类撞 C2308")
    patch_rows = [f"{key}#{index}" for key, rows in ability_rows.items()
                  for index, row in enumerate(rows)
                  if any(row[col] == "724" for col in ABILITY_KIND_COLUMNS)]
    if patch_rows != ["1399913#0"]:
        raise KuroError(f"724 rows {patch_rows} != ['1399913#0']")
    return {"ability_only_kinds": list(ABILITY_ONLY_KINDS), "leader_clean": True,
            "c2308_kinds_absent": list(C2308_KINDS), "kind_724_rows": patch_rows}


# ------------------------------------------------------------------ 设计稿互校

def _norm_donor(text: str) -> str:
    """设计稿的 donor 写法（``151171#L2`` / ``live 1499893#L2`` / ``… + …``）→ kit 写法。"""
    text = text.strip()
    prefix = ""
    if text.startswith("live "):
        prefix, text = "live:", text[5:].strip()
    text = text.split(" +")[0].strip()
    key, _, suffix = text.partition("#")
    if suffix.startswith("L"):
        suffix = str(int(suffix[1:]) - 1)
    return prefix + (f"{key}#{suffix}" if suffix else key)


def design_crosscheck(ctx) -> dict[str, Any]:
    """设计稿在场时逐条互校（身份 / 文案 / 17 行 donor·面板文案 / 雕像组 / 能量 / 倍率 / 语音路由）。

    设计稿在 gitignore 的 ``work/`` 下，缺失时只记一条 note，不阻塞构建。
    """
    path = MS.design_path(ctx.root, KEY)
    if not path.is_file():
        return {"design_json": str(path), "present": False,
                "note": "设计稿不在（work/ 未恢复）：本次以 kit 模块内联方案为准"}
    design = json.loads(path.read_text(encoding="utf-8"))
    problems: list[str] = []

    for name, want in (("key", KEY), ("cid", CID), ("code", CODE)):
        if design.get(name) != want:
            problems.append(f"{name} = {design.get(name)!r}, kit says {want!r}")
    for name, want in TEXTS.items():
        if design.get("texts", {}).get(name) != want:
            problems.append(f"texts.{name} drifted from the design")

    plan = design.get("plan", {})

    add = plan.get("unique_conditions", {}).get("add", [])
    if len(add) != 1 or add[0].get("key") != UID:
        problems.append(f"design unique_conditions {[a.get('key') for a in add]} != [{UID!r}]")
    elif add[0].get("row", [None] * 5)[4] != UNIQUE_CAP:
        problems.append(f"design unique cap {add[0]['row'][4]!r} != {UNIQUE_CAP!r}")

    rows = plan.get("leader_ability", {}).get("rows", [])
    if len(rows) != len(LEADER):
        problems.append(f"design has {len(rows)} leader rows, kit has {len(LEADER)}")
    for row, (donor, _cells, expect) in zip(rows, LEADER):
        if _norm_donor(str(row.get("donor"))) != donor:
            problems.append(f"leader #{row.get('index')}: donor {row.get('donor')!r} != {donor!r}")
        if row.get("desc_expected") != expect:
            problems.append(f"leader #{row.get('index')}: desc_expected drifted")

    keys = plan.get("ability", {}).get("keys", {})
    if sorted(keys) != sorted(ABILITY):
        problems.append(f"design ability keys {sorted(keys)} != kit {sorted(ABILITY)}")
    for key, records in ABILITY.items():
        entry = keys.get(key, {})
        if entry.get("statue_group") != STATUE_GROUPS[key]:
            problems.append(f"ability {key}: design statue_group {entry.get('statue_group')!r} "
                            f"!= {STATUE_GROUPS[key]!r}")
        designed = entry.get("records", [])
        if len(designed) != len(records):
            problems.append(f"ability {key}: design has {len(designed)} records, "
                            f"kit has {len(records)}")
        for record, (donor, _cells, expect) in zip(designed, records):
            if _norm_donor(str(record.get("donor"))) != donor:
                problems.append(f"ability {key}#{record.get('index')}: "
                                f"donor {record.get('donor')!r} != {donor!r}")
            if record.get("desc_expected") != expect:
                problems.append(f"ability {key}#{record.get('index')}: desc_expected drifted")

    skills = plan.get("skills", {})
    for level, (c4, c5) in SKILL_ENERGY.items():
        energy = skills.get("energy", {}).get(level, {})
        if (str(energy.get("c4")), str(energy.get("c5"))) != (c4, c5):
            problems.append(f"action_skill {level}: energy {energy!r} != {(c4, c5)!r}")
    changes = {change.get("id"): change for change in skills.get("changes", [])}
    if changes.get("S1", {}).get("new") != HITAREA_BUFF_TARGET_AS:
        problems.append(f"skill S1 new {changes.get('S1', {}).get('new')!r} "
                        f"!= {HITAREA_BUFF_TARGET_AS!r}")
    for level in ("1", "2"):
        want_old, want_new = SKILL_MULTIPLIER[level]
        got = changes.get("S2", {})
        if got.get("old", {}).get(level) != want_old or got.get("new", {}).get(level) != want_new:
            problems.append(f"skill S2 level {level}: multiplier drifted from the design")
        want_old_ac, want_new_ac = SKILL_DIRECT_AC[level]
        got = changes.get("S3", {})
        if got.get("old", {}).get(level) != want_old_ac or got.get("new", {}).get(level) != want_new_ac:
            problems.append(f"skill S3 level {level}: AC drifted from the design")
        got = changes.get("S4", {}).get("new", {}).get(level)
        if not isinstance(got, list) or got[2] != [SKILL_ADDITIONAL_AC[level]]:
            problems.append(f"skill S4 level {level}: AC drifted from the design")

    route = design.get("voice", {}).get("route", {})
    if {k: str(v) for k, v in route.items()} != {k: str(v) for k, v in VOICE_ROUTE.items()}:
        problems.append(f"voice route {route!r} != {VOICE_ROUTE!r}")

    if problems:
        raise KuroError("design/kuro.json disagrees with the kit: " + "; ".join(problems))
    return {"design_json": str(path), "present": True, "checked": [
        "identity", "texts", "unique_condition", "leader donors + panel text",
        "ability donors + panel text", "statue_group", "skill energy",
        "skill S1/S2/S3/S4", "voice route"]}


# ------------------------------------------------------------------ build

def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.key, str(spec.cid), spec.code, spec.element) != (KEY, CID_S, CODE, ELEMENT):
        raise KuroError(f"spec identity mismatch: {spec.key}/{spec.cid}/{spec.code}/{spec.element}")
    if spec.template_code != TEMPLATE_CODE or str(spec.template_id) != str(TEMPLATE_ID):
        raise KuroError(f"spec template mismatch: {spec.template_id}/{spec.template_code}")
    if spec.rarity != 5 or spec.pf_type != PF_TYPE or spec.stance != STANCE:
        raise KuroError(f"spec rarity/pf/stance mismatch: "
                        f"{spec.rarity}/{spec.pf_type}/{spec.stance}")
    if UID != f"{CID}01" or len(UID) != 8:
        raise KuroError(f"unique_condition id {UID!r} must be 8 digits cid*100+n")

    notes: list[Any] = [design_crosscheck(ctx)]
    evidence: list[dict[str, Any]] = []

    # ---- 1) 像素/特效交付件（先装：固有状态图标要不要回落取决于它）
    pixel = KL.install_staged_assets(ctx)

    # ---- 2) 固有状态「骰运」（图标先进包：manifest 门禁要求被引用的资产在 roots.common 里）
    icon_note = install_unique_icon(ctx)
    unique_key, unique_row = KL.unique_row(
        ctx, spec, 1, donor=UNIQUE_DONOR,
        cells={0: f"unique_{CODE}_dice_luck", 3: "99999999", 4: UNIQUE_CAP},
        name=UNIQUE_NAME, icon=UNIQUE_ICON)
    if unique_key != UID:
        raise KuroError(f"unique key {unique_key!r} != {UID!r}")
    KL.write_unique(ctx, spec, {unique_key: unique_row})

    # ---- 3) character 行：语音路由 c9–c16 ＋ 队长技名 c18
    crow = list(ctx.pack.pkg_character_row())
    expect_cols = {0: CODE, 2: "5", 3: str(ELEMENT), 6: str(PF_TYPE), 8: CODE,
                   17: CID_S, 26: STANCE, 27: CID_S}
    for index, col in enumerate(range(19, 25)):
        expect_cols[col] = f"{CID_S}{index + 1}"
    drift = {i: (crow[i], v) for i, v in expect_cols.items() if crow[i] != v}
    if drift:
        raise KuroError(f"package character row differs from spec (rerun tables): {drift}")
    route = KL.voice_route(CODE, VOICE_ROUTE)
    crow[9:17] = route
    crow[18] = TEXTS["leader"]
    ctx.write_flat(CHARACTER, {CID_S: [crow]})

    # ---- 4) 队长技 4 行
    leader_rows = []
    for index, (donor, cells, expect) in enumerate(LEADER):
        row, ev = KL.build_row(ctx, "leader_ability", donor, cells,
                               expect_describe=expect, label=f"leader#{index}")
        leader_rows.append(row)
        evidence.append(ev)

    # ---- 5) 词条 6 键 13 条
    ability_rows: dict[str, list[list[str]]] = {}
    for key, records in ABILITY.items():
        built = []
        for index, (donor, cells, expect) in enumerate(records):
            source, _, donor_key = donor.partition("live:")
            source, donor_key = ("live", donor_key) if donor_key else ("official", source)
            row, ev = KL.build_row(ctx, "ability", donor_key, cells, source=source,
                                   element=ELEMENT, expect_describe=expect,
                                   label=f"{key}#{index}")
            ev["source"] = source
            built.append(row)
            evidence.append(ev)
        KL.check_ability_key(built, key, CODE, int(key[-1]))
        if built[0][2] != STATUE_GROUPS[key]:
            raise KuroError(f"ability {key}: c2 {built[0][2]!r} != {STATUE_GROUPS[key]!r}")
        ability_rows[key] = built

    guards = guard_rows(leader_rows, ability_rows)
    ctx.write_flat(KL.LEADER, {CID_S: leader_rows})
    ctx.write_flat(KL.ABILITY, ability_rows)

    # ---- 6) 面板文案规则（队长 + 词条 + 技能名/说明 + 称号 + 简介）
    panel = [ev["describe"] for ev in evidence]
    for text in panel:
        KL.check_panel(text, label="panel row")
    for name in ("title", "skill1", "desc1", "skill2", "desc2", "leader", "profile"):
        KL.check_panel(TEXTS[name], label=f"texts.{name}")

    # ---- 7) action_skill：名称 / 描述 / 能量（其余列断言与母本一致）
    inner = ctx.pkg_nested(CODE, ACTION)
    if sorted(inner) != ["1", "2"]:
        raise KuroError(f"package action_skill inner keys {sorted(inner)} != ['1', '2']")
    new_inner: dict[str, list[list[str]]] = {}
    for level, cells in sorted(inner.items()):
        cells = list(cells)
        if len(cells) != 24:
            raise KuroError(f"action_skill {level}: {len(cells)} columns, expected 24")
        if cells[7] != ctx.program_path(level):
            raise KuroError(f"action_skill {level}: program {cells[7]!r} "
                            f"!= {ctx.program_path(level)!r}")
        if cells[2:4] != ["dynamic/skill/atk_surround", "true"]:
            raise KuroError(f"action_skill {level}: targeting columns changed {cells[2:4]}")
        if cells[8:17] != ["1", "0", "270", "", "0", "0", "", "", "(None)"]:
            raise KuroError(f"action_skill {level}: c8–c16 differ from the template {cells[8:17]}")
        if any(cells[17:]):
            raise KuroError(f"action_skill {level}: c17+ not empty {cells[17:]}")
        cells[0] = TEXTS[f"skill{level}"]
        cells[1] = TEXTS[f"desc{level}"]
        cells[4], cells[5] = SKILL_ENERGY[level]
        if cells[6] != "1":
            raise KuroError(f"action_skill {level}: c6 {cells[6]!r} != '1'")
        new_inner[level] = [cells]
    ctx.write_nested(ACTION, CODE, new_inner, replace_inner=True)

    # ---- 8) 技能 DSL 两档（官方 donor 树改参数；写后从包里回读比对）
    skill_evidence = []
    programs = []
    for level in ("1", "2"):
        source = donor_program(ctx, level)
        tree, ev = mutate_tree(ctx.template_dsl(source), level)
        logical = ctx.write_dsl(ctx.program_path(level), tree)
        back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
        if back != tree:
            raise KuroError(f"skill {level}: package DSL read-back differs from the written tree")
        ev["logical"] = logical
        ev["donor_program"] = source
        skill_evidence.append(ev)
        programs.append(logical)

    # ---- 9) 语音路由目标
    switched = KL.write_voice_ready(ctx)
    lut_path = KL.pixel_dir(ctx) / "fx_lut.json"
    if lut_path.is_file():
        notes.append({"fx_lut": str(lut_path),
                      "unused": "本角色技能特效全部直接引用官方母本路径（零克隆），包内没有可换色的"
                                "特效件；要改色须先改设计稿 §8 改成 clone_effect_family 并重跑图集预检"})

    ctx.sync_character_mirrors()

    ctx.evidence_write("kit-rows.json", {
        "leader": [{"donor": donor, "cells": {str(k): v for k, v in cells.items()},
                    "describe": expect} for donor, cells, expect in LEADER],
        "ability": {key: {"statue_group": STATUE_GROUPS[key],
                          "records": [{"donor": donor,
                                       "cells": {str(k): v for k, v in cells.items()},
                                       "describe": expect}
                                      for donor, cells, expect in records]}
                    for key, records in ABILITY.items()},
        "unique_condition": {unique_key: unique_row},
        "guards": guards,
        "rows": evidence,
    })
    ctx.evidence_write("kit-skills.json", {"programs": programs, "levels": skill_evidence})

    notes.extend([
        {"voice_route": route, "switched_action_skill": switched,
         "why": "kind 1 ConditionExist / 条件种类 28（固有状态）/ 条件 id 13999101「骰运」："
                "首次技能后骰运常驻 ⇒ 开局与开局后各听得到一种「技能准备好」台词"},
        {"unique_condition": {unique_key: {"row": unique_row, **icon_note}}},
        {"pixel_install": pixel},
        {"statue_group": STATUE_GROUPS,
         "why": "裁决 §8：一键内 c2 必须单值。选组规则＝该键每个 kind 在官方基线上都有这一组的"
                "先例，多候选取「最小先例数最大」的。attack_yellow 在 D1/I0/D3/I226/I69 上官方"
                "全是零行 ⇒ 不能当统一组"},
        {"guards": guards,
         "why": "422/724/713 写进队长表 = C7050（裁决 §2、框架 §10.3）；词条里没有 201/202/521 "
                "⇒ 不会撞 C2308（段数统一走技能 DSL）"},
        {"effects": "零克隆：4 条 ShowEffect 全部引用官方 "
                    f"{OFFICIAL_EFFECT_PREFIX}*（开碗/摇碗旋转/金纸吹雪/收碗），"
                    "包内不含 battle/effect 目录 ⇒ 图集增量 0"},
        {"skill_damage_type": "CreateHitArea params[23] = 4：15 段按直接攻击伤害判定 ⇒ "
                              "吃直击伤害 UP／攻击力／雷耐性降低，不吃技能伤害 UP 与 410",
         "precedent": "live 169992 blackflower_wiz_yukata 两档各两处判定区实读 = 4"},
        {"skill_team_buff": {"direct_damage_up": {lv: SKILL_DIRECT_AC[lv][1][1:] for lv in ("1", "2")},
                             "additional_direct_attack": {lv: SKILL_ADDITIONAL_AC[lv][1:]
                                                          for lv in ("1", "2")}},
         "why": "选择器 33 = 队伍全员及协力球，是词条 t5 够不到的覆盖面；3 段让全队的 Fever 点／"
                "连击／「编成直接攻击≥N」计数一起 ×3，回喂 724 与骰运"},
        {"patch_kind": "724（kyubi-fever-ratio-v1）只出现在 1399913#0，donor 取 live 1499893#1"
                       "（自制 149989 希尔媞·校园）——724 是 APK 补丁 kind，官方全表零行，"
                       "没有官方 donor 可抄；行的合法性与面板文案已由 wf_client_legality 与 "
                       "wf_describe 逐行核过"},
    ])

    deviations = [
        {"want": "设计稿按记录分别给 c2 雕像组（1399911 action_skill/attack_yellow、"
                 "1399912 attack_yellow/attack_common、1399913 special/attack_yellow/action_skill、"
                 "1399915 attack_yellow/special、1399916 attack_yellow×2）",
         "got": f"每键单值：{STATUE_GROUPS}（设计稿 md/json 已同步改，登记为 D7）",
         "why": "裁决 §8「ability 表 c2 statue_group 每个键必须单值（官方 790 个多记录键 0 个混用）」，"
                "KL.check_ability_key 也硬卡这条。attack_yellow 在本套件用到的 D1/I0/D3/I226/I69 上"
                "官方全是零行，不能当统一组"},
        {"want": "设计稿 json 的 cells 只写要改的列",
         "got": "把 md §4 说的「清空前置/触发块」显式写进 cells（空串）：1399915#0 c9/c10/c11、"
                "1399915#1 c11、1399916#0 c9/c10/c11、1399916#1 c30/c31/c34/c36（登记为 D8）",
         "why": "donor 的块参数列在 kind 改成 0 之后仍留在行里。1399916#1 实测 describe 渲染成"
                "「风·开局≥6(限1次) → 赋予全队(雷) 麻痹无效」，与登记文案不符（裁决 §3）；"
                "另外三条 describe 虽不变，但留着母本的 600000/White/Yellow 是死数据"},
        {"want": "固有状态图标由像素代理交付（设计稿 §5 的夜靛金骰子）",
         "got": f"kit 自画并写进包（{UNIQUE_ICON_LOGICAL}，source = {icon_note['source']}；"
                "登记为 D9）：PIL 8× 画 + LANCZOS 缩，alpha 与尺寸沿用官方画框 "
                f"{UNIQUE_ICON_FRAME}",
         "why": "manifest 门禁要求被表引用的资产在 roots.common 里声明 —— 引用官方路径当回落"
                "直接红（实测 validate_manifest: referenced asset is not declared）。"
                "像素代理若交付同路径的件，install_staged_assets 以 owner=pixel 写进去，"
                "kit 就不再覆盖（install_unique_icon 判 owner）"},
        {"want": "技能 DSL 的 3 段追加直接攻击发给选择器 33（队伍全员及协力球）",
         "got": "照做，但登记为本套件最大的机制风险（设计稿 R1）",
         "why": "官方 20 处 ACAdditionalDirectAttack 全是 subject -17／2 段；>2 段且发给一群人的"
                "先例只有 live 149988 scutum_valentine（5 段、选择器 82、付与种类 3）。真机不成立时"
                "退到 2 段（伤害总量不变，只少掉计数 ×3），再退就删 S4 并把 1399912#1 的 D73 改成 D4"},
    ]

    # ---- 10) 放行闸：kit 自有产物（17 行 / 固有 / 图标 / 2 棵 DSL / 语音路由）全部就绪后，
    #          只等像素代理的小人件。像素件未到之前保持 draft（批内同口径，见 mia/nicola/rebecca）。
    gate = {"rows": len(evidence), "programs": len(programs),
            "unique_condition": unique_key, "unique_icon": icon_note["source"],
            "pixel_present": pixel["present"],
            "pixel_missing": [entry["logical"] for entry in pixel["skipped"]]}
    ready = bool(pixel["present"]) and not pixel["skipped"]
    gate["reason"] = "kit 自有产物全部过闸" if ready else (
        f"像素成品未就绪：{gate['pixel_missing'] or 'B/pixel/kuro/install.json 不存在'}"
        "（行/固有/图标/DSL/语音路由已全部就绪，像素件一落地重跑 kit 即 ready-for-review）")
    notes.append({"gate": gate})

    return KL.report(
        ctx,
        summary="黑（139991）：雷 · 拳 · 直击辅助——Fever 中把全队直击的倍率与段数一起抬起来，"
                "再用 3 段直击回喂 724 Fever 回转与固有「骰运」",
        status=KL.READY if ready else KL.DRAFT,
        panel=panel,
        notes=notes,
        programs=programs,
        unique_condition={unique_key: icon_note},
        required_capabilities=SPEC["required_capabilities"],
        deviations=deviations,
        extra={"statue_group": STATUE_GROUPS,
               "guards": guards,
               "gate": gate,
               "skills": {"programs": programs,
                          "energy": {lv: list(v) for lv, v in SKILL_ENERGY.items()},
                          "multiplier": {lv: SKILL_MULTIPLIER[lv][1] for lv in SKILL_MULTIPLIER},
                          "hit_area_buff_target_as": HITAREA_BUFF_TARGET_AS,
                          "team_conditions": ["ACDirectDamage", "ACAdditionalDirectAttack"]}},
    )
