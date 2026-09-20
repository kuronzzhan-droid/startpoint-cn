# -*- coding: utf-8 -*-
"""中秋批次 kit：芙拉菲·中秋 149987 ``combat_animal_moon``（风属性技能伤害主 C）。

定位「连击 × 冲刺」近身突进连打型技伤主 C：冲刺攒攻击层数与连击 → 连击过 50 / 150 两道门槛
→ 自身技伤翻倍并开出独立乘区 → 技能终结一击在「主位＋风共鸣」时随连击数放大。设计与数值以
``work/character_packs/midautumn-20260920/design/fluffy.{md,json}`` 为准 —— 行装配部分是
「设计 JSON 驱动」的薄壳：队长 7 行、词条 6 键 15 条的 donor / 逐格改 / 预期 ``wf_describe``
全部从 ``design/fluffy.json`` 的 ``plan`` 块读出后交给 :func:`wf_midautumn_kitlib.build_row`
装配，两边漂移（donor 缺失、legality 不过、``wf_describe`` 对不上、``row_final`` 不一致）当场
报错，不在本文件里手抄 22 行的具体数值。

本模块自己负责设计 JSON 管不到的部分：

* ``custom_ability_string`` 两条强化开关串（536 的 ``change_skill_*``、704 的 ``change_skill_2_*``）；
* ``action_skill`` 两档能量（580/580 与 580/530）；
* 技能 DSL 两档：官方母本 141033 ``combat_animal_{1,2}`` 整树当底座，把官方
  141081 ``combat_animal_xm21_{1,2}`` 的「四连重击 ＋ 裂地演出」嫁接到底座的**敌侧参考点**
  （id 4）上，主体 id 1..12 整体重映射到 11..22，终结一击外包一层
  ``ConditionalsChangeSkillFlag(1)`` 开连击加成（``p8``）；
* 两族技能特效整族克隆（``skill_unique/combat_animal_moon/{rush,jab}/``）＋
  ``B/pixel/fluffy/fx_lut.json`` 染色（文件不在就按母本原色克隆）；
* 语音路由 kind 3（ChangeSkillFlag ← A1#1 的 536）与 ``switched_action_skill``；
* ``B/pixel/fluffy/install.json`` 里的像素小人成品（缺文件静默跳过）。

不做：422 冲刺参数、724、新固有状态、觉醒替换行、722（她不是 PF 角色）——整套 22 行的
``required_client_capabilities`` 全为空，不依赖任何 APK 补丁。

不碰：live store / ``assets/`` / ``.cdn`` / 设备 / 存档；不发布、不提交。
由 ``python mod-tools/wf_midautumn_build.py --char fluffy --step kit`` 调用 :func:`build`。
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import wf_client_legality as L  # noqa: E402
import wf_dsl  # noqa: E402
import wf_dsl_sig as SIG  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402

KitError = KL.KitError

KEY = "fluffy"
CID, CODE = 149987, "combat_animal_moon"
ELEMENT = 3                                    # 风（0 基内部编号，Green）
TEMPLATE_ID, TEMPLATE_CODE = 141033, "combat_animal"
GRAFT_CODE = "combat_animal_xm21"              # 141081（她的圣诞版）：四连重击 + 裂地演出的血统

ABILITY_KEYS = tuple(f"{CID}{slot}" for slot in range(1, 7))
LEADER_ROW_COUNT = 7
ABILITY_RECORD_TOTAL = 15

# custom_ability_string：两条「强化技能效果」串（裁决 §3：技能强化条目不写数字与时间）
CAS_FLAG1 = f"change_skill_{CODE}"             # A1#1 的 536（alv）
CAS_FLAG2 = f"change_skill_2_{CODE}"           # A3#3 的 704（alv2）
SKILL_FLAG_KINDS = ("536", "704")
VOICE_KEY = f"{CODE}_voice_ready"
VOICE_ROUTE = {"kind": 3}                      # ChangeSkillFlag ← A1#1 的 536

TEXTS: dict[str, str] = {}       # 10 个文本键在 design/fluffy.json 的 texts 块里（build 里核验）
SPEC = {
    "required_capabilities": (),               # 22 行全部 required_client_capabilities=[]
    "extra_keys": {
        KL.CAS: (CAS_FLAG1, CAS_FLAG2),
        KL.SWITCHED: (VOICE_KEY,),
    },
}

# ---------------------------------------------------------------- 特效族

# (dst_subdir, 官方源目录, 取的基名, B/pixel/fluffy/ 下的 LUT 文件名)
FX_RUSH = ("rush", f"battle/effect/skill_unique/{TEMPLATE_CODE}",
           (f"{TEMPLATE_CODE}_rush", f"{TEMPLATE_CODE}_final"), "fx_lut.json")
FX_JAB = ("jab", f"battle/effect/skill_unique/{GRAFT_CODE}",
          (f"{GRAFT_CODE}_jab", f"{GRAFT_CODE}_blow", f"{GRAFT_CODE}_crack"), "fx_lut_jab.json")

# **jab 族默认不克隆**（设计稿 §5 自带的退路，偏离 D7'）：
#   * rush 族**必须**克隆——族内含芙拉菲的小人剪影帧，要和像素管线用同一张 LUT，
#     否则战斗里会出现没染色的原版剪影（设计稿 §5 ⚠ / §9 风险 8）；
#   * jab 族没有小人帧，只有彩色剪影。整族克隆给战斗图集加 0.1823 Mpx（≈1.09%），
#     实测把 `five-boss-r1` 从 baseline `fits=true` 压成 `false`（溢出点落在既有的
#     `super_robot_tailcoat/laser_ll`），越过裁决 §6 的「单角色 ≤3.5% **且 fits**」通过线；
#     同批玛格诺斯只占 0.44%，14 人叠加风险更大（记忆卡 wf-battle-atlas-budget）。
#   * 代价只有配色：jab/振りかぶり/裂地三段保持母本风绿。像素代理已备好
#     `fx_lut_jab.json`，作者/主控若决定吃下这 1.09%，把下面一行改成 True 即可（只此一处）。
CLONE_JAB_FAMILY = False

FX_FAMILIES = (FX_RUSH,) + ((FX_JAB,) if CLONE_JAB_FAMILY else ())
# 只引用、不改色的官方件：直接引用官方路径，不克隆不占图集（裁决 §4 / 框架 §10.3）
FX_DIRECT_REFERENCE = (
    "battle/effect/skill_general/decoration/rush_aura",
    "battle/effect/skill_general/decoration/dummy_ball",
) + (() if CLONE_JAB_FAMILY else tuple(f"{FX_JAB[1]}/{base}" for base in FX_JAB[2]))

# ---------------------------------------------------------------- DSL 常量

PROGRAM_DIR = "battle/action/skill/action/rare5"

# 底座（141033）的编辑：连段变长 ⇒ 停球/隐身/替身球/参考点寿命一起拉长
STOP_BALL_FRAMES = 80          # donor 30
HIDE_CHARACTER_FRAMES = 80     # donor 24
DUMMY_EFFECT_FRAMES = 80       # donor 24
RP_LIFETIME = 100              # donor 60；必须 ≥ 最后一个 Wait 帧 60 + 判定区寿命 15

# 参考点块的新时间轴（帧号相对参考点创建的那一刻；兄弟 Wait 各自从块首计帧）
FRAME_JAB = 20
FRAMES_PESTLE = (24, 30, 36, 42)
FRAME_BLOW = 42
FRAME_FINAL = 57
FRAME_FINISHER = 60

FINISHER_RADIUS = 150          # donor Circle{100}
FINISHER_LIFETIME = 15         # donor 10
ID_SHIFT = 10                  # xm21 子树主体 id 1..12 → 11..22

BASE_RUSH_AREA_ID = 5          # 底座精准连击判定区 p19
BASE_FINISH_AREA_ID = 8        # 底座终结判定区 p19（裂地演出挂在它身上）
BASE_RP_ID = 4                 # 底座敌侧参考点 id
GRAFT_PESTLE_AREA_IDS = (1, 4, 7, 10)
GRAFT_FINISH_AREA_ID = 13

EFFECT_JAB = "ジャブ演出"
EFFECT_BLOW = "振りかぶり"
EFFECT_FINISH = "フィニッシュ演出"
EFFECT_DUMMY = "ダミー演出"
EFFECT_CRACK_LABEL = "裂地演出"

# 倍率（design/fluffy.json plan.skills.multipliers）。inner1 单标量，inner2 min~max。
# alv = 536（主位＋风共鸣）供值，alv2 = 704（风共鸣）供值；没供值时 ALv 项返回 0。
SKILL_MULT: dict[str, dict[str, dict[str, float]]] = {
    "1": {
        "rush": {"min": 0.8, "max": 0.8, "alv2_min": 0.4, "alv2_max": 0.4},
        "pestle": {"min": 2.67, "max": 2.67, "alv_min": 0.67, "alv_max": 0.67},
        "finisher": {"min": 33.3, "max": 33.3},
    },
    "2": {
        "rush": {"min": 1.044, "max": 1.2, "alv2_min": 0.52, "alv2_max": 0.6},
        "pestle": {"min": 3.48, "max": 4.0, "alv_min": 0.87, "alv_max": 1.0},
        "finisher": {"min": 43.5, "max": 50},
    },
}
# donor 现值（防母本漂移；只比 min/max，容差 1e-6）
DONOR_MULT = {
    "1": {"rush": (0.33, 0.33), "pestle": (1.675, 1.675), "finisher": (16.7, 16.7)},
    "2": {"rush": (0.429, 0.5), "pestle": (2.1775, 2.5), "finisher": (21.71, 25.0)},
}
# 段数（用于回执里的倍率合计核对）
HITS = {"rush": 10, "pestle": 4, "finisher": 1}
# 落盘前的 AMF3 最小字节数：官方 donor 未压缩就已 3–4 KB，嫁接后只会更大。
# 喂 ``{tree, numbers}`` 包装壳时往返自检抓不到，但尺寸会塌下来（记忆卡 wf-dsl-encode-wrapper-trap）。
MIN_ENCODED_BYTES = 2000


# ---------------------------------------------------------------- 设计稿读取

def load_design(root: Path) -> dict[str, Any]:
    design = MS.load_design(Path(root), KEY)
    if not design:
        raise KitError(f"design/{KEY}.json missing (batch {MS.BATCH_DIR})")
    if design.get("schema") != "ma-design/1" or design.get("key") != KEY:
        raise KitError(f"design identity drift: {design.get('schema')} {design.get('key')}")
    spec_block = design.get("spec") or {}
    if int(spec_block.get("cid", CID)) != CID or spec_block.get("code", CODE) != CODE:
        raise KitError(f"design identity drift: {spec_block.get('cid')} {spec_block.get('code')}")
    return design


def _parse_donor(donor_ref: str) -> tuple[str, str, str]:
    """设计稿 donor 地址 ``"<o|s>:<leader|ability>:<键>:<记录号(1基)>"``。

    返回 ``(source, kind, "键#记录号(0基)")``。记录号是 **1 基**（``design/fluffy.md`` 的
    ``#1``/``#3`` 写法，与同批 mia/hibiki 约定一致）；实读核实：官方 ``leader_ability[141165]``
    只有 3 条记录而设计写 ``:3``，``ability[1410334]`` 只有 1 条而设计写 ``:1`` ⇒ 只能是 1 基。
    """
    parts = str(donor_ref).split(":")
    if len(parts) != 4:
        raise KitError(f"unexpected donor address shape: {donor_ref!r}")
    src, table, key, index = parts
    source = {"o": "official", "s": "live"}.get(src)
    kind = {"leader": "leader_ability", "ability": "ability"}.get(table)
    if source is None or kind is None:
        raise KitError(f"unrecognised donor address: {donor_ref!r}")
    index0 = int(index) - 1
    if index0 < 0:
        raise KitError(f"donor record number must be >= 1 (1-based): {donor_ref!r}")
    return source, kind, f"{key}#{index0}"


def _check_row_final(entry: dict[str, Any], row: list[str], label: str) -> None:
    """设计稿登记的 126/124 列 ``row_final`` 与实装行逐格核对（行漂移的最后一道闸）。"""
    expected = entry.get("row_final")
    if expected is None:
        return
    expected = [("" if cell is None else str(cell)) for cell in expected]
    if list(row) != expected:
        diff = [(i, expected[i] if i < len(expected) else None, row[i] if i < len(row) else None)
                for i in range(max(len(row), len(expected)))
                if (expected[i] if i < len(expected) else None) != (row[i] if i < len(row) else None)]
        raise KitError(f"{label}: row_final drift at columns {diff[:8]}"
                       + (f" (+{len(diff) - 8} more)" if len(diff) > 8 else ""))


# ---------------------------------------------------------------- 行装配

def build_leader_rows(ctx, design: dict[str, Any]) -> tuple[list[list[str]], list[dict[str, Any]]]:
    plan = design["plan"]["leader_ability"]
    if plan["key"] != str(CID) or int(plan["ncols"]) != KL.LEADER_NCOLS:
        raise KitError(f"design leader block drift: key={plan.get('key')} ncols={plan.get('ncols')}")
    rows: list[list[str]] = []
    evidence: list[dict[str, Any]] = []
    for entry in plan["rows"]:
        source, kind, donor = _parse_donor(entry["donor_ref"])
        if kind != "leader_ability":
            raise KitError(f"{entry['id']}: donor table {kind} is not leader_ability")
        label = f"leader#{entry['index']}({entry['id']})"
        row, ev = KL.build_row(ctx, "leader_ability", donor, entry["cells"], source=source,
                               expect_describe=entry["desc_expected"], label=label)
        if row[0] != CODE:
            raise KitError(f"{label}: c0 {row[0]!r} != {CODE}")
        _check_row_final(entry, row, label)
        ev["panel"] = entry["panel_expected"]
        rows.append(row)
        evidence.append(ev)
    if len(rows) != LEADER_ROW_COUNT:
        raise KitError(f"design leader_ability carries {len(rows)} rows, expected {LEADER_ROW_COUNT}")
    _ban_forbidden_leader_kinds(rows)
    return rows, evidence


def _ban_forbidden_leader_kinds(rows: Sequence[Sequence[str]]) -> None:
    """队长表禁 422/724/713（裁决 §2/§8：写进队长表 = C7050）。瞬发 kind c45，持续 kind c107。"""
    for n, row in enumerate(rows):
        instant = row[45] if len(row) > 45 else ""
        during = row[107] if len(row) > 107 else ""
        if instant in ("422", "724", "713") or during in ("422", "724", "713"):
            raise KitError(f"leader#{n}: forbidden kind in leader_ability "
                           f"(c45={instant!r} c107={during!r})")


def build_ability_rows(ctx, design: dict[str, Any]
                       ) -> tuple[dict[str, list[list[str]]], list[dict[str, Any]]]:
    plan = design["plan"]["ability"]
    if int(plan["ncols"]) != KL.ABILITY_NCOLS:
        raise KitError(f"design ability ncols drift: {plan.get('ncols')}")
    if tuple(sorted(plan["keys"])) != tuple(sorted(ABILITY_KEYS)):
        raise KitError(f"design ability keys drift: {sorted(plan['keys'])}")
    rows_by_key: dict[str, list[list[str]]] = {}
    evidence: list[dict[str, Any]] = []
    for slot, key_name in enumerate(ABILITY_KEYS, start=1):
        block = plan["keys"][key_name]
        if int(str(block["slot"]).removeprefix("slot")) != slot:
            raise KitError(f"ability {key_name}: slot {block['slot']} != {slot}")
        rows: list[list[str]] = []
        for entry in block["records"]:
            source, kind, donor = _parse_donor(entry["donor_ref"])
            if kind != "ability":
                raise KitError(f"{entry['id']}: donor table {kind} is not ability")
            label = f"{key_name}#{entry['index']}({entry['id']})"
            row, ev = KL.build_row(ctx, "ability", donor, entry["cells"], source=source,
                                   element=ELEMENT, expect_describe=entry["desc_expected"],
                                   label=label)
            _check_row_final(entry, row, label)
            ev["panel"] = entry["panel_expected"]
            ev["skill_flag"] = row[47] in SKILL_FLAG_KINDS
            rows.append(row)
            evidence.append(ev)
        KL.check_ability_key(rows, key_name, CODE, slot)
        if rows[0][1] != block["unisonable_c1"] or rows[0][2] != block["statue_group_c2"]:
            raise KitError(f"ability {key_name}: c1/c2 {rows[0][1]}/{rows[0][2]} != design "
                           f"{block['unisonable_c1']}/{block['statue_group_c2']}")
        rows_by_key[key_name] = rows
    total = sum(len(v) for v in rows_by_key.values())
    if total != ABILITY_RECORD_TOTAL:
        raise KitError(f"ability records {total} != {ABILITY_RECORD_TOTAL}")
    return rows_by_key, evidence


def check_skill_flag_strings(rows: Iterable[Sequence[str]], keys: set[str]) -> list[str]:
    """536 / 704 行的 c70 字符串键必须已登记在 ``custom_ability_string``。

    漏登记 = 详情页渲染描述时 ``MasterStringMap.get`` 抛 C8601「资源损坏」假象
    （与 629 的 :func:`wf_client_legality.invoke_skill_string_problems` 同一条通路，
    只是那个函数只管 kind 629）。
    """
    hits: list[str] = []
    for row in rows:
        if len(row) > 70 and row[47] in SKILL_FLAG_KINDS:
            sid = row[70].strip()
            if not sid:
                raise KitError(f"kind {row[47]} row has an empty c70 string_id (C8601)")
            if sid not in keys:
                raise KitError(f"kind {row[47]} c70 string_id {sid!r} not in custom_ability_string "
                               f"{sorted(keys)} (C8601)")
            hits.append(sid)
    return hits


# ---------------------------------------------------------------- 共享表文本

def write_strings(ctx, design: dict[str, Any]) -> tuple[dict[str, str], set[str]]:
    """``custom_ability_string``：两条强化开关串。"""
    rows = design["plan"]["texts"]["custom_ability_string"]["rows"]
    cas_plan = {entry["key"]: entry["text"] for entry in rows}
    if set(cas_plan) != {CAS_FLAG1, CAS_FLAG2}:
        raise KitError(f"design custom_ability_string keys drift: {sorted(cas_plan)}")
    declared = set(ctx.spec.extra_keys.get(KL.CAS, ()))
    missing = [k for k in cas_plan if k not in declared]
    if missing:
        raise KitError(f"custom_ability_string keys not declared in SPEC['extra_keys']: {missing}")
    caps: set[str] = set()
    for key, text in cas_plan.items():
        # 「技能强化」条目不写数字与时间（裁决 §3）
        KL.check_panel(text, skill_flag=True, label=key)
        cap = L.panel_override_capability(key)
        if cap:
            caps.add(cap)
    ctx.write_flat(KL.CAS, {k: [[v]] for k, v in cas_plan.items()})
    return cas_plan, caps


def write_action_skill(ctx, design: dict[str, Any]) -> dict[str, list[str]]:
    """``action_skill`` 两档：名称/描述由 tables 写 TEXTS，这里只改能量并核对程序路径。"""
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
        entry = energy[level]
        cells[4], cells[5] = str(entry["c4"]), str(entry["c5"])
        out[level] = cells
    ctx.write_nested(KL.ACTION, CODE, {lv: [cells] for lv, cells in out.items()}, replace_inner=True)
    return out


# ---------------------------------------------------------------- DSL 工具

def command(payload: list) -> list:
    return ["Command", list(payload)]


def wait_event(frame: int, payloads: Sequence[list]) -> list:
    """``["Event", ["Wait", N, "*", ["Block", [...]]]]``。

    禁写 ``Command Wait``：未知构造名会被静默落成索引 0，整块被吞且不报错
    （记忆卡 wf-dsl-command-wait-trace-trap）。
    """
    return ["Event", ["Wait", int(frame), "*", ["Block", [command(p) for p in payloads]]]]


def block(payloads: Sequence[list]) -> list:
    return ["Block", [command(p) for p in payloads]]


def _only(items: list, what: str) -> list:
    if len(items) != 1:
        raise KitError(f"expected exactly 1 {what}, got {len(items)}")
    return items[0]


def _slv(value: Sequence[dict]) -> tuple[float, float]:
    entry = _only(list(value), "SLv value")
    return float(entry["min"]), float(entry["max"])


def _assert_mult(cmd: list, expect: tuple[float, float], label: str) -> None:
    got = _slv(cmd[6])
    if abs(got[0] - expect[0]) > 1e-6 or abs(got[1] - expect[1]) > 1e-6:
        raise KitError(f"{label}: donor CNA multiplier drift {got} != {expect}")


def signature_problems(tree) -> list[str]:
    """官方参数形状签名差分（``wf_dsl_sig`` 逐参类型）—— 防 F1034。

    裸数值塞进 ``Array`` 参（例如 Sector 角度）会在详情页/进战斗 F1034，而 AMF3 往返自检
    抓不到（记忆卡 wf-dsl-param-shape-f1034）。同时兜住「构造名写错被静默吞掉」
    （未知命令名/事件名直接报错）。
    """
    problems: list[str] = []

    def is_block(value) -> bool:
        return isinstance(value, list) and len(value) == 2 and value[0] == "Block" \
            and isinstance(value[1], list)

    def check(name: str, sig: Sequence[str], params: list, where: str) -> None:
        if len(params) != len(sig):
            problems.append(f"{where}{name}: {len(params)} params, signature wants {len(sig)}")
            return
        for i, (want, value) in enumerate(zip(sig, params), start=1):
            if want == "int":
                ok = isinstance(value, int) and not isinstance(value, bool)
            elif want == "Number":
                ok = isinstance(value, (int, float)) and not isinstance(value, bool)
            elif want == "Boolean":
                ok = isinstance(value, bool)
            elif want == "String":
                ok = isinstance(value, str)
            elif want == "Array":
                ok = isinstance(value, list) and not is_block(value)
            elif want == "ActionDslExpression":
                ok = is_block(value)
            else:                                   # haxe enum / Option：[标签, …] 或 null
                ok = value is None or (isinstance(value, list) and value
                                       and isinstance(value[0], str))
            if not ok:
                problems.append(f"{where}{name} p{i}: expected {want}, got {type(value).__name__} "
                                f"{str(value)[:60]!r}")

    def walk(node, where: str) -> None:
        if isinstance(node, list):
            if node and node[0] == "Command" and len(node) == 2 and isinstance(node[1], list):
                payload = node[1]
                name = payload[0]
                sig = SIG.COMMANDS.get(name)
                if sig is None:
                    problems.append(f"{where}unknown command {name!r} (silently swallowed at runtime)")
                else:
                    check(name, sig, payload[1:], where)
                for child in payload[1:]:
                    walk(child, f"{where}{name}/")
                return
            if node and node[0] == "Event" and len(node) == 2 and isinstance(node[1], list):
                event = node[1]
                name = event[0]
                sig = SIG.EVENTS.get(name)
                if sig is None:
                    problems.append(f"{where}unknown event {name!r}")
                else:
                    check(name, sig, event[1:], where)
                for child in event[1:]:
                    walk(child, f"{where}{name}/")
                return
            for child in node:
                walk(child, where)
        elif isinstance(node, dict):
            for child in node.values():
                walk(child, where)

    walk(tree, "")
    return problems


def dsl_problems(tree, *, element: int | None = None) -> list[str]:
    problems: list[str] = []
    problems += [f"signature: {p}" for p in signature_problems(tree)]
    problems += [f"direction: {p}" for p in wf_dsl.player_side_dsl_problems(tree)]
    problems += [f"subject: {p}" for p in L.action_dsl_subject_binding_problems(tree)]
    problems += [f"hit_target: {p}" for p in L.action_dsl_hit_area_target_problems(tree)]
    if element is not None:
        problems += [f"element: {p}" for p in L.action_dsl_element_problems(tree, element)]
    return problems


def roundtrip_problems(tree) -> list[str]:
    """AMF3 往返自检：``encode_amf3`` **只吃裸树**（喂 ``{tree, numbers}`` 壳会 F1034）。

    注意 :func:`wf_dsl.parse_dsl` 吃的是**已解压**的 AMF3 字节（设计稿 §4.5 门禁 1 写成
    ``parse_dsl(zlib.compress(...)[2:-4])`` 是笔误，那样喂进去会 ``未支持的 AMF3 标记``；
    已同步修正设计稿）。这里额外跑一次 deflate/inflate，确认落盘编码链也能还原。
    """
    import zlib
    try:
        raw = wf_dsl.encode_amf3(tree)
    except Exception as exc:                                   # noqa: BLE001
        return [f"encode_amf3 failed: {exc}"]
    if wf_dsl.parse_dsl(raw).get("tree") != tree:
        return ["AMF3 roundtrip mismatch"]
    deflated = zlib.compress(raw, 9)[2:-4]
    if wf_dsl.parse_dsl(zlib.decompressobj(-15).decompress(deflated)).get("tree") != tree:
        return ["deflate roundtrip mismatch"]
    return []


def encoded_size(tree) -> int:
    """落盘前的 AMF3 字节数。往返自检对「喂错壳」是瞎的，尺寸同量级是第二道眼。"""
    return len(wf_dsl.encode_amf3(tree))


def effect_refs(tree) -> list[str]:
    """树里所有特效引用路径（``SpecifyEffectDirectly`` 与 ``ResolveByElement``）。"""
    out: list[str] = []
    for cmd in wf_dsl.iter_dsl_commands(tree, "ShowEffect"):
        ref = cmd[2]
        if isinstance(ref, list) and len(ref) >= 2 and isinstance(ref[1], str):
            out.append(ref[1])
    return out


def _write_dsl_checked(ctx, program: str, tree) -> str:
    if not (isinstance(tree, list) and tree and tree[0] == "ActionDsl"):
        raise KitError(f"write_dsl needs a bare ActionDsl tree, got {type(tree).__name__}")
    logical = ctx.write_dsl(program, tree)
    back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
    if back != tree:
        raise KitError(f"DSL readback mismatch: {logical}")
    return logical


# ---------------------------------------------------------------- 技能树嫁接

def graft_tree(base_tree, graft_source, level: str) -> tuple[list, dict[str, Any]]:
    """底座 141033 ``combat_animal_<level>`` ＋ 嫁接 141081 ``combat_animal_xm21_<level>``。

    纯函数（不碰 ctx / 不写盘），参数是两棵官方裸树，返回 ``(新树, 证据)``。特效引用
    在这一步保持官方路径，由调用方的 ``rewrite_effect_refs`` 统一改写。

    嫁接的东西只有「ジャブ演出 ＋ 四段 CHA/CNA ＋ 振りかぶり ＋ 裂地演出」；xm21 自己的
    ``StopBall`` / ``CreateReferencePoint`` / 两条 ``CreateCondition`` 一律不取（底座已有
    ``StopBall`` 与 ``ACAttackPoint``；四连重击改挂底座的**敌侧**参考点 id 4，否则会打在
    球前方而不是敌人身上）。
    """
    if level not in SKILL_MULT:
        raise KitError(f"unknown skill level {level!r}")
    tree = copy.deepcopy(base_tree)
    xm = copy.deepcopy(graft_source)
    mult = SKILL_MULT[level]
    donor_mult = DONOR_MULT[level]

    # ---- 底座头部：movementPriority 3（有 MoveBall）、tree[3]=true、tree[10]=0（自动＝技能伤害）
    if tree[0] != "ActionDsl" or tree[1] != 3 or tree[3] is not True or tree[10] != 0:
        raise KitError(f"base donor head drift: {tree[:4]} bta={tree[10]}")
    if xm[0] != "ActionDsl":
        raise KitError("graft donor is not an ActionDsl tree")

    # ---- 底座：停球 / 隐身 / 替身球 / 参考点寿命
    stop = _only(list(wf_dsl.iter_dsl_commands(tree, "StopBall")), "StopBall in base")
    if stop[2] != 30:
        raise KitError(f"base StopBall frames drift: {stop[2]}")
    stop[2] = STOP_BALL_FRAMES
    hide = _only(list(wf_dsl.iter_dsl_commands(tree, "HideCharacter")), "HideCharacter in base")
    if hide[2] != 24:
        raise KitError(f"base HideCharacter frames drift: {hide[2]}")
    hide[2] = HIDE_CHARACTER_FRAMES
    dummy = _only([s for s in wf_dsl.iter_dsl_commands(tree, "ShowEffect") if s[1] == EFFECT_DUMMY],
                  EFFECT_DUMMY)
    if dummy[5] != ["SpecifyEffectLifetimeDirectly", 24]:
        raise KitError(f"base dummy effect lifetime drift: {dummy[5]}")
    dummy[5] = ["SpecifyEffectLifetimeDirectly", DUMMY_EFFECT_FRAMES]

    rp = _only(list(wf_dsl.iter_dsl_commands(tree, "CreateReferencePoint")),
               "CreateReferencePoint in base")
    if rp[10] != BASE_RP_ID or rp[9] != 60:
        raise KitError(f"base reference point drift: id={rp[10]} lifetime={rp[9]}")
    rp[9] = RP_LIFETIME
    rp_block = rp[11]

    # ---- 底座参考点块里的三件东西
    areas = list(wf_dsl.iter_dsl_commands(rp_block, "CreateHitArea"))
    rush_area = _only([a for a in areas if a[19] == BASE_RUSH_AREA_ID], "base rush CreateHitArea")
    finish_area = _only([a for a in areas if a[19] == BASE_FINISH_AREA_ID],
                        "base finisher CreateHitArea")
    final_show = _only([s for s in wf_dsl.iter_dsl_commands(rp_block, "ShowEffect")
                        if s[1] == EFFECT_FINISH], f"base {EFFECT_FINISH}")

    rush_cna = _only(list(wf_dsl.iter_dsl_commands(rush_area[23], "CreateNormalAttack")),
                     "base rush CreateNormalAttack")
    _assert_mult(rush_cna, donor_mult["rush"], f"skill{level} rush")
    rush_cna[6] = [dict(mult["rush"])]
    if rush_area[13] != ["SpecifyHitAreaLifetimeDirectly", 18] \
            or rush_area[14] != ["CalculatedUsingMaxNumOfHits", HITS["rush"]]:
        raise KitError(f"base rush area drift: {rush_area[13]} {rush_area[14]}")

    finish_cna = _only(list(wf_dsl.iter_dsl_commands(finish_area[23], "CreateNormalAttack")),
                       "base finisher CreateNormalAttack")
    _assert_mult(finish_cna, donor_mult["finisher"], f"skill{level} finisher")
    finish_cna[6] = [dict(mult["finisher"])]
    if finish_cna[8] is not False:
        raise KitError(f"base finisher CNA p8 drift: {finish_cna[8]}")
    shake_finish = _only(list(wf_dsl.iter_dsl_commands(finish_area[23], "ShakeCamera")),
                         "base finisher ShakeCamera")

    # ---- xm21：取四段重击 + 三个演出
    xrp = _only(list(wf_dsl.iter_dsl_commands(xm, "CreateReferencePoint")),
                "CreateReferencePoint in graft donor")
    xblock = xrp[11]
    xareas = list(wf_dsl.iter_dsl_commands(xblock, "CreateHitArea"))
    if tuple(a[19] for a in xareas) != GRAFT_PESTLE_AREA_IDS + (GRAFT_FINISH_AREA_ID,):
        raise KitError(f"graft donor hit-area ids drift: {[a[19] for a in xareas]}")
    pestle_areas = [a for a in xareas if a[19] in GRAFT_PESTLE_AREA_IDS]
    xshow = {s[1]: s for s in wf_dsl.iter_dsl_commands(xblock, "ShowEffect")}
    missing = [n for n in (EFFECT_JAB, EFFECT_BLOW, EFFECT_FINISH) if n not in xshow]
    if missing:
        raise KitError(f"graft donor is missing effects {missing}")
    jab_show, blow_show, crack_show = xshow[EFFECT_JAB], xshow[EFFECT_BLOW], xshow[EFFECT_FINISH]

    # 主体 id 1..12 → 11..22；坐标锚点从 xm21 自己的球前参考点（p2=0）改挂底座敌侧参考点 4
    for area in pestle_areas:
        if area[2] != 0:
            raise KitError(f"graft pestle area anchor drift: p2={area[2]}")
        cna = _only(list(wf_dsl.iter_dsl_commands(area[23], "CreateNormalAttack")),
                    "graft pestle CreateNormalAttack")
        _assert_mult(cna, donor_mult["pestle"], f"skill{level} pestle")
        if cna[1] != area[22]:
            raise KitError(f"graft pestle CNA subject {cna[1]} != hit-area node[22] {area[22]}")
        area[2] = BASE_RP_ID
        area[19] += ID_SHIFT
        area[21] += ID_SHIFT
        area[22] += ID_SHIFT
        cna[1] += ID_SHIFT
        cna[6] = [dict(mult["pestle"])]

    for show, anchor in ((jab_show, BASE_RP_ID), (blow_show, BASE_RP_ID),
                         (crack_show, BASE_FINISH_AREA_ID)):
        show[3] = anchor
    crack_show[1] = EFFECT_CRACK_LABEL          # 与底座的「フィニッシュ演出」区分开

    # ---- 终结判定区：放大到 Circle{150}、寿命 15；裂地演出 + 震屏挂 p20；p23 外包 Conditionals
    if finish_area[9] != ["Circle", [{"min": 100, "max": 100}]] \
            or finish_area[13] != ["SpecifyHitAreaLifetimeDirectly", 10]:
        raise KitError(f"base finisher area drift: {finish_area[9]} {finish_area[13]}")
    finish_area[9] = ["Circle", [{"min": FINISHER_RADIUS, "max": FINISHER_RADIUS}]]
    finish_area[13] = ["SpecifyHitAreaLifetimeDirectly", FINISHER_LIFETIME]
    finish_area[20] = block([crack_show, shake_finish])
    then_cna = copy.deepcopy(finish_cna)
    then_cna[8] = True                           # 536 开关：终结一击吃连击加成
    else_cna = copy.deepcopy(finish_cna)
    else_cna[8] = False
    # Conditionals 的分支必须是完整 Block；空分支写 ["Block", []]，禁写 ["DoNothing"]
    # （那是 IfTargetNotFound 的枚举，进游戏 F1009 —— 记忆卡 wf-dsl-donothing-enum-trap）
    finish_area[23] = block([["ConditionalsChangeSkillFlag", 1,
                              block([then_cna]), block([else_cna])]])

    # ---- 重排参考点块的时间轴（兄弟 Wait 各自从块首计帧，沿用 xm21 的写法）
    rp[11] = ["Block", [
        command(rush_area),
        wait_event(FRAME_JAB, [jab_show]),
        wait_event(FRAMES_PESTLE[0], [pestle_areas[0]]),
        wait_event(FRAMES_PESTLE[1], [pestle_areas[1]]),
        wait_event(FRAMES_PESTLE[2], [pestle_areas[2]]),
        wait_event(FRAMES_PESTLE[3], [pestle_areas[3], blow_show]),
        wait_event(FRAME_FINAL, [final_show]),
        wait_event(FRAME_FINISHER, [finish_area]),
    ]]
    if FRAME_FINISHER + FINISHER_LIFETIME > RP_LIFETIME:
        raise KitError("reference point lifetime is shorter than the last hit area window "
                       "(伤害会静默消失)")

    totals = {seg: round(mult[seg]["max"] * HITS[seg], 4) for seg in HITS}
    alv = round(mult["pestle"].get("alv_max", 0.0) * HITS["pestle"], 4)
    alv2 = round(mult["rush"].get("alv2_max", 0.0) * HITS["rush"], 4)
    evidence = {
        "level": level,
        "multipliers": {seg: dict(mult[seg]) for seg in HITS},
        "segment_totals": totals,
        "total_no_flag": round(sum(totals.values()), 4),
        "total_flag2_only": round(sum(totals.values()) + alv2, 4),
        "total_both_flags": round(sum(totals.values()) + alv + alv2, 4),
        "frames": {"jab": FRAME_JAB, "pestle": list(FRAMES_PESTLE), "blow": FRAME_BLOW,
                   "final": FRAME_FINAL, "finisher": FRAME_FINISHER},
        "stop_ball": STOP_BALL_FRAMES, "reference_point_lifetime": RP_LIFETIME,
        "subject_ids": {"base_rush": BASE_RUSH_AREA_ID, "base_finisher": BASE_FINISH_AREA_ID,
                        "grafted": [a[19] for a in pestle_areas]},
        "combo_bonus_branch": {"then_p8": True, "else_p8": False},
    }
    return tree, evidence


def build_skill_tree(ctx, level: str, families: Sequence[dict[str, Any]]
                     ) -> tuple[list, dict[str, Any]]:
    base = ctx.template_dsl(f"{PROGRAM_DIR}/{TEMPLATE_CODE}${TEMPLATE_CODE}_{level}")
    xm = ctx.template_dsl(f"{PROGRAM_DIR}/{GRAFT_CODE}${GRAFT_CODE}_{level}")
    tree, evidence = graft_tree(base, xm, level)
    rewrites = 0
    for family in families:
        tree, info = ctx.rewrite_effect_refs(tree, family, strict=True)
        rewrites += info["rewritten"]
    refs = effect_refs(tree)
    allowed = {f["dst_dir"] for f in families}
    for ref in refs:
        head = ref.rsplit("/", 1)[0]
        if head in allowed or ref in FX_DIRECT_REFERENCE:
            continue
        raise KitError(f"skill {level}: effect reference {ref!r} is neither a cloned family "
                       f"member nor an official shared decoration")
    problems = dsl_problems(tree, element=ELEMENT) + roundtrip_problems(tree)
    size = encoded_size(tree)
    if size < MIN_ENCODED_BYTES:
        problems.append(f"encoded DSL is suspiciously small ({size} bytes) —— 疑似喂了包装壳")
    if problems:
        raise KitError(f"skill {level} DSL gates failed: {problems}")
    evidence["effect_rewrites"] = rewrites
    evidence["effect_refs"] = refs
    evidence["encoded_bytes"] = size
    return tree, evidence


# ---------------------------------------------------------------- 入口

def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.cid, spec.code, spec.element) != (CID, CODE, ELEMENT):
        raise KitError(f"identity drift: {spec.cid}/{spec.code}/element {spec.element}")
    if (spec.template_id, spec.template_code) != (TEMPLATE_ID, TEMPLATE_CODE):
        raise KitError(f"template drift: {spec.template_id}/{spec.template_code}")
    if spec.pf_type != 1 or spec.stance != "Attacker" or int(spec.rarity) != 5:
        raise KitError(f"spec drift: pf_type={spec.pf_type} stance={spec.stance} rarity={spec.rarity}")
    if MS.text_placeholders(spec):
        raise KitError(f"design texts still placeholders: {MS.text_placeholders(spec)}")

    design = load_design(ctx.root)

    # ---- 1) 队长技 7 行（design.json 驱动，含队长表禁 kind 检查）
    leader_rows, leader_evidence = build_leader_rows(ctx, design)
    capabilities: set[str] = set()
    for ev in leader_evidence:
        capabilities.update(ev["capabilities"])
    ctx.write_flat(KL.LEADER, {str(CID): leader_rows})

    # ---- 2) 词条 6 键 15 条（design.json 驱动）
    ability_rows, ability_evidence = build_ability_rows(ctx, design)
    for ev in ability_evidence:
        capabilities.update(ev["capabilities"])
    ctx.write_flat(KL.ABILITY, ability_rows)

    # ---- 3) 两条强化开关串（536 / 704 的 c70 查找键）
    cas_plan, cas_caps = write_strings(ctx, design)
    capabilities.update(cas_caps)
    flag_strings = check_skill_flag_strings(
        [row for rows in ability_rows.values() for row in rows], set(cas_plan))
    if sorted(flag_strings) != sorted(cas_plan):
        raise KitError(f"custom_ability_string keys {sorted(cas_plan)} vs used {sorted(flag_strings)}")

    # ---- 4) action_skill 两档能量
    action_rows = write_action_skill(ctx, design)

    # ---- 5) 特效族（整族克隆 + LUT 染色；LUT 文件不在就按母本原色克隆）
    pixel_dir = KL.pixel_dir(ctx)
    families: list[dict[str, Any]] = []
    luts: dict[str, bool] = {}
    for subdir, src_dir, members, lut_name in FX_FAMILIES:
        lut = KL.png_transform_from_lut(pixel_dir / lut_name)
        luts[subdir] = bool(lut)
        family = ctx.clone_effect_family(src_dir, subdir, fx_names=list(members),
                                         png_transform=lut)
        want_dst = f"battle/effect/skill_unique/{CODE}/{subdir}"
        if family["dst_dir"] != want_dst or sorted(family["copied_bases"]) != sorted(members):
            raise KitError(f"effect family drift: {family['dst_dir']} {family['copied_bases']}")
        families.append(family)
    lut = all(luts.values()) and bool(luts)

    # ---- 6) 技能 DSL 两档（底座 141033 + 嫁接 141081）
    programs: list[str] = []
    skill_gates: dict[str, Any] = {}
    for level in ("1", "2"):
        tree, gates = build_skill_tree(ctx, level, families)
        programs.append(_write_dsl_checked(ctx, ctx.program_path(level), tree))
        skill_gates[level] = gates

    # ---- 7) 语音路由 kind 3（ChangeSkillFlag ← A1#1 的 536）+ character 行
    design_route = design["voice"]["route"]
    if int(design_route.get("kind")) != VOICE_ROUTE["kind"]:
        raise KitError(f"design voice route drift: {design_route}")
    route = KL.voice_route(CODE, VOICE_ROUTE)
    char_row = ctx.pack.pkg_character_row()
    char_row[9:17] = route
    if char_row[6] != "1" or char_row[26] != "Attacker" or char_row[27] != str(CID):
        raise KitError(f"character row drift: c6={char_row[6]} c26={char_row[26]} c27={char_row[27]}")
    ctx.write_flat(KL.CHARACTER, {str(CID): [char_row]})
    voice_ready = KL.write_voice_ready(ctx)

    # ---- 8) 像素成品（缺文件静默跳过）+ 三层镜像
    pixel = KL.install_staged_assets(ctx)
    mirrors = ctx.sync_character_mirrors()
    if mirrors["character"][9:17] != route:
        raise KitError("character mirror lost the voice route")

    # ---- 面板：本套件不写 desc_override，22 行全部按原生文案显示
    panel: list[str] = []
    for ev in leader_evidence:
        KL.check_panel(ev["panel"], label=ev["label"])
        panel.append(ev["panel"])
    for ev in ability_evidence:
        KL.check_panel(ev["panel"], skill_flag=bool(ev.get("skill_flag")), label=ev["label"])
        panel.append(ev["panel"])
    panel.extend(cas_plan[k] for k in (CAS_FLAG1, CAS_FLAG2))

    ctx.evidence_write("kit-gates.json", {
        "leader": {"rows": leader_rows, "evidence": leader_evidence},
        "ability": {"rows": ability_rows, "evidence": ability_evidence},
        "skills": skill_gates,
        "custom_ability_string": cas_plan,
        "effect_families": [{k: f[k] for k in ("src_dir", "dst_dir", "layout", "copied_bases",
                                               "complete_family", "missing_effects")}
                            for f in families],
        "fx_lut": bool(lut), "voice_route": route, "voice_ready": voice_ready,
        "pixel": pixel, "mirrors": mirrors, "action_skill": action_rows,
        "required_client_capabilities": sorted(capabilities),
    })

    notes = [
        "技能：官方母本 141033 combat_animal_{1,2} 整树当底座，嫁接官方 141081 "
        "combat_animal_xm21_{1,2} 的四连重击 + 裂地演出到底座的敌侧参考点（id 4）；"
        f"xm21 主体 id 1..12 整体 +{ID_SHIFT} → 11..22；停球 30→{STOP_BALL_FRAMES} 帧、"
        f"参考点寿命 60→{RP_LIFETIME} 帧（≥ 最后一个 Wait 帧 {FRAME_FINISHER} + 判定区寿命 "
        f"{FINISHER_LIFETIME}）；tree[10]=0 保持（自动归属＝技能伤害，donor 原值不动）",
        f"倍率：满级 10 段精准连击 + 4 段玉杵重击 + 裂地终结 = "
        f"{skill_gates['2']['total_no_flag']}×（无开关）／"
        f"{skill_gates['2']['total_flag2_only']}×（仅 704 风共鸣）／"
        f"{skill_gates['2']['total_both_flags']}×（536+704 主位风共鸣），裁决 §2 带 78–95×；"
        f"SLv1 = {skill_gates['1']['total_no_flag']}×／{skill_gates['1']['total_both_flags']}×。"
        "终结一击外包 ConditionalsChangeSkillFlag(1)：then 支 p8=true 吃连击加成，"
        "else 支 p8=false（两支都是完整 CNA 行，禁 [\"DoNothing\"]）",
        "强化开关走 SLv 的 alv / alv2 附加项（FixedSLvValueResolver），不是 DSL 分支："
        "536（A1#1，主位＋风共鸣）供 alv 给四连重击，704（A3#3，风共鸣）供 alv2 给精准连击；"
        "没供值时 ALv 项返回 0，所以非共鸣队的面板与实际一致",
        f"特效：克隆 {sorted(luts)} 族到 skill_unique/{CODE}/（rush 族含小人剪影帧，必须与像素管线同 LUT）"
        + ("，已套用 B/pixel/fluffy/ 的 LUT 换色（风绿→青玉/月白/桂金）"
           if lut else "；LUT 文件缺失，缺的那族按母本原色克隆（像素代理交付后重跑 kit）")
        + ("" if CLONE_JAB_FAMILY else
           "；jab 族（四连重击/振りかぶり/裂地）按设计稿 §5 退路直接引用官方 "
           f"skill_unique/{GRAFT_CODE}/ 路径不进包，省 0.1823 Mpx ≈ 1.09% 图集"
           "（像素代理已备好 fx_lut_jab.json；要吃下这 1.09% 就把 kit 里的 CLONE_JAB_FAMILY 改 True）")
        + "；rush_aura / dummy_ball 是 ResolveByElement 官方公共件，同样直接引用",
        "面板：本套件没有 422/724/413，也没有恒真的 HpLow 持续行 ⇒ 不写 desc_override，"
        "22 行全部按 wf_describe 原生文案显示；两条 custom_ability_string 不含数字与时间",
        {"pixel_install": pixel},
    ]

    deviations: list[dict[str, Any]] = []
    for entry in design.get("deviations", ()):
        deviations.append({
            "want": entry.get("planned") or entry.get("原设想") or entry.get("want"),
            "got": entry.get("actual") or entry.get("实际落法") or entry.get("got"),
            "why": entry.get("why") or entry.get("原因"),
        })
    # jab 族不克隆（设计稿 §5 退路）已在 design/fluffy.json 的 deviations D7' 里登记，
    # 由上面的循环带进回执，这里不重复写。
    if not lut:
        missing_luts = sorted(k for k, v in luts.items() if not v)
        deviations.append({
            "want": "design/fluffy.json plan.skills.effects_clone：克隆时套 LUT 换成青玉/月白/桂金的中秋配色",
            "got": f"本轮 B/pixel/fluffy/ 下 {missing_luts} 族的 LUT 文件不存在 ⇒ 这些族按母本原色"
                   "克隆（风绿），kit 已留好挂点，像素代理交付后重跑 --step kit 即生效",
            "why": "像素/特效换色件不归 kit 代理；缺件时静默跳过是框架 §7.6 的约定，"
                   "但不登记就会被当成「已换色」验收",
        })
    if not CLONE_JAB_FAMILY and (pixel_dir / FX_JAB[3]).is_file():
        deviations.append({
            "want": f"像素代理已交付 B/pixel/fluffy/{FX_JAB[3]}（jab 族的中秋配色 LUT）",
            "got": "本轮没用它：jab 族按设计稿 §5 退路直接引用官方路径，不克隆也就不染色",
            "why": "克隆 jab 族会让 five-boss-r1 的 wf_atlas_budget_check fits 翻成 false"
                   "（越过裁决 §6 通过线）。要吃下这 1.09% 图集，把 "
                   "wf_midautumn_kit_fluffy.CLONE_JAB_FAMILY 改成 True 并重跑 kit,assets,manifest",
        })

    gate = {"rows": len(leader_evidence) + len(ability_evidence), "programs": len(programs),
            "pixel_present": pixel["present"],
            "pixel_missing": [e["logical"] for e in pixel["skipped"]],
            "fx_lut_present": bool(lut)}
    ready = pixel["present"] and not pixel["skipped"] and bool(lut)
    gate["reason"] = "kit 自有产物全部过闸" if ready else (
        "像素/特效件未就绪："
        + (", ".join(gate["pixel_missing"]) or "B/pixel/fluffy/install.json 不存在")
        + ("" if lut else "；fx_lut.json 不存在"))

    return KL.report(
        ctx, summary="芙拉菲：风属性技能伤害主 C（连击 × 冲刺，玉杵捣月·桂风连打）",
        status=KL.READY if ready else KL.DRAFT, panel=panel, notes=notes, programs=programs,
        required_capabilities=sorted(capabilities | set(SPEC["required_capabilities"])),
        deviations=deviations,
        extra={"custom_ability_string": sorted(cas_plan),
               "effect_families": [f["dst_dir"] for f in families],
               "kit_gate": gate, "voice_route": route,
               "skill_totals": {lv: skill_gates[lv]["total_both_flags"] for lv in ("1", "2")}})
