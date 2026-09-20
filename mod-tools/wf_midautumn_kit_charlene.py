# -*- coding: utf-8 -*-
"""中秋批次 kit：夏琳 139992 ``artificialeye_sniper_moon``（雷 · 射击 · 直击辅助）。

轴线：**把敌人身上「同时存在的弱体条数」当层数卖给全队**。
技能一发给敌人挂 4 条不同来源的弱体（全属性抗性↓ / 攻击力↓ / 麻痹 / 中毒），
队长技与词条把这 4 层翻译成「触发敌方 Direct 伤害特攻」与「触发敌方攻击特攻」
两条互不稀释的乘区，再补一条不挑 boss 的 491「减益攻击特攻」兜底。

由 ``python mod-tools/wf_midautumn_build.py --char charlene --step kit`` 调用 :func:`build`。
只经 ``KitContext`` 写 ``work/character_packs/ma-charlene/``；live store / ``assets/`` /
``.cdn`` / 设备 / 存档 一律不碰，不发布、不 git。

设计稿：``work/character_packs/midautumn-20260920/design/charlene.{md,json}``。
行方案（donor + 逐格改 + ``wf_describe`` 回读）全部内联在本模块，设计稿在场时逐条互校
（:func:`design_crosscheck`）——设计稿在 gitignore 的 ``work/`` 下，缺失时不阻塞。

落地内容
--------
- character 行 c9–c16 语音路由（kind 1 ConditionExist / 3 AttackPointUp → ``<code>_voice_ready``）
  ＋ c18 队长技名；character_text 12 列与 action_skill 两档文案由 ``tables`` 依 :data:`TEXTS` 写，
  本模块只断言不漂移。
- 队长技 5 行、词条 6 键 10 条：官方 donor 行 + 逐格改，逐行过 ``wf_client_legality``
  （合法性 / 声明块字段 / 元素列）并与登记的面板文案逐字比对。
- action_skill 两档能量 c4/c5 = 母本原值 500/500 与 500/450（辅助档），名称/描述同 :data:`TEXTS`。
- 两棵技能 DSL：官方母本 ``artificialeye_sniper$_1/_2`` 整树，只改
  ``CreateNormalAttack`` 倍率格与 on-hit 的 ``CreateCondition``（母本那条改参数 + 克隆 3 条）。
  **不新增构造名、不改命令顺序、不动判定区形状**；特效全部直接引用官方路径，零克隆零图集增量。
- ``switched_action_skill`` ``<code>_voice_ready``（matched_skill_ready 的路由目标）。
- 像素/特效交付件：``B/pixel/charlene/install.json`` 在场才装，缺失静默跳过。

**无固有状态、无 ``custom_ability_string``、无 ``desc_override``、零 APK 补丁 kind。**
"""
from __future__ import annotations

import copy
import json
from typing import Any

import wf_midautumn_kitlib as KL
import wf_midautumn_specs as MS

KEY = "charlene"
CID = 139992
CID_S = "139992"
CODE = "artificialeye_sniper_moon"
TEMPLATE_CODE = "artificialeye_sniper"
ELEMENT = 2                      # 内部 ElementKind：2 = 雷（Yellow）
ELEMENT_TOKEN = "Yellow"
VOICE_KEY = CODE + "_voice_ready"

# 一键内 c2（雕像组）必须单值（裁决 §8）。取 ``attack_yellow``：母本 131176 自己就把
# 1311763 的 5 条混 kind 记录（D0 / I245 / I209 / I536）统一挂在 attack_yellow 下，
# 是「雷属性角色的攻击系词条」这一格的官方写法。
STATUE_GROUP = "attack_yellow"

CHARACTER = KL.CHARACTER
ACTION = KL.ACTION

TEXTS = {
    "name": "夏琳",
    "furigana": "XIALIN",
    "profile": "「三千米外也绝不失手」的死神，这一夜把兔子挂饰系上枪管，坐在桂树下的石栏上啃月饼。"
               "她说今晚歇业——可要是有人扰了这轮满月，桂花落地之前，对方就已经躺在准星里了。",
    "title": "代号·月兔",
    "skill1": "桂影·望月三千",
    "desc1": "瞄准距离最近的敌人射出月华贯通弹，对命中的敌人造成雷属性伤害 ＋ 赋予其累积全属性抗性降低"
             "与累积攻击力降低效果（无视弱体耐性）＋ 追加赋予麻痹与中毒效果",
    "skill2": "桂影·望月三千＋",
    "desc2": "瞄准距离最近的敌人射出月华贯通弹，对命中的敌人造成雷属性伤害 ＋ 赋予其累积全属性抗性降低"
             "与累积攻击力降低效果（无视弱体耐性）＋ 追加赋予麻痹与中毒效果",
    "leader": "Ace of Moonlight",
    "cv": "AI 合成配音",
}

SPEC = {
    "stance": "Jammer",                      # 母本 c26；整套 kit 的轴就是给敌人挂弱体
    "required_capabilities": (),             # 10+5 条行实跑 caps 全空，不需要任何 APK 补丁 kind
    "extra_keys": {KL.SWITCHED: (VOICE_KEY,)},
}

# character c9–c16：kind 1 ConditionExist，条件种类 3 = AttackPointUp、条件 id 0。
# 依据：词条 1399923#0「技能Hit → 赋予全队(雷) 状态攻击力（15 秒）」target 5 含自身 ⇒
# 打完技能 15 秒内她身上必有攻击力 UP，这段窗口内满槽播 matched_skill_ready。
VOICE_ROUTE = {"kind": 1, "condition_kind": "3", "condition_id": "0"}

# ------------------------------------------------------------------ 行方案
# 每条 =（donor 键#记录号（0 基）, 逐格改, 面板预期文案）。donor 一律取官方基线
# （``.cdn/cn`` OfficialBaseline），不取 store。

LEADER: tuple[tuple[str, dict[int, str], str], ...] = (
    # L1 每层弱体 → 全队(雷) 触发敌方 Direct 伤害特攻（直击伤害池）
    ("121165#1", {0: CODE, 100: "4", 109: ELEMENT_TOKEN, 111: "60000", 112: "85000"},
     "持续·任一敌方状态计数减益≥1(限4次) → 赋予全队(雷) 触发敌方Direct伤害特攻 60%→85%"),
    # L2 同层数 → 攻击力池（与 L1 分池，不互相稀释）
    ("121165#0", {0: CODE, 100: "4", 109: ELEMENT_TOKEN, 111: "30000", 112: "40000"},
     "持续·任一敌方状态计数减益≥1(限4次) → 赋予全队(雷) 触发敌方攻击特攻 30%→40%"),
    # L3 只要敌人身上有任何弱体 → 攻击力池（不挑元素、不挑 boss 的兜底）
    ("161069#1", {0: CODE, 47: ELEMENT_TOKEN, 49: "30000", 50: "50000"},
     "赋予全队(雷) 减益攻击特攻 30%→50%"),
    # L4 雷共鸣 6 人 → 独立特攻池（P4）
    ("111004#1", {0: CODE, 4: "2", 7: "600000", 8: "600000", 9: ELEMENT_TOKEN,
                  47: ELEMENT_TOKEN, 49: "15000", 50: "25000"},
     "雷·编成≥6 时: 赋予全队(雷) 减益特攻 15%→25%"),
    # L5 开场给除自己以外的雷属性队员半管技能槽（官方夏琳本人的队长行）
    ("131176#0", {0: CODE, 49: "40000", 50: "50000"},
     "赋予除自身全员(雷) 技能槽 40%→50%"),
)

ABILITY: dict[str, tuple[tuple[str, dict[int, str], str], ...]] = {
    # 1 自身充能 ＋ 本体轴（直击伤害池）
    "1399921": (
        ("1311761#0", {0: CODE + "_1", 2: STATUE_GROUP},
         "雷·MySelf 时: 自身 技能槽 50%→100%"),
        ("1211651#0", {0: CODE + "_1", 2: STATUE_GROUP, 102: "4", 111: ELEMENT_TOKEN},
         "持续·任一敌方状态计数减益≥1(限4次) → 赋予全队(雷) 触发敌方Direct伤害特攻 12.5%→25%"),
    ),
    # 2 减益特攻两池（P1 攻击力池 / P4 独立特攻池）
    "1399922": (
        ("1110934#0", {0: CODE + "_2", 2: STATUE_GROUP, 49: ELEMENT_TOKEN,
                       51: "15000", 52: "30000"},
         "赋予全队(雷) 减益攻击特攻 15%→30%"),
        ("1610052#1", {0: CODE + "_2", 2: STATUE_GROUP, 49: ELEMENT_TOKEN,
                       51: "2500", 52: "5000"},
         "赋予全队(雷) 减益特攻 2.5%→5%"),
    ),
    # 3 Ⓜ 主位：团队状态攻击力 ＋ 自带第 4 条弱体源 ＋ 官方夏琳的 2 号位充能
    "1399923": (
        ("1610693#0", {0: CODE + "_3", 2: STATUE_GROUP, 49: ELEMENT_TOKEN},
         "技能Hit≥1(CT20秒) → 赋予全队(雷) 状态攻击力 50%→100%(15秒)×1次"),
        ("1210873#0", {0: CODE + "_3", 2: STATUE_GROUP,
                       51: "-4000", 52: "-8000", 58: "300000000"},
         "技能发动≥1 → 自身 敌方状态攻击力 -4%→-8%(50秒)[累积上限3]"),
        ("1311763#2", {0: CODE + "_3", 2: STATUE_GROUP},
         "雷·编成≥6(限1次) → 赋予队长 2号位技能槽 5%→10%"),
    ),
    # 4 雷共鸣门控的独立特攻池按层
    "1399924": (
        ("1211656#0", {0: CODE + "_4", 2: STATUE_GROUP, 11: ELEMENT_TOKEN, 102: "4",
                       111: ELEMENT_TOKEN, 113: "2500", 114: "5000"},
         "雷·编成≥6 时: 持续·任一敌方状态计数减益≥1(限4次) → 赋予全队(雷) 触发敌方特攻 2.5%→5%"),
    ),
    # 5 直击体系正反馈：全队雷属性成员的直击合计每 10 次给全队 Direct 伤害
    "1399925": (
        ("1510573#1", {0: CODE + "_5", 1: "true", 2: STATUE_GROUP, 29: ELEMENT_TOKEN,
                       49: ELEMENT_TOKEN, 51: "3000", 52: "6000"},
         "编成直接攻击≥10(限10次)(CT10秒) → 赋予全队(雷) Direct伤害 3%→6%"),
    ),
    # 6 本体轴的攻击力池按层（副位也吃）
    "1399926": (
        ("1211653#0", {0: CODE + "_6", 1: "true", 2: STATUE_GROUP, 102: "4",
                       111: ELEMENT_TOKEN, 113: "7500", 114: "15000"},
         "持续·任一敌方状态计数减益≥1(限4次) → 赋予全队(雷) 触发敌方攻击特攻 7.5%→15%"),
    ),
}

# ------------------------------------------------------------------ 技能 DSL
# 母本整树保留；只改两处（设计稿 §4.2 S1–S5）。

# S1 CreateNormalAttack 倍率格（单发贯通弹，每敌命中 1 次 ⇒ 总倍率 = CNA 倍率）。
# 满级 40× 落在裁决 §2「辅助技能 36–50×」带内偏下；两档维持官方的档差比例。
SKILL_MULTIPLIER = {"1": (24, 28), "2": (34, 40)}
SKILL_ENERGY = {"1": ("500", "500"), "2": ("500", "450")}

#: 母本那条 CreateCondition 的整体形状被复用四次；只换 AC 列表与末位 forceApply。
#: 名称 / AC / forceApply。数值两档相同（设计稿 §4.2：升档只加伤害倍率）。
CONDITIONS: tuple[tuple[str, list, bool], ...] = (
    # S2 全属性抗性↓（累积 4 层 = −32%）。元素码 254 = 全属性：boss 的 resist_element_resistance
    # 是白名单，只放行 254 与克制属性，写单元素码会被静默硬拒（记忆 wf-force-apply-and-damage-floors）。
    # forceApply=true 穿 boss 弱体耐性，蓝本官方 ``stella_copy_assist``（254 + 负值 + 累积 + true）。
    ("tolerance_all",
     ["ACToleranceOfElement",
      [{"min": 1800, "max": 1800}],
      254,
      [{"min": -0.06, "max": -0.08, "alv_min": -0.02, "alv_max": -0.03}],
      [{"min": 4, "max": 4}]],
     True),
    # S3 敌方攻击力↓（累积 4 层 = −24%）。AC 形状抄官方 ``amulet_bosslady_2``
    # ``[3900, -0.06→-0.07, 累积 3]``，只改帧/强度/层上限。
    ("attack_down",
     ["ACAttackPoint",
      [{"min": 1800, "max": 1800}],
      [{"min": -0.05, "max": -0.06, "alv_min": -0.02, "alv_max": -0.03}],
      [{"min": 4, "max": 4}]],
     True),
    # S4 麻痹 3 秒。**不强制付与**（裁决 §2 对麻痹的口径：不对 boss 强制付与）。
    ("paralysis",
     ["ACParalysis", [{"min": 180, "max": 180}], True],
     False),
    # S5 中毒（「桂花醉」）。毒走 FixedAttackCalculator 独立通道，强度取官方下档，是风味不是输出。
    # 1200 帧是官方 ACPoison 最常见档（31 条里 16 条）。
    ("poison",
     ["ACPoison", [{"min": 1200, "max": 1200}], [{"min": 4000, "max": 4000}],
      [{"min": 1, "max": 1}]],
     False),
)

#: 技能特效全部直接引用官方母本路径（零克隆、零图集增量，裁决 §4）。
OFFICIAL_EFFECT_PREFIX = f"battle/effect/skill_unique/{TEMPLATE_CODE}/"

#: 母本整树的命令计数指纹：任何一项对不上都说明母本漂移或改错了结构。
DONOR_COMMAND_COUNTS = {
    "FindNearSubjects": 1, "StopBall": 1, "ShowEffect": 5, "CreateHitArea": 1,
    "MoveHitArea": 1, "ShakeCamera": 1, "CreateNormalAttack": 1, "CreateCondition": 1,
}


class CharleneError(KL.KitError):
    """本角色 kit 的断言失败。"""


# ------------------------------------------------------------------ DSL 工具

def _command_slots(node, name: str, out: list | None = None) -> list[tuple[list, int]]:
    """找出 ``["Command", [<name>, …]]` 在其父列表里的位置，返回 ``[(父列表, 下标), …]``。"""
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


def _walk(node):
    yield node
    if isinstance(node, list):
        for child in node:
            yield from _walk(child)
    elif isinstance(node, dict):
        for child in node.values():
            yield from _walk(child)


def effect_paths(tree) -> list[str]:
    """树里所有 ``SpecifyEffectDirectly`` 的特效路径。"""
    return [node[1] for node in _walk(tree)
            if isinstance(node, list) and len(node) == 2
            and node[0] == "SpecifyEffectDirectly" and isinstance(node[1], str)]


def mutate_tree(tree, level: str):
    """母本整树 → 本角色的树。返回 ``(tree, evidence)``；结构不符直接抛错。"""
    counts = _command_counts(tree)
    if counts != DONOR_COMMAND_COUNTS:
        raise CharleneError(f"donor skill tree {level} drifted: commands {counts} "
                            f"!= {DONOR_COMMAND_COUNTS}")
    if not (isinstance(tree, list) and len(tree) == 12 and tree[0] == "ActionDsl"):
        raise CharleneError(f"donor skill tree {level}: unexpected root {tree[:2]!r}")
    if tree[1] != 2 or tree[10] != 0:
        # tree[10] = buffTargetAs：0 = 自动（技能伤害）。她不是直击输出位，保持 0。
        raise CharleneError(f"donor root header {level}: movementPriority={tree[1]} "
                            f"buffTargetAs={tree[10]}, expected 2/0")

    # --- S1 CreateNormalAttack 倍率
    (cna_parent, cna_index), = _command_slots(tree, "CreateNormalAttack")
    cna = cna_parent[cna_index][1]
    if cna[2] != 255:
        # 255 = 随自身属性。DSL 显式元素码只有 CreateNormalAttack[2] 有 +1 偏移
        # （记忆 wf-dsl-element-code-offset），写死反而会错，这一格不动。
        raise CharleneError(f"CreateNormalAttack element slot {cna[2]!r} != 255")
    low, high = SKILL_MULTIPLIER[level]
    before_mult = copy.deepcopy(cna[6])
    cna[6] = [{"min": low, "max": high}]

    # --- S2–S5 on-hit CreateCondition：母本那条改参数，再克隆 3 条
    (cc_parent, cc_index), = _command_slots(tree, "CreateCondition")
    donor_cmd = cc_parent[cc_index]
    donor_body = donor_cmd[1]
    if len(donor_body) != 13:
        raise CharleneError(f"donor CreateCondition has {len(donor_body)} slots, expected 13")
    if donor_body[10] != 3:
        # 下标 10 = 付与对象种类；母本这条挂在 on-hit 的敌人身上，错配 = 施法 C16102
        # （记忆 wf-createcondition-target-kind）。整条克隆 ⇒ 这一格原样保留。
        raise CharleneError(f"donor CreateCondition target kind {donor_body[10]!r} != 3")
    if donor_body[12] is not False:
        raise CharleneError(f"donor CreateCondition forceApply {donor_body[12]!r} != False")
    before_ac = copy.deepcopy(donor_body[2])

    new_commands = []
    for name, ac, force in CONDITIONS:
        command = copy.deepcopy(donor_cmd)
        # 下标 2 是 **AC 列表**（母本是 ``[[ACToleranceOfElement, …]]`` 一条）：
        # 直接塞裸 AC 会把嵌套层吃掉一层，往返自检抓不到，进战斗才炸。
        command[1][2] = [copy.deepcopy(ac)]
        command[1][12] = bool(force)
        new_commands.append(command)
    cc_parent[cc_index:cc_index + 1] = new_commands

    # --- 特效：全部还是官方母本路径（零克隆、零图集增量）
    paths = effect_paths(tree)
    stray = [p for p in paths if not p.startswith(OFFICIAL_EFFECT_PREFIX)]
    if stray:
        raise CharleneError(f"skill {level} references non-official effect paths: {stray}")
    if len(paths) != DONOR_COMMAND_COUNTS["ShowEffect"]:
        raise CharleneError(f"skill {level} has {len(paths)} effect refs, expected "
                            f"{DONOR_COMMAND_COUNTS['ShowEffect']}")

    after = _command_counts(tree)
    expect_after = dict(DONOR_COMMAND_COUNTS, CreateCondition=len(CONDITIONS))
    if after != expect_after:
        raise CharleneError(f"mutated skill tree {level}: commands {after} != {expect_after}")

    evidence = {
        "level": level,
        "create_normal_attack": {"before": before_mult, "after": copy.deepcopy(cna[6])},
        "create_condition": {
            "donor_ac": before_ac,
            "records": [{"name": name, "ac": ac[0], "force_apply": force}
                        for name, ac, force in CONDITIONS],
        },
        "effect_refs": paths,
    }
    return tree, evidence


#: ``tables`` 会把母本 131176 的 ChangeSkillFlag 那套整体克隆过来（词条 1311763#L5 的 c70
#: 指向 ``change_skill_<code>`` 这条 ``custom_ability_string``）。本套件重写了整个词条 3，
#: 没有 ChangeSkillFlag 行 ⇒ 那条字符串成了**谁都不引用的孤行**，且内容还是母本的
#: 「雷属性抗性降低」（本角色改成全属性了，文案与真实机制不符）。按裁决 §3「死行不上面板」删掉。
ORPHAN_CAS_KEY = "change_skill_" + CODE


def _cas_claim(ctx):
    return next((claim for claim in ctx.pack.load_claims()
                 if (claim["root"], claim["logical_path"]) == ("common", KL.CAS)), None)


def drop_orphan_change_skill(ctx) -> dict[str, Any]:
    """撤销孤儿 ``change_skill_<code>`` 字符串，并让本包彻底不带 ``custom_ability_string`` 表。

    幂等：``tables`` 每次重跑都会把这张共享全表再复制进包，本函数每次都把它清掉。
    """
    result: dict[str, Any] = {
        "key": ORPHAN_CAS_KEY,
        "why": "本套件没有 ChangeSkillFlag 词条行 ⇒ 这条字符串无人引用，且文案仍是母本的"
               "「雷属性抗性降低」，与技能改成全属性 254 之后的真实机制不符（裁决 §3 死行不上面板）",
    }
    entry = _cas_claim(ctx)
    if entry is not None and ORPHAN_CAS_KEY in entry.get("outer_keys", []):
        result["unclaimed"] = ctx.unclaim(KL.CAS, [ORPHAN_CAS_KEY])
        entry = _cas_claim(ctx)
    result["still_claimed"] = entry is not None
    path = ctx.pack.pkg_path("common", KL.CAS)
    if entry is None and path.is_file():
        # ``custom_ability_string`` 是共享全表。本包一个键都不认领，却还带着 ``tables``
        # 那一刻的旧快照 —— 批内别的角色随后进 live 的键不在里面，照这份快照整表覆盖
        # 就会把它们删掉（记忆 wf-device-push-overwrites-device-only-rows：整表覆盖＝灾难）。
        # 无认领就不带这张表；manifest 的 ``root_tables_not_claimed`` 门禁同样要求这样。
        path.unlink()
        result["package_table_deleted"] = True
    return result


# ------------------------------------------------------------------ 设计稿互校

def design_crosscheck(ctx) -> dict[str, Any]:
    """设计稿在场时逐条互校（身份 / 文案 / 15 行的 donor·面板文案 / 能量 / 倍率 / 语音路由）。

    设计稿在 gitignore 的 ``work/`` 下，缺失时只记一条 note，不阻塞构建。
    """
    path = MS.design_path(ctx.root, KEY)
    if not path.is_file():
        return {"design_json": str(path), "present": False,
                "note": "设计稿不在（work/ 未恢复）：本次以 kit 模块内联方案为准"}
    design = json.loads(path.read_text(encoding="utf-8"))
    problems: list[str] = []

    ident = design.get("identity", {})
    for name, want in (("cid", CID), ("code", CODE), ("element", ELEMENT),
                       ("template_character", 131176), ("template_code", TEMPLATE_CODE)):
        if ident.get(name) != want:
            problems.append(f"identity.{name} = {ident.get(name)!r}, kit says {want!r}")

    for name, want in TEXTS.items():
        got = design.get("texts", {}).get(name)
        if got != want:
            problems.append(f"texts.{name} drifted from the design")

    plan = design.get("plan", {})
    rows = plan.get("leader_ability", {}).get("rows", [])
    if len(rows) != len(LEADER):
        problems.append(f"design has {len(rows)} leader rows, kit has {len(LEADER)}")
    for row, (donor, _cells, expect) in zip(rows, LEADER):
        key, _, index = donor.partition("#")
        want_donor = f"official leader_ability[{key}] #{int(index) + 1}"
        if row.get("donor") != want_donor:
            problems.append(f"leader #{row.get('index')}: donor {row.get('donor')!r} != {want_donor!r}")
        if row.get("desc_expected") != expect:
            problems.append(f"leader #{row.get('index')}: desc_expected drifted")

    keys = plan.get("ability", {}).get("keys", {})
    if sorted(keys) != sorted(ABILITY):
        problems.append(f"design ability keys {sorted(keys)} != kit {sorted(ABILITY)}")
    for key, recs in ABILITY.items():
        entry = keys.get(key, {})
        if entry.get("statue_group") != STATUE_GROUP:
            problems.append(f"ability {key}: design statue_group {entry.get('statue_group')!r} "
                            f"!= {STATUE_GROUP!r}")
        records = entry.get("records", [])
        if len(records) != len(recs):
            problems.append(f"ability {key}: design has {len(records)} records, kit has {len(recs)}")
        for record, (donor, _cells, expect) in zip(records, recs):
            rec_key, _, index = donor.partition("#")
            want_donor = f"official ability[{rec_key}] #{int(index) + 1}"
            if record.get("donor") != want_donor:
                problems.append(f"ability {key}: donor {record.get('donor')!r} != {want_donor!r}")
            if record.get("desc_expected") != expect:
                problems.append(f"ability {key}: desc_expected drifted")

    skills = plan.get("skills", {})
    for level, (c4, c5) in SKILL_ENERGY.items():
        energy = skills.get("energy", {}).get(f"inner{level}", {})
        if (str(energy.get("c4_min_skill_weight")), str(energy.get("c5_max_skill_weight"))) != (c4, c5):
            problems.append(f"action_skill {level}: energy drifted from the design")
    mult = skills.get("multiplier", {})
    want_mult = {"inner1_slv1": SKILL_MULTIPLIER["1"][0], "inner1_slvmax": SKILL_MULTIPLIER["1"][1],
                 "inner2_slv1": SKILL_MULTIPLIER["2"][0], "inner2_slvmax": SKILL_MULTIPLIER["2"][1]}
    for name, want in want_mult.items():
        if mult.get(name) != want:
            problems.append(f"skill multiplier {name} = {mult.get(name)!r}, kit says {want!r}")

    columns = design.get("voice", {}).get("route", {}).get("columns")
    if columns != KL.voice_route(CODE, VOICE_ROUTE):
        problems.append(f"voice route columns {columns!r} drifted")

    if problems:
        raise CharleneError("design/charlene.json disagrees with the kit: " + "; ".join(problems))
    return {"design_json": str(path), "present": True, "checked": [
        "identity", "texts", "leader donors + panel text", "ability donors + panel text",
        "statue_group", "skill energy", "skill multiplier", "voice route"]}


# ------------------------------------------------------------------ build

def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.key, str(spec.cid), spec.code, spec.element) != (KEY, CID_S, CODE, ELEMENT):
        raise CharleneError(f"spec identity mismatch: {spec.key}/{spec.cid}/{spec.code}/{spec.element}")
    if spec.template_code != TEMPLATE_CODE or spec.rarity != 5:
        raise CharleneError(f"spec template/rarity mismatch: {spec.template_code}/{spec.rarity}")
    if spec.pf_type != 2:
        raise CharleneError(f"spec pf_type {spec.pf_type} != 2 (射击)")

    notes: list[Any] = [design_crosscheck(ctx)]
    evidence: list[dict[str, Any]] = []

    # ---- 1) character 行：语音路由 c9–c16 ＋ 队长技名 c18
    crow = list(ctx.pack.pkg_character_row())
    expect_cols = {0: CODE, 2: "5", 3: str(ELEMENT), 6: str(spec.pf_type), 8: CODE,
                   17: CID_S, 26: "Jammer", 27: CID_S}
    for index, key in enumerate(range(19, 25)):
        expect_cols[key] = f"{CID_S}{index + 1}"
    drift = {i: (crow[i], v) for i, v in expect_cols.items() if crow[i] != v}
    if drift:
        raise CharleneError(f"package character row differs from spec (rerun tables): {drift}")
    route = KL.voice_route(CODE, VOICE_ROUTE)
    crow[9:17] = route
    crow[18] = TEXTS["leader"]
    ctx.write_flat(CHARACTER, {CID_S: [crow]})

    # ---- 2) 队长技 5 行
    leader_rows = []
    for index, (donor, cells, expect) in enumerate(LEADER):
        row, ev = KL.build_row(ctx, "leader_ability", donor, cells,
                               expect_describe=expect, label=f"leader#{index}")
        leader_rows.append(row)
        evidence.append(ev)
    ctx.write_flat(KL.LEADER, {CID_S: leader_rows})

    # ---- 3) 词条 6 键 10 条
    ability_rows: dict[str, list[list[str]]] = {}
    for key, records in ABILITY.items():
        built = []
        for index, (donor, cells, expect) in enumerate(records):
            row, ev = KL.build_row(ctx, "ability", donor, cells, element=ELEMENT,
                                   expect_describe=expect, label=f"{key}#{index}")
            built.append(row)
            evidence.append(ev)
        KL.check_ability_key(built, key, CODE, int(key[-1]))
        ability_rows[key] = built
    ctx.write_flat(KL.ABILITY, ability_rows)
    orphan = drop_orphan_change_skill(ctx)

    # ---- 4) 面板文案规则（队长 + 词条 + 技能名/说明 + 称号）
    panel = [ev["describe"] for ev in evidence]
    for text in panel:
        KL.check_panel(text, label="panel row")
    for name in ("title", "skill1", "desc1", "skill2", "desc2", "leader", "profile"):
        KL.check_panel(TEXTS[name], label=f"texts.{name}")

    # ---- 5) action_skill：名称 / 描述 / 能量（其余列断言与母本一致）
    inner = ctx.pkg_nested(CODE, ACTION)
    if sorted(inner) != ["1", "2"]:
        raise CharleneError(f"package action_skill inner keys {sorted(inner)} != ['1', '2']")
    new_inner: dict[str, list[list[str]]] = {}
    for level, cells in sorted(inner.items()):
        cells = list(cells)
        if len(cells) != 24:
            raise CharleneError(f"action_skill {level}: {len(cells)} columns, expected 24")
        if cells[7] != ctx.program_path(level):
            raise CharleneError(f"action_skill {level}: program {cells[7]!r} "
                                f"!= {ctx.program_path(level)!r}")
        cells[0] = TEXTS[f"skill{level}"]
        cells[1] = TEXTS[f"desc{level}"]
        cells[4], cells[5] = SKILL_ENERGY[level]
        if cells[2:4] != ["dynamic/skill/atk_nearest", "true"]:
            raise CharleneError(f"action_skill {level}: targeting columns changed {cells[2:4]}")
        if cells[8:17] != ["1", "2", "2400", "3000", "0", "0", "0", "0", "(None)"]:
            raise CharleneError(f"action_skill {level}: c8–c16 differ from the template {cells[8:17]}")
        if any(cells[17:]):
            raise CharleneError(f"action_skill {level}: c17+ not empty {cells[17:]}")
        new_inner[level] = [cells]
    ctx.write_nested(ACTION, CODE, new_inner, replace_inner=True)

    # ---- 6) 技能 DSL 两档（官方 donor 树改参数；写后从包里回读比对）
    skill_evidence = []
    programs = []
    for level in ("1", "2"):
        donor_program = ctx.program_path(level).replace(CODE, TEMPLATE_CODE)
        tree, ev = mutate_tree(ctx.template_dsl(donor_program), level)
        logical = ctx.write_dsl(ctx.program_path(level), tree)
        back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
        if back != tree:
            raise CharleneError(f"skill {level}: package DSL read-back differs from the written tree")
        ev["logical"] = logical
        ev["donor_program"] = donor_program
        skill_evidence.append(ev)
        programs.append(logical)

    # ---- 7) 语音路由目标 + 像素/特效交付件
    switched = KL.write_voice_ready(ctx)
    pixel = KL.install_staged_assets(ctx)
    lut_path = KL.pixel_dir(ctx) / "fx_lut.json"
    if lut_path.is_file():
        notes.append({"fx_lut": str(lut_path),
                      "unused": "本角色技能特效全部直接引用官方母本路径（零克隆），"
                                "没有可换色的包内特效；要改色须先改设计稿 §4.3 改成 clone_effect_family"})

    ctx.sync_character_mirrors()

    ctx.evidence_write("kit-rows.json", {
        "leader": [{"donor": donor, "cells": {str(k): v for k, v in cells.items()},
                    "describe": expect} for donor, cells, expect in LEADER],
        "ability": {key: [{"donor": donor, "cells": {str(k): v for k, v in cells.items()},
                           "describe": expect} for donor, cells, expect in records]
                    for key, records in ABILITY.items()},
        "rows": evidence,
    })
    ctx.evidence_write("kit-skills.json", {"programs": programs, "levels": skill_evidence})

    notes.extend([
        {"voice_route": route, "switched_action_skill": switched,
         "why": "kind 1 ConditionExist / 条件种类 3 AttackPointUp：词条 1399923#0 给全队（含自身）"
                "15 秒攻击力 UP ⇒ 连射窗口内满槽播 matched_skill_ready"},
        {"pixel_install": pixel},
        {"statue_group": STATUE_GROUP,
         "why": "一键内 c2 必须单值（裁决 §8）。母本 131176 的 1311763 把 5 条混 kind 记录"
                "（D0/I245/I209/I536）统一挂 attack_yellow，是雷属性角色攻击系词条的官方写法"},
        {"effects": "零克隆：5 条 ShowEffect 全部引用官方 "
                    f"{OFFICIAL_EFFECT_PREFIX}*，包内不含 battle/effect 目录 ⇒ 图集增量 0"},
        {"skill_conditions": [name for name, _ac, _force in CONDITIONS],
         "force_apply": [name for name, _ac, force in CONDITIONS if force],
         "why": "4 条不同来源的弱体 = 队长/词条 D136 的 4 层来源；麻痹与毒不强制付与（裁决 §2），"
                "boss 免疫时退化到 2–3 层（设计稿 R3）"},
        {"unique_condition": "无。层数来源是敌人身上的弱体条数（D136），不需要自身固有状态，"
                             "不占 8 位固有 ID、不需要 48×48 图标"},
        {"orphan_custom_ability_string": orphan},
    ])

    deviations = [
        {"want": "设计稿 §5『所有行的 c2 统一 attack_yellow，只有词条 1 的第 0 条沿用母本的 action_skill』",
         "got": "词条 1 的两条记录统一写 attack_yellow（设计稿 md/json 已同步改，登记为 D9）",
         "why": "裁决 §8：ability 表 c2 每个键必须单值（官方 790 个多记录键 0 个混用），"
                "``KL.check_ability_key`` 也硬卡这条。kind 211 × attack_yellow 官方 2 条先例；"
                "母本 131176 自己就把 1311763 的 5 条混 kind 记录统一挂 attack_yellow"},
        {"want": "设计稿 §4.2 S2/S3 的累积上限（maxAccum）4",
         "got": "照写 4",
         "why": "官方 ACToleranceOfElement 的 maxAccum 实测取值 {1, 3, 5, 60}、ACAttackPoint 取 {1, 3}，"
                "没有恰好 4 的先例，但它是数值档不是枚举（官方同族已有 3 与 5），"
                "满层强度 −32% / −24% 按设计稿口径不变。真机若异常改 3 并把每层上调到 −0.107 / −0.08"},
        {"want": "设计稿没提 ``tables`` 从母本克隆过来的 ``change_skill_artificialeye_sniper_moon``",
         "got": "kit 里撤销认领并删行（:func:`drop_orphan_change_skill`）",
         "why": "本套件重写了整个词条 3，没有 ChangeSkillFlag 行 ⇒ 这条字符串无人引用；"
                "且它的文案还是母本的「雷属性抗性降低」，技能改成全属性 254 之后与真实机制不符"
                "（裁决 §3：死行不上面板）"},
        {"want": "S2/S3 两档（slv 1/2）分别给不同的弱体强度（母本 960→1200 帧、−0.2→−0.3 的档差）",
         "got": "两档写同一组条件参数，升档只提升 CreateNormalAttack 倍率（24→34 / 28→40）",
         "why": "设计稿 §4.2 只登记了一组条件参数；面板文案不写数字，两档差异由伤害倍率体现"},
    ]

    return KL.report(
        ctx,
        summary="夏琳（139992）：雷 · 射击 · 直击辅助——技能一发挂 4 条弱体，"
                "队长技与词条把弱体条数翻译成触发敌方 Direct 伤害特攻／攻击特攻两条乘区",
        status=KL.DRAFT,
        panel=panel,
        notes=notes,
        programs=programs,
        required_capabilities=(),
        deviations=deviations,
        extra={"statue_group": STATUE_GROUP,
               "skills": {"programs": programs,
                          "energy": {lv: list(v) for lv, v in SKILL_ENERGY.items()},
                          "multiplier": {lv: list(v) for lv, v in SKILL_MULTIPLIER.items()},
                          "conditions": [name for name, _ac, _force in CONDITIONS]}},
    )
