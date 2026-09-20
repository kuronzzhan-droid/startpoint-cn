# -*- coding: utf-8 -*-
"""中秋批次 kit：妮可拉·中秋 119991 ``sorceress_teacher_moon``（火属性技伤辅助）。

定位「月相夜课」：开局自补技能槽 85%（能力1 #0 + 能力5 #1），靠「自身技能槽充满」（触发 24）
点亮满月轴，把全队火属性角色的技能伤害／攻击力往上堆；技能『月相夜讲』分新月·上弦·满月
三相打满屏，末段挂敌方攻击力降低 + 火属性抗性降低 + 驱散 1 个强化，并给全体火属性角色
挂技能伤害提升。设计与数值以
``work/character_packs/midautumn-20260920/design/nicola.{md,json}`` 为准 —— 本模块是
「设计 JSON 驱动」的薄壳：队长 6 行、词条 6 键 13 条的 donor／逐格改／预期 ``wf_describe``
全部从 ``design/nicola.json`` 的 ``plan`` 块读出后交给 :func:`wf_midautumn_kitlib.build_row`
装配，两边漂移（donor 缺失、legality 不过、``wf_describe`` 对不上、与设计稿登记的 ``row_final``
逐格不等）当场报错，不在本文件里手抄 19 行的具体数值。

本模块自己负责的是设计 JSON 管不到的部分：
    - ``custom_ability_string``：536「切换技能形态」的 c70 字符串键（未注册 = C8601）；
    - ``action_skill`` 两档能量 500/500、500/450（名称/描述由 ``tables`` 写 TEXTS）；
    - 技能 DSL 两档：设计稿的 ``composed_tree`` 逐命令回到官方 donor 树上核对
      （:data:`SHAPE_DONORS` 五棵官方树 + :data:`ALLOWED_CELL_DIFFS` 白名单），写后回读；
    - 技能特效：默认**直接引用官方路径**（零图集增量，裁决 §4／框架 §10.3）；
      只有 ``B/pixel/nicola/fx_lut.json`` 到位（要改色）才 ``clone_effect_family`` + LUT 染色，
      引用一律走 ``rewrite_effect_refs``；
    - 语音路由（kind 3 ChangeSkillFlag ← 能力1 #1 的 536）与 ``switched_action_skill``；
    - ``B/pixel/nicola/install.json`` 里的像素小人成品（缺文件静默跳过）。

不碰：live store / ``assets/`` / ``.cdn`` / 设备 / 存档；本套件**零固有状态**（满月轴走原生
触发 24，不自建层数），因此也没有 48×48 图标与 8 位固有 ID。
由 ``python mod-tools/wf_midautumn_build.py --char nicola --step kit`` 调用 :func:`build`。
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

KEY = "nicola"
CID, CODE = 119991, "sorceress_teacher_moon"
ELEMENT = 0                                     # 火（0 基内部编号，Red）
TEMPLATE_ID, TEMPLATE_CODE = 211020, "sorceress_teacher"

ABILITY_KEYS = tuple(f"{CID}{slot}" for slot in range(1, 7))
LEADER_ROWS = 6
ABILITY_RECORDS = 13

CAS_CHANGE_SKILL = f"change_skill_{CODE}"       # 536 的 c70 字符串键（未注册 = C8601）
VOICE_KEY = f"{CODE}_voice_ready"
VOICE_ROUTE = {"kind": 3}                       # ChangeSkillFlag ← 能力1 #1 的 536

TEXTS: dict[str, str] = {}                      # 10 个文本键在 design/nicola.json 的 texts 块里
SPEC = {
    "required_capabilities": (),
    "extra_keys": {
        KL.CAS: (CAS_CHANGE_SKILL,),
        KL.SWITCHED: (VOICE_KEY,),
    },
}

# ---------------------------------------------------------------- 技能 DSL

SKILL_LEVELS = ("1", "2")

#: 逐命令核对用的官方 donor 树（设计稿 plan.skills.donor_trees 的实际路径）。
#: ``pirates_gunner`` 提供 ``ShowEffect`` 的 ``scale=['Some',[slv]]`` 先例；设计稿
#: 原文写的是 ``rare5/``，官方实际只有 ``rare4/``（本轮实读更正，见 deviations）。
SHAPE_DONORS = {
    "mother_1": f"battle/action/skill/action/rare4/{TEMPLATE_CODE}${TEMPLATE_CODE}_1",
    "mother_2": f"battle/action/skill/action/rare4/{TEMPLATE_CODE}${TEMPLATE_CODE}_2",
    "wirfled_2": "battle/action/skill/action/rare5/wirfled_playable$wirfled_playable_2",
    "clarisse_2": "battle/action/skill/action/rare5/clarisse$clarisse_2",
    "pirates_1": "battle/action/skill/action/rare4/pirates_gunner$pirates_gunner_1",
}

#: 每条命令允许相对**某一条**官方 donor 同名命令改动的下标（0 = 命令名本身）。
#: 闸门语义：树里每条命令都必须能在 :data:`SHAPE_DONORS` 里找到一条同名同参数个数的官方命令，
#: 其差异下标是这里的子集 —— 参数形状写歪（记忆卡 wf-dsl-param-shape-f1034）、
#: 多写/少写一位、把枚举写成裸值，都会在这一步当场炸掉。
ALLOWED_CELL_DIFFS = {
    "HideCharacter": frozenset(),
    "ShowEffect": frozenset({1, 2, 12}),              # 演出名 / 特效引用 / 缩放
    "CreateHitArea": frozenset({13, 19, 21, 22}),     # 判定区寿命 + 三个 GID
    "CreateNormalAttack": frozenset({1, 6}),          # GID + 倍率
    "CreateCondition": frozenset({1, 2}),             # GID + AdditionalCondition 条目
    "DeleteCondition": frozenset({1}),                # GID
    "FindAllSubjects": frozenset({1}),                # GID
    "ShakeCamera": frozenset({1}),                    # 震幅
}

#: 设计稿 composed_tree 写的是「克隆后」的目标路径；kit 先把它退回官方源路径，
#: 需要换色时再由 ``clone_effect_family`` + ``rewrite_effect_refs`` 改写过去。
#: 直接把克隆后的路径写死在树里 = 未克隆时指向包内不存在的路径（进战斗数据不足 / C8003）。
EFFECT_RETARGET = {
    f"battle/effect/skill_unique/{CODE}/{CODE}_player_back":
        f"battle/effect/skill_unique/{TEMPLATE_CODE}/{TEMPLATE_CODE}_player_back",
    f"battle/effect/skill_unique/{CODE}/{CODE}_all":
        f"battle/effect/skill_unique/{TEMPLATE_CODE}/{TEMPLATE_CODE}_all",
    f"battle/effect/skill_unique/{CODE}/moon_phase/moon_phase_explosion":
        "battle/effect/skill_unique/megumin/megumin_explosion",
}

#: 官方 donor 的「ダミー演出」把第 10 位（``ShowEffect`` 参数 9）写 ``true``（自身挂载的
#: 立绘背景演出）；设计稿的 composed_tree 写成了 ``false``，本轮按 donor 原值恢复。
DUMMY_EFFECT_LABEL = "ダミー演出"
DUMMY_EFFECT_FLAG_INDEX = 10

#: 换色时才克隆的两族特效：(源目录, 目标子目录, 要复制的基名)
FX_FAMILIES = (
    (f"battle/effect/skill_unique/{TEMPLATE_CODE}", "lecture",
     (f"{TEMPLATE_CODE}_all", f"{TEMPLATE_CODE}_player_back")),
    ("battle/effect/skill_unique/megumin", "moon_phase", ("megumin_explosion",)),
)


# ---------------------------------------------------------------- 设计稿读取

def load_design(root: Path) -> dict[str, Any]:
    design = MS.load_design(Path(root), KEY)
    if not design:
        raise KitError(f"design/{KEY}.json missing (batch {MS.BATCH_DIR})")
    identity = design.get("identity") or {}
    if design.get("schema") != "ma-design/1" or design.get("key") != KEY:
        raise KitError(f"design schema/key drift: {design.get('schema')} {design.get('key')}")
    if (identity.get("cid"), identity.get("code"), identity.get("element")) != (CID, CODE, ELEMENT):
        raise KitError(f"design identity drift: {identity.get('cid')}/{identity.get('code')}"
                       f"/element {identity.get('element')}")
    template = identity.get("template_character") or {}
    if (template.get("id"), template.get("code")) != (TEMPLATE_ID, TEMPLATE_CODE):
        raise KitError(f"design template drift: {template.get('id')}/{template.get('code')}")
    return design


def _parse_donor(donor: str) -> tuple[str, str, str]:
    """设计稿的 donor 地址 ``"<official|live>:<ability|leader>:<键>#L<记录号(1基)>"``。

    → ``(source, kind, "键#记录号(0基)")``。``official`` = ``.cdn/cn`` 官方归档
    （``OfficialBaseline``，不是 store）；``live`` = 已上线的自制角色行，只读。
    """
    parts = str(donor).split(":")
    if len(parts) != 3:
        raise KitError(f"unexpected donor address shape: {donor!r}")
    src, table, rest = parts
    source = {"official": "official", "live": "live"}.get(src)
    kind = {"ability": "ability", "leader": "leader_ability"}.get(table)
    if source is None or kind is None:
        raise KitError(f"unrecognised donor address: {donor!r}")
    key, sep, record = rest.partition("#")
    if not sep:
        raise KitError(f"donor address lacks the #L<record> suffix: {donor!r}")
    index0 = int(record.lstrip("Ll")) - 1
    if index0 < 0:
        raise KitError(f"donor record number must be >= 1 (1-based): {donor!r}")
    return source, kind, f"{key}#{index0}"


def _check_row_final(label: str, row: list[str], entry: dict[str, Any]) -> None:
    """与设计稿登记的 ``row_final`` 逐格核对（设计稿是先算好的产物，这里抓转录/漂移）。"""
    expected = entry.get("row_final")
    if not expected:
        return
    expected = [str(x) for x in expected]
    if expected == row:
        return
    width = max(len(expected), len(row))
    diff = [(i, expected[i] if i < len(expected) else None, row[i] if i < len(row) else None)
            for i in range(width)
            if (expected[i] if i < len(expected) else None) != (row[i] if i < len(row) else None)]
    raise KitError(f"{label}: row differs from design row_final at {diff[:8]}")


def build_leader_rows(ctx, design: dict[str, Any]) -> tuple[list[list[str]], list[dict[str, Any]]]:
    plan = design["plan"]["leader_ability"]
    if plan["key"] != str(CID) or int(plan["layout"]["ncols"]) != KL.LEADER_NCOLS:
        raise KitError(f"design leader block drift: key={plan.get('key')} layout={plan.get('layout')}")
    rows: list[list[str]] = []
    evidence: list[dict[str, Any]] = []
    for entry in plan["rows"]:
        source, kind, donor = _parse_donor(entry["donor"])
        if kind != "leader_ability":
            raise KitError(f"leader#{entry['index']}: donor table is {kind}")
        label = f"leader#{entry['index']}"
        row, ev = KL.build_row(ctx, "leader_ability", donor, entry["cells"], source=source,
                               element=ELEMENT, expect_describe=entry["desc_expected"], label=label)
        if row[0] != CODE:
            raise KitError(f"{label}: c0 {row[0]!r} != {CODE}")
        _check_row_final(label, row, entry)
        rows.append(row)
        evidence.append(ev)
    if len(rows) != LEADER_ROWS or int(plan["new_row_count"]) != LEADER_ROWS:
        raise KitError(f"design leader_ability carries {len(rows)} rows, expected {LEADER_ROWS}")
    return rows, evidence


def ban_forbidden_leader_kinds(rows: list[list[str]]) -> None:
    """队长表禁 422/724/713（裁决 §2/§8：写进队长表 = C7050）。瞬发 kind 在 c45，during 在 c107。"""
    for n, row in enumerate(rows):
        if row[45] in ("422", "724", "713") or row[107] in ("422", "724", "713"):
            raise KitError(f"leader#{n}: forbidden kind in leader_ability "
                           f"(c45={row[45]!r} c107={row[107]!r})")


def build_ability_rows(ctx, design: dict[str, Any]) -> tuple[dict[str, list[list[str]]],
                                                             list[dict[str, Any]]]:
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
        rows: list[list[str]] = []
        for entry in block["records"]:
            source, kind, donor = _parse_donor(entry["donor"])
            if kind != "ability":
                raise KitError(f"{key_name}#{entry['index']}: donor table is {kind}")
            label = f"{key_name}#{entry['index']}"
            row, ev = KL.build_row(ctx, "ability", donor, entry["cells"], source=source,
                                   element=ELEMENT, expect_describe=entry["desc_expected"],
                                   label=label)
            _check_row_final(label, row, entry)
            rows.append(row)
            evidence.append(ev)
        KL.check_ability_key(rows, key_name, CODE, slot)
        # 裁决 §8：c2 statue_group 每键单值；c1 主位限制同样整键一致（check_ability_key 已判
        # 「全键一致」，这里再对上设计稿登记的值，防止两边同时漂到别的值上）。
        wanted_c1 = [str(x) for x in block["unisonable_per_record"]]
        if [r[1] for r in rows] != wanted_c1 or rows[0][2] != block["statue_group"]:
            raise KitError(f"ability {key_name}: c1/c2 {[r[1] for r in rows]}/{rows[0][2]!r} "
                           f"!= design {wanted_c1}/{block['statue_group']!r}")
        if int(block["record_count"]["new"]) != len(rows):
            raise KitError(f"ability {key_name}: {len(rows)} records != design "
                           f"{block['record_count']['new']}")
        rows_by_key[key_name] = rows
        total += len(rows)
    if total != ABILITY_RECORDS or int(plan["record_total"]) != ABILITY_RECORDS:
        raise KitError(f"ability record total {total} != {ABILITY_RECORDS}")
    return rows_by_key, evidence


def write_strings(ctx, design: dict[str, Any], ability_rows: dict[str, list[list[str]]]) -> dict[str, str]:
    """``custom_ability_string``：536「切换技能形态」的 c70 字符串键。"""
    rows = design["plan"]["texts"]["custom_ability_string"]["rows"]
    plan = {entry["key"]: entry["text"] for entry in rows}
    if set(plan) != {CAS_CHANGE_SKILL}:
        raise KitError(f"design custom_ability_string keys drift: {sorted(plan)}")
    declared = set(ctx.spec.extra_keys.get(KL.CAS, ()))
    missing = [k for k in plan if k not in declared]
    if missing:
        raise KitError(f"custom_ability_string keys not declared in SPEC['extra_keys']: {missing}")
    # 裁决 §3：能力里的「技能强化」条目不写数字与时间。
    for key, text in plan.items():
        KL.check_panel(text, skill_flag=True, label=key)
    # 反查：这个键真的被某条 536 行引用（c70），否则是死串。
    referenced = {row[70] for rows_ in ability_rows.values() for row in rows_ if row[70]}
    unused = sorted(set(plan) - referenced)
    if unused:
        raise KitError(f"custom_ability_string keys not referenced by any ability row c70: {unused}")
    ctx.write_flat(KL.CAS, {k: [[v]] for k, v in plan.items()})
    return plan


def write_action_skill(ctx, design: dict[str, Any]) -> dict[str, list[str]]:
    """两档技能能量（名称/描述由 ``tables`` 写 TEXTS，这里只改 c4/c5）。"""
    spec = ctx.spec
    energy = design["plan"]["skills"]["energy"]
    if design["plan"]["skills"]["action_skill_outer_key"] != CODE:
        raise KitError(f"design action_skill outer key drift: "
                       f"{design['plan']['skills']['action_skill_outer_key']!r}")
    inner = ctx.pkg_nested(CODE)
    if set(inner) != set(SKILL_LEVELS):
        raise KitError(f"package action_skill inner keys {sorted(inner)}")
    out: dict[str, list[str]] = {}
    for level in SKILL_LEVELS:
        cells = list(inner[level])
        if cells[7] != ctx.program_path(level):
            raise KitError(f"action_skill {level} program path drift: {cells[7]!r}")
        if cells[0] != spec.texts[f"skill{level}"] or cells[1] != spec.texts[f"desc{level}"]:
            raise KitError(f"action_skill {level}: name/desc differ from design texts (rerun tables)")
        cells[4], cells[5] = str(energy[level]["c4"]), str(energy[level]["c5"])
        out[level] = cells
    ctx.write_nested(KL.ACTION, CODE, {lv: [cells] for lv, cells in out.items()}, replace_inner=True)
    return out


# ---------------------------------------------------------------- DSL

def _flat_command(cmd: list) -> list:
    """命令的顶层参数；嵌套 ``Block``（子命令表）折成哨兵，只比本命令自己这一层。"""
    return ["<block>" if isinstance(x, list) and x and x[0] == "Block" else x for x in cmd]


def _shape(node) -> str:
    """参数的结构指纹：枚举名保留、具体数值抹掉。

    用来判「这一位的**形状**跟官方 donor 是不是同一种」——裸数值进 Array 参
    （``[{'min':10,'max':10}]`` 写成 ``10``）这类写法在详情页炸 F1034，往返自检抓不到
    （记忆卡 wf-dsl-param-shape-f1034）。
    """
    if isinstance(node, bool):
        return "bool"
    if isinstance(node, (int, float)):
        return "num"
    if node is None:
        return "null"
    if isinstance(node, str):
        return "str"
    if isinstance(node, dict):
        keys = set(node)
        return "slv" if keys <= {"min", "max", "alv_min", "alv_max", "alv2_min", "alv2_max"} \
            else "dict:" + ",".join(sorted(keys))
    if isinstance(node, list):
        if not node:
            return "[]"
        if isinstance(node[0], str) and node[0] in ("Block", "Command", "Event"):
            return node[0].lower()
        if isinstance(node[0], str):
            return "[" + node[0] + "|" + ",".join(_shape(x) for x in node[1:]) + "]"
        return "[" + ",".join(_shape(x) for x in node) + "]"
    return type(node).__name__


def donor_command_index(ctx) -> dict[str, list[list]]:
    index: dict[str, list[list]] = {}
    for path in SHAPE_DONORS.values():
        tree = ctx.template_dsl(path)
        for cmd in wf_dsl.iter_dsl_commands(tree):
            index.setdefault(cmd[0], []).append(_flat_command(cmd))
    return index


def _donor_shapes_by_slot(commands: list[list]) -> dict[int, set[str]]:
    """同名 donor 命令按下标汇总出现过的形状（官方在这一位写过哪几种形状）。"""
    out: dict[int, set[str]] = {}
    for cmd in commands:
        for i, value in enumerate(cmd):
            out.setdefault(i, set()).add(_shape(value))
    return out


def donor_gate_problems(tree, donors: dict[str, list[list]]) -> list[str]:
    """每条命令都必须能在官方 donor 里找到一条同名命令，满足两个条件：

    1. **值锚**：存在一条同名同参数个数的官方命令，与本命令不相等的下标全部落在
       :data:`ALLOWED_CELL_DIFFS` 的白名单里；
    2. **形状先例**：本命令每一位的形状（:func:`_shape`）都在官方同名命令的同一位上出现过。

    第 2 条独立于第 1 条：白名单允许改值，但改出来的形状必须是官方在那一位真写过的。
    「裸数值进 Array 参」这类 F1034 写法即使发生在允许改动的那一位，也会在这里被抓。
    """
    problems: list[str] = []
    for cmd in wf_dsl.iter_dsl_commands(tree):
        name = cmd[0]
        allowed = ALLOWED_CELL_DIFFS.get(name)
        candidates = donors.get(name, ())
        if allowed is None:
            problems.append(f"{name}: 没有登记允许改动的下标（新命令必须先找官方先例）")
            continue
        mine = _flat_command(cmd)
        same_arity = [c for c in candidates if len(c) == len(mine)]
        if not same_arity:
            problems.append(f"{name}: 官方 donor 里没有同参数个数（{len(mine) - 1}）的同名命令")
            continue
        best: tuple[int, list[int]] | None = None
        anchored = False
        for other in same_arity:
            diff = sorted(i for i in range(len(mine)) if mine[i] != other[i])
            outside = [i for i in diff if i not in allowed]
            if best is None or len(outside) < best[0]:
                best = (len(outside), diff)
            if not outside:
                anchored = True
                break
        if not anchored:
            problems.append(f"{name}: 找不到只差 {sorted(allowed)} 的官方 donor 命令"
                            f"（最接近的差在 {best[1] if best else '?'}）")
        by_slot = _donor_shapes_by_slot(same_arity)
        for i, value in enumerate(mine):
            shape = _shape(value)
            if shape not in by_slot.get(i, set()):
                problems.append(f"{name}[{i}]: 形状 {shape} 在官方同名命令的这一位上零先例"
                                f"（官方写过 {sorted(by_slot.get(i, set()))}）")
    return problems


def dsl_gate_problems(tree, *, element: int | None = None) -> list[str]:
    problems: list[str] = []
    problems += [f"direction: {p}" for p in wf_dsl.player_side_dsl_problems(tree)]
    problems += [f"coord: {p}" for p in wf_dsl.coord_sys_source_problems(tree)]
    problems += [f"subject: {p}" for p in L.action_dsl_subject_binding_problems(tree)]
    problems += [f"hit_target: {p}" for p in L.action_dsl_hit_area_target_problems(tree)]
    if element is not None:
        problems += [f"element: {p}" for p in L.action_dsl_element_problems(tree, element)]
    return problems


def retarget_effects(tree) -> int:
    """把设计稿写的「克隆后目标路径」退回官方源路径，并恢复 donor 的 ダミー演出 布尔位。"""
    changed = 0
    for cmd in wf_dsl.iter_dsl_commands(tree, "ShowEffect"):
        ref = cmd[2]
        if isinstance(ref, list) and len(ref) == 2 and ref[0] == "SpecifyEffectDirectly":
            target = EFFECT_RETARGET.get(str(ref[1]))
            if target is not None:
                cmd[2] = ["SpecifyEffectDirectly", target]
                changed += 1
        if cmd[1] == DUMMY_EFFECT_LABEL and cmd[DUMMY_EFFECT_FLAG_INDEX] is not True:
            cmd[DUMMY_EFFECT_FLAG_INDEX] = True
            changed += 1
    return changed


def build_skill_tree(ctx, design: dict[str, Any], level: str, families: list[dict[str, Any]],
                     donors: dict[str, list[list]]) -> tuple[Any, dict[str, Any]]:
    plan = design["plan"]["skills"][f"tree_plan_{level}"]
    if plan["program"] != ctx.program_path(level):
        raise KitError(f"skill {level} program path drift: {plan['program']!r}")
    tree = copy.deepcopy(plan["composed_tree"])
    if not (isinstance(tree, list) and tree and tree[0] == "ActionDsl"):
        raise KitError(f"skill {level} design tree is not a bare ActionDsl tree")
    if tree[10] != 0:
        # tree[10] = buffTargetAs：0 = 自动档 = 技能伤害；写 2/3/4 会改乘区，
        # 全队技伤加成全部失效（记忆卡 wf-dsl-damage-attribution-bufftargetas）。
        raise KitError(f"skill {level}: buffTargetAs must stay 0, got {tree[10]}")
    retarget_effects(tree)

    rewrites = 0
    kept: list[str] = []
    for family in families:
        tree, info = ctx.rewrite_effect_refs(tree, family)
        rewrites += info["rewritten"]
        kept += list(info.get("kept_donor") or ())

    problems = donor_gate_problems(tree, donors) + dsl_gate_problems(tree, element=ELEMENT)
    if problems:
        raise KitError(f"skill {level} DSL gates failed: {problems}")
    refs = sorted({str(c[2][1]) for c in wf_dsl.iter_dsl_commands(tree, "ShowEffect")
                   if isinstance(c[2], list) and len(c[2]) == 2 and c[2][0] == "SpecifyEffectDirectly"})
    return tree, {"level": level, "effect_rewrites": rewrites, "effect_refs": refs,
                  "kept_official_refs": sorted(set(kept)),
                  "buff_target_as": tree[10], "values": plan.get("values")}


def write_dsl_checked(ctx, program: str, tree) -> str:
    """``write_dsl`` 只吃裸树；写后回读比对（记忆卡 wf-dsl-encode-wrapper-trap）。"""
    if not (isinstance(tree, list) and tree and tree[0] == "ActionDsl"):
        raise KitError(f"write_dsl needs a bare ActionDsl tree, got {type(tree).__name__}")
    logical = ctx.write_dsl(program, tree)
    back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
    if back != tree:
        raise KitError(f"DSL readback mismatch: {logical}")
    return logical


def clone_effect_families(ctx, transform) -> list[dict[str, Any]]:
    """只有要换色（``fx_lut.json`` 到位）才克隆；否则直接引用官方路径（零图集增量）。"""
    if transform is None:
        return []
    families = []
    for src_dir, subdir, members in FX_FAMILIES:
        family = ctx.clone_effect_family(src_dir, subdir, fx_names=list(members),
                                         png_transform=transform)
        if sorted(family["copied_bases"]) != sorted(members):
            raise KitError(f"effect family {src_dir}: copied {family['copied_bases']} != {list(members)}")
        families.append(family)
    return families


# ---------------------------------------------------------------- 入口

def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.cid, spec.code, spec.element) != (CID, CODE, ELEMENT):
        raise KitError(f"identity drift: {spec.cid}/{spec.code}/element {spec.element}")
    if (spec.template_id, spec.template_code) != (TEMPLATE_ID, TEMPLATE_CODE):
        raise KitError(f"template drift: {spec.template_id}/{spec.template_code}")
    if spec.pf_type != 4 or spec.stance != "Supporter" or spec.rarity != 5:
        raise KitError(f"spec drift: pf_type={spec.pf_type} stance={spec.stance} rarity={spec.rarity}")
    if MS.text_placeholders(spec):
        raise KitError(f"design texts still placeholders: {MS.text_placeholders(spec)}")

    design = load_design(ctx.root)
    if design["plan"]["unique_conditions"]["add"]:
        raise KitError("design now carries unique_conditions; this kit is built for the zero-unique plan")

    # ---- 1) 队长技 6 行（design.json 驱动）
    leader_rows, leader_evidence = build_leader_rows(ctx, design)
    ban_forbidden_leader_kinds(leader_rows)
    capabilities: set[str] = set()
    for ev in leader_evidence:
        capabilities.update(ev["capabilities"])
    ctx.write_flat(KL.LEADER, {str(CID): leader_rows})

    # ---- 2) 词条 6 键 13 条（design.json 驱动）
    ability_rows, ability_evidence = build_ability_rows(ctx, design)
    for ev in ability_evidence:
        capabilities.update(ev["capabilities"])
    ctx.write_flat(KL.ABILITY, ability_rows)

    # ---- 3) 536 的面板字符串
    cas_plan = write_strings(ctx, design, ability_rows)

    # ---- 4) action_skill 两档能量
    action_rows = write_action_skill(ctx, design)

    # ---- 5) 技能特效：默认直接引用官方路径；有 fx_lut.json 才克隆 + 染色
    lut_path = KL.pixel_dir(ctx) / "fx_lut.json"
    transform = KL.png_transform_from_lut(lut_path)
    families = clone_effect_families(ctx, transform)

    # ---- 6) 技能 DSL 两档
    donors = donor_command_index(ctx)
    programs: list[str] = []
    skill_gates: dict[str, Any] = {}
    for level in SKILL_LEVELS:
        tree, gates = build_skill_tree(ctx, design, level, families, donors)
        programs.append(write_dsl_checked(ctx, ctx.program_path(level), tree))
        skill_gates[level] = gates

    # ---- 7) 语音路由（kind 3 ChangeSkillFlag ← 能力1 #1 的 536）+ character 行
    route = KL.voice_route(CODE, VOICE_ROUTE)
    design_route = design["voice"]["route"]
    if int(design_route["kind"]) != VOICE_ROUTE["kind"] or \
            [str(x) for x in design_route["character_c9_c16"]] != route:
        raise KitError(f"design voice route drift: {design_route}")
    if not any(row[47] == "536" for rows in ability_rows.values() for row in rows):
        raise KitError("voice route kind 3 (ChangeSkillFlag) needs a 536 ability row in the kit")
    char_row = ctx.pack.pkg_character_row()
    char_row[9:17] = route
    if char_row[6] != str(spec.pf_type) or char_row[26] != "Supporter" or char_row[27] != str(CID):
        raise KitError(f"character row drift: c6={char_row[6]} c26={char_row[26]} c27={char_row[27]}")
    if char_row[18] != spec.texts["leader"] or list(char_row[19:25]) != list(ABILITY_KEYS):
        raise KitError(f"character row leader/ability columns drift: {char_row[17:25]}")
    ctx.write_flat(KL.CHARACTER, {str(CID): [char_row]})
    voice_ready = KL.write_voice_ready(ctx)

    # ---- 8) 像素成品（缺文件静默跳过）+ 三层镜像
    pixel = KL.install_staged_assets(ctx)
    mirrors = ctx.sync_character_mirrors()
    if mirrors["character"][9:17] != route:
        raise KitError("character mirror lost the voice route")

    # 面板：本套件没有 desc_override（全套零 422/724/629/722、零 during 行），
    # 队长 6 行与词条 13 条都按 wf_describe 原文显示；536 条目的文字来自 custom_ability_string。
    panel = [ev["describe"] for ev in leader_evidence]
    panel += [ev["describe"] for ev in ability_evidence]
    panel.append(cas_plan[CAS_CHANGE_SKILL])

    ctx.evidence_write("kit-gates.json", {
        "leader": {"rows": leader_rows, "evidence": leader_evidence},
        "ability": {"rows": ability_rows, "evidence": ability_evidence},
        "skills": skill_gates, "action_skill": action_rows,
        "custom_ability_string": cas_plan,
        "effect_families": [{k: fam[k] for k in ("src_dir", "dst_dir", "layout", "copied_bases",
                                                 "complete_family", "missing_effects")}
                            for fam in families],
        "fx_lut": {"path": str(lut_path), "present": transform is not None},
        "donor_trees": SHAPE_DONORS, "allowed_cell_diffs": {k: sorted(v) for k, v in
                                                            ALLOWED_CELL_DIFFS.items()},
        "voice_route": route, "voice_ready": voice_ready,
        "pixel": pixel, "mirrors": mirrors,
    })

    notes = [
        "队长 6 行：火共鸣（编成≥6）基座攻击 200% + 技伤 200%，招牌是 L3「开局除自身全员(火)"
        "技能槽 100%」与 L4「任一火属性角色技能槽充满 → 全队(火)技伤 +30%，限 5 次」；"
        "全队主轴合计 550%（裁决 §2 带 490–650）。",
        "词条 6 键 13 条：全部瞬发行（触发模式列全 0，零 during 行）——绕开 c85 哨兵、"
        "during puller 契约与「生命值100%以下」恒真文案三类坑；零固有状态（满月轴走原生触发 24）。",
        f"技能 DSL：设计稿 composed_tree 逐命令回到 {len(SHAPE_DONORS)} 棵官方 donor 树上核对"
        f"（允许改动下标白名单见 evidence/kit-gates.json），两档 tree[10]=0 保持技能伤害归属；"
        "写后回读比对。三相各 10 倍（＋档 10.4~12 带 alv 0.5~1.0，官方 CNA 带 alv 有 22 处先例）。",
        ("技能特效：已套用 B/pixel/nicola/fx_lut.json 换色，克隆 "
         + "、".join(f["dst_dir"] for f in families)
         if families else
         "技能特效：无 fx_lut.json ⇒ 不克隆，直接引用官方路径 "
         f"battle/effect/skill_unique/{TEMPLATE_CODE}/* 与 battle/effect/skill_unique/megumin/"
         "megumin_explosion（零图集增量，裁决 §4／框架 §10.3）。像素代理交付 LUT 后重跑 "
         "--step kit 会自动改成克隆 + 染色。"),
        "语音：kind 3 ChangeSkillFlag ← 能力1 #1 的 536（主位 + 火共鸣时播 matched_skill_ready）。",
        {"pixel_install": pixel},
    ]

    deviations = [
        {"want": "design/nicola.json identity.status_donor：kit 里用 ★5 火属性 donor 111177 "
                 "覆盖 character_status（母本 211020 是 ★4，Lv100 会停在 3320/674）",
         "got": "kit 不碰 character_status —— 框架 `MAPack.template_raw` 已在 --step tables 自动把 "
                "★4 母本的 character_status 换成同 pf 类型的官方 ★5 donor 111153 flame_blessgirl"
                "（Lv100 4059/799，框架 §6/§11 实跑核对过）",
         "why": "同一张表两处改会互相覆盖；框架的 donor 选取规则可复算（median_donor）且被 "
                "--step check 的 rarity 字段持续复核，kit 再写一遍只会让两边漂移"},
        {"want": "design/nicola.json plan.skills.tree_plan_*：ダミー演出 ShowEffect 第 10 位写 false",
         "got": "按官方 donor 原值恢复成 true（母本 rare4/sorceress_teacher 的 _1/_2 两棵树都是 true；"
                "同树的「全体演出」才是 false）",
         "why": "设计稿没有给改动理由，两个演出的这一位在官方树里本来就不同值 ⇒ 判定为转录误差；"
                "「donor + 逐格改」只改有理由改的格（裁决 §6）。设计稿已同步改回"},
        {"want": "design/nicola.json plan.skills.effects_clone：目标目录直接是 "
                 f"battle/effect/skill_unique/{CODE}/，basename 改名成 {CODE}_* / moon_phase_*",
         "got": f"不改色时**不克隆**，DSL 直接引用官方 {TEMPLATE_CODE}/megumin 路径；要改色时 "
                "clone_effect_family(layout='codename') 落在 "
                f"battle/effect/skill_unique/{CODE}/<lecture|moon_phase>/，basename 保留官方前缀，"
                "引用统一由 rewrite_effect_refs 改写",
         "why": "裁决 §4／框架 §10.3「只引用不改色的官方特效直接引用官方路径，不要复制」；"
                "框架的 codename 布局不支持「目标即角色根目录、basename 改名」"
                "（同批 magnus/mia 已撞过同一限制）。只是路径命名差异，不影响引用正确性"},
        {"want": "design/nicola.json plan.skills.atlas_estimate：moon_phase 子集重打后 ≈0.14 Mpx",
         "got": "clone_effect_family 不重打图集 —— 它整张复制 donor sheet（megumin 247×853 ≈0.21 Mpx）"
                "并只改 atlas 的目录前缀；只有改色时才有这份增量，不改色时增量为 0",
         "why": "框架既有实现（wf_seasonal7_common.clone_effect_family）；即便克隆，单角色合计仍 "
                "≈0.43 Mpx ≈2.6%，低于裁决 §6 的 3.5% 通过线"},
        {"want": "design/nicola.json plan.skills.tree_plan_common.validation：ShowEffect(AB, Some) 的"
                 "官方样本是 pirates_gunner_1",
         "got": "官方实际路径是 battle/action/skill/action/rare4/pirates_gunner$pirates_gunner_1"
                "（rare5 下没有这个角色），本 kit 的 donor 闸门用的就是 rare4 这棵",
         "why": "实读 WF_PATHLIST_recovered.txt 与官方归档核实；设计稿已补上完整路径"},
    ]
    for entry in design.get("deviations", ()):
        deviations.append({"want": entry.get("item") or entry.get("want"),
                           "got": entry.get("actual") or entry.get("got"),
                           "why": entry.get("why")})

    gate = {"leader_rows": len(leader_evidence), "ability_records": len(ability_evidence),
            "programs": len(programs), "effect_families": [f["dst_dir"] for f in families],
            "fx_lut_present": transform is not None,
            "pixel_present": pixel["present"],
            "pixel_missing": [e["logical"] for e in pixel["skipped"]]}
    ready = pixel["present"] and not pixel["skipped"]
    gate["reason"] = "kit 自有产物全部过闸" if ready else \
        f"像素成品未就绪：{gate['pixel_missing'] or 'B/pixel/nicola/install.json 不存在'}"

    return KL.report(
        ctx, summary="妮可拉：火属性技伤辅助（满月轴——自身技能槽充满驱动的全队技伤/攻击增益 + "
                     "三相月技能，末段挂攻击降低·火抗降低·驱散 1）",
        status=KL.READY if ready else KL.DRAFT, panel=panel, notes=notes, programs=programs,
        required_capabilities=sorted(capabilities | set(SPEC["required_capabilities"])),
        deviations=deviations,
        extra={"custom_ability_string": sorted(cas_plan),
               "effect_families": [f["dst_dir"] for f in families],
               "kit_gate": gate, "voice_route": route,
               "unique_conditions": []})
