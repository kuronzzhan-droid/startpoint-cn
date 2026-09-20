# -*- coding: utf-8 -*-
"""玛格诺斯（119990 ``lion_swordman_moon``）：火 · 用强化弹射打技能伤害。

体系（裁决 §2「火龙式引擎放能力 3 主位槽 + 情娅式 PF 次数叠技伤」）：

- 放技能 → 自身叠「引擎点火」（固有 ``11999001``）3 层，队长位再 +2 层 ⇒ 上限 5；
- 点火在身时每次强化弹射 → 629 发动追击「氮气爆燃」（一棵独立 DSL 树，按**技能伤害**结算）
  并消耗 1 层；629 行排在 525 消耗行**之前**（记忆卡 R3）；
- 主技能本体 = 母本一刀 + 情娅式「球上挂 900 帧碰撞判定」骑行段（同样按技能伤害结算）；
- 独立乘区（kind 694）与强化弹射次数档（1111833 / 1110993）把 PF 次数换成技能伤害。

设计稿 ``B/design/magnus.{md,json}``；本模块的 PLAN/LEADER/UNIQUE 与设计稿在 :func:`build`
里逐项对账（``_design_problems``），设计稿漂移会当场报错。
"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

import wf_dsl
import wf_midautumn_kitlib as KL
import wf_midautumn_specs as MS

# ---------------------------------------------------------------- 身份与自有键

CID, CODE = 119990, "lion_swordman_moon"
CID_S = str(CID)
TEMPLATE_ID, TEMPLATE_CODE = 111129, "lion_swordman_playable"
UID = MS.unique_condition_id(CID, 1)                       # "11999001"

CHASE_STRING = f"ability_skill_{CODE}_ignite"
SWITCH_STRING = f"change_skill_{CODE}"
VOICE_KEY = f"{CODE}_voice_ready"

CHASE_PROGRAM = f"battle/action/skill/action/rare5/{CODE}${CODE}_ignite"
UC_ICON_ROW = f"battle/common/unique_condition/unique_{CODE}_ignition"
UC_ICON_LOGICAL = UC_ICON_ROW + ".png"
UC_ICON_FRAME_DONOR = "battle/common/unique_condition/unique_fire_dragon_zenith.png"

# 特效：只引用、不改色 ⇒ 直接引用官方路径，不复制（裁决 §4 / 框架 §10.3 / 偏离 D12）。
DONOR_FX_DIR = f"battle/effect/skill_unique/{TEMPLATE_CODE}"
FLAME = f"{DONOR_FX_DIR}/{TEMPLATE_CODE}_flame"

RIDE_DONOR = "battle/action/skill/action/rare5/tsundere_bountyhunter_vt22$tsundere_bountyhunter_vt22_%s"
CHASE_DONOR = ("battle/action/skill/action/ability_skill/"
               "ability_skill_fire_dragon_zenith$ability_skill_fire_dragon_zenith")

_SKILL_DESC = ("挥舞缠绕着火焰的剑向前方斩劈，对敌人造成火属性伤害／之后的一段时间内，"
               "对与球碰撞到的敌人造成火属性伤害／赋予火属性角色及火属性协力球攻击力提升效果")

TEXTS = {
    "title": "月下归途的机车骑士",
    "profile": "中秋夜赶着回乡的狮族青年。后座绑着一大包月饼，说是给等门的家人带的。"
               "他把油门拧到底，说这样月亮就追不上他——其实只是怕团圆饭凉了。",
    "leader": "月下全油门",
    "skill1": "月下咆哮·烈焰甩尾",
    "skill2": "月下咆哮·烈焰甩尾＋",
    "desc1": _SKILL_DESC,
    "desc2": _SKILL_DESC,
    "cv": "AI 合成配音",
}

SPEC = {
    "extra_keys": {
        MS.UNIQUE_CONDITION_LOGICAL: (UID,),
        "master/string/custom_ability_string.orderedmap": (CHASE_STRING, SWITCH_STRING),
        "master/skill/switched_action_skill.orderedmap": (VOICE_KEY,),
    },
}

# ---------------------------------------------------------------- 行计划（donor + 逐格改）

# 固有状态：官方 unique_condition[19] unique_fire_dragon_zenith「勇敢之焰」
UNIQUE_DONOR = "19"
UNIQUE_NAME = "引擎点火"
UNIQUE_CELLS = {0: f"unique_{CODE}_ignition", 2: UC_ICON_ROW, 4: "5", 14: CODE}

# 队长技 5 行（全部瞬发；无 during 行 ⇒ 不会出现恒真 HP 文案）
LEADER: tuple[tuple[str, str, dict[int, str], str], ...] = (
    ("111099#0", "official",
     {0: CODE, 4: "2", 7: "600000", 8: "600000", 9: "Red", 49: "200000", 50: "200000"},
     "火·编成≥6 时: 赋予全队(火) 攻击力 200%"),
    ("111183#1", "official",
     {0: CODE, 4: "2", 7: "600000", 8: "600000", 9: "Red",
      25: "0", 28: "", 29: "", 32: "", 49: "200000", 50: "200000"},
     "火·编成≥6 时: 赋予全队(火) 技能伤害 200%"),
    ("111183#1", "official",
     {0: CODE, 4: "2", 7: "600000", 8: "600000", 9: "Red",
      28: "200000", 29: "200000", 32: "10", 49: "20000", 50: "20000"},
     "火·编成≥6 时: 强化弹射≥2(限10次) → 赋予全队(火) 技能伤害 20%"),
    ("111183#2", "official", {0: CODE, 49: "5000", 50: "5000"},
     "火·编成≥6 时: 强化弹射≥5 → 赋予全队(火) 技能槽 5%"),
    ("111183#3", "official", {0: CODE, 49: "200000", 50: "200000", 66: UID},
     "火·编成≥6 时: 技能发动≥1 → 自身 状态固有 200%×1次"),
)

# 六个词条键。每键 c1（主位限制）与 c2（雕像组）必须全键一致（kitlib.check_ability_key）。
PLAN: dict[int, tuple[tuple[str, str, dict[int, str], str], ...]] = {
    1: (
        ("1111831#0", "official", {0: f"{CODE}_1", 2: "attack_common"},
         "火·MySelf 时: 自身 技能槽 50%→100%"),
        ("1111832#0", "official",
         {0: f"{CODE}_1", 2: "attack_common", 30: "200000", 31: "200000"},
         "火·MySelf 时: 强化弹射≥2(限10次) → 自身 攻击力 10%→20%"),
    ),
    2: (
        ("1110992#0", "official",
         {0: f"{CODE}_2", 2: "action_skill", 30: "200000", 31: "200000",
          51: "5000", 52: "10000"},
         "强化弹射≥2(限10次) → 赋予全队(火) 技能伤害 5%→10%"),
        ("2110065#0", "official",
         {0: f"{CODE}_2", 2: "action_skill", 51: "1000000", 52: "1500000"},
         "技能发动≥1 → 自身 追加连击 10→15"),
    ),
    3: (
        ("1111652#0", "official", {0: f"{CODE}_3", 2: "action_skill", 68: UID},
         "技能发动≥1 → 自身 状态固有 300%×1次"),
        # 629：字符串键 c70 + 程序路径 c71；必须排在下面的 525 消耗行之前。
        ("1611053#0", "official",
         {0: f"{CODE}_3", 1: "false", 2: "action_skill", 6: "188", 7: "0",
          9: "100000", 10: "100000", 12: UID, 27: "2", 28: "", 35: "0",
          70: CHASE_STRING, 71: CHASE_PROGRAM},
         f"状态计数固有≥1[固有{UID}] 时: 强化弹射≥1 → 自身 发动技能动作[{CHASE_STRING}]"),
        ("1111652#2", "official",
         {0: f"{CODE}_3", 2: "action_skill", 6: "188", 7: "0", 9: "100000",
          10: "100000", 12: UID, 27: "2", 68: UID},
         f"状态计数固有≥1[固有{UID}] 时: 强化弹射≥1 → 自身 消耗固有状态 100%"),
        ("1111296#0", "official",
         {0: f"{CODE}_3", 1: "false", 2: "action_skill", 70: SWITCH_STRING},
         f"自身 切换技能形态[{SWITCH_STRING}]"),
    ),
    4: (
        ("1111833#1", "official",
         {0: f"{CODE}_4", 1: "true", 2: "attack_common", 30: "200000", 31: "200000",
          51: "15000", 52: "30000"},
         "强化弹射≥2(限10次) → 自身 技能伤害 15%→30%"),
        ("1110993#1", "official", {0: f"{CODE}_4", 1: "true", 2: "attack_common"},
         "强化弹射≥5(限4次) → 自身 技能伤害 18.75%→37.5%"),
    ),
    5: (
        # kind 694（瞬发独立乘区技能伤害）官方 0 行，只有 live 先例 ⇒ 这一行取 store。
        ("1299925#1", "store", {0: f"{CODE}_5", 2: "action_skill"},
         "自身 独立乘区技能伤害 20%→40%"),
        ("1110993#2", "official", {0: f"{CODE}_5", 1: "true", 2: "action_skill"},
         "火·编成≥6 时: 强化弹射≥5(CT15秒) → 自身 技能槽 5%→10%"),
    ),
    6: (
        ("1110996#0", "official",
         {0: f"{CODE}_6", 2: "special", 51: "10000", 52: "20000"},
         "火·MySelf 时: 自身 技能槽充能 10%→20%"),
        ("1110013#0", "official", {0: f"{CODE}_6", 1: "true", 2: "special"},
         "自身 强化弹射连击数↓ 3→5"),
    ),
}

# 面板字符串（custom_ability_string）。629 的条目不写数字与时间（裁决 §3）。
CAS_TEXTS = {
    CHASE_STRING: "发动技能「氮气爆燃」：在球身点燃引擎之炎，碰撞到敌人时引爆，造成火属性伤害（以技能伤害计算）",
    SWITCH_STRING: "强化『月下咆哮·烈焰甩尾』的威力",
}

# action_skill c4/c5/c6（官方 492 个双档技能的 c4 两档恒同值）
ENERGY = {"1": ("560", "560", "1"), "2": ("560", "510", "1")}

# 语音路由：kind 1 ConditionExist（引擎点火）。kind 3 会因 536 常驻而让 skill_ready 永不播。
VOICE_ROUTE = {"kind": 1, "condition_kind": "28", "condition_id": UID}

# DSL
RIDE_MULT = {"1": (0.15, 0.15), "2": (0.19, 0.225)}
RIDE_ID_REMAP = {7: 6, 8: 7, 9: 8}
RIDE_REMAP_HITS = 6          # ids 19/21/22 各 1 处 + 内层 GH 与两条 CNA 的 p1 共 3 处
CHASE_MULT = 2.0
CHASE_BURST_SCALE = 4


class KitError(KL.KitError):
    pass


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------- 设计稿对账

def _design(ctx) -> dict[str, Any] | None:
    path = ctx.pack.batch_dir / "design" / "magnus.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _norm_cells(cells: Any) -> dict[int, str]:
    return {int(k): ("" if v is None else str(v)) for k, v in dict(cells or {}).items()}


def _design_problems(design: dict[str, Any]) -> list[str]:
    """kit 里的行计划与设计稿逐项对账（donor / source / cells / 预期面板文案）。"""
    problems: list[str] = []
    plan = design.get("plan", {})

    def cmp(label: str, got: tuple[str, str, dict[int, str], str], want: dict[str, Any]) -> None:
        donor, source, cells, expect = got
        if donor != want.get("donor"):
            problems.append(f"{label}: donor {donor!r} != design {want.get('donor')!r}")
        if source != want.get("source"):
            problems.append(f"{label}: source {source!r} != design {want.get('source')!r}")
        if _norm_cells(cells) != _norm_cells(want.get("cells")):
            problems.append(f"{label}: cells {_norm_cells(cells)} != design {_norm_cells(want.get('cells'))}")
        if expect != want.get("desc_expected"):
            problems.append(f"{label}: desc {expect!r} != design {want.get('desc_expected')!r}")

    rows = plan.get("leader_ability", {}).get("rows", [])
    if len(rows) != len(LEADER):
        problems.append(f"leader row count {len(LEADER)} != design {len(rows)}")
    for got, want in zip(LEADER, rows):
        cmp(f"leader#{want.get('index')}", got, want)

    keys = plan.get("ability", {}).get("keys", {})
    for slot, records in PLAN.items():
        want_block = keys.get(f"{CID}{slot}")
        if want_block is None:
            problems.append(f"ability {CID}{slot}: missing from design")
            continue
        want_records = want_block.get("records", [])
        if len(want_records) != len(records):
            problems.append(f"ability {CID}{slot}: {len(records)} records != design {len(want_records)}")
        for got, want in zip(records, want_records):
            cmp(f"ability {CID}{slot}#{want.get('index')}", got, want)

    add = plan.get("unique_conditions", {}).get("add", [])
    if len(add) != 1 or add[0].get("key") != UID:
        problems.append(f"unique_conditions design block unexpected: {[a.get('key') for a in add]}")
    elif _norm_cells(add[0].get("cells")) != _norm_cells(UNIQUE_CELLS):
        problems.append(f"unique cells {_norm_cells(UNIQUE_CELLS)} != design {_norm_cells(add[0].get('cells'))}")

    energy = plan.get("skills", {}).get("energy", {})
    for level in ("1", "2"):
        want = tuple(str(x) for x in energy.get(f"level{level}", ()))
        if want != ENERGY[level]:
            problems.append(f"energy level{level} {ENERGY[level]} != design {want}")

    cas = {row.get("key"): row.get("text")
           for row in plan.get("texts", {}).get("custom_ability_string", {}).get("rows", [])}
    for key, text in CAS_TEXTS.items():
        if cas.get(key) != text:
            problems.append(f"custom_ability_string {key}: text differs from design")

    route = design.get("voice", {}).get("route", {})
    if {str(k): str(v) for k, v in route.items()} != {str(k): str(v) for k, v in VOICE_ROUTE.items()}:
        problems.append(f"voice route {VOICE_ROUTE} != design {route}")
    return problems


# ---------------------------------------------------------------- 固有状态 + 图标

def build_unique(ctx) -> tuple[str, list[str]]:
    key, row = KL.unique_row(ctx, ctx.spec, 1, UNIQUE_DONOR, UNIQUE_CELLS, name=UNIQUE_NAME)
    if key != UID:
        raise KitError(f"unique id {key} != {UID}")
    if row[3] != "1200" or row[4] != "5":
        raise KitError(f"unique duration/cap unexpected: c3={row[3]!r} c4={row[4]!r}")
    KL.write_unique(ctx, ctx.spec, {key: row})
    return key, row


def draw_icon(frame):
    """48×48「引擎点火」：夜黑圆角底 + 金边，上弦月剪影，凹侧一簇火苗。

    与 seasonal7 同工艺：8× 画布绘制 → LANCZOS 缩回 48×48 → 用官方图标的 alpha 当外框
    （alpha 一格不改，避免图集 alpha 门禁变红）。
    """
    from PIL import Image, ImageDraw
    if frame.size != (48, 48):
        raise KitError(f"icon frame donor must be 48x48, got {frame.size}")
    K = 8
    N = 48 * K
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    inner = Image.new("L", (N, N), 0)
    ImageDraw.Draw(inner).rounded_rectangle((3 * K, 3 * K, 45 * K - 1, 45 * K - 1),
                                            radius=5 * K, fill=255)
    top, bot = (36, 30, 44), (18, 14, 22)
    grad = Image.new("RGBA", (1, N))
    for y in range(N):
        t = y / (N - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    layer.paste(grad.resize((N, N)), (0, 0), inner)

    gold, moon = (216, 150, 58, 255), (242, 212, 121, 255)
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((4 * K, 4 * K, 44 * K - 1, 44 * K - 1), radius=4 * K,
                        outline=gold, width=2 * K)

    # 上弦月：大圆减去偏右上的小圆，凹侧朝右下
    disc = Image.new("L", (N, N), 0)
    ImageDraw.Draw(disc).ellipse((8.5 * K, 9.5 * K, 31.5 * K, 32.5 * K), fill=255)
    cut = Image.new("L", (N, N), 0)
    ImageDraw.Draw(cut).ellipse((15.0 * K, 6.5 * K, 38.0 * K, 29.5 * K), fill=255)
    crescent = Image.composite(Image.new("L", (N, N), 0), disc, cut)
    layer.paste(Image.new("RGBA", (N, N), moon), (0, 0),
                Image.composite(crescent, Image.new("L", (N, N), 0), inner))

    # 火苗：外焰 #FF8A3C → 内焰 #FFE08A（竖向渐变，走蒙版）
    outer = [(31.0, 20.0), (35.6, 27.2), (36.4, 32.6), (33.6, 37.8), (28.4, 38.4),
             (25.0, 34.6), (25.6, 29.6), (28.4, 25.6), (29.4, 28.2)]
    flame = Image.new("L", (N, N), 0)
    ImageDraw.Draw(flame).polygon([(x * K, y * K) for x, y in outer], fill=255)
    fgrad = Image.new("RGBA", (1, N))
    lo, hi = (255, 138, 60), (255, 224, 138)
    for y in range(N):
        t = max(0.0, min(1.0, (y / (N - 1) - 0.40) / 0.45))
        fgrad.putpixel((0, y), tuple(round(lo[i] + (hi[i] - lo[i]) * (1 - t)) for i in range(3)) + (255,))
    layer.paste(fgrad.resize((N, N)), (0, 0),
                Image.composite(flame, Image.new("L", (N, N), 0), inner))
    core = [(31.0, 27.0), (33.4, 31.4), (31.6, 35.8), (28.6, 34.4), (28.8, 30.4)]
    ImageDraw.Draw(layer).polygon([(x * K, y * K) for x, y in core], fill=(255, 240, 196, 255))

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
    raw = ctx.official_read(UC_ICON_FRAME_DONOR)
    if raw is None:
        _root, raw, _how = ctx.pack.template_asset(UC_ICON_FRAME_DONOR)
    frame = ctx.png_open(raw)
    data = ctx.png_store_bytes(draw_icon(frame))
    ctx.write_asset("common", UC_ICON_LOGICAL, data)
    back = ctx.png_open(ctx.pack.pkg_path("common", UC_ICON_LOGICAL).read_bytes())
    if back.size != (48, 48):
        raise KitError(f"unique_condition icon must stay 48x48, got {back.size}")
    if back.getchannel("A").tobytes() != frame.getchannel("A").tobytes():
        raise KitError("unique_condition icon alpha differs from the official frame donor")
    return {"logical": UC_ICON_LOGICAL, "frame_donor": UC_ICON_FRAME_DONOR,
            "sha256": _sha256(data), "bytes": len(data)}


# ---------------------------------------------------------------- 词条 / 队长技 / 面板串

def build_rows(ctx) -> dict[str, Any]:
    spec = ctx.spec
    evidence: list[dict[str, Any]] = []
    caps: set[str] = set()

    leader: list[list[str]] = []
    for index, (donor, source, cells, expect) in enumerate(LEADER):
        row, ev = KL.build_row(ctx, "leader_ability", donor, cells, source=source,
                               element=spec.element, expect_describe=expect,
                               label=f"leader#{index}")
        leader.append(row)
        evidence.append(ev)
        caps.update(ev["capabilities"])
    if any(r[0] != CODE for r in leader):
        raise KitError(f"leader c0 must be {CODE}: {[r[0] for r in leader]}")

    ability: dict[str, list[list[str]]] = {}
    for slot, records in PLAN.items():
        key = f"{CID}{slot}"
        rows: list[list[str]] = []
        for index, (donor, source, cells, expect) in enumerate(records):
            row, ev = KL.build_row(ctx, "ability", donor, cells, source=source,
                                   element=spec.element, expect_describe=expect,
                                   label=f"{key}#{index}")
            rows.append(row)
            evidence.append(ev)
            caps.update(ev["capabilities"])
        KL.check_ability_key(rows, key, CODE, slot)
        ability[key] = rows

    _order_problems(ability[f"{CID}3"])
    return {"leader": leader, "ability": ability, "evidence": evidence,
            "capabilities": sorted(caps)}


def _order_problems(rows: list[list[str]]) -> None:
    """槽 3 的硬顺序契约：629 发动追击必须排在同触发的 525 消耗行之前（记忆卡 R3）。

    顺序反了 ⇒ 最后一层先被吃掉，最后一次强化弹射打不出追击。
    """
    kinds = [row[47] for row in rows]
    if "629" not in kinds or "525" not in kinds:
        raise KitError(f"ability slot 3 lost the 629/525 pair: {kinds}")
    if kinds.index("629") > kinds.index("525"):
        raise KitError(f"629 must precede the 525 consume row, got {kinds}")
    invoke, consume = rows[kinds.index("629")], rows[kinds.index("525")]
    if invoke[27] != consume[27]:
        raise KitError(f"629/525 trigger kinds differ: {invoke[27]} vs {consume[27]}")
    if invoke[6] != consume[6] or invoke[12] != consume[12]:
        raise KitError("629/525 preconditions differ; both must gate on the same unique condition")


def write_strings(ctx) -> dict[str, str]:
    """custom_ability_string：629 条目 + 技能强化条目。"""
    declared = set(ctx.spec.extra_keys.get(KL.CAS, ()))
    missing = [key for key in CAS_TEXTS if key not in declared]
    if missing:
        raise KitError(f"custom_ability_string keys not declared in SPEC['extra_keys']: {missing}")
    KL.check_panel(CAS_TEXTS[CHASE_STRING], label=CHASE_STRING)
    KL.check_panel(CAS_TEXTS[SWITCH_STRING], skill_flag=True, label=SWITCH_STRING)
    official = ctx.official_flat(KL.CAS)
    clashes = [key for key in CAS_TEXTS if key in official]
    if clashes:
        raise KitError(f"custom_ability_string keys already exist officially: {clashes}")
    ctx.write_flat(KL.CAS, {key: [[text]] for key, text in CAS_TEXTS.items()})
    return dict(CAS_TEXTS)


# ---------------------------------------------------------------- 语音路由

def write_voice_route(ctx) -> list[str]:
    import wf_seasonal7_voice as V
    cols = KL.voice_route(CODE, VOICE_ROUTE)
    if cols != ["1", "28", UID, "", "", VOICE_KEY, "false", "false"]:
        raise KitError(f"unexpected voice route columns: {cols}")
    row = ctx.csv_split(ctx.pkg_flat(KL.CHARACTER)[CID_S])[0]
    new_row = V.route_character_row(list(row), cols, CODE)
    ctx.write_flat(KL.CHARACTER, {CID_S: [new_row]})
    return cols


# ---------------------------------------------------------------- action_skill

def write_action_skill(ctx) -> dict[str, list[str]]:
    inner = ctx.pkg_nested(CODE)
    if set(inner) != {"1", "2"}:
        raise KitError(f"package action_skill inner keys {sorted(inner)}")
    out: dict[str, list[str]] = {}
    for level, cells in sorted(inner.items()):
        cells = list(cells)
        if len(cells) != 24:
            raise KitError(f"action_skill {level} has {len(cells)} columns, expected 24")
        if cells[7] != ctx.program_path(level):
            raise KitError(f"action_skill {level} program path {cells[7]!r} unexpected")
        if cells[0] != TEXTS[f"skill{level}"] or cells[1] != TEXTS[f"desc{level}"]:
            raise KitError(f"action_skill {level} name/desc differ from TEXTS (rerun tables)")
        if cells[2] != "dynamic/skill/atk_front":
            raise KitError(f"action_skill {level} auto-cast target {cells[2]!r} differs from the template")
        cells[4], cells[5], cells[6] = ENERGY[level]
        out[level] = cells
    ctx.write_nested(KL.ACTION, CODE, {lv: [cells] for lv, cells in out.items()},
                     replace_inner=True)
    return out


# ---------------------------------------------------------------- DSL

def _commands(tree, name: str | None = None) -> list[list]:
    return list(wf_dsl.iter_dsl_commands(tree, name) if name
                else wf_dsl.iter_dsl_commands(tree))


def _declared_ids(tree) -> list[int]:
    """树里声明的绑定 id：RP c10、CreateHitArea c19/c21/c22、FindAllSubjects c1。"""
    ids: list[int] = []
    for c in _commands(tree):
        if c[0] == "CreateReferencePoint":
            ids.append(c[10])
        elif c[0] == "CreateHitArea":
            ids.extend((c[19], c[21], c[22]))
        elif c[0] == "FindAllSubjects":
            ids.append(c[1])
    return ids


def _remap_ints(node, mapping: dict[int, int]) -> int:
    hits = 0
    if isinstance(node, list):
        for i, value in enumerate(node):
            if isinstance(value, bool):
                continue
            if isinstance(value, int) and value in mapping:
                node[i] = mapping[value]
                hits += 1
            else:
                hits += _remap_ints(value, mapping)
    elif isinstance(node, dict):
        for value in node.values():
            hits += _remap_ints(value, mapping)
    return hits


def _ride_event(ctx, level: str) -> list:
    """从情娅 vt22 的树里摘出「Wait 90 → 球上 Circle30 / 寿命 900」那个 Event 块。

    只保留其中的 CreateHitArea（丢掉同块里的 ConditionalsChangeSkillFlag → 直击分支：
    直击不是本角色的轴）。
    """
    donor = ctx.template_dsl(RIDE_DONOR % level)
    block = None
    for node in donor[11][1]:
        if not (isinstance(node, list) and node and node[0] == "Event"):
            continue
        if any(c[2] == -18 and c[13] == ["SpecifyHitAreaLifetimeDirectly", 900]
               for c in _commands(node, "CreateHitArea")):
            block = copy.deepcopy(node)
            break
    if block is None:
        raise KitError(f"vt22 level {level}: riding Event block not found")

    waits = _find_waits(block)
    if len(waits) < 1:
        raise KitError("riding block has no Wait node")
    wait = waits[0]
    if wait[1] != 90:
        raise KitError(f"riding block Wait frame {wait[1]} != 90")
    bodies = [x for x in wait if isinstance(x, list) and x and x[0] == "Block"]
    if len(bodies) != 1:
        raise KitError(f"unexpected Wait body shape ({len(bodies)} blocks)")
    keep = [c for c in bodies[0][1]
            if isinstance(c, list) and c[0] == "Command" and c[1][0] == "CreateHitArea"]
    if len(keep) != 1:
        raise KitError(f"expected exactly 1 CreateHitArea in the riding block, got {len(keep)}")
    bodies[0][1][:] = keep
    return block


def _find_waits(node, out: list | None = None) -> list:
    out = [] if out is None else out
    if isinstance(node, list):
        if node and node[0] == "Wait":
            out.append(node)
            return out
        for item in node:
            _find_waits(item, out)
    return out


def _tune_ride(hitarea: list, level: str) -> dict[str, Any]:
    if (hitarea[19], hitarea[21], hitarea[22]) != (7, 8, 9):
        raise KitError(f"riding hit-area ids {hitarea[19:23]} differ from the vt22 donor")
    hits = _remap_ints(hitarea, RIDE_ID_REMAP)
    if hits != RIDE_REMAP_HITS:
        raise KitError(f"riding id remap touched {hits} ints, expected {RIDE_REMAP_HITS}")
    if (hitarea[19], hitarea[21], hitarea[22]) != (6, 7, 8):
        raise KitError(f"riding hit-area ids after remap: {hitarea[19:23]}")

    low, high = RIDE_MULT[level]
    attacks = _commands(hitarea, "CreateNormalAttack")
    if len(attacks) != 2:
        raise KitError(f"riding block should carry 2 CreateNormalAttack, got {len(attacks)}")
    for cna in attacks:
        cna[6][0]["min"], cna[6][0]["max"] = low, high
        if isinstance(cna[15], list) and cna[15] and cna[15][0] == "SpecifyHitEffectDirectly":
            cna[15] = ["Fine"]          # 引擎内置命中特效 ⇒ 不引用情娅族，图集零增量

    effects = _commands(hitarea, "ShowEffect")
    if len(effects) != 2:
        raise KitError(f"riding block should carry 2 ShowEffect, got {len(effects)}")
    for show in effects:
        on_create = show[5][:1] == ["SpecifyEffectLifetimeDirectly"]
        show[1] = "ride_aura" if on_create else "ride_hit"
        show[2] = ["SpecifyEffectDirectly", FLAME]
        show[5] = ["PlayOnlyFirstSequence"]
        show[6] = ["AB"]                # 球上不用朝向坐标
    return {"multiplier": [low, high], "hit_area_ids": [6, 7, 8],
            "effects": [show[1] for show in effects]}


def build_main_tree(ctx, level: str) -> tuple[Any, dict[str, Any]]:
    template_program = ctx.program_path(level).replace(CODE, TEMPLATE_CODE)
    tree = copy.deepcopy(ctx.template_dsl(template_program))
    before = _declared_ids(tree)
    if sorted(before) != [0, 1, 2, 3, 4, 5]:
        raise KitError(f"template {template_program} declares ids {sorted(before)}, expected 0..5")
    if tree[10] != 0:
        raise KitError(f"template root buffTargetAs {tree[10]} != 0 (skill-damage attribution)")

    ride = _ride_event(ctx, level)
    hitarea = _commands(ride, "CreateHitArea")[0]
    ride_info = _tune_ride(hitarea, level)

    root = tree[11]
    positions = [i for i, node in enumerate(root[1])
                 if isinstance(node, list) and node[0] == "Command"
                 and node[1][0] == "CreateReferencePoint"]
    if len(positions) != 1:
        raise KitError(f"template root has {len(positions)} CreateReferencePoint commands")
    root[1].insert(positions[0] + 1, ride)

    ids = _declared_ids(tree)
    if len(ids) != len(set(ids)) or sorted(ids) != list(range(9)):
        raise KitError(f"merged tree binding ids not unique/contiguous: {sorted(ids)}")
    sword = [c for c in _commands(tree, "CreateNormalAttack") if c[6][0].get("max", 0) > 1]
    if len(sword) != 1:
        raise KitError(f"expected exactly 1 main-slash CreateNormalAttack, got {len(sword)}")
    return tree, {"level": level, "ride": ride_info, "slash": dict(sword[0][6][0]),
                  "root_commands": [n[1][0] if n[0] == "Command" else n[0] for n in root[1]]}


def build_chase_tree(ctx) -> tuple[Any, dict[str, Any]]:
    """追击「氮气爆燃」：官方火龙 ability_skill 原树，只换特效路径与倍率。

    根头 ``tree[10]=0`` 保持不动：629 以 AbilitySkill 执行 ⇒ 自动按**技能伤害**结算
    （记忆卡 wf-dsl-damage-attribution-bufftargetas）。写 2 会被掰成能力伤害，那是卖点的反面。
    """
    tree = copy.deepcopy(ctx.template_dsl(CHASE_DONOR))
    if tree[10] != 0:
        raise KitError(f"chase donor root buffTargetAs {tree[10]} != 0")
    effects = _commands(tree, "ShowEffect")
    if len(effects) != 2:
        raise KitError(f"chase donor should carry 2 ShowEffect, got {len(effects)}")
    names = []
    for show in effects:
        aura = str(show[2][1]).endswith("_player")
        show[1] = "ignite_aura" if aura else "ignite_burst"
        show[2] = ["SpecifyEffectDirectly", FLAME]
        if aura:
            if show[5] != ["SpecifyEffectLifetimeDirectly", 100]:
                raise KitError(f"chase aura lifetime {show[5]} differs from the donor")
            show[5] = ["PlayOnlyFirstSequence"]      # 母本 _flame 是 once/70 帧
        else:
            if show[5] != ["SpecifyEffectLifetimeDirectly", 30]:
                raise KitError(f"chase burst lifetime {show[5]} differs from the donor")
            show[12] = ["Some", [{"min": CHASE_BURST_SCALE, "max": CHASE_BURST_SCALE}]]
        names.append(show[1])
    if sorted(names) != ["ignite_aura", "ignite_burst"]:
        raise KitError(f"chase effect names unexpected: {names}")
    for hide in _commands(tree, "HideEffect"):
        hide[1] = "ignite_aura"
    attacks = _commands(tree, "CreateNormalAttack")
    if len(attacks) != 1:
        raise KitError(f"chase donor should carry 1 CreateNormalAttack, got {len(attacks)}")
    attacks[0][6][0]["min"] = attacks[0][6][0]["max"] = CHASE_MULT
    areas = _commands(tree, "CreateHitArea")
    if len(areas) != 2:
        raise KitError(f"chase donor should carry 2 CreateHitArea, got {len(areas)}")
    return tree, {"multiplier": CHASE_MULT, "burst_scale": CHASE_BURST_SCALE,
                  "hit_areas": [[a[9], a[13], a[14]] for a in areas]}


def _dsl_problems(tree) -> None:
    problems = wf_dsl.player_side_dsl_problems(tree)
    if problems:
        raise KitError(f"player-side DSL problems: {problems}")


def _effect_ref_problems(ctx, tree) -> list[str]:
    """DSL 引用的特效路径必须在官方归档里真的存在（引用官方路径，不复制）。"""
    missing = []
    for value in ctx.walk(tree):
        if not isinstance(value, str) or not value.startswith("battle/effect/"):
            continue
        if not any(ctx.official_read(f"{value}.{kind}.amf3.deflate") is not None
                   for kind in ("parts", "timeline")):
            missing.append(value)
    return sorted(set(missing))


def write_skills(ctx) -> dict[str, Any]:
    info: dict[str, Any] = {}
    programs = []
    for level in ("1", "2"):
        tree, meta = build_main_tree(ctx, level)
        _dsl_problems(tree)
        refs = _effect_ref_problems(ctx, tree)
        if refs:
            raise KitError(f"skill {level} references effects absent from the official baseline: {refs}")
        logical = ctx.write_dsl(ctx.program_path(level), tree)
        back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
        if back != tree:
            raise KitError(f"skill {level} readback differs from the written tree")
        meta["logical"] = logical
        meta["sha256"] = _sha256(ctx.pack.pkg_path("common", logical).read_bytes())
        info[level] = meta
        programs.append(ctx.program_path(level))

    tree, meta = build_chase_tree(ctx)
    _dsl_problems(tree)
    refs = _effect_ref_problems(ctx, tree)
    if refs:
        raise KitError(f"chase references effects absent from the official baseline: {refs}")
    logical = ctx.write_dsl(CHASE_PROGRAM, tree)
    if ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes()) != tree:
        raise KitError("chase readback differs from the written tree")
    meta["logical"] = logical
    meta["sha256"] = _sha256(ctx.pack.pkg_path("common", logical).read_bytes())
    info["ignite"] = meta
    programs.append(CHASE_PROGRAM)
    return {"skills": info, "programs": programs}


# ---------------------------------------------------------------- 入口

SUMMARY = "玛格诺斯：火 · 用强化弹射打技能伤害（引擎点火 → 629 追击「氮气爆燃」+ 骑行碰撞）"

NOTES = [
    "特效全部直接引用官方 battle/effect/skill_unique/lion_swordman_playable/*（不克隆、图集零增量，裁决 §4）",
    "槽 3 整键 c1=false（主位限制，与母本 111129 槽 3 同形）：合击副位不显示这四条",
    "629 追击与主技能骑行段都按技能伤害结算（根头 buffTargetAs=0），吃 694 独立乘区",
    "「引擎点火」固有 1200 帧 / 上限 5 层：能力 3 每次施放 +3 层，队长技 L4 再 +2 层",
    "球上的两处光环（骑行 ride_aura、追击 ignite_aura）都保持 donor 的缩放（≈1）："
    "母本 _flame 在主技能地裂处是 scale 3 配 Circle150，球半径只有 30 ⇒ 不放大；金丝雀 C5 真机再调",
    "像素交付件（sprite_sheet / special_sprite_sheet）若是标准 PNG，装包时由 kitlib 换成 WF 存储态魔数"
    "（\\x89png）；不换会在 manifest 门禁报 WF storage signature required",
]

DEVIATIONS = [
    {"want": "设计稿 effects_clone：把母本三个特效基名克隆到 skill_unique/lion_swordman_moon/（约 1.02% 图集）",
     "got": "不克隆，三处全部直接引用官方 lion_swordman_playable 族路径",
     "why": "裁决 §4 / 框架 §10.3：只引用不改色的官方特效直接引用官方路径；B/pixel/magnus/fx_lut.json "
            "不存在 ⇒ 本轮不改色。另：clone_effect_family 保留 donor 基名并落在 <code>/<子目录>/ 下，"
            "设计稿 A1「基名改成 lion_swordman_moon_*」在框架里做不到。设计稿已同步（偏离 D12）。"},
    {"want": "设计稿 skills.energy.level1 = c4 550 / c5 560",
     "got": "c4 560 / c5 560（二档仍 560/510）",
     "why": "官方 492 个双档 action_skill 的 c4 在两档之间 100% 相同，且 c5 从不高于 c4；原值让一档比母本"
            "还贵、二档反而便宜。设计稿已同步（偏离 D13）。"},
    {"want": "追击光环用 loop 型光环（情娅 _player / 火龙 _player 的 900 与 100 帧寿命）",
     "got": "母本 _flame 的 PlayOnlyFirstSequence（一次性 70 帧），开窗与每次命中各烧一下",
     "why": "母本 _flame 是 once/70 帧序列，把它按 900/100 帧强行拉长属于未验行为；改用官方已有的寿命写法。"},
    {"want": "像素件（小人 sprite_sheet 等）随 kit 一起装包",
     "got": "B/pixel/magnus/install.json 不存在时自动跳过，包内保持母本像素件",
     "why": "像素/立绘/语音不归本代理；像素代理交付后重跑 kit 即可装入（install_staged_assets 的静默跳过口）。"},
]


def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.cid, spec.code) != (CID, CODE):
        raise KitError(f"kit bound to {CID}/{CODE}, got {spec.cid}/{spec.code}")
    if (spec.template_id, spec.template_code) != (TEMPLATE_ID, TEMPLATE_CODE):
        raise KitError(f"template must stay {TEMPLATE_ID}/{TEMPLATE_CODE}, "
                       f"got {spec.template_id}/{spec.template_code}")
    if spec.element != 0:
        raise KitError(f"magnus stays fire (element 0), got {spec.element}")

    design = _design(ctx)
    design_problems = _design_problems(design) if design else ["design/magnus.json absent"]
    if design and design_problems:
        raise KitError(f"kit drifted from the design document: {design_problems}")

    voice_cols = write_voice_route(ctx)
    unique_key, unique_row = build_unique(ctx)
    icon = install_unique_icon(ctx)

    rows = build_rows(ctx)
    ctx.write_flat(KL.LEADER, {CID_S: rows["leader"]})
    ctx.write_flat(KL.ABILITY, rows["ability"])
    strings = write_strings(ctx)

    action = write_action_skill(ctx)
    skills = write_skills(ctx)
    voice_ready = KL.write_voice_ready(ctx)
    pixel = KL.install_staged_assets(ctx)
    mirrors = ctx.sync_character_mirrors()

    panel = [ev["describe"] for ev in rows["evidence"]] + list(strings.values())
    ctx.evidence_write("kit-rows.json", {
        "leader": rows["leader"], "ability": rows["ability"],
        "unique_condition": {unique_key: unique_row},
        "custom_ability_string": strings, "action_skill": action,
        "voice_route": voice_cols, "evidence": rows["evidence"],
    })
    return KL.report(
        ctx,
        summary=SUMMARY,
        status=KL.READY,
        panel=panel,
        notes=NOTES + [{"icon": icon, "pixel": pixel, "voice_ready": voice_ready,
                        "mirrors": mirrors, "design_checked": bool(design)}],
        programs=skills["programs"],
        unique_condition={unique_key: {"name": UNIQUE_NAME, "icon": UC_ICON_LOGICAL,
                                       "duration_frames": int(unique_row[3]),
                                       "cap": int(unique_row[4])}},
        required_capabilities=rows["capabilities"],
        deviations=DEVIATIONS,
        extra={"skills_detail": {"trees": skills["skills"],
                                 "energy": {lv: list(ENERGY[lv]) for lv in ("1", "2")}},
               "voice_route": voice_cols},
    )
