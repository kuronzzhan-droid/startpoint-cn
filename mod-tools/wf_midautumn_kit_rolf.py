# -*- coding: utf-8 -*-
"""中秋批次 kit：罗尔夫·中秋 149986 ``black_wolf_knight_moon``（风属性直击输出核心）。

定位「月下独奏」：一发技能同时点亮**最大速度固定**与**贯通**两个门，队长 5 行与词条 6 键
12 条里的 8 条全部挂在这两个门上；速度固定另把同目标直击冷却 20 帧压到 10 帧（隐形乘区，
不进面板）。零固有状态、零 422/629/713/722/724、零客户端补丁能力、零图集增量
（技能特效直接引用官方 ``black_wolf_knight_wt23`` 路径，风→风不换色）。
设计与数值以 ``work/character_packs/midautumn-20260920/design/rolf.{md,json}`` 为准。

本模块是「设计 JSON 驱动」的薄壳：队长 5 行、词条 6 键 12 条的 donor / 逐格改 / 预期
``wf_describe`` 全部从 ``design/rolf.json`` 的 ``plan`` 块读出后交给
:func:`wf_midautumn_kitlib.build_row` 装配 —— 设计稿的 ``cells`` 是**整行**（只列非空列），
kit 把它与官方 donor 逐格求差得到 edits，装配完再反向核对整行，于是
「donor 在官方侧漂移」「设计稿自相矛盾」「描述器漂移」三类错都会当场报出来，
不在本文件里手抄 17 行的具体数值。

本模块自己负责设计 JSON 之外的部分：

    - **裁决 §8 的设计自查**：队长表禁 422/724/713；during 触发的 puller 列
      （D214/D30 留空、D204 写 9＋元素组）；c2 雕像组每键单值**且逐 kind 有官方先例**；
      套件内禁 201/202/521（C2308）与 252/45（段数取优死行）；零固有状态；零补丁能力。
    - **技能 DSL 两档**：母本 141159 ``black_wolf_knight_wt23_{lv}`` 整树，删掉 PF 块，
      两处判定区 ``params[23] 0→4``（两段走直击伤害池），两条 CNA 倍率改档，
      再嫁接官方铃鹿 ``silence_suzuka_2`` 的「贯通＋最大速度固定」块（选择器 82 主小队）
      与官方画狂老人Z ``mob_jiguza_playable_2`` 的「风属性角色直击伤害↑」块（选择器 113[4]）。
    - ``action_skill`` 两档能量 600/600、600/550 → 560/560、560/510。
    - 母本 536「切换技能形态」整条删除（词条表 c70 逐行断言无 ``change_skill_`` 字样）；
      语音第二条准备音改走 kind 1（贯通）路由。
    - ``B/pixel/rolf/`` 的像素成品与可选 ``fx_lut.json``（都缺就跳过，不换色、不克隆特效族）。

不碰：live store / ``assets/`` / ``.cdn`` / 设备 / 存档；不碰 179999 wt26 与官方 111007 / 141159 的键。
由 ``python mod-tools/wf_midautumn_build.py --char rolf --step kit`` 调用 :func:`build`。
"""
from __future__ import annotations

import copy
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

KEY = "rolf"
CID, CODE = 149986, "black_wolf_knight_moon"
ELEMENT = 3                                      # 风（0 基内部编号，Green）
TEMPLATE_ID, TEMPLATE_CODE = 141159, "black_wolf_knight_wt23"
PF_TYPE, STANCE = 0, "Attacker"                  # c6 母本原值；c26 直击主 C ⇒ Attacker

ABILITY_KEYS = tuple(f"{CID}{slot}" for slot in range(1, 7))
LEADER_ROWS = 5
ABILITY_RECORDS = 12

VOICE_KEY = KL.switch_key(CODE)                  # black_wolf_knight_moon_voice_ready
# kind 1 = ConditionExist；c10=31 贯通、c11=0。普莉姆拉 169992 已上线同形（wf_seasonal7_kit_primula）。
VOICE_ROUTE_COLS = ["1", "31", "0", "", "", VOICE_KEY, "false", "false"]

# 母本 1411596 的 536 行被 tables 重映射出来的字符串键：本套件没有 536 ⇒ 它无人引用（只登记）。
ORPHAN_CAS_KEY = f"change_skill_{CODE}"

# 技能特效：裁决 §4「优先直接引用官方路径」。母本三件本来就是风绿，风→风零染色、零图集增量。
FX_SRC_DIR = f"battle/effect/skill_unique/{TEMPLATE_CODE}"
FX_SUBDIR = "moonlight"
FX_DST_DIR = f"battle/effect/skill_unique/{CODE}/{FX_SUBDIR}"
FX_BASES = (f"{TEMPLATE_CODE}_slash", f"{TEMPLATE_CODE}_smash", f"{TEMPLATE_CODE}_explosion")
OFFICIAL_FX_PATHS = frozenset(f"{FX_SRC_DIR}/{name}" for name in FX_BASES)

# 嫁接源（都取 lv2 档的官方树；节点整块复制，只改绑定 id 与数值）。
SUZUKA_PROGRAM = "battle/action/skill/action/rare5/silence_suzuka$silence_suzuka_2"
JIGUZA_PROGRAM = "battle/action/skill/action/rare5/mob_jiguza_playable$mob_jiguza_playable_2"
BIND_TEAM = 8          # root[1] 贯通＋最大速度固定（选择器 82 主小队）
BIND_WIND = 9          # root[2] 风属性角色直击伤害↑（选择器 113 过滤 [4]）
SELECTOR_MAIN_PARTY = 82
SELECTOR_ELEMENT = 113
# 官方基线 940 棵技能树实读（09-20）：``ACFixedSpeed`` 的充能参数只出现过这 6 个值，
# **0 零先例**（设计 deviations D6 / risks R5）。本套件取最轻档 -0.1。
OFFICIAL_FIXED_SPEED_CHARGES = (-0.65, -0.3, -0.2, -0.15, -0.12, -0.1)
DSL_WIND = ELEMENT + 1  # DSL 显式元素码 = 内部 + 1（记忆卡 wf-dsl-element-code-offset）

# 判定区 26 参卡：``params[23]`` = cmd[24]（伤害归属）。0 = 技能伤害、4 = 直接攻击伤害。
HIT_AREA_DAMAGE_SLOT = 24
HIT_AREA_MAXHITS_SLOT = 14
CNA_MULTIPLIER_SLOT = 6

# 行布局（设计稿 plan.*.layout；puller 断言用）。
LEADER_DURING_TRIGGER, LEADER_DURING_PULLER = 95, 96
LEADER_INSTANT_KIND, LEADER_DURING_KIND = 45, 107
ABILITY_DURING_TRIGGER, ABILITY_DURING_PULLER = 97, 98
ABILITY_INSTANT_KIND, ABILITY_DURING_KIND = 47, 109
# during 触发里「必须留空 puller」与「必须写 9＋元素组」的两组（设计 engine_findings E5）。
PULLER_MUST_BE_EMPTY = ("214", "30")
PULLER_MUST_BE_NINE = ("204",)

FORBIDDEN_LEADER_KINDS = ("422", "724", "713")   # 写进队长表 = C7050（裁决 §2/§8）
# C2308（瞬发常驻「取最大值类」段数）与段数取优死行（设计 engine_findings E1/E4）。
FORBIDDEN_ABILITY_KINDS = ("201", "202", "521", "252", "45", "629", "536", "422", "724", "713")

DONOR_ADDRESS = re.compile(r"official (leader_ability|ability) (\d+)#L(\d+)")

TEXTS: dict[str, str] = {}       # 10 个文本键在 design/rolf.json 的 texts 块里（build 里核验）
SPEC = {
    "required_capabilities": (),                 # 零补丁套件：每行的 required_client_capabilities 必须空
    "extra_keys": {KL.SWITCHED: (VOICE_KEY,)},   # 唯一自有键；无固有状态、无 custom_ability_string
}


# ---------------------------------------------------------------- 设计稿读取

def load_design(root: Path | None = None) -> dict[str, Any]:
    design = MS.load_design(Path(root) if root is not None else Path("."), KEY)
    if not design:
        raise KitError(f"design/{KEY}.json missing (batch {MS.BATCH_DIR})")
    if (design.get("schema"), design.get("cid"), design.get("code")) != ("ma-design/1", CID, CODE):
        raise KitError(f"design identity drift: {design.get('schema')} "
                       f"{design.get('cid')} {design.get('code')}")
    return design


def parse_donor(donor: str) -> tuple[str, str]:
    """``"official ability 2410331#L1"`` → (``"ability"``, ``"2410331#0"``)。

    设计稿的记录号是 **1 基**（``design/rolf.md`` 的写法），``kitlib.donor_row`` 要 0 基下标。
    只认官方基线（``.cdn/cn`` ``OfficialBaseline``）—— 裁决 §6「不拿 store 当官方」。
    """
    match = DONOR_ADDRESS.fullmatch(str(donor).strip())
    if match is None:
        raise KitError(f"unrecognised donor address: {donor!r}")
    kind, key, level = match.group(1), match.group(2), int(match.group(3))
    if level < 1:
        raise KitError(f"donor record number must be >= 1 (1-based): {donor!r}")
    return kind, f"{key}#{level - 1}"


def full_row(cells: dict[str, Any], ncols: int, label: str) -> list[str]:
    """设计稿的 ``cells`` 只列非空列 ⇒ 展开成整行，没列到的列一律空串。"""
    row = [""] * ncols
    for col, value in cells.items():
        index = int(col)
        if not 0 <= index < ncols:
            raise KitError(f"{label}: column {index} out of range (ncols={ncols})")
        if value is None or str(value) == "":
            raise KitError(f"{label}: cells 只许列非空列，c{index} 写了空值")
        row[index] = str(value)
    return row


def derive_edits(donor: list[str], want: list[str]) -> dict[int, str]:
    """逐格求差：donor 与设计稿整行不同的列就是这一行的 edits（含「改成空串」）。"""
    return {i: want[i] for i in range(len(want)) if donor[i] != want[i]}


def assemble(ctx, kind: str, entry: dict[str, Any], label: str) -> tuple[list[str], dict[str, Any]]:
    """官方 donor 整行 + 逐格改 + 三道合法性 + ``wf_describe`` 回读 + 反向核对整行。"""
    table_kind, donor_addr = parse_donor(entry["donor"])
    if table_kind != kind:
        raise KitError(f"{label}: donor points at {table_kind}, expected {kind}")
    ncols = KL.ABILITY_NCOLS if kind == "ability" else KL.LEADER_NCOLS
    table = KL.ABILITY if kind == "ability" else KL.LEADER
    want = full_row(entry["cells"], ncols, label)
    donor = KL.apply_cells(KL.donor_row(ctx, table, donor_addr), {}, ncols)
    edits = derive_edits(donor, want)
    row, evidence = KL.build_row(ctx, kind, donor_addr, edits,
                                 element=ELEMENT if kind == "ability" else None,
                                 expect_describe=entry["desc_expected"], label=label)
    if row != want:
        diffs = [(i, row[i], want[i]) for i in range(ncols) if row[i] != want[i]]
        raise KitError(f"{label}: 成品行与设计稿 cells 不一致（列, 实际, 设计）: {diffs}")
    if row[0] != (CODE if kind == "leader_ability" else f"{CODE}_{label[7]}"):
        raise KitError(f"{label}: c0 {row[0]!r} unexpected")
    KL.check_panel(entry["desc_expected"], label=label)
    evidence = evidence | {"panel": entry["desc_expected"], "edited_columns": sorted(edits)}
    return row, evidence


# ---------------------------------------------------------------- 裁决 §8 设计自查

def check_leader_kinds(rows: list[list[str]]) -> None:
    """队长表禁 422/724/713（写进去 = C7050，记忆卡 wf-dash-parameter-leader-table-trap）。"""
    for n, row in enumerate(rows):
        bad = {row[LEADER_INSTANT_KIND], row[LEADER_DURING_KIND]} & set(FORBIDDEN_LEADER_KINDS)
        if bad:
            raise KitError(f"leader#{n}: forbidden kind {sorted(bad)} in leader_ability")


def check_ability_kinds(rows_by_key: dict[str, list[list[str]]]) -> None:
    """套件内禁 201/202/521（C2308）、252/45（段数取优死行）、629/536/422/724/713。"""
    for key, rows in rows_by_key.items():
        for n, row in enumerate(rows):
            bad = ({row[ABILITY_INSTANT_KIND], row[ABILITY_DURING_KIND]}
                   & set(FORBIDDEN_ABILITY_KINDS))
            if bad:
                raise KitError(f"ability {key}#{n}: forbidden kind {sorted(bad)}")


def check_during_pullers(rows: list[list[str]], trigger_col: int, puller_col: int,
                         label: str) -> list[dict[str, Any]]:
    """during 触发的 puller 列：D214/D30 必须留空，D204 必须写 9 ＋元素组。

    写错 ⇒ ``parseAt98`` C7050（设计 engine_findings E5 / 记忆卡 wf-precondition-puller-c7050）。
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


def official_group_kinds(ctx) -> tuple[dict[tuple[str, str], int], dict[tuple[str, str], int]]:
    """官方基线里 ``(c2 雕像组, kind)`` 的先例计数：瞬发 c47 一张、持续 c109 一张。"""
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
    return instant, during


def check_statue_group_precedent(ctx, rows_by_key: dict[str, list[list[str]]]) -> list[dict[str, Any]]:
    """裁决 §8：跨 kind 组键前，所选 c2 在该键用到的**每个** kind 上都要有官方先例。

    本套件 09-20 的自查结果：``attack_common`` 对 ``during 46``（DirectAttack3 常驻段数）与
    ``instant 690``（Fixed速度↑延长）各 0 行先例 ⇒ 1499863 / 1499865 改 ``condition``
    （设计 deviations D10）。``ability_statue_group`` 只有颜色/图标/形象三列，纯面板外观。
    """
    instant, during = official_group_kinds(ctx)
    report, missing = [], []
    for key, rows in rows_by_key.items():
        group = rows[0][2]
        for n, row in enumerate(rows):
            for kind_col, table, tag in ((ABILITY_INSTANT_KIND, instant, "instant"),
                                         (ABILITY_DURING_KIND, during, "during")):
                kind = row[kind_col]
                if not kind:
                    continue
                count = table.get((group, kind), 0)
                report.append({"key": key, "record": n, "group": group,
                               "trigger": tag, "kind": kind, "official_rows": count})
                if count <= 0:
                    missing.append(f"{key}#{n} {group} × {tag} {kind}")
    if missing:
        raise KitError("c2 雕像组在这些 kind 上没有官方先例（裁决 §8）: " + ", ".join(missing))
    return report


# ---------------------------------------------------------------- 表写入

def build_leader_rows(ctx, design: dict[str, Any]) -> tuple[list[list[str]], list[dict[str, Any]]]:
    plan = design["plan"]["leader_ability"]
    if str(plan["key"]) != str(CID) or int(plan["layout"]["ncols"]) != KL.LEADER_NCOLS:
        raise KitError(f"design leader block drift: key={plan.get('key')} layout={plan.get('layout')}")
    rows, evidence = [], []
    for entry in plan["rows"]:
        label = f"leader#{entry['index']}({entry['label']})"
        row, ev = assemble(ctx, "leader_ability", entry, label)
        rows.append(row)
        evidence.append(ev)
    if len(rows) != LEADER_ROWS:
        raise KitError(f"design leader_ability carries {len(rows)} rows, expected {LEADER_ROWS}")
    check_leader_kinds(rows)
    return rows, evidence


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
    for slot, key in enumerate(ABILITY_KEYS, start=1):
        block = plan["keys"][key]
        rows = []
        for index, entry in enumerate(block["records"]):
            label = f"ability{slot}#{index}({entry['label']})"
            row, ev = assemble(ctx, "ability", entry, label)
            rows.append(row)
            evidence.append(ev)
            total += 1
        KL.check_ability_key(rows, key, CODE, slot)
        if rows[0][1] != str(block["c1_unisonable"]) or rows[0][2] != str(block["statue_group_c2"]):
            raise KitError(f"ability {key}: c1/c2 {rows[0][1]}/{rows[0][2]} != design "
                           f"{block['c1_unisonable']}/{block['statue_group_c2']}")
        rows_by_key[key] = rows
    if total != ABILITY_RECORDS:
        raise KitError(f"design ability carries {total} records, expected {ABILITY_RECORDS}")
    check_ability_kinds(rows_by_key)
    return rows_by_key, evidence


def write_action_skill(ctx, design: dict[str, Any]) -> dict[str, list[str]]:
    """两档能量 600/600、600/550 → 560/560、560/510；名称/描述由 tables 写，这里只核验。"""
    spec = ctx.spec
    energy = design["plan"]["skills"]["energy"]
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
    ctx.write_nested(KL.ACTION, CODE, {lv: [cells] for lv, cells in out.items()}, replace_inner=True)
    return out


def audit_orphan_change_skill(ctx) -> dict[str, Any]:
    """母本 1411596 的 536 被整条替换掉了 ⇒ tables 建出来的字符串键成了孤儿，只登记不撤销。

    设计 asserts 的「成品表不得含 ``change_skill_`` 字样」指的是**词条表 c70**（那条由
    :func:`build` 逐行断言）。``custom_ability_string`` 里这个多出来的字符串键是框架
    ``tables`` 的产物、由框架认领：撤销它会让包内表既无认领又删不掉
    （``unclaim`` 只在「包内表与底表逐行相同」时才删文件，而底表正被同批别的角色改着），
    直接撞 manifest 的 ``root_tables_not_claimed``。一行没人引用的字符串零风险，留着。
    """
    try:
        present = ORPHAN_CAS_KEY in ctx.pkg_flat(KL.CAS)
    except FileNotFoundError:
        present = False
    return {"key": ORPHAN_CAS_KEY, "present": present, "referenced": False,
            "action": "left in place (framework-owned, unreferenced)"}


# ---------------------------------------------------------------- DSL 工具

def num(value) -> int | float:
    """整数值写成 AMF3 整数，非整数才写 double（官方树的写法；设计 deviations D12）。"""
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


def block_commands(cmd, slot: int) -> list:
    block = cmd[slot]
    if not (isinstance(block, list) and block and block[0] == "Block"):
        raise KitError(f"{cmd[0]} p{slot} is not a Block")
    return [command(st) for st in block[1]]


def drop_power_flip_block(tree) -> dict[str, Any]:
    """删掉母本 root[1]：``FindAllSubjects(8,34,[4]) → FindAllSubjects(9,97) → ACPowerFlipDamage``。

    本角色一条 PF kind 都不写（设计 positioning / pf_override_why），绑定号 8/9 因此空出来。
    """
    body = statements(tree)
    if len(body) != 2:
        raise KitError(f"donor root carries {len(body)} statements, expected 2")
    cmd = command(body[1])
    if not cmd or cmd[0] != "FindAllSubjects" or cmd[1] != BIND_TEAM or cmd[2] != 34:
        raise KitError(f"donor root[1] is not the PF block: {cmd[:3] if cmd else body[1][:1]}")
    inner = block_commands(cmd, 9)
    if len(inner) != 1 or not inner[0] or inner[0][0] != "FindAllSubjects" or inner[0][2] != 97:
        raise KitError("donor root[1] inner selector drift")
    condition = block_commands(inner[0], 9)
    if len(condition) != 1 or condition[0][0] != "CreateCondition" \
            or condition[0][2][0][0] != "ACPowerFlipDamage":
        raise KitError("donor root[1] does not carry ACPowerFlipDamage")
    removed = body.pop(1)
    return {"removed_command": command(removed)[0], "freed_bindings": [BIND_TEAM, BIND_WIND]}


def retune_attacks(tree, values: dict[str, Any]) -> dict[str, Any]:
    """两处判定区 ``params[23] 0 → 4``（两段改走直接攻击伤害池），两条 CNA 倍率改档。

    斩击 = 单发判定区（``CalculatedUsingMaxNumOfHits`` 1，Wait 9 段）；
    爆击 = 10 连击判定区（Wait 49 段）。其余参数（target / element 255 / flat / 削韧 / Fever /
    incCombo）一格不动（设计 S4）。
    """
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
    out = {"hit_area_damage_kind": kind, "multipliers": {}}
    for tag, hits in (("slash", 1), ("burst", 10)):
        attacks = [c for c in block_commands(by_hits[hits], 23) if c and c[0] == "CreateNormalAttack"]
        if len(attacks) != 1:
            raise KitError(f"{tag} hit area carries {len(attacks)} CreateNormalAttack")
        attack = attacks[0]
        if attack[2] != 255:
            raise KitError(f"{tag} CreateNormalAttack element drift: {attack[2]!r}")
        low, high = values[tag]
        attack[CNA_MULTIPLIER_SLOT] = span(low, high)
        out["multipliers"][tag] = [num(low), num(high)]
    return out


def pick_command(tree, name: str, predicate) -> Any:
    for cmd in wf_dsl.iter_dsl_commands(tree, name):
        if predicate(cmd):
            return cmd
    raise KitError(f"donor tree has no matching {name}")


def find_statement(tree, predicate):
    """深度优先找整条 ``["Command", [...]]`` 语句（要整块 deepcopy 时用，不是只拿参数数组）。

    铃鹿的两块 ``FindAllSubjects(82)`` 埋在 ``ConditionalsChangeSkillFlag`` 分支里，
    不在根语句表上，所以这里必须递归，不能只扫 ``statements(tree)``。
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

    选择器 82 = 主小队（不含协力球），``CreateCondition`` 下标 10（付与对象种类）= 3 Member
    （记忆卡 wf-createcondition-target-kind）；``CreateCondition`` 第 1 参必须等于所在
    ``FindAllSubjects`` 的绑定 id（记忆卡 wf-dsl-subject-lookup-map）。
    """
    donor = ctx.template_dsl(SUZUKA_PROGRAM)

    def has_slow_fixed_speed(cmd) -> bool:
        if cmd[0] != "FindAllSubjects" or cmd[2] != SELECTOR_MAIN_PARTY:
            return False
        for inner in block_commands(cmd, 9):
            if inner and inner[0] == "CreateCondition" and inner[2][0][0] == "ACFixedSpeed":
                return inner[2][0][2] == [{"min": 1, "max": 1}]
        return False

    statement = copy.deepcopy(find_statement(donor, has_slow_fixed_speed))
    cmd = statement[1]
    cmd[1] = BIND_TEAM
    kept = []
    for child in cmd[9][1]:
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
        if name == "ACFixedSpeed":
            charge = float(values["fixed_speed_charge"])
            if not OFFICIAL_FIXED_SPEED_CHARGES[0] <= charge <= OFFICIAL_FIXED_SPEED_CHARGES[-1]:
                raise KitError(f"ACFixedSpeed 充能参数 {charge} 越出官方实读区间 "
                               f"{OFFICIAL_FIXED_SPEED_CHARGES[0]}~{OFFICIAL_FIXED_SPEED_CHARGES[-1]}")
            inner[2][0][2] = span(values["fixed_speed_speed"])
            inner[2][0][3] = span(charge)
            inner[2][0][4] = span(values["fixed_speed_stacks"])
        elif name != "ACPiercing":
            raise KitError(f"unexpected condition {name} in the suzuka block")
        kept.append(child)
    names = [command(child)[2][0][0] for child in kept]
    if names != ["ACPiercing", "ACFixedSpeed"]:
        raise KitError(f"team block conditions drift: {names}")
    cmd[9][1] = kept
    return statement, names


def make_wind_block(ctx, values: dict[str, Any]):
    """画狂老人Z ``mob_jiguza_playable_2`` 的「风属性角色 → 直接攻击伤害↑」整块。

    ``FindAllSubjects(113, [4])`` ＋ 付与对象种类 1 是官方成对写法（113 配 1，不是 3）；
    DSL 元素码 4 = 内部 3 = 风（记忆卡 wf-dsl-element-code-offset）。
    """
    donor = ctx.template_dsl(JIGUZA_PROGRAM)

    def is_direct_damage(cmd) -> bool:
        if cmd[0] != "FindAllSubjects" or cmd[2] != SELECTOR_ELEMENT or cmd[3] != [DSL_WIND]:
            return False
        inner = block_commands(cmd, 9)
        return len(inner) == 1 and inner[0] and inner[0][0] == "CreateCondition" \
            and inner[0][2][0][0] == "ACDirectDamage"

    statement = copy.deepcopy(find_statement(donor, is_direct_damage))
    cmd = statement[1]
    cmd[1] = BIND_WIND
    inner = command(cmd[9][1][0])
    if inner[10] != 1:
        raise KitError(f"jiguza ACDirectDamage: 付与对象种类 {inner[10]} != 1")
    inner[1] = BIND_WIND
    frames = int(values["direct_damage_frames"])
    low, high = values["direct_damage"]
    inner[2][0][1] = span(frames)
    inner[2][0][2] = span(low, high)
    return statement, {"frames": frames, "value": [num(low), num(high)]}


def effect_paths(tree) -> set[str]:
    return {str(cmd[2][1]) for cmd in wf_dsl.iter_dsl_commands(tree, "ShowEffect")
            if isinstance(cmd[2], list) and cmd[2][0] == "SpecifyEffectDirectly"}


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


def build_skill_tree(ctx, level: str, values: dict[str, Any],
                     family: dict[str, Any] | None) -> tuple[Any, dict[str, Any]]:
    """母本 141159 整树 → 删 PF 块 → 两段改直击池并改倍率 → 嫁接两块状态。"""
    donor_program = ctx.program_path(level).replace(CODE, TEMPLATE_CODE)
    tree = copy.deepcopy(ctx.template_dsl(donor_program))
    if tree[0] != "ActionDsl" or tree[1] != 2 or tree[10] != 0:
        raise KitError(f"skill {level} donor head drift: {tree[:2]} bta={tree[10]}")

    removed = drop_power_flip_block(tree)
    attacks = retune_attacks(tree, values)

    body = statements(tree)
    before = len(body)
    team, team_names = make_team_block(ctx, values)
    wind, wind_info = make_wind_block(ctx, values)
    body.append(team)
    body.append(wind)
    if len(body) != before + 2:
        raise KitError(f"skill {level}: appended {len(body) - before} blocks, expected 2")
    if tree[10] != 0:
        raise KitError("root buffTargetAs must stay 0 (自动档)")

    if family is not None:
        tree, rewrite = ctx.rewrite_effect_refs(tree, family, strict=True)
        expected = {f"{family['dst_dir']}/{name}" for name in FX_BASES}
    else:
        rewrite = None
        expected = set(OFFICIAL_FX_PATHS)
    paths = effect_paths(tree)
    if paths != expected:
        raise KitError(f"skill {level} effect paths drift: {sorted(paths)}")

    problems = dsl_problems(tree)
    if problems:
        raise KitError(f"skill {level} DSL gates failed: {problems}")
    return tree, {"level": level, "removed_power_flip": removed, "attacks": attacks,
                  "team_conditions": team_names, "wind_direct_damage": wind_info,
                  "effect_paths": sorted(paths), "effect_rewrites": rewrite,
                  "buff_target_as": tree[10]}


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
        raise KitError("设计稿登记了固有状态，但本套件是零固有状态方案（设计 deviations D1）")
    if MS.UNIQUE_CONDITION_LOGICAL in spec.extra_keys:
        raise KitError("SPEC 声明了固有状态键，但本套件不建固有状态")
    if design["plan"]["pf_override"] or design["plan"]["dash_parameter"]:
        raise KitError("设计稿登记了 722/422，但本套件两者都不做")

    # ---- 1) 队长技 5 行（design.json 驱动）
    leader_rows, leader_evidence = build_leader_rows(ctx, design)
    leader_pullers = check_during_pullers(leader_rows, LEADER_DURING_TRIGGER,
                                          LEADER_DURING_PULLER, "leader")
    capabilities: set[str] = set()
    for ev in leader_evidence:
        capabilities.update(ev["capabilities"])
    ctx.write_flat(KL.LEADER, {str(CID): leader_rows})

    # ---- 2) 词条 6 键 12 条（design.json 驱动）
    ability_rows, ability_evidence = build_ability_rows(ctx, design)
    ability_pullers = []
    for key, rows in ability_rows.items():
        ability_pullers += check_during_pullers(rows, ABILITY_DURING_TRIGGER,
                                                ABILITY_DURING_PULLER, key)
    statue_precedent = check_statue_group_precedent(ctx, ability_rows)
    for ev in ability_evidence:
        capabilities.update(ev["capabilities"])
    if capabilities:
        raise KitError(f"本套件应当零客户端补丁，却要求能力 {sorted(capabilities)}")
    ctx.write_flat(KL.ABILITY, ability_rows)
    for key, rows in ability_rows.items():
        for n, row in enumerate(rows):
            if any("change_skill_" in cell for cell in row):
                raise KitError(f"ability {key}#{n} still carries a change_skill_ string id")

    # ---- 3) 母本 536 的孤儿字符串键（只登记，不撤销；见 audit_orphan_change_skill 的说明）
    orphan = audit_orphan_change_skill(ctx)

    # ---- 4) action_skill 两档能量
    action_rows = write_action_skill(ctx, design)

    # ---- 5) 技能特效：默认直接引用官方 wt23 路径（零图集增量）；有 LUT 才克隆换色
    lut_path = KL.pixel_dir(ctx) / "fx_lut.json"
    lut = KL.png_transform_from_lut(lut_path)
    family = None
    if lut is not None:
        family = ctx.clone_effect_family(FX_SRC_DIR, FX_SUBDIR, png_transform=lut)
        if family["dst_dir"] != FX_DST_DIR or sorted(family["copied_bases"]) != sorted(FX_BASES):
            raise KitError(f"effect family drift: {family['dst_dir']} {family['copied_bases']}")

    # ---- 6) 技能 DSL 两档
    values = design["plan"]["skills"]["values"]
    programs, skill_gates = [], {}
    for level in ("1", "2"):
        level_values = dict(values[level])
        level_values["hit_area_damage_kind"] = values["hit_area_damage_kind"]
        tree, gates = build_skill_tree(ctx, level, level_values, family)
        programs.append(write_dsl_checked(ctx, ctx.program_path(level), tree))
        skill_gates[level] = gates

    # ---- 7) 语音路由（kind 1 ConditionExist ← 贯通 31）+ character 行
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

    # ---- 8) 像素成品（缺文件静默跳过）+ 三层镜像
    pixel = KL.install_staged_assets(ctx)
    mirrors = ctx.sync_character_mirrors()
    if mirrors["character"][9:17] != route:
        raise KitError("character mirror lost the voice route")

    # 面板：无 desc_override、无 custom_ability_string ⇒ 17 行全部由客户端自渲染。
    panel = [ev["panel"] for ev in leader_evidence] + [ev["panel"] for ev in ability_evidence]

    ctx.evidence_write("kit-gates.json", {
        "leader": {"rows": leader_rows, "evidence": leader_evidence, "pullers": leader_pullers},
        "ability": {"rows": ability_rows, "evidence": ability_evidence,
                    "pullers": ability_pullers, "statue_group_precedent": statue_precedent},
        "skills": skill_gates, "action_skill": action_rows,
        "effect_family": family, "fx_lut": {"path": str(lut_path), "applied": bool(lut)},
        "orphan_custom_ability_string": orphan,
        "voice_route": route, "voice_ready": voice_ready,
        "pixel": pixel, "mirrors": mirrors,
    })

    energy = design["plan"]["skills"]["energy"]
    notes = [
        "技能『月下独奏』：母本 141159 整树（FindNearSubjects → CreateReferencePoint → 停球 70 帧 → "
        "Wait 9 斩击 / Wait 49 爆击 10 连，判定区 Circle r225、元素 255、flat 200/3、削韧 10/1、"
        "Fever 5/0.5、incCombo 全部不动）；删掉母本 root[1] 的 PF 块（本角色一条 PF kind 都不写）；"
        "两处判定区 params[23] 0→4 ⇒ 两段改走**直接攻击伤害池**；"
        f"倍率 斩击 {skill_gates['1']['attacks']['multipliers']['slash']}/"
        f"{skill_gates['2']['attacks']['multipliers']['slash']}、"
        f"爆击 {skill_gates['1']['attacks']['multipliers']['burst']}/"
        f"{skill_gates['2']['attacks']['multipliers']['burst']}（×10 连）；"
        f"能量 {energy['donor']} → {energy['inner1']['c4']}/{energy['inner1']['c5']}、"
        f"{energy['inner2']['c4']}/{energy['inner2']['c5']}",
        "嫁接两块官方状态：root[1] 取铃鹿 silence_suzuka_2 的 FindAllSubjects(82 主小队) 整块，"
        "丢掉 ACFlying（浮游是 149950 的轴），留 ACPiercing ＋ ACFixedSpeed，绑定 8，"
        f"时长 {values['1']['piercing_frames']}/{values['2']['piercing_frames']} 帧、"
        f"速度 {values['2']['fixed_speed_speed']} 充能 {values['2']['fixed_speed_charge']}"
        "（官方最轻档，0 零先例 ⇒ 设计 D6 已改）；"
        "root[2] 取画狂老人Z mob_jiguza_playable_2 的 FindAllSubjects(113,[4]) 整块 → ACDirectDamage，"
        f"绑定 9，{values['1']['direct_damage_frames']} 帧、"
        f"{values['1']['direct_damage']}/{values['2']['direct_damage']}。"
        "付与对象种类照抄官方（82→3 Member、113→1），CreateCondition 第 1 参 == 所在 FindAllSubjects 绑定 id",
        "队长 5 行 + 词条 12 条全部「官方 donor 整行 + 逐格改」，每行过 client_legality 三件套并与"
        "设计稿登记的 wf_describe 回读逐字比对；required_client_capabilities 全空 ⇒ 零客户端补丁。"
        "during 触发 puller 逐行断言：D214/D30 留空、D204 写 9＋元素组（parseAt98 C7050）",
        f"c2 雕像组逐 kind 官方先例复核（裁决 §8）：{len(statue_precedent)} 组全部 ≥1 行先例；"
        "1499863 / 1499865 因 attack_common × during 46、attack_common × instant 690 各 0 行先例"
        "改成 condition（设计 deviations D10，纯面板外观）",
        "技能特效直接引用官方 battle/effect/skill_unique/black_wolf_knight_wt23/{_slash,_smash,_explosion}"
        "（风→风零染色、零图集增量）" + ("；已套用 B/pixel/rolf/fx_lut.json 克隆换色" if lut else
                                        "；B/pixel/rolf/fx_lut.json 不存在 ⇒ 不克隆不换色（设计默认）"),
        f"母本 536「切换技能形态」整条删除（词条表 c70 逐行断言无 change_skill_ 字样）；"
        f"tables 建出来的字符串键 {ORPHAN_CAS_KEY} "
        + ("留在包内但无人引用（框架认领的表，撤销会撞 manifest 的 root_tables_not_claimed）"
           if orphan["present"] else "本轮不在包内"),
        {"pixel_install": pixel},
    ]

    # 偏离登记的唯一真源是设计稿；这里只做搬运与「三段都得写」的硬校验。
    deviations: list[dict[str, Any]] = []
    for entry in design.get("deviations", ()):
        want = entry.get("from") or entry.get("planned") or entry.get("want") or entry.get("原设想")
        got = entry.get("to") or entry.get("actual") or entry.get("got") or entry.get("实际落法")
        why = entry.get("why") or entry.get("原因")
        if not (want and got and why):
            raise KitError(f"design deviation is missing 原设想/实际落法/原因: {entry}")
        deviations.append({"id": entry.get("id"), "want": want, "got": got, "why": why})

    gate = {"rows": len(leader_evidence) + len(ability_evidence), "programs": len(programs),
            "capabilities": sorted(capabilities), "fx_lut_applied": bool(lut),
            "pixel_present": pixel["present"],
            "pixel_missing": [e["logical"] for e in pixel["skipped"]]}
    ready = pixel["present"] and not pixel["skipped"]
    gate["reason"] = "kit 自有产物全部过闸" if ready else (
        f"像素成品未就绪：{gate['pixel_missing'] or 'B/pixel/rolf/install.json 不存在'}")

    return KL.report(
        ctx,
        summary="罗尔夫：风属性直击输出核心（技能自供「最大速度固定＋贯通」两个门，"
                "队长与 8 条持续词条全挂在这两个门上）",
        status=KL.READY if ready else KL.DRAFT, panel=panel, notes=notes, programs=programs,
        required_capabilities=sorted(capabilities), deviations=deviations,
        extra={"kit_gate": gate, "voice_route": route, "statue_groups":
               {key: rows[0][2] for key, rows in ability_rows.items()},
               "effect_families": [FX_DST_DIR] if family else [],
               "effect_references": sorted(OFFICIAL_FX_PATHS) if family is None else [],
               "calibration": design.get("calibration", {})})
