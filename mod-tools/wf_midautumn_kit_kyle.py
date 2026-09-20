# -*- coding: utf-8 -*-
"""中秋批次 kit：凯尔 139990 ``kyle_moon``（雷 · 近战 · 直击输出主 C）。

轴线是**「贯通 × 月牙层数」两条互相咬合的直击线**：技能一发给全队与协力球挂「贯通／直击
伤害提升／加速」三条状态，自身再靠「月牙」（固有 ``13999001``，上限 20 层）把层数翻译成
全队与自身的直击伤害；队长技与词条各有一条 D204 把直击伤害池**跨池换算**成攻击力。
技能三段斩全部写 ``CreateHitArea params[23] = 4``（按直接攻击伤害结算），所以技能本身也吃
直击线的全部加成。设计与数值以 ``work/character_packs/midautumn-20260920/design/kyle.{md,json}``
为准 —— 本模块是「设计 JSON 驱动」的薄壳：队长 6 行、词条 6 键 13 条的 donor／逐格改／预期
``wf_describe`` 全部从 ``design/kyle.json`` 的 ``plan`` 块读出后装配，两边漂移（donor 缺失、
legality 不过、``wf_describe`` 对不上）当场报错，不在本文件里手抄 19 行的具体数值。

本模块自己负责设计 JSON 管不到的部分：

- 固有状态「月牙」（``13999001``，官方 donor 11「能量吸取」同形，上限 20 层、入棺不清层）
  ＋ 48×48 图标（PIL 8× 画 → LANCZOS，alpha 取官方图标外框，一格不改）；
- 技能 DSL 两档：官方母本 ``black_wolf_knight_wt23`` 的 ``_1``/``_2`` 整树改参数 ——
  三段斩（第 9／49／92 帧）判定区全部 ``p23 = 4``，末段「月华终斩」直接引用官方
  ``light_adventurer_4anv_ground_thunder``（零图集增量）；母本那块「PF 伤害」整块换成
  「全队及协力球：贯通 ＋ 直击伤害 UP ＋ 加速」三条 ``CreateCondition``；
- 技能特效族 ``black_wolf_knight_wt23``（slash/smash/explosion，593×253）换名重打到
  ``skill_unique/kyle_moon/blade/``，风绿 → 雷黄 LUT 染色（``B/pixel/kyle/fx_lut.json``
  优先，没有就用设计稿内联的 13 格色表）；
- ``action_skill`` 两档能量 560/560 与 560/510、名称与说明（其余列断言与母本一致）；
- 语音路由（kind 1 ConditionExist ← 条件种类 31 贯通）与 ``switched_action_skill``；
- ``B/pixel/kyle/install.json`` 里的像素小人成品（缺文件静默跳过）。

**无 ``custom_ability_string``、无 ``desc_override``、无 629／722／422／724／713，零 APK 补丁 kind。**
由 ``python mod-tools/wf_midautumn_build.py --char kyle --step kit`` 调用 :func:`build`。
只经 ``KitContext`` 写 ``work/character_packs/ma-kyle/``；live store / ``assets/`` / ``.cdn`` /
设备 / 存档一律不碰，不发布、不 git。
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
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

KEY = "kyle"
CID, CID_S = 139990, "139990"
CODE = "kyle_moon"
ELEMENT = 2                                     # 内部 ElementKind：2 = 雷（Yellow）
ELEMENT_TOKEN = "Yellow"
TEMPLATE_ID, TEMPLATE_CODE = 141159, "black_wolf_knight_wt23"

ABILITY_KEYS = tuple(f"{CID}{slot}" for slot in range(1, 7))

# ---- 固有状态「月牙」
UID = MS.unique_condition_id(CID, 1)            # "13999001"（8 位；7 位撞过基诺维）
UNIQUE_DONOR = "11"                             # 官方 unique_condition[11]「能量吸取」
UNIQUE_STRING_ID = f"unique_{CODE}_crescent"
UNIQUE_NAME = "月牙"
UNIQUE_CAP = "20"                               # 禁 (None)：那是上限 1，during 134 按层加成会全死
UNIQUE_ICON_ROW = f"battle/common/unique_condition/{UNIQUE_STRING_ID}"
UNIQUE_ICON_LOGICAL = UNIQUE_ICON_ROW + ".png"
UNIQUE_ICON_FRAME = f"battle/common/unique_condition/unique_blackflower_wiz_smr22.png"

VOICE_KEY = f"{CODE}_voice_ready"
VOICE_ROUTE = {"kind": 1, "condition_kind": "31", "condition_id": "0"}   # 31 = 贯通

TEXTS: dict[str, str] = {}      # 10 个文本键在 design/kyle.json 的 texts 块里（build 里核验）
SPEC = {
    "required_capabilities": (),                # 19 行实跑 caps 全空，不需要任何 APK 补丁 kind
    "extra_keys": {
        MS.UNIQUE_CONDITION_LOGICAL: (UID,),
        KL.SWITCHED: (VOICE_KEY,),
    },
}

# ---------------------------------------------------------------- donor 地址
# 设计稿的 donor 字段是人读散文（"触发 1630012#L1 / 内容 1611231#L1"），这里给出机读地址。
# ``#N`` 一律 **0 基**；设计稿写的 ``#LN`` 是 1 基，两边在 :func:`_check_design_donor` 互校。
# 多个 donor = 复合行（触发块取一个、内容块取另一个），逐格审计时任一 donor 命中即算有来源。

LEADER_DONORS: dict[int, tuple[str, ...]] = {
    0: ("131182#0", "131170#2"),    # I32 全队攻击力 + 雷共鸣前置块
    1: ("161135#0",),               # D30 贯通 → D1 全队直击
    2: ("161123#0",),               # D134 固有层数 → D1（c107 0→1）
    3: ("161135#1",),               # 前置 38 + D204 → D0 跨池
    4: ("161123#2",),               # I23 技能发动 → I461 月牙 +2
    5: ("161123#3",),               # I0 开局 → I461 月牙 +3
}

ABILITY_DONORS: dict[tuple[str, int], tuple[str, ...]] = {
    ("1399901", 0): ("1310024#0",),
    ("1399901", 1): ("1610023#2",),
    ("1399902", 0): ("1410216#1",),
    ("1399902", 1): ("1611352#0",),
    ("1399903", 0): ("1611231#0", "1630012#0"),     # 内容块 / 触发块
    ("1399903", 1): ("1611231#0",),
    ("1399903", 2): ("1610083#2",),
    ("1399904", 0): ("1411112#1",),
    ("1399904", 1): ("1611352#0", "1410073#0"),     # 内容块 / 触发块
    ("1399905", 0): ("1411113#1",),
    ("1399905", 1): ("1411113#2",),
    ("1399906", 0): ("2610351#0",),
    ("1399906", 1): ("1310326#0",),
}

#: 内容 kind 黑名单。422 冲刺参数 / 724 Fever 比例 只许写 ability 表且本套件不用；
#: 713 独立乘区本套件不用；201/202/521 是被 C2308 卡住的瞬发常驻型（设计稿 E6）。
FORBIDDEN_CONTENT_KINDS = ("201", "202", "422", "521", "713", "724")
#: 前置 kind 白名单（裁决 §8：前置留空 = 角色页 C7050，只用有先例的几种）。
#: 2 = 元素编成、3 = MySelf、38 = 状态贯通、202 = OwnerIsMain。
ALLOWED_PRECONDITION_KINDS = ("", "0", "2", "3", "38", "202")

# ---------------------------------------------------------------- 技能 DSL

FX_SRC_DIR = f"battle/effect/skill_unique/{TEMPLATE_CODE}"
FX_SUBDIR = "blade"
FX_DST_DIR = f"battle/effect/skill_unique/{CODE}/{FX_SUBDIR}"
#: 末段「月华终斩」：直接引用官方件（裁决 §4「优先直接引用官方路径」）。莱特 4 周年把像素
#: 小人单独放在 ``_player`` / ``_player_thunder`` / ``_player_dash``（ShowEffect 名「キャラドット」），
#: ``_ground_thunder``（名「フィニッシュ」）是纯落雷件 ⇒ 不会把别人的小人带进来（设计稿 R3）。
FINISH_EFFECT = ("battle/effect/skill_unique/light_adventurer_4anv/"
                 "light_adventurer_4anv_ground_thunder")
FINISH_EFFECT_ANCHOR = ["AB"]            # 官方本人就是 AB + Some(3)（实读其 _1/_2 两树）
FINISH_EFFECT_SCALE = ["Some", [{"min": 3, "max": 3}]]

#: 三条「全队及协力球」状态的 donor（整条 ``CreateCondition`` 克隆，只改参数与主体绑定号）。
#: exact 色表漏网的抗锯齿过渡色兜底（裁决 §4「风绿→雷黄，暗部偏蓝紫；只换色不重画形状」）。
#: 母本可见像素的色相分布实测：75–160° 绿带 ~1.1 万、160–215° 青带 ~3.4 万、低饱和 ~1.3 万。
#: 低饱和（芯白）与全黑描边靠 ``sat_min`` / ``val_min`` 挡住，一格不动。
FX_HUE_FALLBACK = [
    {"from": [75, 160], "sat_min": 0.12, "val_min": 0.04,
     "hue_set": 52, "sat_scale": 1.05},          # 风绿 → 雷黄
    {"from": [160, 215], "sat_min": 0.12, "val_min": 0.04,
     "hue_set": 201, "sat_scale": 0.80, "val_scale": 1.02},   # 青 → 冷蓝白（同 41EACE→A8E4FF）
]

PIERCING_DONOR = "battle/action/skill/action/rare5/black_wolf_knight$black_wolf_knight_2"
DIRECT_DONOR = ("battle/action/skill/action/rare5/"
                "combat_animal_meteor23$combat_animal_meteor23_2")
SPEEDUP_DONOR = "battle/action/skill/action/rare5/wind_spgirl_1anv$wind_spgirl_1anv_2"

#: 母本整树的命令计数指纹：任何一项对不上都说明母本漂移或改错了结构。
DONOR_COMMAND_COUNTS = {
    "FindNearSubjects": 1, "CreateReferencePoint": 1, "StopBall": 1, "ShowEffect": 3,
    "CreateHitArea": 2, "ShakeCamera": 2, "CreateNormalAttack": 2,
    "FindAllSubjects": 2, "CreateCondition": 1,
}
#: 改完之后应有的命令计数（S5 加一段斩、S6 删 PF 块、S7–S9 换成三条状态）。
RESULT_COMMAND_COUNTS = {
    "FindNearSubjects": 1, "CreateReferencePoint": 1, "StopBall": 1, "ShowEffect": 4,
    "CreateHitArea": 3, "ShakeCamera": 3, "CreateNormalAttack": 3,
    "FindAllSubjects": 1, "CreateCondition": 3,
}

RP_LIFETIME = 130                    # S0：容下第 92 帧的 S3（寿命 20 ⇒ 最晚 112 帧）
STOPBALL_FRAMES = 95                 # S1：S3 在球恢复前触发
FINISH_WAIT = 92                     # S5：第三段的起始帧
FINISH_BINDS = (8, 9, 10)            # S5 判定区的三个绑定号（CNA 主体 = 第三个）

#: 三段斩的判定区参数（``CreateHitArea`` 的 params 下标，见设计稿 §4）。
HITAREA_EDITS = {
    0: {"radius": 260, "lifetime": 12, "max_hits": 1},     # S3 第 9 帧「月牙斩」
    1: {"radius": 280, "lifetime": 40, "max_hits": 14},    # S4 第 49 帧「狼牙连斩」
}
FINISH_HITAREA = {"radius": 320, "lifetime": 20, "max_hits": 1, "break_weak_point": True}
BUFF_TARGET_AS_DIRECT = 4            # CreateHitArea params[23]：4 = 按直接攻击伤害结算

#: 三段 ``CreateNormalAttack`` 的非倍率格（倍率从设计稿读）。
CNA_SHAPE = {
    0: {"subject": 4, "base": 200, "p12": 10, "p13": 5},
    1: {"subject": 7, "base": 3, "p12": 1, "p13": 0.5},
    2: {"subject": 10, "base": 200, "p12": 12, "p13": 6},   # S5 新增段（由第 1 段克隆改）
}

#: 特效重命名（只是 DSL 里的内部标签，不上面板）。
EFFECT_NAMES = {0: "月牙斬", 1: "狼牙連斬", 2: "爆発", 3: "月華終斬"}

_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")
_MINMAX_RE = re.compile(r"min\s*:\s*(-?[\d.]+)\s*,\s*max\s*:\s*(-?[\d.]+)")


# ---------------------------------------------------------------- 设计稿读取

def load_design(root: Path) -> dict[str, Any]:
    design = MS.load_design(Path(root), KEY)
    if not design:
        raise KitError(f"design/{KEY}.json missing (batch {MS.BATCH_DIR})")
    if (design.get("schema"), design.get("cid"), design.get("code")) != ("ma-design/1", CID, CODE):
        raise KitError(f"design identity drift: {design.get('schema')} "
                       f"{design.get('cid')} {design.get('code')}")
    return design


def _check_design_donor(donor_text: str, addresses: tuple[str, ...], label: str) -> None:
    """设计稿散文 donor 与本模块机读地址互校：每个地址的「键 + 1 基记录号」都要在散文里出现。"""
    text = str(donor_text)
    for address in addresses:
        key, _, index = address.partition("#")
        if key not in text:
            raise KitError(f"{label}: design donor {donor_text!r} does not mention {key}")
        one_based = f"#L{int(index) + 1}"
        if one_based not in text and f"#{int(index) + 1}" not in text:
            raise KitError(f"{label}: design donor {donor_text!r} does not mention record "
                           f"{one_based} (kit uses 0-based {address})")


def _minmax(numbers: list[float]) -> dict[str, float]:
    if len(numbers) == 1:
        return {"min": numbers[0], "max": numbers[0]}
    if len(numbers) == 2:
        return {"min": numbers[0], "max": numbers[1]}
    raise KitError(f"cannot read a min/max pair out of {numbers}")


def _num(text: str) -> float:
    value = float(text)
    return int(value) if value.is_integer() else value


def _groups(spec_text: str) -> list[dict[str, float]]:
    """``"[{960}],[{1.0,1.0}]"`` / ``"{600,600}"`` → ``[{min,max}, …]``（设计稿的速记写法）。"""
    return [_minmax([_num(n) for n in _NUM_RE.findall(chunk)])
            for chunk in str(spec_text).split("],[") if _NUM_RE.search(chunk)]


def _cna_mult(spec_text: str, label: str) -> dict[str, float]:
    match = _MINMAX_RE.search(str(spec_text))
    if not match:
        raise KitError(f"{label}: cannot read the CreateNormalAttack multiplier out of {spec_text!r}")
    return {"min": _num(match.group(1)), "max": _num(match.group(2))}


def read_skill_plan(design: dict[str, Any]) -> dict[str, Any]:
    """从设计稿的 ``plan.skills`` 读出两档的全部可变数值。"""
    skills = design["plan"]["skills"]
    changes = {entry["id"]: entry for entry in skills["structural_changes"]}
    missing = [sid for sid in ("S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9")
               if sid not in changes]
    if missing:
        raise KitError(f"design plan.skills lacks structural changes {missing}")
    if int(changes["S0"]["new"]) != RP_LIFETIME or int(changes["S1"]["new"]) != STOPBALL_FRAMES:
        raise KitError("design S0/S1 disagree with the kit on reference-point lifetime / StopBall")

    plan: dict[str, Any] = {"energy": {}, "levels": {}}
    for level in ("1", "2"):
        energy = skills["energy"][level]
        plan["energy"][level] = (str(energy["c4"]), str(energy["c5"]), str(energy["c6"]))
        plan["levels"][level] = {
            "cna": [_cna_mult(changes["S3"]["cna"][level], f"S3/{level}"),
                    _cna_mult(changes["S4"]["cna"][level], f"S4/{level}"),
                    _cna_mult(changes["S5"]["cna"][level], f"S5/{level}")],
            "piercing": _groups(changes["S7"]["edits"]["frames"][level])[0],
            "direct": _groups(changes["S8"]["edits"][level]),
            "speedup": _groups(changes["S9"]["edits"][level]),
        }
        for name in ("direct", "speedup"):
            if len(plan["levels"][level][name]) != 2:
                raise KitError(f"design S8/S9 {name} for level {level} must carry frames + strength")
    return plan


# ---------------------------------------------------------------- 行装配
# 设计稿的 ``cells`` 是**整行的全部非空列**（"只列非空列；其余一律写空串"），所以这里不是
# 「donor + 少数几格」而是「按设计稿铺整行」。donor 仍然是硬门禁：每个写进去的值都必须
# 要么在某个 donor 的同一列上出现过，要么被设计稿的 ``edits`` 点名；donor 上非空而设计稿
# 不要的列同样必须被 ``edits`` 点名（否则就是漏抄）。

def _cells(entry: dict[str, Any]) -> dict[int, str]:
    return {int(k): str(v) for k, v in entry["cells"].items()}


def _audit_against_donors(donors: list[list[str]], cells: dict[int, str],
                          edits: dict[str, Any], ncols: int, label: str) -> dict[str, Any]:
    named = {key for key in edits if re.fullmatch(r"c\d+", str(key))}

    def donor_value(row: list[str], col: int) -> str:
        return row[col] if col < len(row) else ""

    unexplained = [f"c{col}={value!r} (donors {[donor_value(d, col) for d in donors]})"
                   for col, value in sorted(cells.items())
                   if not any(donor_value(d, col) == value for d in donors)
                   and f"c{col}" not in named]
    dropped = {}
    for col in range(ncols):
        if col in cells:
            continue
        values = [donor_value(d, col) for d in donors]
        if all(values) and f"c{col}" not in named:
            unexplained.append(f"c{col} dropped silently (donors {values})")
        elif values[0]:
            dropped[f"c{col}"] = values[0]
    if unexplained:
        raise KitError(f"{label}: cells not traceable to a donor nor listed in the design edits: "
                       + "; ".join(unexplained))
    return {"donor_cells_dropped": dropped, "edits_declared": sorted(named)}


def _build_row(ctx, kind: str, addresses: tuple[str, ...], entry: dict[str, Any],
               label: str) -> tuple[list[str], dict[str, Any]]:
    table = KL.ABILITY if kind == "ability" else KL.LEADER
    ncols = KL.ABILITY_NCOLS if kind == "ability" else KL.LEADER_NCOLS
    _check_design_donor(entry["donor"], addresses, label)
    donors = [KL.donor_row(ctx, table, address) for address in addresses]
    cells = _cells(entry)
    audit = _audit_against_donors(donors, cells, entry.get("edits") or {}, ncols, label)
    row = KL.apply_cells([""] * ncols, cells, ncols)

    problems = KL.row_problems(kind, row, ELEMENT if kind == "ability" else None)
    if problems:
        raise KitError(f"{label}: client legality rejected the row: {problems}")
    rendered = KL.describe(kind, row)
    if rendered != entry["desc_expected"]:
        raise KitError(f"{label}: wf_describe drift\n  got    {rendered!r}\n"
                       f"  expect {entry['desc_expected']!r}")
    caps = KL.capabilities(kind, row)
    if caps:
        raise KitError(f"{label}: row needs client capabilities {caps}; 本套件要求零 APK 补丁 kind")
    evidence = {"label": label, "kind": kind, "donors": list(addresses),
                "describe": rendered, "capabilities": caps}
    evidence.update(audit)
    return row, evidence


def _ban_kinds(kind: str, rows: list[list[str]], label: str) -> None:
    """内容 kind 黑名单 + 前置 kind 白名单（裁决 §2/§8；写错 = C7050 / C2308）。"""
    if kind == "ability":
        content, precondition = (47, 109), (6, 13, 20)
    else:
        content, precondition = (45, 107), (4, 11, 18)
    for index, row in enumerate(rows):
        for col in content:
            if row[col] in FORBIDDEN_CONTENT_KINDS:
                raise KitError(f"{label}#{index}: forbidden content kind {row[col]!r} at c{col}")
        for col in precondition:
            if row[col] not in ALLOWED_PRECONDITION_KINDS:
                raise KitError(f"{label}#{index}: precondition kind {row[col]!r} at c{col} "
                               f"is outside the vetted set {ALLOWED_PRECONDITION_KINDS}")


def build_leader_rows(ctx, design: dict[str, Any]) -> tuple[list[list[str]], list[dict[str, Any]]]:
    plan = design["plan"]["leader_ability"]
    if plan["key"] != CID_S:
        raise KitError(f"design leader block key {plan.get('key')!r} != {CID_S}")
    if int(plan["layout"]["ncols"]) != KL.LEADER_NCOLS:
        raise KitError(f"design leader ncols {plan['layout'].get('ncols')}")
    rows, evidence = [], []
    for entry in plan["rows"]:
        index = int(entry["index"])
        label = f"leader#{index}"
        row, ev = _build_row(ctx, "leader_ability", LEADER_DONORS[index], entry, label)
        if row[0] != CODE:
            raise KitError(f"{label}: c0 {row[0]!r} != {CODE}")
        rows.append(row)
        evidence.append(ev)
    if len(rows) != len(LEADER_DONORS):
        raise KitError(f"design leader_ability carries {len(rows)} rows, "
                       f"expected {len(LEADER_DONORS)}")
    _ban_kinds("leader_ability", rows, "leader")
    return rows, evidence


def build_ability_rows(ctx, design: dict[str, Any]) -> tuple[dict[str, list[list[str]]],
                                                             list[dict[str, Any]]]:
    plan = design["plan"]["ability"]
    if int(plan["layout"]["ncols"]) != KL.ABILITY_NCOLS:
        raise KitError(f"design ability ncols {plan['layout'].get('ncols')}")
    if tuple(sorted(plan["keys"])) != tuple(sorted(ABILITY_KEYS)):
        raise KitError(f"design ability keys drift: {sorted(plan['keys'])}")
    rows_by_key: dict[str, list[list[str]]] = {}
    evidence: list[dict[str, Any]] = []
    for slot, key in enumerate(ABILITY_KEYS, start=1):
        block = plan["keys"][key]
        rows = []
        for entry in block["records"]:
            label = f"{key}#{int(entry['index'])}"
            row, ev = _build_row(ctx, "ability", ABILITY_DONORS[(key, int(entry["index"]))],
                                 entry, label)
            rows.append(row)
            evidence.append(ev)
        # c0 = <code>_<slot>；c1（主位限制）与 c2（雕像组）全键一致（裁决 §8）
        KL.check_ability_key(rows, key, CODE, slot)
        if rows[0][1] != str(block["unisonable"]):
            raise KitError(f"ability {key}: c1 {rows[0][1]!r} != design {block['unisonable']!r}")
        if "statue_group" in block and rows[0][2] != block["statue_group"]:
            raise KitError(f"ability {key}: c2 {rows[0][2]!r} != design {block['statue_group']!r}")
        _ban_kinds("ability", rows, key)
        rows_by_key[key] = rows
    return rows_by_key, evidence


# ---------------------------------------------------------------- 固有状态与图标

def build_unique(ctx, design: dict[str, Any]) -> tuple[str, list[str]]:
    plan = design["plan"]["unique_conditions"]["add"]
    if len(plan) != 1 or plan[0]["key"] != UID:
        raise KitError(f"design unique_conditions drift: {[e.get('key') for e in plan]}")
    want = [str(cell) for cell in plan[0]["row"]]
    if len(want) != KL.UNIQUE_NCOLS:
        raise KitError(f"design unique row has {len(want)} columns, expected {KL.UNIQUE_NCOLS}")
    if (want[0], want[1], want[4]) != (UNIQUE_STRING_ID, UNIQUE_NAME, UNIQUE_CAP):
        raise KitError(f"design unique row head drift: {want[:5]}")
    key, row = KL.unique_row(ctx, ctx.spec, 1, donor=UNIQUE_DONOR,
                             cells={0: UNIQUE_STRING_ID, 2: UNIQUE_ICON_ROW, 4: UNIQUE_CAP},
                             name=UNIQUE_NAME)
    if row != want:
        raise KitError(f"unique_condition {key} differs from the design row:\n"
                       f"  got    {row}\n  expect {want}")
    if row[13] != "false":
        raise KitError(f"unique_condition {key}: c13 remove_if_encoffin must stay false")
    KL.write_unique(ctx, ctx.spec, {key: row})
    return key, row


def draw_icon(frame):
    """48×48「月牙」：深靛圆底 (#1B1A24) ＋ 2px 描边；金色新月（内缘做成狼牙尖角）＋右下冷白高光。

    8× 画布绘制后 LANCZOS 缩回 48×48；alpha 取官方图标外框（同批统一工艺，alpha 一格不改）。
    """
    from PIL import Image, ImageDraw
    if frame.size != (48, 48):
        raise KitError(f"icon frame donor must be 48x48, got {frame.size}")
    K, N = 8, 48 * 8
    ink = (27, 26, 36, 255)
    gold = (232, 194, 90, 255)
    chill = (244, 240, 255, 255)

    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    inner = Image.new("L", (N, N), 0)
    ImageDraw.Draw(inner).ellipse((3 * K, 3 * K, 45 * K - 1, 45 * K - 1), fill=255)
    layer.paste(Image.new("RGBA", (N, N), ink), (0, 0), inner)
    ImageDraw.Draw(layer).ellipse((4 * K, 4 * K, 44 * K - 1, 44 * K - 1), outline=gold, width=2 * K)

    # 新月 = 大圆减偏移小圆；小圆再被两枚小尖角咬出「狼牙」内缘
    moon = Image.new("L", (N, N), 0)
    md = ImageDraw.Draw(moon)
    md.ellipse((12 * K, 10 * K, 36 * K, 34 * K), fill=255)
    bite = Image.new("L", (N, N), 0)
    bd = ImageDraw.Draw(bite)
    bd.ellipse((19 * K, 8 * K, 43 * K, 32 * K), fill=255)
    bd.polygon([(20 * K, 17 * K), (26 * K, 20 * K), (20 * K, 23 * K)], fill=0)
    bd.polygon([(23 * K, 25 * K), (29 * K, 27 * K), (23 * K, 30 * K)], fill=0)
    moon = Image.composite(Image.new("L", (N, N), 0), moon, bite)
    moon = Image.composite(moon, Image.new("L", (N, N), 0), inner)
    layer.paste(Image.new("RGBA", (N, N), gold), (0, 0), moon)

    # 右下一点冷白高光
    spark = Image.new("L", (N, N), 0)
    sd = ImageDraw.Draw(spark)
    sd.ellipse((32 * K, 32 * K, 38 * K, 38 * K), fill=255)
    layer.paste(Image.new("RGBA", (N, N), chill), (0, 0),
                Image.composite(spark, Image.new("L", (N, N), 0), inner))

    small = layer.resize((48, 48), Image.LANCZOS)
    out = Image.new("RGBA", (48, 48), (255, 255, 255, 0))
    fp, op, sp = frame.load(), out.load(), small.load()
    for y in range(48):
        for x in range(48):
            r, g, b, a = sp[x, y]
            fa = fp[x, y][3]
            if a:
                op[x, y] = (round((r * a + 255 * (255 - a)) / 255),
                            round((g * a + 255 * (255 - a)) / 255),
                            round((b * a + 255 * (255 - a)) / 255), fa)
            else:
                op[x, y] = (255, 255, 255, fa)
    return out


def install_unique_icon(ctx) -> dict[str, Any]:
    frame_raw = ctx.official_read(UNIQUE_ICON_FRAME)
    if frame_raw is None:
        _root, frame_raw, _how = ctx.pack.template_asset(UNIQUE_ICON_FRAME)
    frame = ctx.png_open(frame_raw)
    data = ctx.png_store_bytes(draw_icon(frame))
    ctx.write_asset("common", UNIQUE_ICON_LOGICAL, data)
    back = ctx.png_open(ctx.pack.pkg_path("common", UNIQUE_ICON_LOGICAL).read_bytes())
    if back.size != (48, 48) or back.getchannel("A").tobytes() != frame.getchannel("A").tobytes():
        raise KitError("unique_condition icon size/alpha differ from the official frame donor")
    return {"logical": UNIQUE_ICON_LOGICAL, "frame_donor": UNIQUE_ICON_FRAME,
            "size": list(back.size), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


# ---------------------------------------------------------------- DSL 工具

def _walk(node):
    yield node
    if isinstance(node, list):
        for child in node:
            yield from _walk(child)
    elif isinstance(node, dict):
        for child in node.values():
            yield from _walk(child)


def _is_command(node, name: str | None = None) -> bool:
    return (isinstance(node, list) and len(node) == 2 and node[0] == "Command"
            and isinstance(node[1], list) and node[1]
            and (name is None or node[1][0] == name))


def _command_counts(tree) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in _walk(tree):
        if _is_command(node) and isinstance(node[1][0], str):
            counts[node[1][0]] = counts.get(node[1][0], 0) + 1
    return counts


def _bodies(tree, name: str) -> list[list]:
    """树序里所有 ``["Command", [<name>, …]]`` 的命令体（可原地改）。"""
    return [node[1] for node in _walk(tree) if _is_command(node, name)]


def _one(bodies: list[list], name: str) -> list:
    if len(bodies) != 1:
        raise KitError(f"expected exactly one {name}, got {len(bodies)}")
    return bodies[0]


def effect_paths(tree) -> list[str]:
    return [node[1] for node in _walk(tree)
            if isinstance(node, list) and len(node) == 2
            and node[0] == "SpecifyEffectDirectly" and isinstance(node[1], str)]


def _set_hitarea(body: list, *, radius: int, lifetime: int, max_hits: int,
                 break_weak_point: bool | None = None, binds: tuple[int, int, int] | None = None,
                 label: str = "") -> None:
    """``CreateHitArea``：params[8] 形状 / [12] 寿命 / [13] 命中数 / [23] 归属（+ 可选 [6] 破弱点、绑定号）。"""
    if len(body) != 27:
        raise KitError(f"{label}: CreateHitArea has {len(body) - 1} params, expected 26")
    if body[9][0] != "Circle":
        raise KitError(f"{label}: hit area shape {body[9][0]!r} is not Circle")
    if body[13][0] != "SpecifyHitAreaLifetimeDirectly" or body[14][0] != "CalculatedUsingMaxNumOfHits":
        raise KitError(f"{label}: unexpected lifetime/hits constructors {body[13][0]!r} {body[14][0]!r}")
    body[9] = ["Circle", [{"min": radius, "max": radius}]]
    body[13] = ["SpecifyHitAreaLifetimeDirectly", lifetime]
    body[14] = ["CalculatedUsingMaxNumOfHits", max_hits]
    body[24] = BUFF_TARGET_AS_DIRECT
    if break_weak_point is not None:
        body[7] = bool(break_weak_point)
    if binds is not None:
        body[19], body[21], body[22] = binds


def _set_cna(body: list, shape: dict[str, Any], mult: dict[str, float], label: str) -> None:
    if len(body) != 17:
        raise KitError(f"{label}: CreateNormalAttack has {len(body) - 1} params, expected 16")
    if body[2] != 255:
        # 255 = 随自身属性。显式元素码只有 CreateNormalAttack[2] 有 +1 偏移
        # （记忆 wf-dsl-element-code-offset），写死反而会错，这一格不动。
        raise KitError(f"{label}: CreateNormalAttack element slot {body[2]!r} != 255")
    body[1] = shape["subject"]
    body[5] = shape["base"]
    body[6] = [dict(mult)]
    body[13] = [{"min": shape["p12"], "max": shape["p12"]}]
    body[14] = [{"min": shape["p13"], "max": shape["p13"]}]


def _condition_donor(ctx, program: str, kind: str) -> list:
    """官方树里唯一携带该 AdditionalCondition 的 ``CreateCondition``（整条命令，深拷贝）。"""
    tree = ctx.template_dsl(program)
    hits = [node for node in _walk(tree) if _is_command(node, "CreateCondition")
            and node[1][2] and isinstance(node[1][2][0], list) and node[1][2][0][0] == kind]
    if len(hits) != 1:
        raise KitError(f"{program}: expected exactly 1 CreateCondition/{kind}, got {len(hits)}")
    return copy.deepcopy(hits[0])


def _findall_donor(ctx) -> list:
    """``black_wolf_knight_2`` 的 ``FindAllSubjects(11, 33)`` 整块（含内含的 ACPiercing）。"""
    tree = ctx.template_dsl(PIERCING_DONOR)
    hits = [node for node in _walk(tree) if _is_command(node, "FindAllSubjects")]
    if len(hits) != 1:
        raise KitError(f"{PIERCING_DONOR}: expected exactly 1 FindAllSubjects, got {len(hits)}")
    body = hits[0][1]
    if (body[1], body[2]) != (11, 33):
        raise KitError(f"{PIERCING_DONOR}: FindAllSubjects bind/selector {body[1]}/{body[2]} "
                       f"!= 11/33（33 = 含自身的己方全体，35 是「除自身外」）")
    return copy.deepcopy(hits[0])


def _team_block(ctx, level: str, numbers: dict[str, Any]) -> tuple[list, dict[str, Any]]:
    """S7–S9：``FindAllSubjects(11, 33)`` 一块里挂贯通 / 直击伤害 UP / 加速三条状态。"""
    command = _findall_donor(ctx)
    bind = command[1][1]
    block = command[1][9]
    if block[0] != "Block" or len(block[1]) != 1:
        raise KitError("FindAllSubjects donor block shape drifted")

    piercing = block[1][0]
    if piercing[1][2][0][0] != "ACPiercing":
        raise KitError("FindAllSubjects donor does not carry ACPiercing")
    piercing[1][2][0][1] = [dict(numbers["piercing"])]

    direct = _condition_donor(ctx, DIRECT_DONOR, "ACDirectDamage")
    direct[1][1] = bind
    direct[1][2][0][1] = [dict(numbers["direct"][0])]
    direct[1][2][0][2] = [dict(numbers["direct"][1])]

    speedup = _condition_donor(ctx, SPEEDUP_DONOR, "ACSpeedup")
    speedup[1][1] = bind
    speedup[1][2][0][1] = [dict(numbers["speedup"][0])]
    speedup[1][2][0][2] = [dict(numbers["speedup"][1])]

    for command_node, name in ((piercing, "ACPiercing"), (direct, "ACDirectDamage"),
                               (speedup, "ACSpeedup")):
        body = command_node[1]
        if len(body) != 13:
            raise KitError(f"{name}: CreateCondition has {len(body) - 1} slots, expected 12")
        if body[10] != 3:
            # 下标 10 是付与对象种类：FindAllSubjects 33/34/35/49/82 下必须写 3，
            # 97（球）写 2；错配 = 施法 C16102（裁决 §8 / 记忆 wf-createcondition-target-kind）。
            raise KitError(f"{name}: CreateCondition target kind {body[11]!r} != 3 for selector 33")
        if body[1] != bind:
            raise KitError(f"{name}: subject {body[1]!r} != FindAllSubjects bind {bind}")

    block[1][:] = [piercing, direct, speedup]
    evidence = {"level": level, "bind": bind, "selector": command[1][2],
                "piercing_frames": numbers["piercing"],
                "direct": numbers["direct"], "speedup": numbers["speedup"],
                "donors": {"ACPiercing": PIERCING_DONOR, "ACDirectDamage": DIRECT_DONOR,
                           "ACSpeedup": SPEEDUP_DONOR}}
    return command, evidence


def mutate_tree(ctx, tree, level: str, numbers: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    """母本整树 → 本角色的树（S0–S9）。返回 ``(tree, evidence)``；结构不符直接抛错。"""
    counts = _command_counts(tree)
    if counts != DONOR_COMMAND_COUNTS:
        raise KitError(f"donor skill tree {level} drifted: commands {counts} != {DONOR_COMMAND_COUNTS}")
    if not (isinstance(tree, list) and len(tree) == 12 and tree[0] == "ActionDsl"):
        raise KitError(f"donor skill tree {level}: unexpected root {tree[:2]!r}")
    if tree[1] != 2 or tree[10] != 0:
        # tree[10] = buffTargetAs：保持 0（自动），直击归属逐判定区写 p23 = 4（设计稿 E1）。
        raise KitError(f"donor root header {level}: movementPriority={tree[1]} buffTargetAs={tree[10]}")

    # ---- S0 参照点寿命 100 → 130；S1 StopBall 70 → 95
    rp = _one(_bodies(tree, "CreateReferencePoint"), "CreateReferencePoint")
    before_rp = rp[9]
    rp[9] = RP_LIFETIME
    stopball = _one(_bodies(tree, "StopBall"), "StopBall")
    before_stop = stopball[2]
    stopball[2] = STOPBALL_FRAMES

    rp_block = rp[11]
    if rp_block[0] != "Block":
        raise KitError("CreateReferencePoint does not carry a Block")
    events = [node for node in rp_block[1] if isinstance(node, list) and node[0] == "Event"]
    if len(events) != 2 or [event[1][1] for event in events] != [9, 49]:
        raise KitError(f"donor event waits drifted: {[e[1][1] for e in events]} != [9, 49]")

    # ---- S2/S3/S4 前两段：换特效标签、判定区与倍率
    show_effects = _bodies(tree, "ShowEffect")
    hit_areas = _bodies(tree, "CreateHitArea")
    normal_attacks = _bodies(tree, "CreateNormalAttack")
    for index in (0, 1, 2):
        show_effects[index][1] = EFFECT_NAMES[index]
    for index, edit in HITAREA_EDITS.items():
        _set_hitarea(hit_areas[index], label=f"skill{level} hitarea{index}", **edit)
    for index in (0, 1):
        _set_cna(normal_attacks[index], CNA_SHAPE[index], numbers["cna"][index],
                 f"skill{level} cna{index}")

    # ---- S5 第三段「月华终斩」：同树内克隆第 49 帧那块（签名零漂移），只改参数
    finish = copy.deepcopy(events[1])
    finish[1][1] = FINISH_WAIT
    finish_effect = _one(_bodies(finish, "ShowEffect"), "ShowEffect in the cloned block")
    finish_effect[1] = EFFECT_NAMES[3]
    if finish_effect[2][0] != "SpecifyEffectDirectly":
        raise KitError("cloned ShowEffect does not use SpecifyEffectDirectly")
    finish_effect[2][1] = FINISH_EFFECT
    finish_effect[6] = list(FINISH_EFFECT_ANCHOR)
    finish_effect[12] = copy.deepcopy(FINISH_EFFECT_SCALE)
    finish_area = _one(_bodies(finish, "CreateHitArea"), "CreateHitArea in the cloned block")
    _set_hitarea(finish_area, binds=FINISH_BINDS, label=f"skill{level} finish",
                 **FINISH_HITAREA)
    finish_shake = _one(_bodies(finish, "ShakeCamera"), "ShakeCamera in the cloned block")
    finish_shake[1] = 2
    _set_cna(_one(_bodies(finish, "CreateNormalAttack"), "CreateNormalAttack in the cloned block"),
             CNA_SHAPE[2], numbers["cna"][2], f"skill{level} cna2")
    rp_block[1].append(finish)

    # ---- S6 删掉母本的 PF 伤害块；S7–S9 换成「全队及协力球」三条状态
    top = tree[11]
    if top[0] != "Block" or len(top[1]) != 2:
        raise KitError(f"donor top-level block has {len(top[1])} commands, expected 2")
    if not _is_command(top[1][1], "FindAllSubjects"):
        raise KitError("donor top-level command #2 is not FindAllSubjects")
    removed = top[1][1][1][2]
    team, team_evidence = _team_block(ctx, level, numbers)
    top[1][1] = team

    after = _command_counts(tree)
    if after != RESULT_COMMAND_COUNTS:
        raise KitError(f"mutated skill tree {level}: commands {after} != {RESULT_COMMAND_COUNTS}")
    evidence = {
        "level": level,
        "reference_point_lifetime": {"before": before_rp, "after": rp[9]},
        "stop_ball": {"before": before_stop, "after": stopball[2]},
        "hit_areas": [{"radius": area[9][1][0]["min"], "lifetime": area[13][1],
                       "max_hits": area[14][1], "buff_target_as": area[24],
                       "binds": [area[19], area[21], area[22]]} for area in _bodies(tree, "CreateHitArea")],
        "multipliers": [copy.deepcopy(body[6]) for body in _bodies(tree, "CreateNormalAttack")],
        "waits": [node[1][1] for node in _walk(tree)
                  if isinstance(node, list) and len(node) == 2 and node[0] == "Event"],
        "removed_power_flip_selector": removed,
        "team_conditions": team_evidence,
    }
    return tree, evidence


def _dsl_problems(tree) -> list[str]:
    problems = [f"direction: {p}" for p in wf_dsl.player_side_dsl_problems(tree)]
    problems += [f"coord: {p}" for p in wf_dsl.coord_sys_source_problems(tree)]
    problems += [f"subject: {p}" for p in L.action_dsl_subject_binding_problems(tree)]
    problems += [f"hit_target: {p}" for p in L.action_dsl_hit_area_target_problems(tree)]
    problems += [f"element: {p}" for p in L.action_dsl_element_problems(tree, ELEMENT)]
    return problems


def write_skill_dsl(ctx, design: dict[str, Any], plan: dict[str, Any],
                    family: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    programs, evidence = [], []
    want_programs = list(design["plan"]["skills"]["programs"])
    for level in ("1", "2"):
        donor_program = ctx.program_path(level).replace(CODE, TEMPLATE_CODE)
        tree, ev = mutate_tree(ctx, ctx.template_dsl(donor_program), level, plan["levels"][level])
        tree, rewrite = ctx.rewrite_effect_refs(tree, family)
        paths = effect_paths(tree)
        expected = sorted([f"{FX_DST_DIR}/{TEMPLATE_CODE}_slash",
                           f"{FX_DST_DIR}/{TEMPLATE_CODE}_smash",
                           f"{FX_DST_DIR}/{TEMPLATE_CODE}_explosion", FINISH_EFFECT])
        if sorted(paths) != expected:
            raise KitError(f"skill {level} effect refs {sorted(paths)} != {expected}")
        problems = _dsl_problems(tree)
        if problems:
            raise KitError(f"skill {level}: DSL problems {problems}")
        if not (isinstance(tree, list) and tree and tree[0] == "ActionDsl"):
            raise KitError(f"skill {level}: write_dsl needs a bare ActionDsl tree")
        logical = ctx.write_dsl(ctx.program_path(level), tree)
        back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
        if back != tree:
            raise KitError(f"skill {level}: package DSL read-back differs from the written tree")
        ev.update({"logical": logical, "donor_program": donor_program,
                   "effect_refs": paths, "effect_rewrite": rewrite})
        evidence.append(ev)
        programs.append(logical)
    got_programs = sorted(ctx.program_path(level) for level in ("1", "2"))
    if got_programs != sorted(want_programs):
        raise KitError(f"skill programs {got_programs} != design {sorted(want_programs)}")
    return programs, evidence


# ---------------------------------------------------------------- 特效族

def fx_transform(ctx, design: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    """风绿 → 雷黄的 LUT：``B/pixel/kyle/fx_lut.json`` 优先，没有就用设计稿内联的色表。"""
    staged = KL.pixel_dir(ctx) / "fx_lut.json"
    if staged.is_file():
        fallback = ctx.pack.evidence_path("kit-fx-lut.json")
        if fallback.is_file():
            fallback.unlink()        # 像素代理的色表已到位：别把 kit 的兜底色表留在回执里误导
        data = KL.load_lut(staged) or {}
        return KL.png_transform_from_lut(staged), {
            "source": "pixel", "path": str(staged), "mode": data.get("mode"),
            "exact_entries": len(data.get("exact") or {}), "hue_rules": len(data.get("hue") or [])}
    clone = design["plan"]["skills"]["effects_clone"][0]
    lut = dict((clone.get("recolor") or {}).get("lut") or {})
    if not lut:
        return None, {"source": "none",
                      "why": "设计稿没有内联色表，且像素代理还没交付 fx_lut.json ⇒ 先不改色"}
    payload = {"schema": KL.LUT_SCHEMA, "mode": "both", "tolerance": 0,
               "_source": "design/kyle.json plan.skills.effects_clone[0].recolor.lut"
                          "（13 格精确色表）+ kit 补的两条色相区间兜底",
               "_why": "母本 593×253 的可见像素 7.5 万，13 格精确色只命中约 1.1 万（抗锯齿过渡色"
                       "全部漏网）⇒ 只跑 exact 会留下大片风绿。exact 先跑（保住设计稿点名的"
                       "芯白/冷蓝/靛紫暗部），剩下的像素再按裁决 §4 的「风绿→雷黄、暗部偏蓝紫」"
                       "走色相区间。B/pixel/kyle/fx_lut.json 一旦到位就整份取代本文件。",
               "exact": {f"#{src}": f"#{dst}" for src, dst in lut.items()},
               "hue": FX_HUE_FALLBACK}
    path = ctx.pack.evidence_path("kit-fx-lut.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    return KL.png_transform_from_lut(path), {"source": "design", "path": str(path),
                                             "entries": len(lut)}


def clone_effects(ctx, design: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    clone = design["plan"]["skills"]["effects_clone"][0]
    if clone["src"].rstrip("/") != FX_SRC_DIR or clone["dst"].rstrip("/") != FX_DST_DIR:
        raise KitError(f"design effects_clone drift: {clone.get('src')} → {clone.get('dst')}")
    transform, lut_note = fx_transform(ctx, design)
    family = ctx.clone_effect_family(FX_SRC_DIR, FX_SUBDIR, layout="codename",
                                     png_transform=transform)
    want_bases = sorted(clone["bases"])
    if sorted(family["copied_bases"]) != want_bases:
        raise KitError(f"cloned effect bases {sorted(family['copied_bases'])} != design {want_bases}")
    if family.get("missing_effects"):
        raise KitError(f"effect family clone is missing {family['missing_effects']}")
    note = {"src": FX_SRC_DIR, "dst": family["dst_dir"], "bases": sorted(family["copied_bases"]),
            "files": len(family.get("files") or []), "lut": lut_note,
            "finish_effect": {"path": FINISH_EFFECT, "cloned": False,
                              "why": "裁决 §4：只引用不改色的官方件直接引用官方路径，零图集增量"}}
    return family, note


# ---------------------------------------------------------------- 表与文案

def check_texts(ctx, design: dict[str, Any]) -> dict[str, str]:
    texts = design["texts"]
    missing = [name for name in MS.TEXT_FIELDS if not texts.get(name)]
    if missing:
        raise KitError(f"design texts lack {missing}")
    drift = {name: (ctx.spec.texts.get(name), texts[name]) for name in MS.TEXT_FIELDS
             if ctx.spec.texts.get(name) != texts[name]}
    if drift:
        raise KitError(f"spec texts differ from design/kyle.json: {sorted(drift)}")
    for name in ("title", "profile", "leader", "skill1", "desc1", "skill2", "desc2"):
        KL.check_panel(texts[name], label=f"texts.{name}")
    return texts


def write_character_row(ctx, texts: dict[str, str]) -> list[str]:
    row = list(ctx.pack.pkg_character_row())
    expect = {0: CODE, 2: "5", 3: str(ELEMENT), 6: str(ctx.spec.pf_type), 8: CODE,
              17: CID_S, 26: ctx.spec.stance, 27: CID_S}
    for index, key in enumerate(ABILITY_KEYS):
        expect[19 + index] = key
    drift = {col: (row[col], value) for col, value in expect.items() if row[col] != value}
    if drift:
        raise KitError(f"package character row differs from spec (rerun tables): {drift}")
    route = KL.voice_route(CODE, VOICE_ROUTE)
    row[9:17] = route
    row[18] = texts["leader"]
    ctx.write_flat(KL.CHARACTER, {CID_S: [row]})
    return route


def write_action_skill(ctx, design: dict[str, Any], plan: dict[str, Any],
                       texts: dict[str, str]) -> dict[str, list[str]]:
    desc = design["plan"]["texts_tables"]["action_skill_desc"]
    if desc["outer_key"] != CODE or desc["value"] != texts["desc1"] != texts["desc2"]:
        raise KitError("design action_skill description block disagrees with texts.desc1/desc2")
    inner = ctx.pkg_nested(CODE, KL.ACTION)
    if sorted(inner) != ["1", "2"]:
        raise KitError(f"package action_skill inner keys {sorted(inner)} != ['1', '2']")
    out: dict[str, list[str]] = {}
    for level, cells in sorted(inner.items()):
        cells = list(cells)
        if len(cells) != 24:
            raise KitError(f"action_skill {level}: {len(cells)} columns, expected 24")
        if cells[7] != ctx.program_path(level):
            raise KitError(f"action_skill {level}: program {cells[7]!r} != {ctx.program_path(level)!r}")
        if cells[2:4] != ["dynamic/skill/atk_nearest", "true"]:
            raise KitError(f"action_skill {level}: targeting columns changed {cells[2:4]}")
        if cells[8:17] != ["1", "0", "425", "", "0", "0", "", "", "(None)"]:
            raise KitError(f"action_skill {level}: c8–c16 differ from the template {cells[8:17]}")
        if any(cells[17:]):
            raise KitError(f"action_skill {level}: c17+ not empty {cells[17:]}")
        cells[0] = texts[f"skill{level}"]
        cells[1] = texts[f"desc{level}"]
        cells[4], cells[5], cells[6] = plan["energy"][level]
        out[level] = cells
    ctx.write_nested(KL.ACTION, CODE, {level: [cells] for level, cells in out.items()},
                     replace_inner=True)
    return out


# ---------------------------------------------------------------- 孤儿字符串

#: ``tables`` 把母本 141159 的 ChangeSkillFlag 那套整体克隆了过来（母本词条 1411596#L1 的 c70
#: 指向 ``change_skill_<code>``）。本套件重写了全部 6 个词条键，一条 ChangeSkillFlag 行都没有
#: ⇒ 这条字符串成了谁都不引用的孤行（裁决 §3：死行不上面板）。
ORPHAN_CAS_KEY = "change_skill_" + CODE


def _cas_claim(ctx):
    return next((claim for claim in ctx.pack.load_claims()
                 if (claim["root"], claim["logical_path"]) == ("common", KL.CAS)), None)


def drop_orphan_change_skill(ctx) -> dict[str, Any]:
    """撤销孤儿 ``change_skill_<code>``，并让本包彻底不带 ``custom_ability_string`` 表。

    幂等：``tables`` 每次重跑都会把这张共享全表再复制进包，本函数每次都把它清掉。
    """
    result: dict[str, Any] = {
        "key": ORPHAN_CAS_KEY,
        "why": "本套件没有 ChangeSkillFlag 词条行（c70 全空）⇒ 这条字符串无人引用，"
               "内容还是母本黑狼骑士的旧文案",
    }
    entry = _cas_claim(ctx)
    if entry is not None and ORPHAN_CAS_KEY in entry.get("outer_keys", []):
        result["unclaimed"] = ctx.unclaim(KL.CAS, [ORPHAN_CAS_KEY])
        entry = _cas_claim(ctx)
    result["still_claimed"] = entry is not None
    path = ctx.pack.pkg_path("common", KL.CAS)
    if entry is None and path.is_file():
        # ``custom_ability_string`` 是共享全表。一个键都不认领却带着 ``tables`` 那一刻的旧快照，
        # 照它整表覆盖会把批内别的角色随后进 live 的键删掉
        # （记忆 wf-device-push-overwrites-device-only-rows：整表覆盖＝灾难）。
        path.unlink()
        result["package_table_deleted"] = True
    return result


# ---------------------------------------------------------------- build

def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.key, str(spec.cid), spec.code, spec.element) != (KEY, CID_S, CODE, ELEMENT):
        raise KitError(f"spec identity mismatch: {spec.key}/{spec.cid}/{spec.code}/{spec.element}")
    if (spec.template_id, spec.template_code, spec.rarity) != (TEMPLATE_ID, TEMPLATE_CODE, 5):
        raise KitError(f"spec template/rarity mismatch: {spec.template_id}/"
                       f"{spec.template_code}/{spec.rarity}")
    if spec.pf_type != 0:
        raise KitError(f"spec pf_type {spec.pf_type} != 0（APK 原生剑型 PF，本角色不做 722）")

    design = load_design(ctx.root)
    texts = check_texts(ctx, design)
    plan = read_skill_plan(design)

    # ---- 1) character 行：语音路由 c9–c16 ＋ 队长技名 c18
    route = write_character_row(ctx, texts)

    # ---- 2) 固有状态「月牙」＋ 48×48 图标
    unique_key, unique_row = build_unique(ctx, design)
    icon = install_unique_icon(ctx)

    # ---- 3) 队长技 6 行 + 词条 6 键 13 条
    leader_rows, leader_evidence = build_leader_rows(ctx, design)
    ctx.write_flat(KL.LEADER, {CID_S: leader_rows})
    ability_rows, ability_evidence = build_ability_rows(ctx, design)
    ctx.write_flat(KL.ABILITY, ability_rows)
    orphan = drop_orphan_change_skill(ctx)

    # ---- 4) 面板文案规则
    evidence = leader_evidence + ability_evidence
    panel = [ev["describe"] for ev in evidence]
    for text in panel:
        KL.check_panel(text, label="panel row")

    # ---- 5) action_skill：名称 / 说明 / 能量
    action = write_action_skill(ctx, design, plan, texts)

    # ---- 6) 技能特效族 + 两档 DSL
    family, fx_note = clone_effects(ctx, design)
    programs, skill_evidence = write_skill_dsl(ctx, design, plan, family)

    # ---- 7) 语音路由目标 + 像素交付件
    switched = KL.write_voice_ready(ctx)
    pixel = KL.install_staged_assets(ctx)

    ctx.sync_character_mirrors()

    ctx.evidence_write("kit-rows.json", {
        "leader": leader_evidence, "ability": ability_evidence,
        "unique_condition": {unique_key: unique_row}, "icon": icon,
    })
    ctx.evidence_write("kit-skills.json", {
        "programs": programs, "energy": {lv: list(v) for lv, v in plan["energy"].items()},
        "action_skill": action, "effects": fx_note, "levels": skill_evidence,
    })

    notes: list[Any] = [
        {"design_json": str(MS.design_path(ctx.root, KEY)), "stage": design.get("stage"),
         "rows_checked": len(evidence),
         "how": "每行都按设计稿铺整行，再用 donor 逐列审计（值必须在 donor 同列出现过或被 "
                "design.edits 点名），然后过 wf_client_legality 三件套并与 desc_expected 逐字比对"},
        {"voice_route": route, "switched_action_skill": switched,
         "why": "kind 1 ConditionExist / 条件种类 31 贯通：技能给全队（含自身）挂贯通 "
                "10–15 秒，这段窗口内满槽播 matched_skill_ready"},
        {"unique_condition": {unique_key: {"name": UNIQUE_NAME, "cap": UNIQUE_CAP,
                                           "remove_if_encoffin": unique_row[13]}},
         "why": "上限写 20（数字）：(None) 会被读成上限 1，队长 L3 与词条 A2#1 的 D134 按层加成会全死"},
        {"unique_icon": icon},
        {"effects": fx_note},
        {"pixel_install": pixel},
        {"skills": {"energy": {lv: list(v) for lv, v in plan["energy"].items()},
                    "multipliers": {lv: [d["cna"] for d in [plan["levels"][lv]]][0]
                                    for lv in ("1", "2")},
                    "buff_target_as": "三段判定区全写 params[23]=4 ⇒ 按直接攻击伤害结算"}},
        {"capabilities": "19 行 + 2 棵 DSL 实跑 required_client_capabilities 全空：零 APK 补丁 kind"},
        {"orphan_custom_ability_string": orphan},
    ]

    deviations = [
        {"want": "设计稿 1399901 两条记录的 c2 分别写 action_skill / attack_common",
         "got": "统一写 attack_common（设计稿 md/json 已同步改，登记为 D12）",
         "why": "裁决 §8：ability 表 c2 每键必须单值，KL.check_ability_key 也硬卡；"
                "官方 attack_common 上 I211 有 31 行、during 内容 kind 1 有 33 行先例"},
        {"want": "设计稿 1399906 两条记录的 c2 写 attack_yellow",
         "got": "改写 attack_common（设计稿已同步，登记为 D13）",
         "why": "官方 attack_yellow × I33（Direct伤害 t5）先例 0 行；attack_common 上 I33 21 行、"
                "I32 518 行。雕像组只影响分类展示，不影响生效"},
        {"want": "L5/L6 与 1399903#1/#2 的 desc_expected 带括注（「月牙」+N 层 / puller 说明）",
         "got": "desc_expected 改成 wf_describe 逐字回读，括注移到设计稿新字段 panel_note（D14）",
         "why": "expect_describe 是逐字比对门禁；带括注就只能整条放弃这道漂移检查"},
        {"want": "设计稿 S7 把新 FindAllSubjects 的绑定号从 donor 的 11 改成 8",
         "got": "保持 donor 原值 11（设计稿已同步，登记为 D15）",
         "why": "S5 新增的月华终斩判定区按设计占用绑定号 8/9/10（CNA 主体＝10）；"
                "FindAllSubjects 再写 8 会在同一棵树里重号，lookup 位会解析到错误主体"
                "（记忆 wf-dsl-subject-lookup-map）"},
        {"want": "设计稿 S5 给「月华终斩」的 ShowEffect 指定 anchor AB / scale Some(3)，未指定主体位",
         "got": "主体位沿用被克隆块的 1（CreateReferencePoint），只改名称/路径/锚点/缩放（D16）",
         "why": "判定区绑定号 10 要等这条 ShowEffect 之后的 CreateHitArea 才创建；"
                "引用尚未创建的绑定＝静默失效。锚点 AB 与 Some(3) 与官方本人 "
                "light_adventurer_4anv 的用法逐格一致（实读其 _1/_2 两树）"},
        {"want": "特效换色用 B/pixel/kyle/fx_lut.json",
         "got": fx_note["lut"].get("source"),
         "why": "像素代理还没交付时用设计稿内联的 13 格色表落盘到 evidence/kit-fx-lut.json；"
                "文件到位后优先用它，kit 无需改代码"},
    ]

    return KL.report(
        ctx,
        summary="凯尔（139990）：雷 · 近战 · 直击输出主C —— 技能给全队与协力球挂贯通／直击伤害"
                "提升／加速，自身「月牙」最多 20 层把层数换成全队与自身直击；三段斩全部按直接"
                "攻击伤害结算",
        status=KL.READY,
        panel=panel,
        notes=notes,
        programs=programs,
        unique_condition={unique_key: {"name": UNIQUE_NAME, "icon": icon["logical"],
                                       "cap": UNIQUE_CAP}},
        required_capabilities=(),
        deviations=deviations,
        extra={"skills": {"programs": programs,
                          "energy": {lv: list(v) for lv, v in plan["energy"].items()},
                          "effects": fx_note}},
    )
