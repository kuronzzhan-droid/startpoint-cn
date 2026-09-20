# -*- coding: utf-8 -*-
"""中秋批次 kit：丝缇涅尔·中秋 159995 ``still_obstinator_moon``（光属性技能伤害辅助）。

定位「月相灯」技伤辅助：技能一边放月光激光，一边给主队挂**两条数值与时长都不同**的技能
伤害提升状态（光角色 +120%／全员 +50%，＋档满级）并全屏驱散敌方 1 个强化；队长 L6 与
能力 3#2 用官方 D40「状态计数技能伤害↑」去数这两盏灯 —— 灯越多，全队技伤越高。零新固有
状态、零新图标（裁决 §2「取零新件方案优先」）。设计与数值以
``work/character_packs/midautumn-20260920/design/stinel.{md,json}`` 为准。

本模块是「设计 JSON 驱动」的薄壳：队长 7 行、词条 6 键 14 条的 donor／逐格改／预期
``wf_describe`` 全部从 ``design/stinel.json`` 的 ``plan`` 块读出后交给
:func:`wf_midautumn_kitlib.build_row` 装配，两边漂移（donor 缺失、legality 不过、
``wf_describe`` 对不上、成品行与设计稿登记的整行不一致）当场报错，不在本文件里手抄 21 行
的具体数值（那是设计代理已核实过的产物，抄一遍只会引入新的转录错误）。

本模块自己负责的是设计 JSON 管不到的部分：
    - 技能 DSL 两档：母本 151093 ``still_obstinator_{lv}`` 整树 + 官方诺瓦 ``nova_4anv_{lv}``
      四块嫁接（A 满月灯／B 弦月灯／C 全屏驱散／FX 挂灯演出），主体 id 整体 +4 重映射；
    - 技能特效族 ``still_obstinator`` 整族克隆换名 + ``B/pixel/stinel/fx_lut.json`` 染色
      （粉紫 → 月白·黄铜金；LUT 未交付时按母本原色克隆）；
    - ``action_skill`` 两档能量 650→600 改 550→500；
    - ``custom_ability_string``：536 的 ``change_skill_still_obstinator_moon``；
    - 语音路由（kind 3 ChangeSkillFlag ← 能力 1#2 的 536）与 ``switched_action_skill``；
    - ``B/pixel/stinel/install.json`` 里的像素小人成品（缺文件静默跳过）。

不碰：live store / ``assets/`` / ``.cdn`` / 设备 / 存档；无固有状态、无 422/629/713/722。
由 ``python mod-tools/wf_midautumn_build.py --char stinel --step kit`` 调用 :func:`build`。
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

KEY = "stinel"
CID, CODE = 159995, "still_obstinator_moon"
ELEMENT = 4                                     # 光（0 基内部编号，White）
TEMPLATE_ID, TEMPLATE_CODE = 151093, "still_obstinator"
PF_TYPE, STANCE = 4, "Supporter"                # c6 保持母本特殊型；c26 改辅助（设计 §2）

ABILITY_KEYS = tuple(f"{CID}{slot}" for slot in range(1, 7))
LEADER_ROWS = 7
ABILITY_RECORDS = 14

CAS_CHANGE_SKILL = f"change_skill_{CODE}"       # 536 的 c70 string_id（不注册 = C8601）
VOICE_KEY = KL.switch_key(CODE)                 # still_obstinator_moon_voice_ready
VOICE_ROUTE: dict[str, Any] = {"kind": 3}       # ChangeSkillFlag ← 能力 1#2 的 536

# 特效族：母本 still_obstinator 的浮游炮蓄力/爆发族（2 base、38 rect、sheet 252×776），
# 整族克隆换名 + LUT 染色。clone_effect_family(layout="codename") 强制两级目录
# skill_unique/<code>/<dst_subdir>/，见 deviations D1。
FX_SRC_DIR = f"battle/effect/skill_unique/{TEMPLATE_CODE}"
FX_SUBDIR = "orrery"
FX_DST_DIR = f"battle/effect/skill_unique/{CODE}/{FX_SUBDIR}"
FX_FUNNEL = f"{TEMPLATE_CODE}_funnel"
FX_EXPLOSION = f"{TEMPLATE_CODE}_explosion"

# 嫁接源：官方诺瓦（光技伤辅助蓝本 151182）的技能树。
GRAFT_CODE = "nova_4anv"
GRAFT_PROGRAM = f"battle/action/skill/action/rare5/{GRAFT_CODE}${GRAFT_CODE}_{{lv}}"

# 母本树已占主体 id 0（参考点）与 1/2/3（判定区）；诺瓦块整体 +4。
SUBJECT_BASE = 4
SUBJECT_REMAP = {0: 4, 1: 5, 2: 6, 3: 7, 4: 8}
# CreateHitArea 的三个主体绑定位与 on-hit 块（26 参判定区卡，记忆卡 wf-hitarea-param-card）。
HIT_AREA_SUBJECT_SLOTS = (19, 21, 22)
HIT_AREA_ONHIT_SLOT = 23

# A「满月灯」= 主队光属性角色；B「弦月灯」= 主队全员。两条数值与时长都不同 ⇒ 条件 gid 不同
# ⇒ 并存并累加，同时把 D40 的计数垫到 2（设计 §6.2；**调数值时不许把两条调成完全相同**）。
LIGHT_VALUES = {
    "1": {"a": (960, {"min": 0.6, "max": 0.6}),
          "b": (720, {"min": 0.25, "max": 0.25})},
    "2": {"a": (1200, {"min": 0.6, "max": 1.2, "alv_min": 0.2, "alv_max": 0.4}),
          "b": (900, {"min": 0.25, "max": 0.5})},
}
FX_LABEL = "月相灯演出"
FX_ANCHOR = -17                                  # 自身（记忆卡 wf-dsl-builtin-subjects）

FORBIDDEN_LEADER_KINDS = ("422", "724", "713")   # 写进队长表 = C7050（裁决 §2/§8）

TEXTS: dict[str, str] = {}       # 10 个文本键在 design/stinel.json 的 texts 块里（build 里核验）
SPEC = {
    "extra_keys": {
        KL.CAS: (CAS_CHANGE_SKILL,),
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


def _parse_donor(donor: str) -> tuple[str, str, str]:
    """设计稿的 donor 地址 ``"official o:leader:151182#L1"`` → (source, kind, "键#记录号(0基)")。

    ``o`` = 官方基线（``OfficialBaseline('.cdn/cn')``），``s`` = live store 只读（已上线自制角色）。
    ``#L1`` 的记录号是 **1 基**（``design/stinel.md`` 的写法），``kitlib.donor_row`` 要 0 基下标。
    前缀词（``official``/``live``）与地址里的 ``o``/``s`` 必须自洽，防设计稿手改出半截地址。
    """
    word, _, addr = str(donor).partition(" ")
    parts = addr.split(":")
    if len(parts) != 3:
        raise KitError(f"unexpected donor address shape: {donor!r}")
    src, table, rest = parts
    source = {"o": "official", "s": "live"}.get(src)
    kind = {"leader": "leader_ability", "ability": "ability"}.get(table)
    if source is None or kind is None or word != source:
        raise KitError(f"unrecognised donor address: {donor!r}")
    key, sep, level = rest.partition("#")
    if sep != "#" or not level[:1].upper() == "L":
        raise KitError(f"donor record must be written '#L<1基记录号>': {donor!r}")
    index0 = int(level[1:]) - 1
    if index0 < 0:
        raise KitError(f"donor record number must be >= 1 (1-based): {donor!r}")
    return source, kind, f"{key}#{index0}"


def _check_full_row(row: list[str], cells: dict[str, Any], ncols: int, label: str) -> None:
    """成品行必须与设计稿登记的整行逐格一致：``cells`` 只列非空列，其余列必须是空串。

    这道检查同时抓「donor 在官方/live 侧漂移」与「设计稿 edits 与 cells 自相矛盾」两类错。
    """
    want = {int(col): str(value) for col, value in cells.items()}
    diffs = [(i, row[i], want.get(i, "")) for i in range(ncols) if row[i] != want.get(i, "")]
    if diffs:
        raise KitError(f"{label}: 成品行与设计稿 cells 不一致（列, 实际, 设计）: {diffs}")


def build_leader_rows(ctx, design: dict[str, Any]) -> tuple[list[list[str]], list[dict[str, Any]]]:
    plan = design["plan"]["leader_ability"]
    if str(plan["key"]) != str(CID) or int(plan["layout"]["ncols"]) != KL.LEADER_NCOLS:
        raise KitError(f"design leader block drift: key={plan.get('key')} layout={plan.get('layout')}")
    rows: list[list[str]] = []
    evidence: list[dict[str, Any]] = []
    for entry in plan["rows"]:
        source, kind, donor = _parse_donor(entry["donor"])
        if kind != "leader_ability":
            raise KitError(f"leader#{entry['index']}: donor points at {kind}")
        label = f"leader#{entry['index']}({entry['tag']})"
        row, ev = KL.build_row(ctx, "leader_ability", donor, entry["edits"], source=source,
                               expect_describe=entry["desc_tool"], label=label)
        _check_full_row(row, entry["cells"], KL.LEADER_NCOLS, label)
        if row[0] != CODE:
            raise KitError(f"{label}: c0 {row[0]!r} != {CODE}")
        KL.check_panel(entry["desc_expected"], label=label)
        rows.append(row)
        evidence.append(ev | {"panel": entry["desc_expected"]})
    if len(rows) != LEADER_ROWS:
        raise KitError(f"design leader_ability carries {len(rows)} rows, expected {LEADER_ROWS}")
    return rows, evidence


def ban_forbidden_leader_kinds(rows: list[list[str]]) -> None:
    """队长表禁 422/724/713（裁决 §2/§8）。瞬发 kind 在 c45，持续 kind 在 c107。"""
    for n, row in enumerate(rows):
        if row[45] in FORBIDDEN_LEADER_KINDS or row[107] in FORBIDDEN_LEADER_KINDS:
            raise KitError(f"leader#{n}: forbidden kind in leader_ability (c45={row[45]!r} c107={row[107]!r})")


def build_ability_rows(ctx, design: dict[str, Any]) -> tuple[dict[str, list[list[str]]], list[dict[str, Any]]]:
    plan = design["plan"]["ability"]
    if int(plan["layout"]["ncols"]) != KL.ABILITY_NCOLS:
        raise KitError(f"design ability ncols drift: {plan['layout'].get('ncols')}")
    if tuple(sorted(plan["keys"])) != tuple(sorted(ABILITY_KEYS)):
        raise KitError(f"design ability keys drift: {sorted(plan['keys'])}")
    rows_by_key: dict[str, list[list[str]]] = {}
    evidence: list[dict[str, Any]] = []
    total = 0
    for slot, key_name in enumerate(ABILITY_KEYS, start=1):
        block = plan["keys"][key_name]
        if int(block["slot"]) != slot:
            raise KitError(f"ability {key_name}: slot {block['slot']} != {slot}")
        unisonable = list(block["unisonable_per_record"])
        if len(set(unisonable)) != 1:
            raise KitError(f"ability {key_name}: c1 是整键语义，设计稿却混用了 {unisonable}")
        rows: list[list[str]] = []
        for index, entry in enumerate(block["records"]):
            source, kind, donor = _parse_donor(entry["donor"])
            if kind != "ability":
                raise KitError(f"{key_name}#{index}: donor points at {kind}")
            label = f"{key_name}#{index}({entry.get('tag', '')})"
            row, ev = KL.build_row(ctx, "ability", donor, entry["edits"], source=source,
                                   element=ELEMENT, expect_describe=entry["desc_tool"], label=label)
            _check_full_row(row, entry["cells"], KL.ABILITY_NCOLS, label)
            KL.check_panel(entry["desc_expected"], label=label)
            rows.append(row)
            evidence.append(ev | {"panel": entry["desc_expected"]})
            total += 1
        KL.check_ability_key(rows, key_name, CODE, slot)
        if rows[0][1] != unisonable[0] or rows[0][2] != str(block["statue_group"]):
            raise KitError(f"ability {key_name}: c1/c2 {rows[0][1]}/{rows[0][2]} != design "
                           f"{unisonable[0]}/{block['statue_group']}")
        rows_by_key[key_name] = rows
    if total != ABILITY_RECORDS:
        raise KitError(f"design ability carries {total} records, expected {ABILITY_RECORDS}")
    return rows_by_key, evidence


def write_strings(ctx, design: dict[str, Any]) -> tuple[dict[str, str], set[str]]:
    """``custom_ability_string``：536 的强化文案（裁决 §3：技能强化条目不写数字与时间）。"""
    rows = design["plan"]["texts"]["custom_ability_string"]["rows"]
    cas_plan = {entry["key"]: entry["text"] for entry in rows}
    if set(cas_plan) != {CAS_CHANGE_SKILL}:
        raise KitError(f"design custom_ability_string keys drift: {sorted(cas_plan)}")
    declared = set(ctx.spec.extra_keys.get(KL.CAS, ()))
    missing = [k for k in cas_plan if k not in declared]
    if missing:
        raise KitError(f"custom_ability_string keys not declared in SPEC['extra_keys']: {missing}")
    caps: set[str] = set()
    for key, text in cas_plan.items():
        KL.check_panel(text, skill_flag=True, label=key)
        cap = L.panel_override_capability(key)
        if cap:
            caps.add(cap)
    ctx.write_flat(KL.CAS, {k: [[v]] for k, v in cas_plan.items()})
    return cas_plan, caps


def write_action_skill(ctx, design: dict[str, Any]) -> dict[str, list[str]]:
    """两档能量 650→600 改 550→500；名称/描述由 tables 写 TEXTS，这里只核验不改写。"""
    spec = ctx.spec
    energy = design["plan"]["skills"]["energy"]
    inner = ctx.pkg_nested(CODE)
    if set(inner) != {"1", "2"}:
        raise KitError(f"package action_skill inner keys {sorted(inner)}")
    out: dict[str, list[str]] = {}
    for level, cells in sorted(inner.items()):
        cells = list(cells)
        if len(cells) != 24:
            raise KitError(f"action_skill {level}: {len(cells)} columns, expected 24")
        if cells[7] != ctx.program_path(level):
            raise KitError(f"action_skill {level} program path drift: {cells[7]!r}")
        if cells[0] != spec.texts[f"skill{level}"] or cells[1] != spec.texts[f"desc{level}"]:
            raise KitError(f"action_skill {level}: name/desc differ from design texts (rerun tables)")
        pair = energy[f"level_{level}"]
        if len(pair) != 2:
            raise KitError(f"design energy level_{level} must be [c4, c5], got {pair}")
        cells[4], cells[5] = str(pair[0]), str(pair[1])
        out[level] = cells
    ctx.write_nested(KL.ACTION, CODE, {lv: [cells] for lv, cells in out.items()}, replace_inner=True)
    return out


# ---------------------------------------------------------------- DSL 工具

def _statements(tree) -> list:
    body = tree[11]
    if not (isinstance(body, list) and body and body[0] == "Block"):
        raise KitError(f"root statement block drift: {type(body)}")
    return body[1]


def _command(statement):
    if isinstance(statement, list) and len(statement) == 2 and statement[0] == "Command":
        return statement[1]
    return None


def pick_graft_blocks(tree) -> dict[str, Any]:
    """从诺瓦树里按**结构**挑四块（不按下标，donor 换序也不会挑错）。"""
    found: dict[str, Any] = {}
    for statement in _statements(tree):
        cmd = _command(statement)
        if not cmd:
            continue
        if cmd[0] == "FindAllSubjects":
            inner = _command(cmd[9][1][0]) if cmd[9][1] else None
            if not inner or inner[0] != "CreateCondition":
                continue
            kind = inner[2][0][0]
            if kind == "ACSkillDamage":
                found["skill_damage"] = statement
            elif kind == "ACUnique":
                found["unique"] = statement
        elif cmd[0] == "CreateHitArea" and cmd[9][0] == "Rectangle":
            found["dispel"] = statement
        elif cmd[0] == "ShowEffect" and str(cmd[2][1]).endswith("_kirakira"):
            found["sparkle"] = statement
    missing = {"skill_damage", "unique", "dispel", "sparkle"} - set(found)
    if missing:
        raise KitError(f"nova donor tree is missing graft blocks: {sorted(missing)}")
    return found


def make_light_block(parts: dict[str, Any], *, bind: int, light_only: bool,
                     frames: int, value: dict[str, Any]):
    """「灯」块：整块取诺瓦**自己的 ACSkillDamage 块**（selector 113 + p10=1 的官方形状），

    只改绑定 id、元素过滤与数值。``light_only=True`` 时把过滤列表换成诺瓦 ACUnique 块里的
    光属性过滤（``[5]``）—— 那是同一棵官方树里的同 selector 先例，不自己造参数。
    ``CreateCondition`` 的 p1 必须与所在 ``FindAllSubjects`` 的绑定 id 一致（防 C16103，
    记忆卡 wf-dsl-subject-lookup-map）；p10（付与对象种类）保持 donor 的 1（角色状态）。
    """
    statement = copy.deepcopy(parts["skill_damage"])
    cmd = _command(statement)
    cmd[1] = bind
    cmd[3] = copy.deepcopy(_command(parts["unique"])[3]) if light_only else []
    condition = _command(cmd[9][1][0])
    condition[1] = bind
    entry = condition[2][0]
    if entry[0] != "ACSkillDamage":
        raise KitError(f"graft donor AC drift: {entry[0]}")
    if condition[10] != 1:
        raise KitError(f"CreateCondition 付与对象种类 drift: {condition[10]} (expect 1)")
    entry[1] = [{"min": frames, "max": frames}]
    entry[2] = [dict(value)]
    return statement


def make_dispel_block(parts: dict[str, Any]):
    """全屏驱散：诺瓦原样，只把三个主体绑定位与 ``DeleteCondition`` 的主体按 +4 重映射。"""
    statement = copy.deepcopy(parts["dispel"])
    cmd = _command(statement)
    for slot in HIT_AREA_SUBJECT_SLOTS:
        if cmd[slot] not in SUBJECT_REMAP:
            raise KitError(f"dispel subject slot {slot} carries {cmd[slot]!r}, not a donor id")
        cmd[slot] = SUBJECT_REMAP[cmd[slot]]
    delete = _command(cmd[HIT_AREA_ONHIT_SLOT][1][0])
    if not delete or delete[0] != "DeleteCondition":
        raise KitError("dispel on-hit block is not a DeleteCondition")
    delete[1] = SUBJECT_REMAP[delete[1]]
    return statement


def make_fx_block(parts: dict[str, Any]):
    """挂灯演出：借诺瓦「キラキラ」的参数形状，路径指向母本 funnel（随后由

    ``rewrite_effect_refs`` 统一改写到自家克隆族），锚点换成自身 ``-17``。
    """
    statement = copy.deepcopy(parts["sparkle"])
    cmd = _command(statement)
    cmd[1] = FX_LABEL
    cmd[2] = ["SpecifyEffectDirectly", f"{FX_SRC_DIR}/{FX_FUNNEL}"]
    cmd[3] = FX_ANCHOR
    return statement


def _dsl_problems(tree, *, element: int | None = None) -> list[str]:
    problems: list[str] = []
    problems += [f"direction: {p}" for p in wf_dsl.player_side_dsl_problems(tree)]
    problems += [f"subject: {p}" for p in L.action_dsl_subject_binding_problems(tree)]
    problems += [f"hit_target: {p}" for p in L.action_dsl_hit_area_target_problems(tree)]
    if element is not None:
        problems += [f"element: {p}" for p in L.action_dsl_element_problems(tree, element)]
    return problems


def _write_dsl_checked(ctx, program: str, tree) -> str:
    """``write_dsl`` 只吃裸树；写后回读比对（记忆卡 wf-dsl-encode-wrapper-trap）。"""
    if not (isinstance(tree, list) and tree and tree[0] == "ActionDsl"):
        raise KitError(f"write_dsl needs a bare ActionDsl tree, got {type(tree).__name__}")
    logical = ctx.write_dsl(program, tree)
    back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
    if back != tree:
        raise KitError(f"DSL readback mismatch: {logical}")
    return logical


def build_skill_tree(ctx, level: str, family: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    """母本 151093 整树 + 诺瓦四块（A 满月灯／B 弦月灯／C 全屏驱散／FX 演出）。

    四块全部追加在根 Block 末尾（都在第 0 帧），母本原有语句顺序与数值一律不动 ——
    CNA 倍率（``{28.7}`` / ``{37.31~43, alv 3.5~7}``）、元素 255、判定区形状全保留，
    根头 ``tree[10]``（buffTargetAs）保持 donor 的 0（自动档＝技能伤害归属；写 2/3/4
    会让技伤加成全部失效，记忆卡 wf-dsl-damage-attribution-bufftargetas）。
    """
    donor_program = ctx.program_path(level).replace(CODE, TEMPLATE_CODE)
    tree = copy.deepcopy(ctx.template_dsl(donor_program))
    if tree[0] != "ActionDsl" or tree[1] != 2 or tree[10] != 0:
        raise KitError(f"skill {level} donor head drift: {tree[:2]} bta={tree[10]}")

    attacks = list(wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack"))
    if len(attacks) != 2:
        raise KitError(f"skill {level} donor should carry 2 CreateNormalAttack, got {len(attacks)}")
    multipliers = [cna[6] for cna in attacks]
    if any(cna[2] != 255 for cna in attacks):
        raise KitError(f"skill {level} CNA element drift: {[cna[2] for cna in attacks]}")

    parts = pick_graft_blocks(ctx.template_dsl(GRAFT_PROGRAM.format(lv=level)))
    values = LIGHT_VALUES[level]
    body = _statements(tree)
    before = len(body)
    body.append(make_light_block(parts, bind=SUBJECT_BASE, light_only=True,
                                 frames=values["a"][0], value=values["a"][1]))
    body.append(make_light_block(parts, bind=SUBJECT_BASE + 1, light_only=False,
                                 frames=values["b"][0], value=values["b"][1]))
    body.append(make_dispel_block(parts))
    body.append(make_fx_block(parts))
    if len(body) != before + 4:
        raise KitError(f"skill {level}: appended {len(body) - before} blocks, expected 4")

    tree, info = ctx.rewrite_effect_refs(tree, family, strict=True)
    problems = _dsl_problems(tree, element=ELEMENT)
    if problems:
        raise KitError(f"skill {level} DSL gates failed: {problems}")
    if _effect_paths(tree) - {f"{family['dst_dir']}/{FX_FUNNEL}", f"{family['dst_dir']}/{FX_EXPLOSION}"}:
        raise KitError(f"skill {level} still references foreign effects: {sorted(_effect_paths(tree))}")
    return tree, {"level": level, "grafted": 4, "light_full": values["a"], "light_half": values["b"],
                  "cna_multipliers": multipliers, "effect_rewrites": info["rewritten"],
                  "buff_target_as": tree[10]}


def _effect_paths(tree) -> set[str]:
    return {str(cmd[2][1]) for cmd in wf_dsl.iter_dsl_commands(tree, "ShowEffect")
            if isinstance(cmd[2], list) and cmd[2][0] == "SpecifyEffectDirectly"}


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

    design = load_design(ctx.root)
    if design["plan"]["unique_conditions"]["add"]:
        raise KitError("设计稿登记了固有状态，但本套件是零新件方案（裁决 §2）")

    # ---- 1) 队长技 7 行（design.json 驱动）
    leader_rows, leader_evidence = build_leader_rows(ctx, design)
    ban_forbidden_leader_kinds(leader_rows)
    capabilities: set[str] = set()
    for ev in leader_evidence:
        capabilities.update(ev["capabilities"])
    ctx.write_flat(KL.LEADER, {str(CID): leader_rows})

    # ---- 2) 词条 6 键 14 条（design.json 驱动）
    ability_rows, ability_evidence = build_ability_rows(ctx, design)
    for ev in ability_evidence:
        capabilities.update(ev["capabilities"])
    ctx.write_flat(KL.ABILITY, ability_rows)

    # ---- 3) 536 的面板强化文案
    cas_plan, cas_caps = write_strings(ctx, design)
    capabilities.update(cas_caps)
    change_skill_row = ability_rows[ABILITY_KEYS[0]][1]
    if change_skill_row[70] != CAS_CHANGE_SKILL:
        raise KitError(f"能力1#2 的 536 string_id 漂移: c70={change_skill_row[70]!r}")

    # ---- 4) action_skill 两档能量
    action_rows = write_action_skill(ctx, design)

    # ---- 5) 技能特效族（整族克隆换名 + LUT 染色；LUT 未交付时按母本原色）
    lut_path = KL.pixel_dir(ctx) / "fx_lut.json"
    lut = KL.png_transform_from_lut(lut_path)
    family = ctx.clone_effect_family(FX_SRC_DIR, FX_SUBDIR, png_transform=lut)
    if family["dst_dir"] != FX_DST_DIR or not family["complete_family"]:
        raise KitError(f"effect family drift: {family['dst_dir']} complete={family['complete_family']}")
    if sorted(family["copied_bases"]) != sorted((FX_FUNNEL, FX_EXPLOSION)):
        raise KitError(f"effect family bases drift: {family['copied_bases']}")

    # ---- 6) 技能 DSL 两档
    programs: list[str] = []
    skill_gates: dict[str, Any] = {}
    for level in ("1", "2"):
        tree, gates = build_skill_tree(ctx, level, family)
        programs.append(_write_dsl_checked(ctx, ctx.program_path(level), tree))
        skill_gates[level] = gates

    # ---- 7) 语音路由（kind 3 ChangeSkillFlag ← 能力 1#2 的 536）+ character 行
    design_route = design.get("voice", {}).get("route")
    if not isinstance(design_route, dict) or int(design_route.get("kind", -1)) != VOICE_ROUTE["kind"]:
        raise KitError(f"design voice route drift: {design_route}")
    route = KL.voice_route(CODE, VOICE_ROUTE)
    char_row = ctx.pack.pkg_character_row()
    char_row[9:17] = route
    if char_row[6] != str(PF_TYPE) or char_row[26] != STANCE or char_row[27] != str(CID):
        raise KitError(f"character row drift: c6={char_row[6]} c26={char_row[26]} c27={char_row[27]}")
    ctx.write_flat(KL.CHARACTER, {str(CID): [char_row]})
    voice_ready = KL.write_voice_ready(ctx)

    # ---- 8) 像素成品（缺文件静默跳过）+ 三层镜像
    pixel = KL.install_staged_assets(ctx)
    mirrors = ctx.sync_character_mirrors()
    if mirrors["character"][9:17] != route:
        raise KitError("character mirror lost the voice route")

    # 面板：无 desc_override，21 行逐条按客户端渲染显示（设计稿登记的 desc_expected）。
    panel = [ev["panel"] for ev in leader_evidence] + [ev["panel"] for ev in ability_evidence]
    panel.append(cas_plan[CAS_CHANGE_SKILL])

    ctx.evidence_write("kit-gates.json", {
        "leader": {"rows": leader_rows, "evidence": leader_evidence},
        "ability": {"rows": ability_rows, "evidence": ability_evidence},
        "skills": skill_gates, "action_skill": action_rows,
        "effect_family": {k: family[k] for k in ("src_dir", "dst_dir", "layout", "copied_bases",
                                                 "complete_family", "missing_effects")},
        "fx_lut": {"path": str(lut_path), "applied": bool(lut)},
        "custom_ability_string": cas_plan,
        "voice_route": route, "voice_ready": voice_ready,
        "pixel": pixel, "mirrors": mirrors,
    })

    energy = design["plan"]["skills"]["energy"]
    notes = [
        "技能『月相仪·满月调律』：母本 151093 整树（激光本体、CNA 倍率 28.7 / 37.31~43+alv3.5~7、"
        "元素 255、停球 90 帧、判定区 Circle r150 全部不动）+ 官方诺瓦 nova_4anv 四块嫁接 —— "
        "A 满月灯（主队光，ACSkillDamage 1200帧/+60~120%+alv）、B 弦月灯（主队全员，900帧/+25~50%）、"
        "C 全屏驱散 1 个敌方强化、FX 挂灯演出；主体 id 整体 +4（母本已占 0/1/2/3）；"
        f"tree[10]=0 保持（自动档＝技能伤害归属）；能量 {energy['donor']} → "
        f"{energy['level_1']}/{energy['level_2']}",
        "A/B 两条技伤状态的**数值与时长都不同** ⇒ 条件 gid 不同 ⇒ 并存并累加，同时把队长 L6 与"
        "能力 3#2 的 D40 计数垫到 2 层。**以后调数值时不许把两条调成完全相同**，否则互相覆盖、"
        "D40 只数 1 层（设计 §6.2 / 风险 R1，K4 金丝雀专验）",
        f"特效族整族克隆 {FX_SRC_DIR} → {FX_DST_DIR}（2 base、sheet 252×776 尺寸不变 ⇒ 图集增量 0）"
        + ("；已套用 B/pixel/stinel/fx_lut.json 换色（粉紫 → 月白·黄铜金）"
           if lut else "；**fx_lut.json 未交付，特效仍是母本粉紫色**，像素/特效代理交付后重跑 kit"),
        "面板：无 desc_override（套件里没有 422/629/713/722）；724 走能力 3#4 且在主位限定键 "
        f"{ABILITY_KEYS[2]}（c1=false）里，需客户端能力 kyubi-fever-ratio-v1（现 APK 已带）",
        {"pixel_install": pixel},
    ]
    # 偏离登记的唯一真源是设计稿（本轮 kit 自查发现的三条已写回 design/stinel.json 的
    # V8/V9/V10/V11），这里只做搬运与「三段都得写」的硬校验，不在两处各存一份。
    deviations: list[dict[str, Any]] = []
    for entry in design.get("deviations", ()):
        # 设计稿这批用的是 planned/actual/why；同批别的设计稿用 原设想/实际落法/原因 或 want/got/why。
        want = entry.get("planned") or entry.get("原设想") or entry.get("want")
        got = entry.get("actual") or entry.get("实际落法") or entry.get("got")
        why = entry.get("why") or entry.get("原因")
        if not (want and got and why):
            raise KitError(f"design deviation is missing 原设想/实际落法/原因: {entry}")
        deviations.append({"id": entry.get("id"), "want": want, "got": got, "why": why})

    gate = {"rows": len(leader_evidence) + len(ability_evidence), "programs": len(programs),
            "fx_lut_applied": bool(lut), "pixel_present": pixel["present"],
            "pixel_missing": [e["logical"] for e in pixel["skipped"]]}
    ready = bool(lut) and pixel["present"] and not pixel["skipped"]
    gate["reason"] = "kit 自有产物全部过闸" if ready else "、".join(filter(None, [
        "" if lut else f"特效换色 LUT 未交付（{lut_path}）",
        "" if pixel["present"] and not pixel["skipped"]
        else f"像素成品未就绪：{gate['pixel_missing'] or 'B/pixel/stinel/install.json 不存在'}"]))

    return KL.report(
        ctx, summary="丝缇涅尔：光属性技能伤害辅助（技能挂两盏「月相灯」→ 官方 D40 计数，灯越多全队技伤越高）",
        status=KL.READY if ready else KL.DRAFT, panel=panel, notes=notes, programs=programs,
        required_capabilities=sorted(capabilities),
        deviations=deviations,
        extra={"custom_ability_string": sorted(cas_plan), "effect_families": [FX_DST_DIR],
               "kit_gate": gate, "voice_route": route,
               "calibration": design.get("calibration", {})})
