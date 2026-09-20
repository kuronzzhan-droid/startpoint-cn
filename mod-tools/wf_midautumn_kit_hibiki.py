# -*- coding: utf-8 -*-
"""中秋批次 kit：澄波响·满月混音 169988 ``psychic_teleport_moon``（暗属性 PF 主 C）。

定位「贯通循环型」强化弹射主 C：贯通中 → PF 大幅增伤 → PF 再赋予长贯通并积一层「回响」→ 循环转起来；
PF 之后立刻进入疾驰，冲刺参数被改造成「瞬间移动」。设计与数值以
``work/character_packs/midautumn-20260920/design/hibiki.{md,json}`` 为准（本模块只放 donor 地址与
装配逻辑，倍率/列值全部从设计 JSON 读，两边漂移即报错）。

落地内容
    - ``unique_condition[16998801]``「回响」（donor 官方 ``7``「加热」；c4 上限 **5**，禁 ``(None)``）
      与它的 48×48 图标（alpha 取官方图标外框）；
    - 队长 6 行（含 722 专属 PF）、词条 6 键 15 条：官方/live donor + 逐格改，每行过
      ``wf_client_legality`` 三件套并与设计登记的 ``wf_describe`` 文案逐字核对；
    - ``custom_ability_string``：722 的 c82 串 ``override_string_…_pf`` 与槽 5 的面板覆盖
      ``desc_override_…_5``；
    - ``action_skill`` 两档（名称/描述由 tables 写 TEXTS，这里改图标 c2 与能量 c4/c5）；
    - 技能 DSL 两档：三个官方母本拼一棵（她自己 161183 的骨架/演出/回响 + 威隆 161153 的音场判定区
      与自身攻击 + 荷莉 261083 的队伍块），特效只克隆 1 族 ``song``；
    - 专属强化弹射 722 三档：官方 ``special_lv{n}`` 整树作底座（sha 锁定）+ 官方 supporter 辅助增益块
      （复用 :func:`wf_seasonal7_kit_philia.pf_support_block`），倍率统一 ×4.8，贯通帧拉长到 240/300/360；
      ``power_flip_action[psychic_teleport_moon_pf]`` 指向三档程序；
    - character c9–c16 语音路由（kind 1 ConditionExist ← 固有 16998801）与
      ``switched_action_skill[psychic_teleport_moon_voice_ready]``；
    - ``B/pixel/hibiki/install.json`` 里的像素/特效成品（缺文件静默跳过）。

不碰：立绘、像素成品 PNG、语音音频、live store / ``assets/`` / ``.cdn`` / 设备 / 存档。
由 ``python mod-tools/wf_midautumn_build.py --char hibiki --step kit`` 调用 :func:`build`。
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
import wf_seasonal7_common as C  # noqa: E402
# 只读复用菲莉亚（159996，live 在线）的 DSL 工具与官方 supporter 辅助增益块 —— 裁决：
# 「复用菲莉亚已上线的 build_pf_tree 代码路径」。本模块不修改 wf_seasonal7_* 任何文件。
import wf_seasonal7_kit_philia as PH  # noqa: E402

KitError = KL.KitError

KEY = "hibiki"
CID, CODE = 169988, "psychic_teleport_moon"
ELEMENT = 5                                   # 暗（0 基内部编号）
TEMPLATE_ID, TEMPLATE_CODE = 161183, "psychic_teleport_playable"

UID = MS.unique_condition_id(CID, 1)          # "16998801"
UNIQUE_DONOR = "7"                            # 官方 unique_condition[7]「加热」
UNIQUE_STRING_ID = f"unique_{CODE}_echo"
UNIQUE_NAME = "回响"
UNIQUE_ICON_ROW = f"battle/common/unique_condition/{UNIQUE_STRING_ID}"
UNIQUE_ICON_LOGICAL = UNIQUE_ICON_ROW + ".png"
UNIQUE_ICON_FRAME = "battle/common/unique_condition/unique_combat_animal_xm21.png"
UNIQUE_CAP = "5"                              # 禁 (None)：那是上限 1 层，三条 D134 按层加成会全死

PFA = "master/skill/power_flip_action.orderedmap"
PF_KEY = f"{CODE}_pf"
PF_PROGRAMS = tuple(f"battle/action/power_flip/action/override/{PF_KEY}${PF_KEY}_lv{n}"
                    for n in (1, 2, 3))
SPECIAL_PROGRAMS = {n: f"battle/action/power_flip/action/special$special_lv{n}" for n in (1, 2, 3)}
# 官方 special 底座指纹（2026-09-20 实读 .cdn/cn 官方归档；漂移就说明底座换了，必须重新核算倍率）
SPECIAL_SHA = {
    1: "569f2082c4633bae7e71610c296d6ab141cfabe1f3c4e5e0034c46dbf3e22961",
    2: "4ed6440b9ded6d435e2c2fb9a640541b2c3fc43c5c0068de41077bab07ad73f2",
    3: "7bebfdd5fc3ff46f2a789f7d631ac02084afa0cd11f4f19f71037f7faba3447d",
}
PF_SCALE = 4.8                                # 三档统一的唯一缩放旋钮（设计 §5.2）
PF_PIERCE_FRAMES = {1: 240, 2: 300, 3: 360}   # 官方 60/90/150 → 拉长（贯通是整套循环的命门）
PF_SUPPORT_BIND = 400                         # 辅助增益块主体 id 段（philia.PF_SUPPORT_OFFSET）

CAS_PF = f"override_string_{CODE}_pf"
CAS_DASH = f"desc_override_{CODE}_5"
VOICE_KEY = f"{CODE}_voice_ready"
VOICE_ROUTE = {"kind": 1, "condition_kind": "28", "condition_id": UID}

SKILL_ICON = "dynamic/skill/atk_surround"     # 母本 skill_str_up → 威隆同类技能的官方图标
SKILL_DONORS = {
    "template": f"battle/action/skill/action/rare5/{TEMPLATE_CODE}${TEMPLATE_CODE}_2",
    "field": "battle/action/skill/action/rare5/veteran_hunter_3anv$veteran_hunter_3anv_2",
    "team": "battle/action/skill/action/rare4/herbalist_xm22$herbalist_xm22_2",
}
FX_SRC_DIR = f"battle/effect/skill_unique/{TEMPLATE_CODE}"
FX_SUBDIR = "song"
FX_BACK = f"{TEMPLATE_CODE}_back"
FX_EF = f"{TEMPLATE_CODE}_ef"
FX_DST_DIR = f"battle/effect/skill_unique/{CODE}/{FX_SUBDIR}"
FORBIDDEN_FX_PREFIXES = ("battle/effect/skill_unique/veteran_hunter_3anv/",
                         "battle/effect/skill_unique/herbalist_xm22/")

FIELD_WAIT = 30                               # 母本 Event Wait(44) → 30
FIELD_SUBJECT_BASE = 100                      # 音场块主体 id 段
TEAM_SUBJECT_BASE = 200                       # 队伍块主体 id 段
TEAM_PFDMG_FRAMES = 1200                      # 队伍 PF 伤害帧 900 → 1200

# 两档的倍率/强度（设计 §4.2，单位 1.0 = 100%）
SKILL_PARAMS = {
    "1": {"field": (2.4, 2.4), "self_atk": (1.2, 1.2), "team_pfdmg": (1.0, 1.0), "pierce": (720, 720)},
    "2": {"field": (2.6, 3.0), "self_atk": (1.5, 1.5), "team_pfdmg": (1.2, 1.2), "pierce": (810, 810)},
}

# donor 地址（设计稿的 ``#N`` 是 1 基记录号，这里换成 kitlib 要的 0 基下标）
LEADER_DONORS = (("live", "159996#3"),        # 菲莉亚 722 整行（无前置）
                 ("official", "161153#0"),    # 威隆 3 周年：贯通中全队暗攻
                 ("official", "161153#1"),    # 威隆：贯通中自身 PF 伤害
                 ("official", "161153#2"),    # 威隆：暗共鸣 贯通延长
                 ("official", "131182#3"),    # 莱特 4 周年：共鸣 + PF → 疾驰
                 ("official", "131182#1"))    # 莱特：PF Lv1 命中≥4 → 全队暗攻
ABILITY_DONORS = {
    "1699881": (("official", "1611533#0"), ("official", "1611533#1")),
    "1699882": (("official", "1611532#0"), ("official", "1611532#1")),
    "1699883": (("official", "1410813#0"),          # 芙拉菲·圣诞：PF → 固有 +1 层
                ("live", "1699942#0"),              # 白虎：每层 → PF 伤害
                ("live", "1599971#4")),             # 泽赫尔：每层 → 独立乘区 PF 伤害
    "1699884": (("official", "1611531#0"), ("official", "1611531#1")),
    "1699885": (("live", "1699991#2"), ("live", "1699991#6"),   # 基诺维：422 冲刺参数
                ("live", "1699991#4"), ("live", "1699991#3")),
    "1699886": (("official", "1611472#0"), ("official", "2110026#0"),
                ("live", "1699942#1")),             # 白虎：每层 → 全队暗攻（设计 D-9 从槽 3 迁来）
}
ABILITY_KEYS = tuple(f"{CID}{slot}" for slot in range(1, 7))

TEXTS: dict[str, str] = {}       # 10 个文本键在 design/hibiki.json 的 texts 块里（build 里核验）
SPEC = {
    "required_capabilities": ("dash-parameter-v1", "panel-description-override-v2"),
    "extra_keys": {
        MS.UNIQUE_CONDITION_LOGICAL: (UID,),
        PFA: (PF_KEY,),
        KL.CAS: (CAS_PF, CAS_DASH),
        KL.SWITCHED: (VOICE_KEY,),
    },
}


# ---------------------------------------------------------------- 设计稿读取

def load_design(root: Path) -> dict[str, Any]:
    design = MS.load_design(Path(root), KEY)
    if not design:
        raise KitError(f"design/{KEY}.json missing (batch {MS.BATCH_DIR})")
    if design.get("schema") != "ma-design/1" or design.get("cid") != CID or design.get("code") != CODE:
        raise KitError(f"design identity drift: {design.get('schema')} {design.get('cid')} {design.get('code')}")
    return design


def _plan_rows(design: dict[str, Any]) -> tuple[list[dict], dict[str, dict]]:
    plan = design["plan"]
    leader = plan["leader_ability"]
    if leader["key"] != str(CID) or leader["ncols"] != KL.LEADER_NCOLS:
        raise KitError(f"design leader block drift: key={leader['key']} ncols={leader['ncols']}")
    ability = plan["ability"]
    if ability["ncols"] != KL.ABILITY_NCOLS or tuple(ability["keys"]) != ABILITY_KEYS:
        raise KitError(f"design ability keys drift: {tuple(ability['keys'])}")
    return list(leader["rows"]), dict(ability["keys"])


def _check_donor(entry: dict[str, Any], source: str, donor: str, label: str) -> None:
    """设计稿登记的 donor 地址与本模块常量必须一致（两边漂移即红）。"""
    want = f"{source}:{donor}"
    if entry.get("donor_address") != want:
        raise KitError(f"{label}: design donor_address {entry.get('donor_address')!r} != {want!r}")
    if not entry.get("describe"):
        raise KitError(f"{label}: design lacks the wf_describe readback field 'describe'")


# ---------------------------------------------------------------- 树工具（philia 的纯函数 + 本地补洞）

#: philia 的 ``SUBJECT_SLOTS`` 没收录 DeleteCondition（它不出现在光剑树里）；
#: 荷莉的队伍块靠它解弱体，漏重映射会留下悬空主体 id。
EXTRA_SUBJECT_SLOTS = {"DeleteCondition": (1,)}


def remap_subjects(node, mapping) -> None:
    PH.remap_subjects(node, mapping)
    for name, slots in EXTRA_SUBJECT_SLOTS.items():
        for cmd in PH.cmds(node, name):
            for i in slots:
                value = cmd[i]
                if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                    cmd[i] = mapping(value)


def one_cmd(node, name: str) -> list:
    hits = PH.cmds(node, name)
    if len(hits) != 1:
        raise KitError(f"expected exactly one {name}, got {len(hits)}")
    return hits[0]


def ac_node(cmd: list, kind: str) -> list:
    """``CreateCondition`` 第 2 参里的 AdditionalCondition 节点。"""
    hits = [entry for entry in cmd[2] if isinstance(entry, list) and entry and entry[0] == kind]
    if len(hits) != 1:
        raise KitError(f"CreateCondition carries {len(hits)} {kind} entries")
    return hits[0]


def conditional_names(node, out: set[str] | None = None) -> set[str]:
    out = set() if out is None else out
    if isinstance(node, list):
        if node and isinstance(node[0], str) and node[0].startswith("Conditionals"):
            out.add(node[0])
        for child in node:
            conditional_names(child, out)
    return out


def dsl_problems(tree, *, element: int | None = ELEMENT) -> list[str]:
    """DSL 门禁：客户端合法性三件套 + 参数形状 + 表达式外壳 + 严格作用域 + 主体 id 不重复。"""
    problems: list[str] = []
    problems += [f"subject: {p}" for p in L.action_dsl_subject_binding_problems(tree)]
    problems += [f"hit_target: {p}" for p in L.action_dsl_hit_area_target_problems(tree)]
    if element is not None:
        problems += [f"element: {p}" for p in L.action_dsl_element_problems(tree, element)]
    problems += [f"signature: {p}" for p in PH.signature_problems(tree)]
    problems += [f"expr: {p}" for p in PH.expr_tag_problems(tree)]
    problems += [f"scope: {p}" for p in PH.scope_problems(tree)]
    ids = PH.bound_ids(tree)
    if len(ids) != len(set(ids)):
        problems.append(f"duplicate bound subject ids: {sorted(i for i in set(ids) if ids.count(i) > 1)}")
    bad = sorted(n for n in conditional_names(tree) if n.startswith("ConditionalsNumExecutions"))
    if bad:
        problems.append(f"ConditionalsNumExecutions* must not appear: {bad}")
    return problems


def source_tree(ctx, program: str, want_sha: str | None = None):
    logical = wf_dsl.dsl_logical(program)
    raw = ctx.official_read(logical, "common")
    if raw is None:
        raise KitError(f"official baseline lacks donor DSL {program}")
    if want_sha is not None and C.sha256(raw) != want_sha:
        raise KitError(f"donor DSL fingerprint drift: {program} -> {C.sha256(raw)}")
    return ctx.template_dsl(program)


def write_dsl_checked(ctx, program: str, tree) -> str:
    """``write_dsl`` 只吃裸树；写后回读比对（记忆卡 wf-dsl-encode-wrapper-trap：喂包装壳 = 进战斗 F1034）。"""
    if not (isinstance(tree, list) and tree and tree[0] == "ActionDsl"):
        raise KitError(f"write_dsl needs a bare ActionDsl tree, got {type(tree).__name__}")
    logical = ctx.write_dsl(program, tree)
    back = C.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
    if back != tree:
        raise KitError(f"DSL readback mismatch: {logical}")
    return logical


# ---------------------------------------------------------------- 固有状态图标

def draw_icon(frame):
    """48×48「回响」图标：深紫圆角底 + 白紫音符 + 两圈同心声波弧 + 右上月牙缺口。

    8× 画布绘制后 LANCZOS 缩回 48×48；alpha 取官方图标外框（与上批 unique_condition 图标同工艺）。
    """
    from PIL import Image, ImageDraw
    if frame.size != (48, 48):
        raise KitError(f"icon frame donor must be 48x48, got {frame.size}")
    K, N = 8, 48 * 8
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    top, bot = (35, 28, 58), (20, 15, 38)                 # #231C3A → 更深的紫
    grad = Image.new("RGBA", (1, N))
    for y in range(N):
        t = y / (N - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    grad = grad.resize((N, N))
    inner = Image.new("L", (N, N), 0)
    ImageDraw.Draw(inner).rounded_rectangle((3 * K, 3 * K, 45 * K - 1, 45 * K - 1), radius=6 * K, fill=255)
    layer.paste(grad, (0, 0), inner)
    d = ImageDraw.Draw(layer)
    arc_far, arc_near = (167, 123, 255, 255), (231, 216, 255, 255)
    note, gold = (247, 242, 255, 255), (231, 196, 106, 255)

    # 两圈同心声波弧（左下 → 右上开口），外圈更淡
    for radius, color, width in ((17.0, arc_far, 2.0), (12.0, arc_near, 2.0)):
        box = ((24 - radius) * K, (25 - radius) * K, (24 + radius) * K, (25 + radius) * K)
        d.arc(box, start=205, end=335, fill=color, width=int(width * K))
    # 中心音符：符头 + 符干 + 符尾
    d.ellipse((15.0 * K, 28.0 * K, 24.0 * K, 35.0 * K), fill=note)
    d.line(((23.0 * K, 31.5 * K), (23.0 * K, 12.5 * K)), fill=note, width=int(2.2 * K))
    d.line(((23.0 * K, 12.5 * K), (32.5 * K, 17.0 * K), (32.5 * K, 22.0 * K)),
           fill=note, width=int(2.2 * K), joint="curve")
    # 右上小月牙缺口
    d.ellipse((33.0 * K, 7.0 * K, 43.0 * K, 17.0 * K), fill=gold)
    d.ellipse((35.4 * K, 6.2 * K, 45.4 * K, 16.2 * K), fill=(0, 0, 0, 0))

    small = layer.resize((48, 48), Image.LANCZOS)
    out = Image.new("RGBA", (48, 48), (255, 255, 255, 0))
    fp, op, sp = frame.load(), out.load(), small.load()
    for y in range(48):
        for x in range(48):
            r, g, b, a = sp[x, y]
            fa = fp[x, y][3]
            if a:
                op[x, y] = (round((r * a + 255 * (255 - a)) / 255), round((g * a + 255 * (255 - a)) / 255),
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
            "size": list(back.size), "sha256": C.sha256(data), "bytes": len(data)}


# ---------------------------------------------------------------- 技能 DSL

def build_skill_tree(ctx, level: str, family: dict[str, Any]):
    """三个官方母本拼一棵：骨架/演出/回响（母本）+ 音场判定区与自身攻击（威隆）+ 队伍块（荷莉）。"""
    params = SKILL_PARAMS[level]
    tpl = copy.deepcopy(source_tree(ctx, SKILL_DONORS["template"]))
    field_src = source_tree(ctx, SKILL_DONORS["field"])
    team_src = source_tree(ctx, SKILL_DONORS["team"])
    for name, tree in (("template", tpl), ("field", field_src), ("team", team_src)):
        if tree[0] != "ActionDsl" or tree[10] != 0:
            raise KitError(f"{name} donor head drift: {tree[:2]} bta={tree[10]}")
    body = tpl[11][1]
    if tpl[1] != 1:
        raise KitError(f"template movementPriority drift: {tpl[1]}")

    # --- 0/1/2：停球 + 背景演出 + 前景演出（原样）
    stop = PH.find_one(body, PH.is_cmd("StopBall"), "母本 StopBall")
    shows = [e for e in body if e[0] == "Command" and e[1][0] == "ShowEffect"]
    if len(shows) != 2:
        raise KitError(f"template root carries {len(shows)} ShowEffect (want 背景演出 + EF演出)")
    show_back, show_ef = (copy.deepcopy(e) for e in shows)
    for node, base in ((show_back, FX_BACK), (show_ef, FX_EF)):
        path = node[1][2]
        if path[0] != "SpecifyEffectDirectly" or path[1] != f"{FX_SRC_DIR}/{base}":
            raise KitError(f"template ShowEffect path drift: {path}")

    # --- 3：月光音场（唯一伤害块）
    field = PH.find_one(field_src[11][1],
                        lambda e: e[0] == "Event" and e[1][0] == "Wait" and e[1][1] == 44,
                        "威隆 Event Wait(44) 音场块")
    field[1][1] = FIELD_WAIT
    cha = one_cmd(field, "CreateHitArea")
    if cha[2] != -18 or cha[24] != 0:
        raise KitError(f"音场 CreateHitArea drift: p1={cha[2]} p23={cha[24]}")
    remap_subjects(field, {7: FIELD_SUBJECT_BASE, 8: FIELD_SUBJECT_BASE + 1,
                           9: FIELD_SUBJECT_BASE + 2}.__getitem__)
    aura = one_cmd(field, "ShowEffect")
    # 领域演出复用母本 _back（威隆族不克隆，省 0.161 Mpx 战斗图集 —— 设计 D-7）
    aura[2] = ["SpecifyEffectDirectly", f"{FX_SRC_DIR}/{FX_BACK}"]
    cna = one_cmd(field, "CreateNormalAttack")
    if cna[2] != 255:
        raise KitError(f"音场 CNA 显式元素 {cna[2]}（应保留 255 继承角色属性）")
    cna[6] = PH.slv(*params["field"])
    cna[15] = ["Fine"]                       # 命中演出 → 官方枚举（同树炸弹段原值）

    # --- 4：自身攻击力
    self_atk = PH.find_one(field_src[11][1], PH.is_cmd("CreateCondition"), "威隆 自身攻击力 CreateCondition")
    cc = self_atk[1]
    if cc[1] != -17:
        raise KitError(f"自身攻击力 CreateCondition 主体 {cc[1]}（应为 -17）")
    ac_node(cc, "ACAttackPoint")[2] = PH.slv(*params["self_atk"])

    # --- 5：队伍块（PF 伤害 + 贯穿 + 两段解弱体）
    team = PH.find_one(team_src[11][1], PH.is_find_all(97), "荷莉 FindAllSubjects(97) 队伍块")
    remap_subjects(team, {0: TEAM_SUBJECT_BASE, 1: TEAM_SUBJECT_BASE + 1,
                          2: TEAM_SUBJECT_BASE + 2}.__getitem__)
    pfdmg = next(c for c in PH.cmds(team, "CreateCondition") if c[2][0][0] == "ACPowerFlipDamage")
    pierce = next(c for c in PH.cmds(team, "CreateCondition") if c[2][0][0] == "ACPiercing")
    for cmd in (pfdmg, pierce):
        if cmd[10] != 2:                     # 97 = 球 ⇒ 付与对象种类写 2（记忆卡 wf-createcondition-target-kind）
            raise KitError(f"队伍块 CreateCondition 付与对象种类 {cmd[10]}（应为 2）")
    node = ac_node(pfdmg, "ACPowerFlipDamage")
    node[1] = PH.slv(TEAM_PFDMG_FRAMES, TEAM_PFDMG_FRAMES)
    node[2] = PH.slv(*params["team_pfdmg"])
    ac_node(pierce, "ACPiercing")[1] = PH.slv(*params["pierce"])
    if len(PH.cmds(team, "DeleteCondition")) != 2:
        raise KitError("队伍块解弱体段数漂移（应为两段 DeleteCondition(DCAll,3)）")

    # --- 6：回响 +1 层（拆出 CreateCondition，丢掉外层 FindAllSubjects(1,114) 选择器）
    echo_src = PH.find_one(body, PH.is_find_all(114), "母本 FindAllSubjects(114) 回响块")
    echo = copy.deepcopy(one_cmd(echo_src, "CreateCondition"))
    if echo[10] != 3:                        # 自身/Member ⇒ 付与对象种类写 3
        raise KitError(f"回响 CreateCondition 付与对象种类 {echo[10]}（应为 3）")
    echo[1] = -17
    unique = ac_node(echo, "ACUnique")
    if unique[1] != 16:
        raise KitError(f"回响 donor ACUnique id {unique[1]}（母本应为 16）")
    unique[1] = int(UID)

    tpl[11][1] = [stop, show_back, show_ef, field, self_atk, team, ["Command", echo]]
    tree, info = ctx.rewrite_effect_refs(tpl, family, strict=True)
    paths = sorted(set(PH.spec_paths(tree)))
    stray = [p for p in paths if not p.startswith(FX_DST_DIR + "/")]
    if stray:
        raise KitError(f"skill {level}: 特效引用不在克隆族内: {stray}")
    problems = dsl_problems(tree)
    if problems:
        raise KitError(f"skill {level} DSL gates failed: {problems}")
    return tree, {"level": level, "fx_paths": paths, "effect_rewrites": info["rewritten"],
                  "bound_ids": sorted(set(PH.bound_ids(tree))),
                  "n_attacks": len(PH.cmds(tree, "CreateNormalAttack")),
                  "multipliers": {k: list(v) for k, v in params.items()}}


# ---------------------------------------------------------------- 专属强化弹射（722）

def build_pf_tree(ctx, level: int):
    """官方 ``special_lv{n}`` 整树作底座（sha 锁定）+ 官方 supporter 辅助增益块；倍率统一 ×``PF_SCALE``。"""
    tree = copy.deepcopy(source_tree(ctx, SPECIAL_PROGRAMS[level], SPECIAL_SHA[level]))
    if tree[0] != "ActionDsl" or tree[1] != 1 or tree[10] != 0:
        raise KitError(f"special lv{level} head drift: {tree[:2]} bta={tree[10]}")
    if not PH.cmds(tree, "SetPowerFilpSuppress") or not PH.cmds(tree, "NotifyPowerflipEnd"):
        raise KitError(f"special lv{level} lost SetPowerFilpSuppress / NotifyPowerflipEnd")
    root_body = tree[11][1]
    aura = [n for n, e in enumerate(root_body)
            if e[0] == "Command" and e[1][0] == "ShowEffect" and e[1][1] == "オーラ演出"]
    if len(aura) != 1:
        raise KitError(f"special lv{level} オーラ演出 not unique ({len(aura)})")

    block = PH.pf_support_block(ctx.root, level)
    pierce = [c for c in PH.cmds(block, "CreateCondition") if c[2][0][0] == "ACPiercing"]
    if len(pierce) != 1:
        raise KitError("supporter 辅助增益块 ACPiercing not unique")
    frames = PF_PIERCE_FRAMES[level]
    ac_node(pierce[0], "ACPiercing")[1] = PH.slv(frames, frames)
    if sorted(set(PH.bound_ids(block))) != [PF_SUPPORT_BIND]:
        raise KitError(f"supporter block bound ids {sorted(set(PH.bound_ids(block)))} != [{PF_SUPPORT_BIND}]")
    root_body.insert(aura[0] + 1, block)

    scaled = []
    for cna in PH.cmds(tree, "CreateNormalAttack"):
        mult = cna[6]
        if len(mult) != 1 or mult[0]["min"] != mult[0]["max"]:
            raise KitError(f"special lv{level} CNA multiplier shape drift: {mult}")
        value = round(mult[0]["min"] * PF_SCALE, 6)
        cna[6] = PH.slv(value, value)
        scaled.append(value)
    if not scaled:
        raise KitError(f"special lv{level} carries no CreateNormalAttack")
    for cha in PH.cmds(tree, "CreateHitArea"):
        if cha[24] != 0:
            raise KitError("PF CreateHitArea p23 must stay 0 (4 = 按直击算，整块 PF 乘区被跳过)")
    stray = sorted({p for p in PH.spec_paths(tree) if p.startswith(f"battle/effect/skill_unique/{CODE}/")})
    if stray:
        raise KitError(f"PF lv{level} 引用了包内特效（底座与辅助块的官方件必须直接引用）: {stray}")
    problems = dsl_problems(tree, element=None)   # PF 底座的 CNA 同样是 255 继承，元素检查在技能侧
    if problems:
        raise KitError(f"PF lv{level} DSL gates failed: {problems}")
    return tree, {"level": level, "multipliers": scaled, "total": round(sum(scaled), 6),
                  "pierce_frames": frames, "support_block_bind": PF_SUPPORT_BIND,
                  "official_effects": sorted(set(PH.spec_paths(tree))),
                  "bound_ids": sorted(set(PH.bound_ids(tree)))}


# ---------------------------------------------------------------- build

def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.cid, spec.code, spec.element) != (CID, CODE, ELEMENT):
        raise KitError(f"identity drift: {spec.cid}/{spec.code}/element {spec.element}")
    if (spec.template_id, spec.template_code) != (TEMPLATE_ID, TEMPLATE_CODE):
        raise KitError(f"template drift: {spec.template_id}/{spec.template_code}")
    if spec.pf_type != 3 or spec.stance != "Attacker":
        raise KitError(f"spec drift: pf_type={spec.pf_type} stance={spec.stance}")
    if MS.text_placeholders(spec):
        raise KitError(f"design texts still placeholders: {MS.text_placeholders(spec)}")

    design = load_design(ctx.root)
    leader_plan, ability_plan = _plan_rows(design)
    evidence: list[dict[str, Any]] = []
    panel: list[str] = []
    capabilities: set[str] = set()

    # ---- 1) 固有状态「回响」+ 48×48 图标
    key, row = KL.unique_row(ctx, spec, 1, donor=UNIQUE_DONOR,
                             cells={0: UNIQUE_STRING_ID, 3: "99999999", 4: UNIQUE_CAP,
                                    9: "false", 10: "false", 13: "true"},
                             name=UNIQUE_NAME, icon=UNIQUE_ICON_ROW)
    plan_unique = design["plan"]["unique_conditions"]["add"]
    if len(plan_unique) != 1 or plan_unique[0]["key"] != key or list(plan_unique[0]["row"]) != row:
        raise KitError(f"unique_condition row differs from the design plan: {row}")
    KL.write_unique(ctx, spec, {key: row})
    icon = install_unique_icon(ctx)

    # ---- 2) 队长技 6 行
    if len(leader_plan) != len(LEADER_DONORS):
        raise KitError(f"design leader rows {len(leader_plan)} != donors {len(LEADER_DONORS)}")
    leader_rows = []
    for entry, (source, donor) in zip(leader_plan, LEADER_DONORS):
        label = f"leader#{entry['index']}"
        _check_donor(entry, source, donor, label)
        row, ev = KL.build_row(ctx, "leader_ability", donor, entry["cells"], source=source,
                               expect_describe=entry["describe"], label=label)
        if row[0] != CODE:
            raise KitError(f"{label}: c0 {row[0]!r} != {CODE}")
        leader_rows.append(row)
        evidence.append(ev)
        capabilities.update(ev["capabilities"])
        if entry["index"]:               # L0（722）的面板由 c82 串生成，见 custom_ability_string
            panel.append(KL.check_panel(entry["desc_expected"], label=label))
    # 722 行：三级程序键与 c82 串必须与 power_flip_action / custom_ability_string 对齐
    pf_row = leader_rows[0]
    if pf_row[45] != "722" or pf_row[80] != PF_KEY or pf_row[82] != CAS_PF or pf_row[81] != "1,2,3":
        raise KitError(f"leader 722 row drift: c45={pf_row[45]} c80={pf_row[80]} c81={pf_row[81]} c82={pf_row[82]}")
    if any(pf_row[col] not in ("", "0") for col in (4, 11, 18)):
        raise KitError("leader 722 row must carry no precondition（挂门＝群友报的「PF 没实装」）")
    # during 行的 puller 列：during 30 留空（写 '0' 点角色就 C7050）
    for n, row in enumerate(leader_rows):
        if row[3] == "1" and row[95] == "30" and row[96] != "":
            raise KitError(f"leader#{n}: during 30 puller c96={row[96]!r} must stay empty")
    ctx.write_flat(KL.LEADER, {str(CID): leader_rows})

    # ---- 3) 词条 6 键
    ability_rows: dict[str, list[list[str]]] = {}
    for slot, key_name in enumerate(ABILITY_KEYS, start=1):
        plan = ability_plan[key_name]
        donors = ABILITY_DONORS[key_name]
        if len(plan["records"]) != len(donors):
            raise KitError(f"ability {key_name}: design has {len(plan['records'])} records, "
                           f"module has {len(donors)} donors")
        rows = []
        for entry, (source, donor) in zip(plan["records"], donors):
            label = f"ability{slot}#{entry['index']}"
            _check_donor(entry, source, donor, label)
            row, ev = KL.build_row(ctx, "ability", donor, entry["cells"], source=source,
                                   element=ELEMENT, expect_describe=entry["describe"], label=label)
            rows.append(row)
            evidence.append(ev)
            capabilities.update(ev["capabilities"])
            if key_name != f"{CID}5":    # 槽 5 整槽走 desc_override（恒真 HP 门是死文案）
                panel.append(KL.check_panel(entry["desc_expected"], label=label))
            # during 134 的 puller c98 必须 '0'；during 30 必须留空。两者不可互换
            if row[5] == "1":
                want = "0" if row[97] in ("134", "1") else ""
                if row[98] != want:
                    raise KitError(f"{label}: during {row[97]} puller c98={row[98]!r} must be {want!r}")
            if row[109] == "422" and row[6] != "42":
                raise KitError(f"{label}: 422 行必须挂前置 42（队长），否则与基诺维/泽赫尔的 422 相加")
        KL.check_ability_key(rows, key_name, CODE, slot)
        if rows[0][2] != plan["statue_group_c2"]:
            raise KitError(f"ability {key_name}: c2 {rows[0][2]!r} != design {plan['statue_group_c2']!r}")
        ability_rows[key_name] = rows
    if any(row[109] in ("422", "724", "713") for row in leader_rows):
        raise KitError("队长表禁止 422/724/713（= C7050）")
    ctx.write_flat(KL.ABILITY, ability_rows)

    # ---- 4) 面板覆盖文案 / 722 的 c82 串
    cas_plan = {entry["key"]: entry["value"] for entry in design["plan"]["texts"]["custom_ability_string"]["rows"]}
    if set(cas_plan) != {CAS_PF, CAS_DASH}:
        raise KitError(f"design custom_ability_string keys drift: {sorted(cas_plan)}")
    for cas_key, value in cas_plan.items():
        KL.check_panel(value, label=cas_key)
        cap = L.panel_override_capability(cas_key)
        if cap:
            capabilities.add(cap)
    ctx.write_flat(KL.CAS, {k: [[v]] for k, v in cas_plan.items()})
    panel.extend(cas_plan[k] for k in (CAS_PF, CAS_DASH))

    # ---- 5) action_skill 两档（名称/描述由 tables 写 TEXTS，这里改图标与能量）
    energy = design["plan"]["skills"]["energy"]
    action_rows = {}
    for level, cells in sorted(ctx.pkg_nested(CODE, KL.ACTION).items()):
        if len(cells) != 24:
            raise KitError(f"action_skill {level}: {len(cells)} columns, expected 24")
        cells = list(cells)
        cells[2] = SKILL_ICON
        cells[4], cells[5] = str(energy[level]["c4"]), str(energy[level]["c5"])
        cells[6] = str(energy[level]["c6"])
        cells[7] = ctx.program_path(level)
        if cells[0] != spec.texts[f"skill{level}"] or cells[1] != spec.texts[f"desc{level}"]:
            raise KitError(f"action_skill {level}: name/desc drift from design texts")
        action_rows[level] = [cells]
    if sorted(action_rows) != ["1", "2"]:
        raise KitError(f"action_skill levels {sorted(action_rows)}")
    ctx.write_nested(KL.ACTION, CODE, action_rows, replace_inner=True)

    # ---- 6) 技能特效族（只克隆 1 族）与两档技能 DSL
    lut = KL.png_transform_from_lut(KL.pixel_dir(ctx) / "fx_lut.json")
    family = ctx.clone_effect_family(FX_SRC_DIR, FX_SUBDIR, fx_names=[FX_BACK, FX_EF],
                                     png_transform=lut)
    if family["dst_dir"] != FX_DST_DIR or sorted(family["copied_bases"]) != sorted([FX_BACK, FX_EF]):
        raise KitError(f"effect family drift: {family['dst_dir']} {family['copied_bases']}")
    programs: list[str] = []
    skill_gates = {}
    for level in ("1", "2"):
        tree, gates = build_skill_tree(ctx, level, family)
        for path in PH.spec_paths(tree):
            if path.startswith(FORBIDDEN_FX_PREFIXES):
                raise KitError(f"skill {level}: 残留兄弟目录特效前缀 {path}")
        programs.append(write_dsl_checked(ctx, ctx.program_path(level), tree))
        skill_gates[level] = gates

    # ---- 7) 专属强化弹射 722 三档
    pf_gates = {}
    for level in (1, 2, 3):
        tree, gates = build_pf_tree(ctx, level)
        programs.append(write_dsl_checked(ctx, PF_PROGRAMS[level - 1], tree))
        pf_gates[str(level)] = gates
    design_pf = design["plan"]["pf_override"]["power_flip_action"]
    if design_pf["key"] != PF_KEY or design_pf["value"].split(",") != list(PF_PROGRAMS):
        raise KitError("design power_flip_action drift")
    if float(design["plan"]["pf_override"]["scale_scalar"]) != PF_SCALE:
        raise KitError("design pf scale scalar drift")
    ctx.write_flat(PFA, {PF_KEY: [list(PF_PROGRAMS)]})

    # ---- 8) 语音路由（kind 1 ConditionExist ← 固有 16998801）+ switched_action_skill
    route = KL.voice_route(CODE, VOICE_ROUTE)
    design_route = design["voice"]["route"]
    if (design_route["kind"], str(design_route["condition_kind"]), str(design_route["condition_id"])) \
            != (VOICE_ROUTE["kind"], VOICE_ROUTE["condition_kind"], VOICE_ROUTE["condition_id"]):
        raise KitError(f"design voice route drift: {design_route}")
    if list(design["plan"]["kit_declarations"]["character_c9_c16"]) != list(route):
        raise KitError(f"design character c9–c16 drift: {design['plan']['kit_declarations']['character_c9_c16']}")
    char_row = ctx.pack.pkg_character_row()
    char_row[9:17] = route
    if char_row[6] != "3" or char_row[26] != "Attacker" or char_row[27] != str(CID):
        raise KitError(f"character row drift: c6={char_row[6]} c26={char_row[26]} c27={char_row[27]}")
    ctx.write_flat(KL.CHARACTER, {str(CID): [char_row]})
    voice = KL.write_voice_ready(ctx)

    # ---- 9) 像素/特效成品（缺文件静默跳过）+ 三层镜像
    pixel = KL.install_staged_assets(ctx)
    mirrors = ctx.sync_character_mirrors()
    if mirrors["character"][9:17] != route:
        raise KitError("character mirror lost the voice route")

    ctx.evidence_write("kit-gates.json", {
        "rows": evidence, "skills": skill_gates, "power_flip": pf_gates,
        "unique_condition": {key: {"row": row, "icon": icon}},
        "effect_family": {k: family[k] for k in ("src_dir", "dst_dir", "layout", "copied_bases",
                                                 "complete_family", "missing_effects")},
        "fx_lut": bool(lut), "voice": voice, "pixel": pixel, "mirrors": mirrors})

    notes = [
        f"技能：三母本拼树（{TEMPLATE_CODE} 骨架 + veteran_hunter_3anv 音场 + herbalist_xm22 队伍块）；"
        f"内层1 {skill_gates['1']['multipliers']['field'][0]}×18＝"
        f"{round(skill_gates['1']['multipliers']['field'][0] * 18, 2)}×，"
        f"内层2 满级 {skill_gates['2']['multipliers']['field'][1]}×18＝"
        f"{round(skill_gates['2']['multipliers']['field'][1] * 18, 2)}×；tree[10]=0（技能伤害归属，D-1）",
        f"722：官方 special 底座 ×{PF_SCALE} ＝ "
        + " / ".join(f"lv{n} {pf_gates[str(n)]['total']}×" for n in (1, 2, 3))
        + "；辅助增益块贯通帧 " + "/".join(str(PF_PIERCE_FRAMES[n]) for n in (1, 2, 3))
        + "（官方 60/90/150）；光剑单元不做",
        f"特效只克隆 1 族 {FX_DST_DIR}（威隆族不克隆，领域演出复用 _back、命中演出改 [\"Fine\"]）"
        + ("；已套用 B/pixel/hibiki/fx_lut.json 换色" if lut else "；无 fx_lut.json，按母本原色克隆"),
        {"pixel_install": pixel},
    ]
    deviations = [{"want": item["intended"], "got": item["actual"], "why": item["reason"]}
                  for item in design.get("deviations", ())]
    # 放行条件只看 kit 自己的产物：22 行 + 5 棵 DSL + 5 个自有键 + 语音路由 + 三层镜像都已过闸，
    # 且像素/特效成品已装包（缺件时留 draft）。立绘与语音音频是另两条线，由主控在装配阶段补。
    gate = {"rows": len(evidence), "programs": len(programs),
            "pixel_present": pixel["present"], "pixel_missing": [e["logical"] for e in pixel["skipped"]]}
    ready = pixel["present"] and not pixel["skipped"]
    gate["reason"] = "kit 自有产物全部过闸" if ready else \
        f"像素/特效成品未就绪：{gate['pixel_missing'] or 'B/pixel/hibiki/install.json 不存在'}"
    return KL.report(
        ctx, summary="澄波响：暗属性 PF 主 C（贯通循环型）——722 专属 PF ＋ 回响层数 ＋ 冲刺改造",
        status=KL.READY if ready else KL.DRAFT, panel=panel, notes=notes, programs=programs,
        unique_condition={key: {"name": UNIQUE_NAME, "cap": UNIQUE_CAP, "icon": UNIQUE_ICON_LOGICAL}},
        required_capabilities=sorted(capabilities | set(SPEC["required_capabilities"])),
        deviations=deviations,
        extra={"power_flip_action": {PF_KEY: list(PF_PROGRAMS)},
               "custom_ability_string": sorted(cas_plan),
               "effect_families": [FX_DST_DIR], "kit_gate": gate})
