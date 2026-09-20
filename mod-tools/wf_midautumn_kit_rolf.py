# -*- coding: utf-8 -*-
"""中秋批次 kit：罗尔夫·中秋 149986 ``black_wolf_knight_moon``（风属性直击输出核心）。

rework1（2026-09-21，作者目标面板 ``rework1/panel/rolf.json``）把旧的「纯词条速度固定／贯通」
套件改写成**冲刺 × 速度固定 × 连击**三线咬合的风直击主 C：

* **增益延长线**：队长位 ``IC 156 BuffExtend`` ＋ ``190 PiercingExtend`` ＋ ``690 FixedSpeedUpExtend``
  三条并写 ＋100%（``_deviations.json`` rolf 第 1 条的「双保险」）；
* **冲刺线**：两条 ``422 DashParameter``（CD −33% ＋ Swift 数值抵消 +234.5%）落 ability 表、
  挂前置 42（Leader），文案由 ``desc_override_black_wolf_knight_moon`` 在队长块接管
  （422 写队长表 = 角色页 C7050，记忆 ``wf-dash-parameter-leader-table-trap``）；
* **速度固定线**：``536`` 开的强化分支把技能树的 ``ACFixedSpeed`` 写成 ``[帧, 4, 0, 1]``
  （速度 4 档、充能不衰减）；``IT 246`` 每持续 1 秒叠自身攻击力/直击伤害；
* **连击线**：强化分支的 ``CreateNormalAttack tree[8]=true`` 吃连击成长；``IT 12`` 每 500 连击
  用 ``629`` 调新建的 ``ability_skill_…_encore`` 追击树、每 100 连击 ``226`` 加 50 连击；
* **段数线**：``IC 202 DirectAttack3`` t5＋风 常驻 ＋200%（全批统一 3 段，主 C 的 % ≥ 辅助）。

本轮**不新建固有状态**（面板没有一条需要层数型状态）⇒ 不画 48×48 图标；
特效仍然直接引用官方 ``black_wolf_knight_wt23`` 三件，零克隆零图集增量。

施工单 = ``work/character_packs/midautumn-20260920/rework1/impl/rolf.md``；
设计镜像 = ``design/rolf.json`` 的 ``rework1`` / ``plan_rework1``（旧 ``plan`` 保留作历史）。
不碰 live store / ``assets/`` / ``.cdn`` / 设备 / 存档；不碰 179999 wt26 与官方 111007 / 141159 的键。
由 ``python mod-tools/wf_midautumn_build.py --char rolf --step kit`` 调用 :func:`build`。
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import wf_client_legality as L  # noqa: E402
import wf_dsl  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402

KitError = KL.KitError

KEY = "rolf"
CID, CID_S = 149986, "149986"
CODE = "black_wolf_knight_moon"
ELEMENT = 3                                      # 内部 ElementKind：3 = 风（Green）
ELEMENT_TOKEN = "Green"
TEMPLATE_ID, TEMPLATE_CODE = 141159, "black_wolf_knight_wt23"
PF_TYPE, STANCE = 0, "Attacker"                  # c6 母本原值；c26 直击主 C ⇒ Attacker

ABILITY_KEYS = tuple(f"{CID}{slot}" for slot in range(1, 7))
LEADER_ROWS = 7
ABILITY_RECORDS = 18

# ---------------------------------------------------------------- 自有字符串键
CAS_FLAG = f"change_skill_{CODE}"                      # A3#3 的 536 面板条目
# 629 追击程序键：**不用完整 code**。`ability_skill_black_wolf_knight_moon_encore` 会让
# 包内路径 `…/ability_skill/<键>$<键>.action.dsl.amf3.deflate` 超过 Windows 260 字符上限，
# `--step inspect` 往临时目录复制时直接 WinError（20260921 实测）。长度对齐 kyle 的
# `ability_skill_kyle_moon_pierce`（30 字符）。
CAS_ENCORE = "ability_skill_wolf_moon_encore"        # A3#4 的 629 追击
CAS_LEADER = f"desc_override_{CODE}"                   # 队长块整体接管
CAS_ABILITY = {slot: f"desc_override_{CODE}_{slot}" for slot in range(1, 7)}

ENCORE_PROGRAM = f"battle/action/skill/action/ability_skill/{CAS_ENCORE}${CAS_ENCORE}"

VOICE_KEY = KL.switch_key(CODE)                  # black_wolf_knight_moon_voice_ready
# kind 1 = ConditionExist；c10=31 贯通、c11=0。普莉姆拉 169992 已上线同形。
VOICE_ROUTE_COLS = ["1", "31", "0", "", "", VOICE_KEY, "false", "false"]

SPEC = {
    # 旧套件是「零补丁」；rework1 起需要 422 冲刺参数与面板文案接管两项
    # （两项本批 hibiki / kyle 都在用，已安装客户端具备）。
    "required_capabilities": ("dash-parameter-v1", "panel-description-override-v2"),
    "extra_keys": {
        KL.CAS: (CAS_FLAG, CAS_ENCORE, CAS_LEADER,
                 *(CAS_ABILITY[slot] for slot in range(1, 7))),
        KL.SWITCHED: (VOICE_KEY,),
    },
}

# ---------------------------------------------------------------- 行计划
# 形状：(donor 地址, donor 来源, {列号: 值}, 预期 wf_describe 回读)。
# 列号 0 基；donor 的 ``#N`` 也是 0 基。ability 126 列 / leader 124 列（leader 在 c3 之后逐列 −2）。

#: ability 前置 1/2：风共鸣（官方常规编成门 kind 2，6 人；作者 09-21 00:5x「都是属性共鸣」）
_PRE_RESONANCE_A = {6: "2", 9: "600000", 10: "600000", 11: ELEMENT_TOKEN}
_PRE_RESONANCE_A2 = {13: "2", 16: "600000", 17: "600000", 18: ELEMENT_TOKEN}
#: ability 前置 1：持有者为队长（422 的隔离手段，卡 A §2.2；一场只有一个队长 ⇒ 不会互相叠加）
_PRE_LEADER_A = {6: "42"}
#: leader 前置 1：风共鸣
_PRE_RESONANCE_L = {4: "2", 7: "600000", 8: "600000", 9: ELEMENT_TOKEN}

#: 「每造成 100 次直击」= IT 20 MemberDirectAttack，puller '7' ＋元素组（属性合计，卡 B §1.3）
_DIRECT_100 = {25: "20", 26: "7", 27: ELEMENT_TOKEN,
               28: "10000000", 29: "10000000", 32: "(None)", 33: "0"}
_DIRECT_100_A = {27: "20", 28: "7", 29: ELEMENT_TOKEN,
                 30: "10000000", 31: "10000000", 34: "(None)", 35: "0"}

LEADER: tuple[tuple[str, str, dict[int, str], str | None], ...] = (
    # ① 全体增益延长 ＋100%：156 覆盖全部正向状态，190/690 双保险（_deviations rolf #1）
    ("111005#1", "official",
     {0: CODE, **_PRE_RESONANCE_L, 47: ELEMENT_TOKEN, 49: "100000", 50: "100000"}, None),
    ("111159#1", "official",
     {0: CODE, 9: ELEMENT_TOKEN, 46: "5", 47: ELEMENT_TOKEN, 49: "100000", 50: "100000"}, None),
    ("141135#2", "official",
     {0: CODE, 46: "5", 47: ELEMENT_TOKEN, 49: "100000", 50: "100000"}, None),
    # ⑤ 风属性角色每造成 100 次直击 → 攻击力 ＋100% / 直击伤害 ＋100%（额外乘区那条在 A6#3）
    ("261053#1", "official",
     {0: CODE, **_PRE_RESONANCE_L, **_DIRECT_100, 45: "32", 46: "5", 47: ELEMENT_TOKEN,
      49: "100000", 50: "100000"}, None),
    ("261053#1", "official",
     {0: CODE, **_PRE_RESONANCE_L, **_DIRECT_100, 45: "33", 46: "5", 47: ELEMENT_TOKEN,
      49: "100000", 50: "100000"}, None),
    # ⑥ 战斗开始时：技能槽 ＋50%、技能槽最大值 ＋10%
    ("141177#0", "official",
     {0: CODE, **_PRE_RESONANCE_L, 49: "50000", 50: "50000"}, None),
    ("131122#2", "official",
     {0: CODE, 9: ELEMENT_TOKEN, 47: ELEMENT_TOKEN, 49: "10000", 50: "10000"}, None),
)

_STATUE = {1: "attack_common", 2: "attack_green", 3: "attack_common",
           4: "action_skill", 5: "hp_skill", 6: "special"}
_UNISONABLE = {1: "true", 2: "true", 3: "false", 4: "true", 5: "true", 6: "true"}

PLAN: dict[int, tuple[tuple[str, str, dict[int, str], str | None], ...]] = {
    # ---- 能力 1：冲刺叠直击 + 贯通门攻击力
    1: (
        ("2410331#0", "official",
         {**_PRE_RESONANCE_A, 30: "100000", 31: "100000", 34: "4",
          51: "50000", 52: "50000"}, None),
        ("1110072#0", "official",
         {**_PRE_RESONANCE_A, 113: "200000", 114: "200000"}, None),
    ),
    # ---- 能力 2：作者本轮未点名 ⇒ 机制与数值一格不动（donor/cells 照搬旧套件设计稿）
    2: (
        ("1411892#0", "official",
         {5: "1", 6: "0", 85: "(None)", 97: "214", 108: "false", 109: "1", 110: "5",
          111: ELEMENT_TOKEN, 113: "120000", 114: "120000"}, None),
        ("1611352#0", "official",
         {5: "1", 6: "38", 85: "(None)", 97: "204", 98: "9", 99: ELEMENT_TOKEN,
          100: "20000", 101: "20000", 102: "100", 108: "false", 109: "0", 110: "0",
          113: "1500", 114: "1500"}, None),
    ),
    # ---- 能力 3（Ⓜ）：段数 + 速度固定读秒 + 强化开关 + 两条连击触发
    3: (
        # ① 全队风 3 段、合计 ＋200%（触发 Initial ⇒ 不进 C2308；卡 B §1.1）
        ("1412012#2", "official",
         {**_PRE_RESONANCE_A, 48: "5", 49: ELEMENT_TOKEN,
          51: "200000", 52: "200000"}, None),
        # ② 速度固定每持续 1 秒（60 帧）→ 攻击力/直击各 ＋50%（IT 246，卡 B §5.3）
        ("1411531#0", "official",
         {32: "6000000", 33: "6000000", 34: "(None)", 27: "246",
          47: "32", 48: "0", 49: "", 51: "50000", 52: "50000"}, None),
        ("1411531#0", "official",
         {32: "6000000", 33: "6000000", 34: "(None)", 27: "246",
          47: "33", 48: "0", 49: "", 51: "50000", 52: "50000"}, None),
        # ③a 强化技能开关（536）：开连击成长 + 速度固定 4 档／充能 0
        ("1411113#0", "official", {70: CAS_FLAG}, None),
        # ③b 每 500 连击 → 629 追击（donor 的 CT 就是 300 帧 = 5 秒）
        ("1611053#0", "official",
         {**_PRE_RESONANCE_A, 27: "12", 28: "", 30: "50000000", 31: "50000000",
          34: "(None)", 70: CAS_ENCORE, 71: ENCORE_PROGRAM}, None),
        # ④ 每 100 连击 → 连击 ＋50（226 的 target 列官方全留空：连击是全局量）
        ("2410015#0", "official",
         {**_PRE_RESONANCE_A, 27: "12", 30: "10000000", 31: "10000000", 34: "(None)",
          35: "0", 46: "0", 47: "226", 48: "", 51: "5000000", 52: "5000000"}, None),
    ),
    # ---- 能力 4：开局技能槽 + 全队充能
    4: (
        ("1411111#0", "official",
         {**_PRE_RESONANCE_A, 51: "50000", 52: "50000"}, None),
        ("1411835#0", "official",
         {11: ELEMENT_TOKEN, 49: ELEMENT_TOKEN, 51: "10000", 52: "10000"}, None),
    ),
    # ---- 能力 5：速度固定期间的独立乘区 + 速度固定延长
    5: (
        ("1611113#0", "official",
         {6: "0", 9: "", 10: "", 11: "", 97: "214", 109: "410", 110: "5",
          111: ELEMENT_TOKEN, 113: "50000", 114: "50000"}, None),
        ("1411893#3", "official",
         {48: "5", 49: ELEMENT_TOKEN, 51: "25000", 52: "25000"}, None),
    ),
    # ---- 能力 6：碰撞回槽 + 队长位的三条承载行（422×2 / 693，不进本能力面板）
    6: (
        ("1411115#0", "official",
         {6: "0", 11: "", 34: "(None)", 35: "300", 47: "211", 48: "0",
          51: "5000", 52: "5000"}, None),
        ("1699885#1", "store",
         {**_PRE_LEADER_A, **_PRE_RESONANCE_A2, 113: "-33000", 114: "-33000", 118: "0"}, None),
        # Swift 抵消（卡 A §2.4）：during 34 的 puller 列必须留空，写 '0' = parseAt98 C7050
        ("1699885#1", "store",
         {**_PRE_LEADER_A, **_PRE_RESONANCE_A2, 97: "34", 98: "",
          113: "234500", 114: "234500", 118: "0"}, None),
        ("1299966#0", "store",
         {**_PRE_LEADER_A, **_PRE_RESONANCE_A2, **_DIRECT_100_A,
          48: "5", 49: ELEMENT_TOKEN, 51: "10000", 52: "10000"}, None),
    ),
}

#: 首建实跑出来的 ``wf_describe`` 回读，烤成逐字门禁：donor 漂移 / 描述器改版 / 改错格
#: 都会在这里当场炸。面板上真正显示的是 ``desc_override_*``（PANEL_LEADER / PANEL_ABILITY）。
EXPECT: dict[str, str] = {
    "leader#0": "风·编成≥6 时: 赋予全队(风) 增益延长 100%",
    "leader#1": "风·编成≥6 时: 赋予全队(风) 贯通延长 100%",
    "leader#2": "风·编成≥6 时: 赋予全队(风) Fixed速度↑延长 100%",
    "leader#3": "风·编成≥6 时: 编成直接攻击≥100 → 赋予全队(风) 攻击力 100%",
    "leader#4": "风·编成≥6 时: 编成直接攻击≥100 → 赋予全队(风) Direct伤害 100%",
    "leader#5": "风·编成≥6 时: 赋予全队(风) 技能槽 50%",
    "leader#6": "风·编成≥6 时: 赋予全队(风) 2号位技能槽 10%",
    "1499861#0": "风·编成≥6 时: 冲刺≥1(限4次) → 自身 Direct伤害 50%",
    "1499861#1": "风·编成≥6 时: 持续·状态贯通 → 自身 攻击力 200%",
    "1499862#0": "持续·状态Fixed速度↑ → 赋予全队(风) Direct伤害 120%",
    "1499862#1": "状态贯通 时: 持续·计数直接攻击伤害↑≥20%(限100次) → 自身 攻击力 1.5%",
    "1499863#0": "风·编成≥6 时: 赋予全队(风) DirectAttack3 200%",
    "1499863#1": "状态KeepFrameFixed速度↑≥1 → 自身 攻击力 50%",
    "1499863#2": "状态KeepFrameFixed速度↑≥1 → 自身 Direct伤害 50%",
    "1499863#3": "风·编成≥6 时: 自身 切换技能形态[change_skill_black_wolf_knight_moon]",
    "1499863#4": "风·编成≥6 时: 连击≥500(CT5秒) → 自身 "
                 "发动技能动作[ability_skill_wolf_moon_encore]",
    "1499863#5": "风·编成≥6 时: 连击≥100 → 自身 追加连击 50",
    "1499864#0": "风·编成≥6 时: 自身 技能槽 50%",
    "1499864#1": "风·编成≥6 时: 赋予全队(风) 技能槽充能 10%",
    "1499865#0": "持续·状态Fixed速度↑ → 赋予全队(风) 独立乘区Direct伤害 50%",
    "1499865#1": "赋予全队(风) Fixed速度↑延长 25%",
    "1499866#0": "Collision编成&敌方≥8(CT5秒) → 自身 技能槽 5%",
    "1499866#1": "队长 且 风·编成≥6 时: 持续·HP≤1 → 自身 冲刺参数(可调) -33%",
    "1499866#2": "队长 且 风·编成≥6 时: 持续·状态冲刺≥1 → 自身 冲刺参数(可调) 234.5%",
    "1499866#3": "队长 且 风·编成≥6 时: 编成直接攻击≥100 → 赋予全队(风) 独立乘区Direct伤害 10%",
}

# ---------------------------------------------------------------- 面板文案
# 逐行抄 rework1/panel/rolf.json（作者已过目那一版 + 本轮 dev:true 的回写）；一条记录一行，
# 用换行符分行（禁止用「／」挤成一行）。能力 3 是主位限制槽，每行都要带 MAIN_ICON 前缀，
# 格式照抄玛格诺斯 wf_midautumn_kit_magnus.py 的写法（记忆卡「覆盖文案规则」）。

MAIN_ICON = " <icon id='main'>  "   # desc_override 会盖掉客户端逐行画的 Ⓜ，主位键必须自带

PANEL_LEADER = "\n".join((
    "风属性共鸣时：全体增益效果的持续时间＋100%（包括贯穿、最大速度固定）",
    "风属性共鸣时：强化自身冲刺，冲刺冷却时间－33%",
    "风属性共鸣时：冲刺间隔缩短效果不会让自身的冲刺冷却时间进一步缩短",
    "风属性共鸣时：自身发动技能时，技能所赋予的最大速度固定效果强化至4档，且不衰减技能槽能量获取",
    "风属性共鸣时：风属性角色每造成100次直接攻击，风属性角色攻击力＋100%、直击伤害＋100%，"
    "直击伤害额外乘区＋10%",
    "风属性共鸣时：战斗开始时，风属性角色技能槽＋50%、技能槽最大值＋10%",
))

PANEL_ABILITY = {
    1: "\n".join((
        "风属性共鸣时：冲刺时，自身直接攻击伤害＋50%（最多＋200%）",
        "风属性共鸣时：自身处于贯穿效果时，自身攻击力＋200%",
    )),
    2: "\n".join((
        "自身处于最大速度固定状态时：赋予风属性角色直接攻击伤害＋120%",
        "自身处于贯穿效果时：自身直接攻击伤害提升每达＋20%（最多叠加100层），自身攻击力＋1.5%",
    )),
    3: "\n".join(MAIN_ICON + line for line in (
        "风属性共鸣时：风属性角色的直接攻击强化为3次（同类效果不叠加，取最大值），合计伤害"
        "额外乘区＋200%",
        "最大速度固定效果持续期间，每持续1秒，自身攻击力＋50%、直击伤害＋50%",
        "风属性共鸣时：强化技能，威力随连击数提升（按直接攻击伤害判定），每达成500连击 → "
        "立即对最近的敌人发动自身技能的攻击效果（不消耗技能槽，冷却时间：5秒）",
        "风属性共鸣时：每达成100连击，连击数＋50",
    )),
    4: "\n".join((
        "风属性共鸣时：自身技能槽＋50%",
        "风属性共鸣时：赋予风属性角色技能充能速度＋10%",
    )),
    5: "\n".join((
        "自身处于最大速度固定期间：风属性角色直击伤害额外乘区＋50%",
        "风属性角色的最大速度固定效果持续时间＋25%",
    )),
    6: "自身每与敌人碰撞8次 → 自身技能槽＋5%（冷却时间：5秒）",
}

CAS_TEXTS = {
    # 536 条目：裁决 §3「技能强化条目不写数字与时间」⇒ 不许出现数字、秒、%
    CAS_FLAG: "风属性共鸣时强化技能：威力随连击数提升，并把赋予的最大速度固定强化到最高档、"
              "不衰减技能槽能量获取",
    CAS_ENCORE: "立即对最近的敌人发动自身技能的攻击效果",
    CAS_LEADER: PANEL_LEADER,
    **{CAS_ABILITY[slot]: PANEL_ABILITY[slot] for slot in range(1, 7)},
}

# ---------------------------------------------------------------- 行自检

#: 写进队长表 = 角色页 C7050（422/724/713，记忆 wf-dash-parameter-leader-table-trap）；
#: 693 是「官方 0 行」的 kind，按杰拉德 v3 手册第 23 条「队长表零官方先例 kind 必崩」一并禁掉。
FORBIDDEN_LEADER_KINDS = ("422", "724", "713", "693")
#: 段数取优不相加（AdditionalDirectAttackContent.getBetter）⇒ 本套件只留 202 一个段数来源；
#: 201/521 与 during 45/46/252 一律禁，免得自己顶掉自己。713/724 本套件不用。
FORBIDDEN_ABILITY_KINDS = ("201", "521", "45", "46", "252", "713", "724")
#: 前置 kind 白名单（裁决 §8）：2 = 元素编成、38 = 状态贯通、42 = Leader。
ALLOWED_PRECONDITION_KINDS = ("", "0", "2", "38", "42")

# 行布局（puller 断言用）。
LEADER_DURING_TRIGGER, LEADER_DURING_PULLER = 95, 96
LEADER_INSTANT_KIND, LEADER_DURING_KIND = 45, 107
ABILITY_DURING_TRIGGER, ABILITY_DURING_PULLER = 97, 98
ABILITY_INSTANT_KIND, ABILITY_DURING_KIND = 47, 109
#: during 触发里「必须留空 puller」与「必须写 9＋元素组」的两组（卡 B §2.2 的 puller 契约）。
PULLER_MUST_BE_EMPTY = ("214", "30", "34")
PULLER_MUST_BE_NINE = ("204",)
#: C2308：瞬发常驻型 201/202/521 的触发必须是 Initial（InstantAbilitySource.validate）。
DIRECT_ATTACK_KINDS = ("201", "202", "521")


def _ban_kinds(kind: str, rows: list[list[str]], label: str) -> None:
    """内容 kind 黑名单 ＋ 前置白名单 ＋ 422 / 629 / 536 / 202 的硬规矩。"""
    instant_col = LEADER_INSTANT_KIND if kind == "leader_ability" else ABILITY_INSTANT_KIND
    during_col = LEADER_DURING_KIND if kind == "leader_ability" else ABILITY_DURING_KIND
    pre_cols = (4, 11, 18) if kind == "leader_ability" else (6, 13, 20)
    for index, row in enumerate(rows):
        for col in pre_cols:
            if row[col] not in ALLOWED_PRECONDITION_KINDS:
                raise KitError(f"{label}#{index}: 前置 kind {row[col]!r} 不在白名单 "
                               f"{ALLOWED_PRECONDITION_KINDS}")
        kinds = {row[instant_col], row[during_col]}
        if kind == "leader_ability":
            bad = kinds & set(FORBIDDEN_LEADER_KINDS)
            if bad:
                raise KitError(f"{label}#{index}: 队长表禁止 {sorted(bad)}（C7050）")
        else:
            bad = kinds & set(FORBIDDEN_ABILITY_KINDS)
            if bad:
                raise KitError(f"{label}#{index}: 词条表禁止 {sorted(bad)}")
        if row[instant_col] in DIRECT_ATTACK_KINDS:
            trigger = row[25 if kind == "leader_ability" else 27]
            if trigger not in ("", "0"):
                raise KitError(f"{label}#{index}: 瞬发 {row[instant_col]} 的触发必须是 Initial"
                               f"（C2308），实为 {trigger!r}")
        if kind != "ability":
            continue
        if row[ABILITY_DURING_KIND] == "422":
            if row[6] != "42":
                raise KitError(f"{label}#{index}: 422 行必须挂前置 42（持有者为队长），"
                               f"否则会与基诺维/泽赫尔的 422 相加")
            if not row[118]:
                raise KitError(f"{label}#{index}: 422 行的 c118 param_id 不能留空"
                               "（param_id 0 也要显式写 '0'）")
        if row[ABILITY_INSTANT_KIND] == "629":
            if not row[70] or not row[71]:
                raise KitError(f"{label}#{index}: 629 行必须同时带字符串键 c70 与程序路径 c71")
            if not row[35]:
                raise KitError(f"{label}#{index}: 629 行的 c35 cooltime 不能留空")
            if rows[0][1] != "false":
                raise KitError(f"{label}#{index}: 629 在副位不生效，该键必须 unisonable=false")
        if row[ABILITY_INSTANT_KIND] in KL.SKILL_FLAG_KINDS and not row[70]:
            raise KitError(f"{label}#{index}: {row[ABILITY_INSTANT_KIND]} 行必须带 c70 字符串键")


def _check_pullers(rows: list[list[str]], trigger_col: int, puller_col: int,
                   label: str) -> list[dict[str, Any]]:
    """during 触发的 puller 列：D214/D30/D34 必须留空，D204 必须写 9 ＋元素组。

    写错 ⇒ ``parseAt98`` C7050（记忆卡 wf-precondition-puller-c7050）。
    """
    seen = []
    for n, row in enumerate(rows):
        trigger = row[trigger_col]
        puller, argument = row[puller_col], row[puller_col + 1]
        if trigger in PULLER_MUST_BE_EMPTY and (puller or argument):
            raise KitError(f"{label}#{n}: during {trigger} must leave the puller empty, "
                           f"got c{puller_col}={puller!r} c{puller_col + 1}={argument!r}")
        if trigger in PULLER_MUST_BE_NINE and (puller != "9" or not argument):
            raise KitError(f"{label}#{n}: during {trigger} needs puller 9 + element group, "
                           f"got c{puller_col}={puller!r} c{puller_col + 1}={argument!r}")
        if trigger:
            seen.append({"row": n, "trigger": trigger, "puller": puller, "argument": argument})
    return seen


def _order_problems(rows: list[list[str]]) -> None:
    """629 必须排在同触发的 525 消耗行之前（本套件无 525，只做存在性断言）。"""
    consume = [n for n, row in enumerate(rows) if row[ABILITY_INSTANT_KIND] == "525"]
    invoke = [n for n, row in enumerate(rows) if row[ABILITY_INSTANT_KIND] == "629"]
    if not invoke:
        raise KitError("ability slot 3 lost the 629 encore row")
    if consume and min(consume) < max(invoke):
        raise KitError("ability slot 3: 629 必须排在同触发的 525 消耗行之前")


def statue_group_report(ctx, rows_by_key: dict[str, list[list[str]]]) -> list[dict[str, Any]]:
    """c2 雕像组 × kind 的官方先例统计（裁决 §8 的自查，**记录而非阻断**）。

    rework1 引入了 ``422`` / ``693`` 两个**官方全表 0 行**的 kind，以及唯一一行官方 629
    （``1611053#0``，组 ``special``）。c2 只喂 ``ability_statue_group`` 的颜色/图标/形象三列，
    是纯面板外观，与 kind 的解析无关；在「每个 kind 都要有同组官方先例」和「一键 c2 单值」
    之间只能二选一（202/33 在 ``special`` 下零先例、629 在 ``attack_common`` 下零先例）。
    ⇒ 这里把逐 kind 的先例条数写进 evidence 供复核，零先例的项在 ``zero_precedent`` 里列名。
    """
    instant: dict[tuple[str, str], int] = {}
    during: dict[tuple[str, str], int] = {}
    for blob in ctx.official_flat(KL.ABILITY).values():
        for raw in ctx.csv_split(blob):
            row = list(raw) + [""] * (KL.ABILITY_NCOLS - len(raw))
            group = row[2]
            if row[ABILITY_INSTANT_KIND]:
                pair = (group, row[ABILITY_INSTANT_KIND])
                instant[pair] = instant.get(pair, 0) + 1
            if row[ABILITY_DURING_KIND]:
                pair = (group, row[ABILITY_DURING_KIND])
                during[pair] = during.get(pair, 0) + 1
    report = []
    for key, rows in rows_by_key.items():
        group = rows[0][2]
        for n, row in enumerate(rows):
            for kind_col, table, tag in ((ABILITY_INSTANT_KIND, instant, "instant"),
                                         (ABILITY_DURING_KIND, during, "during")):
                kind = row[kind_col]
                if not kind:
                    continue
                report.append({"key": key, "record": n, "group": group, "trigger": tag,
                               "kind": kind, "official_rows": table.get((group, kind), 0)})
    return report


# ---------------------------------------------------------------- 表写入

def build_rows(ctx) -> dict[str, Any]:
    evidence: list[dict[str, Any]] = []
    caps: set[str] = set()

    leader_rows: list[list[str]] = []
    for index, (addr, source, cells, expect) in enumerate(LEADER):
        label = f"leader#{index}"
        row, ev = KL.build_row(ctx, "leader_ability", addr, cells, source=source,
                               expect_describe=expect or EXPECT.get(label), label=label)
        if row[0] != CODE:
            raise KitError(f"{label}: c0 {row[0]!r} != {CODE}")
        leader_rows.append(row)
        evidence.append(ev)
        caps.update(ev["capabilities"])
    if len(leader_rows) != LEADER_ROWS:
        raise KitError(f"leader plan carries {len(leader_rows)} rows, expected {LEADER_ROWS}")
    _ban_kinds("leader_ability", leader_rows, "leader")
    leader_pullers = _check_pullers(leader_rows, LEADER_DURING_TRIGGER,
                                    LEADER_DURING_PULLER, "leader")

    ability: dict[str, list[list[str]]] = {}
    ability_pullers: list[dict[str, Any]] = []
    total = 0
    for slot in range(1, 7):
        key = f"{CID}{slot}"
        rows: list[list[str]] = []
        for index, (addr, source, cells, expect) in enumerate(PLAN[slot]):
            merged = {0: f"{CODE}_{slot}", 1: _UNISONABLE[slot], 2: _STATUE[slot], **cells}
            label = f"{key}#{index}"
            row, ev = KL.build_row(ctx, "ability", addr, merged, source=source, element=ELEMENT,
                                   expect_describe=expect or EXPECT.get(label), label=label)
            rows.append(row)
            evidence.append(ev)
            caps.update(ev["capabilities"])
            total += 1
        KL.check_ability_key(rows, key, CODE, slot)
        _ban_kinds("ability", rows, key)
        ability_pullers += _check_pullers(rows, ABILITY_DURING_TRIGGER,
                                          ABILITY_DURING_PULLER, key)
        ability[key] = rows
    if total != ABILITY_RECORDS:
        raise KitError(f"ability plan carries {total} records, expected {ABILITY_RECORDS}")
    _order_problems(ability[f"{CID}3"])
    for key, rows in ability.items():
        for n, row in enumerate(rows):
            if "change_skill_" in row[70] and row[ABILITY_INSTANT_KIND] not in KL.SKILL_FLAG_KINDS:
                raise KitError(f"ability {key}#{n}: 悬空的 change_skill_ 字符串键")

    missing = sorted(caps - set(ctx.spec.required_capabilities))
    if missing:
        raise KitError(f"rows need client capabilities {missing} that SPEC does not declare")
    return {"leader": leader_rows, "ability": ability, "evidence": evidence,
            "capabilities": sorted(caps),
            "pullers": {"leader": leader_pullers, "ability": ability_pullers}}


def write_action_skill(ctx, design: dict[str, Any]) -> dict[str, list[str]]:
    """两档能量 560/560、560/510（本轮不改）；名称/描述由 tables 写，这里只核验。"""
    spec = ctx.spec
    energy = design["plan_rework1"]["skills"]["energy"]
    inner = ctx.pkg_nested(CODE)
    if set(inner) != {"1", "2"}:
        raise KitError(f"package action_skill inner keys {sorted(inner)}")
    out: dict[str, list[str]] = {}
    for level, raw in sorted(inner.items()):
        cells = list(raw)
        if len(cells) != 24:
            raise KitError(f"action_skill {level}: {len(cells)} columns, expected 24")
        if cells[7] != ctx.program_path(level):
            raise KitError(f"action_skill {level} program path drift: {cells[7]!r}")
        if cells[0] != spec.texts[f"skill{level}"] or cells[1] != spec.texts[f"desc{level}"]:
            raise KitError(f"action_skill {level}: name/desc differ from design texts (rerun tables)")
        block = energy[f"inner{level}"]
        cells[4], cells[5], cells[6] = str(block["c4"]), str(block["c5"]), str(block["c6"])
        out[level] = cells
    ctx.write_nested(KL.ACTION, CODE, {lv: [cells] for lv, cells in out.items()},
                     replace_inner=True)
    return out


def write_strings(ctx) -> dict[str, str]:
    """``custom_ability_string``：536 / 629 的条目 + 队长与 6 条能力的面板接管。"""
    declared = set(ctx.spec.extra_keys.get(KL.CAS, ()))
    missing = [key for key in CAS_TEXTS if key not in declared]
    if missing:
        raise KitError(f"custom_ability_string keys not declared in SPEC['extra_keys']: {missing}")
    for key, text in CAS_TEXTS.items():
        for line in text.split("\n"):
            KL.check_panel(line.replace(MAIN_ICON, ""),
                           skill_flag=(key == CAS_FLAG), label=key)
    for slot in range(1, 7):
        rendered = CAS_TEXTS[CAS_ABILITY[slot]].split("\n")
        wants_icon = _UNISONABLE[slot] == "false"
        if any(line.startswith(MAIN_ICON) != wants_icon for line in rendered):
            raise KitError(f"slot {slot} desc_override main-position icon does not match c1")
    official = ctx.official_flat(KL.CAS)
    clashes = [key for key in CAS_TEXTS if key in official]
    if clashes:
        raise KitError(f"custom_ability_string keys already exist officially: {clashes}")
    ctx.write_flat(KL.CAS, {key: [[text]] for key, text in CAS_TEXTS.items()})
    return dict(CAS_TEXTS)


# ---------------------------------------------------------------- DSL 工具

SUZUKA_PROGRAM = "battle/action/skill/action/rare5/silence_suzuka$silence_suzuka_2"
JIGUZA_PROGRAM = "battle/action/skill/action/rare5/mob_jiguza_playable$mob_jiguza_playable_2"
BIND_TEAM = 8          # root[1] 贯通＋最大速度固定（选择器 82 主小队）
BIND_WIND = 9          # root[2] 风属性角色直击伤害↑（选择器 113 过滤 [4]）
SELECTOR_MAIN_PARTY = 82
SELECTOR_ELEMENT = 113
#: 官方基线 940 棵技能树实读（09-20）：``ACFixedSpeed`` 的常态充能只出现过这 6 个值。
#: 强化档写 0（＝不扣能量）是作者点名要的，官方铃鹿 ``[300, 4, -0.65, 1]`` 就是速度 4。
OFFICIAL_FIXED_SPEED_CHARGES = (-0.65, -0.3, -0.2, -0.15, -0.12, -0.1)
DSL_WIND = ELEMENT + 1  # DSL 显式元素码 = 内部 + 1（记忆卡 wf-dsl-element-code-offset）

# 判定区 26 参卡：``params[23]`` = cmd[24]（伤害归属）。0 = 技能伤害、4 = 直接攻击伤害。
HIT_AREA_DAMAGE_SLOT = 24
HIT_AREA_MAXHITS_SLOT = 14
HIT_AREA_ONHIT_SLOT = 23
CNA_MULTIPLIER_SLOT = 6
CNA_COMBO_SLOT = 8      # tree[8] = enablesComboBonus ⇒ ×(1 + 连击×0.005)，无上限（卡 A §5.1）
SKILL_FLAG_INDEX = 1    # ConditionalsChangeSkillFlag 的旗号（536 = 1，704 = 2；本套件只用 1）

FX_SRC_DIR = f"battle/effect/skill_unique/{TEMPLATE_CODE}"
FX_SUBDIR = "moonlight"
FX_DST_DIR = f"battle/effect/skill_unique/{CODE}/{FX_SUBDIR}"
FX_BASES = (f"{TEMPLATE_CODE}_slash", f"{TEMPLATE_CODE}_smash", f"{TEMPLATE_CODE}_explosion")
OFFICIAL_FX_PATHS = frozenset(f"{FX_SRC_DIR}/{name}" for name in FX_BASES)


def num(value) -> int | float:
    """整数值写成 AMF3 整数，非整数才写 double（官方树的写法）。"""
    number = float(value)
    return int(number) if number.is_integer() else number


def span(low, high=None) -> list[dict[str, Any]]:
    """DSL 的 ``[{"min": x, "max": y}]`` 参数壳（裸数值进 Array 参 = F1034）。"""
    high = low if high is None else high
    return [{"min": num(low), "max": num(high)}]


def statements(tree) -> list:
    body = tree[11]
    if not (isinstance(body, list) and body and body[0] == "Block"):
        raise KitError(f"root statement block drift: {type(body)}")
    return body[1]


def command(statement):
    if isinstance(statement, list) and len(statement) == 2 and statement[0] == "Command":
        return statement[1]
    return None


def cmd(payload: list) -> list:
    return ["Command", list(payload)]


def block(payloads) -> list:
    return ["Block", [cmd(p) for p in payloads]]


def flag_branch(then_payloads, else_payloads) -> list:
    """``["ConditionalsChangeSkillFlag", 1, Block[…], Block[…]]``（官方 silence_suzuka_2 实读形状）。

    分支必须是完整 ``Block``；空分支写 ``["Block", []]``，**禁写 ``["DoNothing"]``**
    （那是 ``IfTargetNotFound`` 的枚举，进游戏 F1009，记忆卡 wf-dsl-donothing-enum-trap）。
    """
    return ["ConditionalsChangeSkillFlag", SKILL_FLAG_INDEX,
            block(then_payloads), block(else_payloads)]


def block_commands(node, slot: int) -> list:
    body = node[slot]
    if not (isinstance(body, list) and body and body[0] == "Block"):
        raise KitError(f"{node[0]} p{slot} is not a Block")
    return [command(st) for st in body[1]]


def drop_power_flip_block(tree) -> dict[str, Any]:
    """删掉母本 root[1]：``FindAllSubjects(8,34,[4]) → FindAllSubjects(9,97) → ACPowerFlipDamage``。"""
    body = statements(tree)
    if len(body) != 2:
        raise KitError(f"donor root carries {len(body)} statements, expected 2")
    node = command(body[1])
    if not node or node[0] != "FindAllSubjects" or node[1] != BIND_TEAM or node[2] != 34:
        raise KitError(f"donor root[1] is not the PF block: {node[:3] if node else body[1][:1]}")
    inner = block_commands(node, 9)
    if len(inner) != 1 or not inner[0] or inner[0][0] != "FindAllSubjects" or inner[0][2] != 97:
        raise KitError("donor root[1] inner selector drift")
    condition = block_commands(inner[0], 9)
    if len(condition) != 1 or condition[0][0] != "CreateCondition" \
            or condition[0][2][0][0] != "ACPowerFlipDamage":
        raise KitError("donor root[1] does not carry ACPowerFlipDamage")
    removed = body.pop(1)
    return {"removed_command": command(removed)[0], "freed_bindings": [BIND_TEAM, BIND_WIND]}


def retune_attacks(tree, values: dict[str, Any], *, combo: str) -> dict[str, Any]:
    """两处判定区 ``params[23] 0 → 4``，两条 CNA 改倍率，并按 ``combo`` 处理连击成长。

    ``combo="flag"``：CNA 外包 ``ConditionalsChangeSkillFlag(1)``，then 支 ``tree[8]=True``
    （536 开的强化档才吃连击成长）；``combo="always"``：629 追击树，直接 ``tree[8]=True``
    （629 行本身已挂风共鸣前置，不用再分支）。其余参数（target / element 255 / flat / 削韧 /
    Fever / incCombo）一格不动。
    """
    if combo not in ("flag", "always"):
        raise KitError(f"unknown combo mode {combo!r}")
    areas = list(wf_dsl.iter_dsl_commands(tree, "CreateHitArea"))
    if len(areas) != 2:
        raise KitError(f"donor should carry 2 CreateHitArea, got {len(areas)}")
    kind = int(values["hit_area_damage_kind"])
    by_hits: dict[int, Any] = {}
    for area in areas:
        if area[HIT_AREA_DAMAGE_SLOT] != 0:
            raise KitError(f"CreateHitArea params[23] already {area[HIT_AREA_DAMAGE_SLOT]!r}")
        area[HIT_AREA_DAMAGE_SLOT] = kind
        hits = area[HIT_AREA_MAXHITS_SLOT]
        if not (isinstance(hits, list) and hits[0] == "CalculatedUsingMaxNumOfHits"):
            raise KitError(f"CreateHitArea lifetime/hits drift: {hits!r}")
        by_hits[int(hits[1])] = area
    if sorted(by_hits) != [1, 10]:
        raise KitError(f"unexpected hit counts {sorted(by_hits)}")
    out = {"hit_area_damage_kind": kind, "multipliers": {}, "combo_bonus": combo}
    for tag, hits in (("slash", 1), ("burst", 10)):
        area = by_hits[hits]
        onhit = area[HIT_AREA_ONHIT_SLOT]
        if not (isinstance(onhit, list) and onhit and onhit[0] == "Block"):
            raise KitError(f"{tag} hit area p23 is not a Block")
        slots = [i for i, st in enumerate(onhit[1])
                 if command(st) and command(st)[0] == "CreateNormalAttack"]
        if len(slots) != 1:
            raise KitError(f"{tag} hit area carries {len(slots)} CreateNormalAttack")
        attack = command(onhit[1][slots[0]])
        if attack[2] != 255:
            raise KitError(f"{tag} CreateNormalAttack element drift: {attack[2]!r}")
        if attack[CNA_COMBO_SLOT] is not False:
            raise KitError(f"{tag} CreateNormalAttack tree[8] already {attack[CNA_COMBO_SLOT]!r}")
        low, high = values[tag]
        attack[CNA_MULTIPLIER_SLOT] = span(low, high)
        if combo == "always":
            attack[CNA_COMBO_SLOT] = True
        else:
            boosted = copy.deepcopy(attack)
            boosted[CNA_COMBO_SLOT] = True
            onhit[1][slots[0]] = cmd(flag_branch([boosted], [attack]))
        out["multipliers"][tag] = [num(low), num(high)]
    return out


def pick_command(tree, name: str, predicate) -> Any:
    for node in wf_dsl.iter_dsl_commands(tree, name):
        if predicate(node):
            return node
    raise KitError(f"donor tree has no matching {name}")


def find_statement(tree, predicate):
    """深度优先找整条 ``["Command", [...]]`` 语句（要整块 deepcopy 时用）。

    铃鹿的两块 ``FindAllSubjects(82)`` 埋在 ``ConditionalsChangeSkillFlag`` 分支里，
    不在根语句表上，所以这里必须递归。
    """
    found = []

    def walk(node) -> None:
        if found or not isinstance(node, list):
            return
        if len(node) == 2 and node[0] == "Command" and isinstance(node[1], list) \
                and node[1] and isinstance(node[1][0], str):
            if predicate(node[1]):
                found.append(node)
                return
            for child in node[1][1:]:
                walk(child)
            return
        for child in node:
            walk(child)

    walk(tree)
    if not found:
        raise KitError("donor tree has no matching statement")
    return found[0]


def make_team_block(ctx, values: dict[str, Any]):
    """铃鹿 ``silence_suzuka_2`` 的「主小队 → 贯通 ＋ 最大速度固定」整块，丢掉 ACFlying。

    ``ACFixedSpeed`` 外包 ``ConditionalsChangeSkillFlag(1)``：then 支 = 强化档
    ``[帧, 4, 0, 1]``（速度 4 档、充能 0 不衰减，面板队长技第 4 行）；else 支 = 常态档
    ``[帧, 1, -0.1, 1]``（官方最轻档）。选择器 82 = 主小队，``CreateCondition`` 下标 10
    （付与对象种类）= 3 Member，第 1 参必须等于所在 ``FindAllSubjects`` 的绑定 id。
    """
    donor = ctx.template_dsl(SUZUKA_PROGRAM)

    def has_slow_fixed_speed(node) -> bool:
        if node[0] != "FindAllSubjects" or node[2] != SELECTOR_MAIN_PARTY:
            return False
        for inner in block_commands(node, 9):
            if inner and inner[0] == "CreateCondition" and inner[2][0][0] == "ACFixedSpeed":
                return inner[2][0][2] == [{"min": 1, "max": 1}]
        return False

    statement = copy.deepcopy(find_statement(donor, has_slow_fixed_speed))
    node = statement[1]
    node[1] = BIND_TEAM
    kept, names = [], []
    for child in node[9][1]:
        inner = command(child)
        if not inner or inner[0] != "CreateCondition":
            raise KitError(f"suzuka block carries a non-CreateCondition statement: {child[:1]}")
        name = inner[2][0][0]
        if name == "ACFlying":                      # 浮游是 149950 伊尔格拉乌的轴，本角色不做
            continue
        if inner[10] != 3:
            raise KitError(f"suzuka {name}: 付与对象种类 {inner[10]} != 3 (Member)")
        inner[1] = BIND_TEAM
        frames = int(values["piercing_frames"] if name == "ACPiercing"
                     else values["fixed_speed_frames"])
        inner[2][0][1] = span(frames)
        if name == "ACPiercing":
            kept.append(child)
        elif name == "ACFixedSpeed":
            charge = float(values["fixed_speed_charge"])
            if not OFFICIAL_FIXED_SPEED_CHARGES[0] <= charge <= OFFICIAL_FIXED_SPEED_CHARGES[-1]:
                raise KitError(f"ACFixedSpeed 常态充能 {charge} 越出官方实读区间 "
                               f"{OFFICIAL_FIXED_SPEED_CHARGES[0]}~{OFFICIAL_FIXED_SPEED_CHARGES[-1]}")
            inner[2][0][2] = span(values["fixed_speed_speed"])
            inner[2][0][3] = span(charge)
            inner[2][0][4] = span(values["fixed_speed_stacks"])
            boosted = copy.deepcopy(inner)
            boosted[2][0][2] = span(values["fixed_speed_speed_boost"])
            boosted[2][0][3] = span(values["fixed_speed_charge_boost"])
            kept.append(cmd(flag_branch([boosted], [inner])))
        else:
            raise KitError(f"unexpected condition {name} in the suzuka block")
        names.append(name)
    if names != ["ACPiercing", "ACFixedSpeed"]:
        raise KitError(f"team block conditions drift: {names}")
    node[9][1] = kept
    return statement, names


def make_wind_block(ctx, values: dict[str, Any]):
    """画狂老人Z ``mob_jiguza_playable_2`` 的「风属性角色 → 直接攻击伤害↑」整块。

    ``FindAllSubjects(113, [4])`` ＋ 付与对象种类 1 是官方成对写法（113 配 1，不是 3）；
    DSL 元素码 4 = 内部 3 = 风（记忆卡 wf-dsl-element-code-offset）。
    """
    donor = ctx.template_dsl(JIGUZA_PROGRAM)

    def is_direct_damage(node) -> bool:
        if node[0] != "FindAllSubjects" or node[2] != SELECTOR_ELEMENT or node[3] != [DSL_WIND]:
            return False
        inner = block_commands(node, 9)
        return len(inner) == 1 and inner[0] and inner[0][0] == "CreateCondition" \
            and inner[0][2][0][0] == "ACDirectDamage"

    statement = copy.deepcopy(find_statement(donor, is_direct_damage))
    node = statement[1]
    node[1] = BIND_WIND
    inner = command(node[9][1][0])
    if inner[10] != 1:
        raise KitError(f"jiguza ACDirectDamage: 付与对象种类 {inner[10]} != 1")
    inner[1] = BIND_WIND
    frames = int(values["direct_damage_frames"])
    low, high = values["direct_damage"]
    inner[2][0][1] = span(frames)
    inner[2][0][2] = span(low, high)
    return statement, {"frames": frames, "value": [num(low), num(high)]}


def effect_paths(tree) -> set[str]:
    return {str(node[2][1]) for node in wf_dsl.iter_dsl_commands(tree, "ShowEffect")
            if isinstance(node[2], list) and node[2][0] == "SpecifyEffectDirectly"}


def dsl_problems(tree) -> list[str]:
    problems = [f"direction: {p}" for p in wf_dsl.player_side_dsl_problems(tree)]
    problems += [f"subject: {p}" for p in L.action_dsl_subject_binding_problems(tree)]
    problems += [f"hit_target: {p}" for p in L.action_dsl_hit_area_target_problems(tree)]
    problems += [f"element: {p}" for p in L.action_dsl_element_problems(tree, ELEMENT)]
    return problems


def write_dsl_checked(ctx, program: str, tree) -> str:
    """``write_dsl`` 只吃裸树；写后回读逐节点比对（记忆卡 wf-dsl-encode-wrapper-trap）。"""
    if not (isinstance(tree, list) and tree and tree[0] == "ActionDsl"):
        raise KitError(f"write_dsl needs a bare ActionDsl tree, got {type(tree).__name__}")
    logical = ctx.write_dsl(program, tree)
    back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
    if back != tree:
        raise KitError(f"DSL readback mismatch: {logical}")
    return logical


def donor_tree(ctx, level: str):
    program = ctx.program_path(level).replace(CODE, TEMPLATE_CODE)
    tree = copy.deepcopy(ctx.template_dsl(program))
    if tree[0] != "ActionDsl" or tree[1] != 2 or tree[10] != 0:
        raise KitError(f"skill {level} donor head drift: {tree[:2]} bta={tree[10]}")
    return tree


def check_effects(tree, family: dict[str, Any] | None, label: str) -> set[str]:
    expected = ({f"{family['dst_dir']}/{name}" for name in FX_BASES} if family is not None
                else set(OFFICIAL_FX_PATHS))
    paths = effect_paths(tree)
    if paths != expected:
        raise KitError(f"{label} effect paths drift: {sorted(paths)}")
    return paths


def build_skill_tree(ctx, level: str, values: dict[str, Any],
                     family: dict[str, Any] | None) -> tuple[Any, dict[str, Any]]:
    """母本 141159 整树 → 删 PF 块 → 两段改直击池/倍率/连击分支 → 嫁接两块状态。"""
    tree = donor_tree(ctx, level)
    removed = drop_power_flip_block(tree)
    attacks = retune_attacks(tree, values, combo="flag")

    body = statements(tree)
    before = len(body)
    team, team_names = make_team_block(ctx, values)
    wind, wind_info = make_wind_block(ctx, values)
    body.append(team)
    body.append(wind)
    if len(body) != before + 2:
        raise KitError(f"skill {level}: appended {len(body) - before} blocks, expected 2")
    if tree[10] != 0:
        raise KitError("root buffTargetAs must stay 0（自动档）")

    rewrite = None
    if family is not None:
        tree, rewrite = ctx.rewrite_effect_refs(tree, family, strict=True)
    paths = check_effects(tree, family, f"skill {level}")

    problems = dsl_problems(tree)
    if problems:
        raise KitError(f"skill {level} DSL gates failed: {problems}")
    return tree, {"level": level, "removed_power_flip": removed, "attacks": attacks,
                  "team_conditions": team_names, "wind_direct_damage": wind_info,
                  "effect_paths": sorted(paths), "effect_rewrites": rewrite,
                  "buff_target_as": tree[10]}


def strip_stop_ball(node) -> int:
    """递归删掉所有 ``StopBall``（629 每 500 连击停球 70 帧会抢走玩家操作）。"""
    removed = 0
    if isinstance(node, list):
        if node and node[0] == "Block" and isinstance(node[1], list):
            keep = []
            for child in node[1]:
                inner = command(child)
                if inner and inner[0] == "StopBall":
                    removed += 1
                    continue
                keep.append(child)
            node[1] = keep
        for child in node:
            removed += strip_stop_ball(child)
    return removed


def build_encore_tree(ctx, level: str, values: dict[str, Any],
                      family: dict[str, Any] | None) -> tuple[Any, dict[str, Any]]:
    """629 追击树：母本主块的**伤害两段**，连击成长常开，不停球、不复刻团队增益。

    施工单偏离 R-D4：复刻团队增益会让「速度固定 15 秒窗口」变成每 500 连击白嫖刷新的永续，
    远超作者写的「发动自身技能效果」。629 的伤害归属由判定区 ``params[23]=4`` 决定，
    根 ``buffTargetAs`` 保持 0（记忆卡 wf-dsl-damage-attribution-bufftargetas）。
    """
    tree = donor_tree(ctx, level)
    drop_power_flip_block(tree)
    attacks = retune_attacks(tree, values, combo="always")
    body = statements(tree)
    if len(body) != 1:
        raise KitError(f"encore donor body carries {len(body)} statements, expected 1")
    stopped = strip_stop_ball(body[0])
    if stopped != 1:
        raise KitError(f"encore tree removed {stopped} StopBall commands, expected 1")
    encore = list(copy.deepcopy(tree[:11])) + [["Block", [body[0]]]]
    if encore[10] != 0:
        raise KitError("encore root buffTargetAs must stay 0")

    rewrite = None
    if family is not None:
        encore, rewrite = ctx.rewrite_effect_refs(encore, family, strict=True)
    paths = check_effects(encore, family, "encore")

    problems = dsl_problems(encore)
    if problems:
        raise KitError(f"encore DSL gates failed: {problems}")
    return encore, {"level": level, "attacks": attacks, "stop_ball_removed": stopped,
                    "effect_paths": sorted(paths), "effect_rewrites": rewrite,
                    "team_blocks": 0, "buff_target_as": encore[10]}


# ---------------------------------------------------------------- 设计镜像

def load_design(root: Path | None = None) -> dict[str, Any]:
    design = MS.load_design(Path(root) if root is not None else Path("."), KEY)
    if not design:
        raise KitError(f"design/{KEY}.json missing (batch {MS.BATCH_DIR})")
    if (design.get("schema"), design.get("cid"), design.get("code")) != ("ma-design/1", CID, CODE):
        raise KitError(f"design identity drift: {design.get('schema')} "
                       f"{design.get('cid')} {design.get('code')}")
    return design


def design_problems(design: dict[str, Any]) -> list[str]:
    """设计稿的 ``plan_rework1`` 必须镜像本模块的计划（漂移当场报）。"""
    problems: list[str] = []
    plan = design.get("plan_rework1")
    if not isinstance(plan, dict):
        return ["design has no plan_rework1 block"]
    if int(plan.get("leader_rows", -1)) != LEADER_ROWS:
        problems.append(f"leader row count mirror drift: {plan.get('leader_rows')}")
    if int(plan.get("ability_records", -1)) != ABILITY_RECORDS:
        problems.append(f"ability record count mirror drift: {plan.get('ability_records')}")
    want_slots = {str(slot): len(PLAN[slot]) for slot in range(1, 7)}
    if {str(k): int(v) for k, v in (plan.get("ability_rows_by_slot") or {}).items()} != want_slots:
        problems.append(f"per-slot mirror drift: {plan.get('ability_rows_by_slot')}")
    if sorted(plan.get("custom_ability_string") or []) != sorted(CAS_TEXTS):
        problems.append(f"custom_ability_string mirror drift: {plan.get('custom_ability_string')}")
    if sorted(plan.get("ability_skill_programs") or []) != [ENCORE_PROGRAM]:
        problems.append(f"ability_skill program mirror drift: {plan.get('ability_skill_programs')}")
    if list(plan.get("unique_conditions") or []) != []:
        problems.append("rework1 建了固有状态，但本套件是零固有状态方案")
    if sorted(plan.get("required_capabilities") or []) != sorted(SPEC["required_capabilities"]):
        problems.append(f"capability mirror drift: {plan.get('required_capabilities')}")
    return problems


# ---------------------------------------------------------------- 入口

def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.cid, spec.code, spec.element) != (CID, CODE, ELEMENT):
        raise KitError(f"identity drift: {spec.cid}/{spec.code}/element {spec.element}")
    if (spec.template_id, spec.template_code) != (TEMPLATE_ID, TEMPLATE_CODE):
        raise KitError(f"template drift: {spec.template_id}/{spec.template_code}")
    if spec.pf_type != PF_TYPE or spec.stance != STANCE:
        raise KitError(f"spec drift: pf_type={spec.pf_type} stance={spec.stance}")
    if MS.text_placeholders(spec):
        raise KitError(f"design texts still placeholders: {MS.text_placeholders(spec)}")
    if MS.UNIQUE_CONDITION_LOGICAL in spec.extra_keys:
        raise KitError("SPEC 声明了固有状态键，但本套件不建固有状态")

    design = load_design(ctx.root)
    problems = design_problems(design)
    if problems:
        raise KitError(f"design mirror rejected: {problems}")

    # ---- 1) 队长 7 行 + 词条 6 键 18 条
    rows = build_rows(ctx)
    ctx.write_flat(KL.LEADER, {str(CID): rows["leader"]})
    ctx.write_flat(KL.ABILITY, rows["ability"])
    statue = statue_group_report(ctx, rows["ability"])

    # ---- 2) custom_ability_string：536 / 629 条目 + 7 条面板接管
    strings = write_strings(ctx)

    # ---- 3) action_skill 两档能量（本轮不改）
    action_rows = write_action_skill(ctx, design)

    # ---- 4) 技能特效：默认直接引用官方 wt23 路径（零图集增量）；有 LUT 才克隆换色
    lut_path = KL.pixel_dir(ctx) / "fx_lut.json"
    lut = KL.png_transform_from_lut(lut_path)
    family = None
    if lut is not None:
        family = ctx.clone_effect_family(FX_SRC_DIR, FX_SUBDIR, png_transform=lut)
        if family["dst_dir"] != FX_DST_DIR or sorted(family["copied_bases"]) != sorted(FX_BASES):
            raise KitError(f"effect family drift: {family['dst_dir']} {family['copied_bases']}")

    # ---- 5) 技能 DSL 两档 + 629 追击树
    values = design["plan_rework1"]["skills"]["values"]
    programs, skill_gates = [], {}
    for level in ("1", "2"):
        level_values = dict(values[level])
        level_values["hit_area_damage_kind"] = values["hit_area_damage_kind"]
        tree, gates = build_skill_tree(ctx, level, level_values, family)
        programs.append(write_dsl_checked(ctx, ctx.program_path(level), tree))
        skill_gates[level] = gates
    encore_values = dict(values[str(values["encore_level"])])
    encore_values["hit_area_damage_kind"] = values["hit_area_damage_kind"]
    encore, encore_gates = build_encore_tree(ctx, str(values["encore_level"]),
                                             encore_values, family)
    programs.append(write_dsl_checked(ctx, ENCORE_PROGRAM, encore))

    # ---- 6) 语音路由（kind 1 ConditionExist ← 贯通 31）+ character 行
    design_route = design.get("voice", {}).get("route") or {}
    if list(design_route.get("columns", ())) != VOICE_ROUTE_COLS:
        raise KitError(f"design voice route drift: {design_route.get('columns')}")
    route = KL.voice_route(CODE, VOICE_ROUTE_COLS)
    char_row = ctx.pack.pkg_character_row()
    char_row[9:17] = route
    if char_row[6] != str(PF_TYPE) or char_row[26] != STANCE or char_row[27] != str(CID):
        raise KitError(f"character row drift: c6={char_row[6]} c26={char_row[26]} c27={char_row[27]}")
    ctx.write_flat(KL.CHARACTER, {str(CID): [char_row]})
    voice_ready = KL.write_voice_ready(ctx)

    # ---- 7) 像素成品（缺文件静默跳过）+ 三层镜像
    pixel = KL.install_staged_assets(ctx)
    mirrors = ctx.sync_character_mirrors()
    if mirrors["character"][9:17] != route:
        raise KitError("character mirror lost the voice route")

    panel = [PANEL_LEADER] + [PANEL_ABILITY[slot] for slot in range(1, 7)]

    ctx.evidence_write("kit-gates.json", {
        "leader": {"rows": rows["leader"]},
        "ability": {"rows": rows["ability"], "statue_group_precedent": statue},
        "evidence": rows["evidence"], "pullers": rows["pullers"],
        "skills": skill_gates, "encore": encore_gates, "action_skill": action_rows,
        "custom_ability_string": strings,
        "effect_family": family, "fx_lut": {"path": str(lut_path), "applied": bool(lut)},
        "voice_route": route, "voice_ready": voice_ready,
        "pixel": pixel, "mirrors": mirrors,
    })

    energy = design["plan_rework1"]["skills"]["energy"]
    notes = [
        "rework1（作者目标面板 rework1/panel/rolf.json）：队长 5 行 → 7 行、词条 12 条 → 18 条；"
        "新增 422×2（冲刺 CD −33% ＋ Swift 数值抵消 +234.5%，挂前置 42 只在当队长时成立）、"
        "536 强化开关、629 连击追击、202 常驻 3 段、IT 246 速度固定读秒、IC 693 直击独立乘区。"
        "面板 7 块全部由 desc_override_* 接管；本轮不建固有状态 ⇒ 无 48×48 图标",
        "技能『月下独奏』：母本 141159 整树（FindNearSubjects → CreateReferencePoint → 停球 70 帧 → "
        "Wait 9 斩击 / Wait 49 爆击 10 连）；删母本 root[1] 的 PF 块；两处判定区 params[23] 0→4 "
        "⇒ 两段走**直接攻击伤害池**；两条 CreateNormalAttack 外包 ConditionalsChangeSkillFlag(1)，"
        "then 支 tree[8]=true 吃连击成长（×(1+连击×0.005)，卡 A §5.1），else 支保持 false；"
        f"倍率不动 斩击 {skill_gates['1']['attacks']['multipliers']['slash']}/"
        f"{skill_gates['2']['attacks']['multipliers']['slash']}、"
        f"爆击 {skill_gates['1']['attacks']['multipliers']['burst']}/"
        f"{skill_gates['2']['attacks']['multipliers']['burst']}（×10 连）；"
        f"能量 {energy['inner1']['c4']}/{energy['inner1']['c5']}、"
        f"{energy['inner2']['c4']}/{energy['inner2']['c5']}（不改）",
        "嫁接两块官方状态：root[1] = 铃鹿 silence_suzuka_2 的 FindAllSubjects(82 主小队) 整块，"
        "丢掉 ACFlying，留 ACPiercing ＋ ACFixedSpeed（绑定 8）；ACFixedSpeed 再外包 "
        "ConditionalsChangeSkillFlag(1)：then 支 "
        f"[帧, {values['2']['fixed_speed_speed_boost']}, {values['2']['fixed_speed_charge_boost']}, 1]"
        "（速度 4 档、充能不衰减 = 队长技第 4 行），else 支 "
        f"[帧, {values['2']['fixed_speed_speed']}, {values['2']['fixed_speed_charge']}, 1]；"
        "root[2] = 画狂老人Z mob_jiguza_playable_2 的 FindAllSubjects(113,[4]) → ACDirectDamage（绑定 9）。"
        "付与对象种类照抄官方（82→3 Member、113→1），CreateCondition 第 1 参 == 所在 FindAllSubjects 绑定 id",
        f"629 追击树 {ENCORE_PROGRAM}：母本主块的伤害两段（判定区 params[23]=4、CNA tree[8]=true），"
        f"删掉 {encore_gates['stop_ball_removed']} 条 StopBall，不复刻团队增益（施工单偏离 R-D4）；"
        "根 buffTargetAs 保持 0。629 行 c70/c71 双写、CT 300 帧、该键 unisonable=false",
        "队长 7 行 + 词条 18 条全部「官方/live donor 整行 + 逐格改」，每行过 client_legality 三件套"
        "并与 EXPECT 里的 wf_describe 回读逐字比对；during 触发 puller 逐行断言："
        "D214/D30/D34 留空、D204 写 9＋元素组（parseAt98 C7050）；422 行断言前置 42 与 c118 非空",
        "技能特效直接引用官方 battle/effect/skill_unique/black_wolf_knight_wt23/{_slash,_smash,_explosion}"
        "（风→风零染色、零图集增量）" + ("；已套用 B/pixel/rolf/fx_lut.json 克隆换色" if lut else
                                        "；B/pixel/rolf/fx_lut.json 不存在 ⇒ 不克隆不换色（设计默认）"),
        {"pixel_install": pixel},
    ]

    deviations: list[dict[str, Any]] = []
    for entry in design.get("deviations", ()):
        want = entry.get("from") or entry.get("planned") or entry.get("want") or entry.get("原设想")
        got = entry.get("to") or entry.get("actual") or entry.get("got") or entry.get("实际落法")
        why = entry.get("why") or entry.get("原因")
        if not (want and got and why):
            raise KitError(f"design deviation is missing 原设想/实际落法/原因: {entry}")
        deviations.append({"id": entry.get("id"), "want": want, "got": got, "why": why})

    gate = {"rows": len(rows["evidence"]), "programs": len(programs),
            "capabilities": rows["capabilities"], "fx_lut_applied": bool(lut),
            "pixel_present": pixel["present"],
            "pixel_missing": [e["logical"] for e in pixel["skipped"]]}
    ready = pixel["present"] and not pixel["skipped"]
    gate["reason"] = "kit 自有产物全部过闸" if ready else (
        f"像素成品未就绪：{gate['pixel_missing'] or 'B/pixel/rolf/install.json 不存在'}")

    return KL.report(
        ctx,
        summary="罗尔夫 rework1：风属性直击输出核心（冲刺 × 最大速度固定 × 连击三线，"
                "536 强化档给 4 档速度固定与连击成长，629 每 500 连击追击）",
        status=KL.READY if ready else KL.DRAFT, panel=panel, notes=notes, programs=programs,
        required_capabilities=sorted(rows["capabilities"]), deviations=deviations,
        extra={"kit_gate": gate, "voice_route": route,
               "statue_groups": {key: r[0][2] for key, r in rows["ability"].items()},
               "statue_group_zero_precedent":
                   [f"{e['key']}#{e['record']} {e['group']} × {e['trigger']} {e['kind']}"
                    for e in statue if e["official_rows"] == 0],
               "effect_families": [FX_DST_DIR] if family else [],
               "effect_references": sorted(OFFICIAL_FX_PATHS) if family is None else [],
               "encore_program": ENCORE_PROGRAM,
               "calibration": design.get("calibration", {})})
