# -*- coding: utf-8 -*-
"""普莉姆拉·浴衣 169992 ``blackflower_wiz_yukata`` 套件（季节换装七角色 kit）。

设计定稿：``work/character_packs/seasonal7-20260916/design/primula.json``（status=final）与 ``primula.md``。
本模块按设计落地：

- character 行语音路由 c9–c16、character_text（设计全文）；
- 队长 6 行、词条 6 键 11 条：一律取**官方基线** donor 行，逐列断言旧值后改写（``LEADER_PLAN``/``ABILITY_PLAN``），
  设计 JSON 在场时再断言成品行与设计逐字相同；
- 固有状态「百合夜」``16999201``（官方 11 同构，上限 10）＋ 48×48 图标（官方外框 alpha，程序绘制百合与团扇）；
- action_skill 两档（161069 inner 行为底）、两棵技能 DSL（从官方 DSL 按 f3_tree.py 逐参数断言拼装，裸树编码）；
- 两个特效族（sibling 形态）克隆与 DSL 特效引用改写；预留 Effects 阶段染色 sheet 钩子
  （``fx/primula/out/manifest.json``）；
- switched_action_skill ``<code>_voice_ready``（与 ``wf_seasonal7_voice.pack_voice`` 同列约定：action_skill c7..c23）。

不做（设计 §0.7）：722 PF 覆盖、422 冲刺参数、724、desc_override、custom_ability_string。

离线门禁（manifest/status/inspect 之后）::

    python mod-tools/wf_seasonal7_kit_primula.py gates

写 ``seasonal7-20260916/impl/primula/gates.json``；全过时把 ``evidence/kit-report.json`` 的 status 升为
``ready-for-review``。kit 重跑时只有「静态门禁全过且 gates.json 通过且 kit 产物摘要未变」才保持 ready-for-review。

克隆特效 timeline 内嵌 SE（``sounds[].path``）是战斗预载引用：kit 静态门禁与离线门禁都要求每条可在包内或 live
解析到 ``<path>.mp3``，否则记失败（写错前缀＝进战斗「数据不足」）。

``ready-for-review`` / ``all_pass`` 只覆盖 kit 范围。语音 22 条、speech 8 行、像素 2 张由 Integrate 阶段装包；
gates.json 的 ``integration_pending.clear`` 与 ``release_ready_after_integration`` 为 true 之前不得发布。

Integrate 阶段（媒体整合）：

- 特效：染色 sheet 除经 ``png_transform`` 钩子外，克隆后再以**染色 PNG 的存储态原字节**
  （``wf_assets.png_encode``，不经 PIL 重编码）覆盖包内 sheet（owner=effects），包内 sha = 存储态 sha；
  ``fx_sheet_problems`` 在 kit 与离线门禁里核对字节、尺寸与 alpha = 母本。
- 像素小人：``pixel/primula/report.json`` 门禁全过、``pixel/_review/verify_all.json`` primula 复核
  （hard + 声明 D1）全过、REVIEW.md 修复轮复核判 PASS、三处 sha 一致时，``install_pixel`` 把
  ``out/{sprite_sheet,special_sprite_sheet}.png`` 以存储态写入 ``character/<code>/pixelart/``（owner=pixel），
  写后核对尺寸/alpha = 母本、atlas/frame/timeline = 母本树（仅 ``character/<母本>/`` 前缀）；未就绪不写。
- 语音：由 ``impl/primula/voice_merge.py`` 在 ``wf_seasonal7_voice pack`` 之后并账（不在 kit 内）；
  ``integration_pending.voice.clear`` 另要求包内不再残留母本占位语音。
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import math
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

CID = "169992"
CODE = "blackflower_wiz_yukata"
UID = "16999201"
UID_INT = 16999201
ELEMENT = 5                                    # Black（0 基）
BATCH = "work/character_packs/seasonal7-20260916"
DESIGN_JSON = f"{BATCH}/design/primula.json"
DESIGN_TREES = {"1": f"{BATCH}/design/primula_tree_1.json", "2": f"{BATCH}/design/primula_tree_2.json"}
OFFICIAL_SIG = f"{BATCH}/research/_tmp/official_sig.json"
FX_MANIFEST = f"{BATCH}/fx/primula/out/manifest.json"
IMPL_DIR = f"{BATCH}/impl/primula"
GATES_FILE = f"{IMPL_DIR}/gates.json"

ABILITY = "master/ability/ability.orderedmap"
LEADER = "master/ability/leader_ability.orderedmap"
CHAR = "master/character/character.orderedmap"
TEXT = "master/character/character_text.orderedmap"
UNIQUE = "master/character/unique_condition.orderedmap"
ACTION = "master/skill/action_skill.orderedmap"
SWITCHED = "master/skill/switched_action_skill.orderedmap"
CAS = "master/string/custom_ability_string.orderedmap"
VOICE_READY = f"{CODE}_voice_ready"
ICON_ROW_PATH = f"battle/common/unique_condition/unique_{CODE}_lily_night"
ICON_LOGICAL = ICON_ROW_PATH + ".png"
ICON_FRAME_DONOR = "battle/common/unique_condition/unique_blackflower_wiz_smr22.png"

SKILL_NAME_1 = "紫百合·烟花扇舞"
SKILL_NAME_2 = "紫百合·烟花扇舞＋"
SKILL_DESC = ("在距离最近的敌人处创造紫百合花园，持续造成暗属性伤害并赋予其暗属性抗性降低效果，"
              "消散前绽放烟花追加暗属性伤害【威力随“百合夜”层数提升】（花园与烟花均以直接攻击伤害判定）"
              "／赋予队伍及协力球直接攻击伤害提升【随“百合夜”层数提升】＆贯穿效果"
              "／发动时“百合夜”为5层以上则赋予暗属性角色最大速度固定效果")
PROFILE = ("夏日祭典之夜，普莉姆拉换上绣满紫百合的浴衣，握着团扇怯生生地走进人群。"
           "烟花升空的刹那，她轻摇扇面，让曾被人畏惧的黑百合魔力在夜空中绽成紫花——"
           "今晚，她想让同伴看见这份力量温柔的一面。")
LEADER_NAME = "夏夜绽放的紫百合"
CV = "AI 合成配音"

TEXTS = {"name": "普莉姆拉", "furigana": "PULIMULA", "title": "夏夜扇舞的百合魔女", "profile": PROFILE,
         "leader": LEADER_NAME, "skill1": SKILL_NAME_1, "desc1": SKILL_DESC,
         "skill2": SKILL_NAME_2, "desc2": SKILL_DESC, "cv": CV}
SPEC = {"extra_keys": {UNIQUE: (UID,), SWITCHED: (VOICE_READY,)}}

# 语音路由（设计 §10.1，阵容审查 R6）：ConditionExist(1) + Piercing(31)，c11 写 0（客户端不读，过构建器数字校验）
ROUTE_COLS = ["1", "31", "0", "", "", VOICE_READY, "false", "false"]

# ---------------------------------------------------------------- 行方案（官方 donor + 逐列 旧值→新值）
# (表, donor 键, donor 行号(1 基), {列: (旧, 新)})
LEADER_PLAN = [
    ("leader_ability", "161135", 1, {0: ("wind_spgirl_hw22", CODE), 111: ("230000", "300000"), 112: ("300000", "300000")}),
    ("leader_ability", "161177", 1, {0: ("ruin_girl_3halfanv", CODE), 49: ("40000", "50000"), 50: ("50000", "50000")}),
    ("leader_ability", "161123", 1, {0: ("blackflower_wiz_smr22", CODE), 102: ("11", UID), 107: ("0", "1"),
                                      111: ("11500", "15000"), 112: ("15000", "15000")}),
    ("leader_ability", "161123", 4, {0: ("blackflower_wiz_smr22", CODE), 49: ("100000", "300000"),
                                      50: ("100000", "300000"), 66: ("11", UID)}),
    ("leader_ability", "161069", 2, {0: ("blackflower_wiz", CODE), 49: ("60000", "100000"), 50: ("80000", "100000")}),
    ("leader_ability", "161123", 2, {0: ("blackflower_wiz_smr22", CODE), 102: ("11", UID), 111: ("750", "1000"),
                                      112: ("1000", "1000")}),
]
ABILITY_PLAN = {
    1: [("ability", "1610691", 1, {0: ("blackflower_wiz_1", f"{CODE}_1"), 51: ("25000", "100000"), 52: ("50000", "100000")}),
        ("ability", "1611111", 1, {0: ("mirror_witch_1", f"{CODE}_1"), 109: ("1", "3"), 113: ("60000", "15000"),
                                   114: ("120000", "15000")})],
    2: [("ability", "1611111", 1, {0: ("mirror_witch_1", f"{CODE}_2"), 113: ("60000", "150000"), 114: ("120000", "150000")}),
        ("ability", "1610692", 2, {0: ("blackflower_wiz_2", f"{CODE}_2"), 51: ("10000", "50000"), 52: ("20000", "50000")})],
    3: [("ability", "1611231", 1, {0: ("blackflower_wiz_smr22_1", f"{CODE}_3"), 1: ("true", "false"), 68: ("11", UID)}),
        ("ability", "1611231", 1, {0: ("blackflower_wiz_smr22_1", f"{CODE}_3"), 1: ("true", "false"), 27: ("23", "20"),
                                   28: ("0", "7"), 29: ("", "Black"), 30: ("100000", "5000000"), 31: ("100000", "5000000"),
                                   51: ("200000", "100000"), 52: ("200000", "100000"), 68: ("11", UID)}),
        ("ability", "1611233", 3, {0: ("blackflower_wiz_smr22_3", f"{CODE}_3"), 104: ("11", UID), 110: ("0", "5"),
                                   111: ("", "Black"), 113: ("10000", "10000"), 114: ("20000", "10000")})],
    4: [("ability", "1611113", 1, {0: ("mirror_witch_3", f"{CODE}_4"), 1: ("false", "true"), 113: ("5000", "20000"),
                                   114: ("10000", "20000")}),
        ("ability", "1610693", 2, {0: ("blackflower_wiz_3", f"{CODE}_4"), 1: ("false", "true"), 51: ("-10000", "-20000"),
                                   52: ("-20000", "-20000")})],
    5: [("ability", "1610693", 1, {0: ("blackflower_wiz_3", f"{CODE}_5"), 1: ("false", "true"), 51: ("50000", "100000"),
                                   52: ("100000", "100000")})],
    6: [("ability", "1610696", 1, {0: ("blackflower_wiz_6", f"{CODE}_6"), 51: ("12500", "40000"), 52: ("25000", "40000")})],
}
# 固有状态：官方 11（能量吸取）只改 c0–c2；c4=10 上限（不能写 (None)）
UNIQUE_DONOR = "11"
UNIQUE_EDITS = {0: ("unique_blackflower_wiz_smr22", f"unique_{CODE}_lily_night"),
                1: (None, "百合夜"),
                2: ("battle/common/unique_condition/unique_blackflower_wiz_smr22", ICON_ROW_PATH)}

# action_skill：161069 blackflower_wiz inner 行为底（c2 图标 atk_nearest、c8-c23 自动施放区域原样）
ACTION_DONOR = "blackflower_wiz"
ACTION_EDITS = {
    "1": {0: ("毁灭怒放", SKILL_NAME_1), 4: ("580", "540"), 5: ("580", "540"), 6: ("1", "1"),
          7: ("battle/action/skill/action/rare5/blackflower_wiz$blackflower_wiz_1",
              f"battle/action/skill/action/rare5/{CODE}${CODE}_1")},
    "2": {0: ("毁灭怒放＋", SKILL_NAME_2), 4: ("580", "540"), 5: ("530", "490"), 6: ("1", "1"),
          7: ("battle/action/skill/action/rare5/blackflower_wiz$blackflower_wiz_2",
              f"battle/action/skill/action/rare5/{CODE}${CODE}_2")},
}

# 特效族（设计 effects.clone，sibling 形态）
EFFECT_FAMILIES = (
    {"src_dir": "battle/effect/skill_unique/blackflower_wiz", "dst_subdir": "garden", "layout": "sibling",
     "fx_names": ["blackflower_wiz_flower_back", "blackflower_wiz_flower", "blackflower_wiz_hit"]},
    {"src_dir": "battle/effect/skill_unique/blackflower_wiz_smr22", "dst_subdir": "hanabi", "layout": "sibling",
     "fx_names": ["blackflower_wiz_smr22_flower", "blackflower_wiz_smr22_heart"]},
)

# 技能树参数（设计 §6.1 / f3_tree.py V）
HEART_NAME = "`自身のハート"
KEY_DD = "百合夜直撃バフ"
KEY_FS = "百合夜最大速度固定"


def _slv(a, b=None, vlv=None):
    d = {"min": a, "max": a if b is None else b}
    if vlv:
        d["vlv"] = vlv
    return [d]


TREE_VALUES = {
    "1": dict(garden_mul=_slv(2.0), fin_mul=_slv(6.7, vlv=[{"vid": 2, "min": 0, "max": 0.6}]),
              dd=_slv(0.8, vlv=[{"vid": 1, "min": 0, "max": 0.1}]), pierce=_slv(1080),
              fs_time=_slv(720), fs_speed=_slv(1), fs_charge=_slv(0)),
    "2": dict(garden_mul=_slv(2.6, 3.0), fin_mul=_slv(8.7, 10, vlv=[{"vid": 2, "min": 0, "max": 0.6}]),
              dd=_slv(1.0, 1.25, vlv=[{"vid": 1, "min": 0, "max": 0.1}]), pierce=_slv(1200),
              fs_time=_slv(900), fs_speed=_slv(1), fs_charge=_slv(0)),
}


class KitError(RuntimeError):
    pass


# ---------------------------------------------------------------- 行构建

def _donor_row(ctx_or_pack, table: str, key: str, line: int) -> list[str]:
    import wf_seasonal7_common as C
    import wf_mod_tool as core
    logical = f"master/ability/{table}.orderedmap"
    pack = getattr(ctx_or_pack, "pack", ctx_or_pack)
    raw = pack.official_read(logical, "common")
    if raw is None:
        raise KitError(f"official baseline lacks {logical}; donors must be official")
    rows = core.read_orderedmap_file_from_bytes(raw)
    if key not in rows:
        raise KitError(f"official donor missing: {table}:{key}")
    lines = C.csv_split(rows[key])
    if not 1 <= line <= len(lines):
        raise KitError(f"official donor {table}:{key} has {len(lines)} lines, want #{line}")
    return list(lines[line - 1])


def _apply_edits(row: list[str], edits: dict[int, tuple], label: str) -> list[str]:
    out = list(row)
    for col, (old, new) in edits.items():
        if col >= len(out):
            raise KitError(f"{label}: column {col} out of range {len(out)}")
        if old is not None and out[col] != old:
            raise KitError(f"{label}: c{col} expected {old!r}, found {out[col]!r}")
        out[col] = new
    return out


def build_leader_rows(pack) -> list[list[str]]:
    return [_apply_edits(_donor_row(pack, t, k, n), e, f"leader#{i + 1} <= {t}:{k}#L{n}")
            for i, (t, k, n, e) in enumerate(LEADER_PLAN)]


def build_ability_rows(pack) -> dict[str, list[list[str]]]:
    out = {}
    for slot, plan in ABILITY_PLAN.items():
        out[f"{CID}{slot}"] = [_apply_edits(_donor_row(pack, t, k, n), e, f"A{slot}#{i + 1} <= {t}:{k}#L{n}")
                               for i, (t, k, n, e) in enumerate(plan)]
    return out


def build_unique_row(pack) -> list[str]:
    import wf_seasonal7_common as C
    import wf_mod_tool as core
    raw = pack.official_read(UNIQUE, "common")
    if raw is None:
        raise KitError("official baseline lacks unique_condition table")
    donor = C.csv_split(core.read_orderedmap_file_from_bytes(raw)[UNIQUE_DONOR])[0]
    row = _apply_edits(donor, UNIQUE_EDITS, f"unique_condition:{UNIQUE_DONOR}")
    if row[4] in ("", "(None)") or int(row[4]) != 10:
        raise KitError(f"unique max_accumulation must be 10, got {row[4]!r}")
    return row


def build_action_rows(pack) -> dict[str, list[str]]:
    import wf_seasonal7_common as C
    import wf_mod_tool as core
    raw = pack.official_read(ACTION, "common")
    if raw is None:
        raise KitError("official baseline lacks action_skill table")
    inner = core.load_nested_table_bytes(raw, ACTION).rows[ACTION_DONOR].text_rows()
    out = {}
    for level, edits in ACTION_EDITS.items():
        row = _apply_edits(C.csv_split(inner[level])[0], edits, f"action_skill:{ACTION_DONOR}/{level}")
        row[1] = SKILL_DESC
        if len(row) != 24:
            raise KitError(f"action_skill row length {len(row)} != 24")
        out[level] = row
    return out


def text_row() -> list[str]:
    return [TEXTS["name"], TEXTS["furigana"], PROFILE, TEXTS["title"], SKILL_NAME_1, SKILL_DESC,
            SKILL_NAME_2, SKILL_DESC, "(None)", "(None)", LEADER_NAME, CV]


# ---------------------------------------------------------------- 技能树拼装（移植 design/_tmp/primula/final/f3_tree.py）

def _cmd(node):
    if not (isinstance(node, list) and node and node[0] in ("Command", "Event")):
        raise KitError(f"not a Command/Event node: {str(node)[:80]}")
    return node[1]


def _get(tree, path):
    node = tree
    for k in path:
        node = node[k]
    return node


class _Log:
    def __init__(self):
        self.items: list[dict] = []

    def setp(self, block, node, i, old, new):
        arr = _cmd(node)
        if arr[i + 1] != old:
            raise KitError(f"{block}: {arr[0]} p{i} expected {old!r}, found {arr[i + 1]!r}")
        arr[i + 1] = new
        self.items.append(dict(block=block, command=arr[0], param=f"p{i}", old=old, new=new))

    def expect(self, block, node, i, old):
        arr = _cmd(node)
        if arr[i + 1] != old:
            raise KitError(f"{block}: {arr[0]} p{i} expected {old!r}, found {arr[i + 1]!r}")

    def note(self, block, command, param, old, new):
        self.items.append(dict(block=block, command=command, param=param, old=old, new=new))


def _program(pack, code: str, level: str) -> str:
    import wf_seasonal7_common as C
    import wf_mod_tool as core
    raw = pack.official_read(ACTION, "common")
    table = core.load_nested_table_bytes(raw if raw is not None else pack.live_table_bytes(ACTION), ACTION)
    if code not in table.rows:
        table = core.load_nested_table_bytes(pack.live_table_bytes(ACTION), ACTION)
    return C.csv_split(table.rows[code].text_rows()[level])[0][7]


def compose_tree(pack, level: str) -> tuple[list, list[dict]]:
    """按设计块清单从官方 DSL 拼装（特效路径保持官方，稍后由 rewrite_effect_refs 改到克隆目录）。"""
    log = _Log()
    W = pack.template_dsl(_program(pack, "blackflower_wiz", level))
    S2 = pack.template_dsl(_program(pack, "blackflower_wiz_smr22", level))
    SA = pack.template_dsl(_program(pack, "sing_android_hw20", "2"))
    MW = pack.template_dsl(_program(pack, "mirror_witch", "2"))
    SW = pack.template_dsl(_program(pack, "special_week", "2"))
    v = TREE_VALUES[level]
    root = []
    # B0 扇舞（smr22 heart，挂 -17）
    fan = copy.deepcopy(_get(S2, [11, 1, 1]))
    if _cmd(fan)[0] != "ShowEffect":
        raise KitError("B0 source is not ShowEffect")
    log.setp("B0_fan", fan, 0, HEART_NAME, "扇舞")
    log.expect("B0_fan", fan, 1, ["SpecifyEffectDirectly",
                                  "battle/effect/skill_unique/blackflower_wiz_smr22/blackflower_wiz_smr22_heart"])
    log.setp("B0_fan", fan, 7, -300, 0)
    root.append(fan)
    # B2 花园（161069 整棵 FindNear 子树）
    g = copy.deepcopy(_get(W, [11, 1, 0]))
    if _cmd(g)[0] != "FindNearSubjects":
        raise KitError("B2 source is not FindNearSubjects")
    log.setp("B2_garden", g, 4, 0, 10)
    rp = _get(g, [1, 6, 1, 0])
    if _cmd(rp)[0] != "CreateReferencePoint":
        raise KitError("B2 RP missing")
    log.setp("B2_garden.RP", rp, 0, 0, 10)
    log.setp("B2_garden.RP", rp, 8, 200, 280)
    log.setp("B2_garden.RP", rp, 9, 1, 11)
    rpb = _get(rp, [1, 11, 1])
    back, front, wait15 = rpb[0], rpb[1], rpb[2]
    log.expect("B2_garden.fx_back", back, 1,
               ["SpecifyEffectDirectly", "battle/effect/skill_unique/blackflower_wiz/blackflower_wiz_flower_back"])
    log.setp("B2_garden.fx_back", back, 2, 1, 11)
    log.expect("B2_garden.fx_front", front, 1,
               ["SpecifyEffectDirectly", "battle/effect/skill_unique/blackflower_wiz/blackflower_wiz_flower"])
    log.setp("B2_garden.fx_front", front, 2, 1, 11)
    if not (_cmd(wait15)[0] == "Wait" and _cmd(wait15)[1] == 15):
        raise KitError("B2 Wait 15 missing")
    w15b = _get(wait15, [1, 3, 1])
    ha_a, ha_b = w15b
    if _cmd(ha_b)[0] != "CreateHitArea":
        raise KitError("B2 HA_B missing")
    w15b[:] = [ha_a]
    log.note("B2_garden.wait15", "Wait", "p2 body", "[HA_A, HA_B self regen]", "[HA_A]")
    log.setp("B2_garden.HA_A", ha_a, 1, 1, 11)
    for i, (o, n) in zip((18, 20, 21), ((2, 12), (3, 13), (4, 14))):
        log.setp("B2_garden.HA_A", ha_a, i, o, n)
    log.setp("B2_garden.HA_A", ha_a, 23, 0, 4)
    onhit = _get(ha_a, [1, 23, 1])
    cna = onhit[1]
    if _cmd(cna)[0] != "CreateNormalAttack":
        raise KitError("B2 HA_A CNA missing")
    log.setp("B2_garden.HA_A.CNA", cna, 0, 4, 14)
    log.setp("B2_garden.HA_A.CNA", cna, 4, 13, 20)
    log.setp("B2_garden.HA_A.CNA", cna, 5, _cmd(cna)[6], v["garden_mul"])
    log.expect("B2_garden.HA_A.CNA", cna, 14,
               ["SpecifyHitEffectDirectly", ["SpecifyEffectDirectly",
                                             "battle/effect/skill_unique/blackflower_wiz/blackflower_wiz_hit"], False])
    tol = onhit[2]
    if not (_cmd(tol)[0] == "CreateCondition" and _cmd(tol)[2][0][0] == "ACToleranceOfElement"):
        raise KitError("B2 tolerance CC missing")
    log.setp("B2_garden.HA_A.tolerance", tol, 0, 4, 14)
    # B3 烟花：smr22 Wait38 特效 → Wait150；Wait60 绑定+判定区 → Wait172
    w38 = copy.deepcopy(_get(S2, [11, 1, 2, 1, 11, 1, 0]))
    if _cmd(w38)[0] != "Wait":
        raise KitError("B3 Wait38 missing")
    log.setp("B3_hanabi.wait_fx", w38, 0, 38, 150)
    eff = _get(w38, [1, 3, 1, 0])
    log.setp("B3_hanabi.fx_burst", eff, 0, "攻撃", "烟花")
    log.expect("B3_hanabi.fx_burst", eff, 1,
               ["SpecifyEffectDirectly", "battle/effect/skill_unique/blackflower_wiz_smr22/blackflower_wiz_smr22_flower"])
    log.setp("B3_hanabi.fx_burst", eff, 2, 0, 11)
    w60 = copy.deepcopy(_get(S2, [11, 1, 2, 1, 11, 1, 2]))
    if _cmd(w60)[0] != "Wait":
        raise KitError("B3 Wait60 missing")
    log.setp("B3_hanabi.wait_hit", w60, 0, 60, 172)
    w60b = _get(w60, [1, 3, 1])
    bind2, ha_f, leader = w60b[0], w60b[1], w60b[2]
    if _cmd(leader)[0] != "IfThisCharacterIsLeader":
        raise KitError("B3 leader heal block missing")
    log.setp("B3_hanabi.bind_vid2", bind2, 2, ["DCUnique", 11], ["DCUnique", UID_INT])
    log.setp("B3_hanabi.HA_F", ha_f, 1, 0, 11)
    log.setp("B3_hanabi.HA_F", ha_f, 8, ["Circle", [{"min": 250, "max": 250}]], ["Circle", [{"min": 300, "max": 300}]])
    for i, (o, n) in zip((18, 20, 21), ((3, 18), (4, 19), (5, 20))):
        log.setp("B3_hanabi.HA_F", ha_f, i, o, n)
    log.setp("B3_hanabi.HA_F", ha_f, 23, 0, 4)
    fcna = _get(ha_f, [1, 23, 1, 0])
    if _cmd(fcna)[0] != "CreateNormalAttack":
        raise KitError("B3 HA_F CNA missing")
    log.setp("B3_hanabi.HA_F.CNA", fcna, 0, 5, 20)
    log.setp("B3_hanabi.HA_F.CNA", fcna, 4, 167, 100)
    log.setp("B3_hanabi.HA_F.CNA", fcna, 5, _cmd(fcna)[6], v["fin_mul"])
    w60b[:] = [bind2, ha_f]
    log.note("B3_hanabi.wait_hit", "Wait", "p2 body", "[Bind vid2, HA, IfThisCharacterIsLeader(heal)]", "[Bind vid2, HA]")
    rpb.extend([w38, w60])
    root.append(g)
    # W1：官方 smr22 Wait 1 容器
    w1 = copy.deepcopy(_get(S2, [11, 1, 2, 1, 11, 1, 1]))
    if not (_cmd(w1)[0] == "Wait" and _cmd(w1)[1] == 1):
        raise KitError("W1 Wait 1 missing")
    w1b = _get(w1, [1, 3, 1])
    b1 = w1b[0]
    if _cmd(b1)[0] != "BindConditionAccumulationVariable":
        raise KitError("W1 Bind vid1 missing")
    log.setp("W1.B1_bind_vid1", b1, 2, ["DCUnique", 11], ["DCUnique", UID_INT])
    # B4 全队增益（sing_android_hw20 FindAll(33) + mirror_witch ACPiercing）
    fa = copy.deepcopy(_get(SA, [11, 1, 4]))
    if not (_cmd(fa)[0] == "FindAllSubjects" and _cmd(fa)[2] == 33):
        raise KitError("B4 FindAll(33) missing")
    log.setp("W1.B4_team", fa, 0, 0, 30)
    body = _get(fa, [1, 9, 1])
    dd = body[1]
    if _cmd(dd)[2][0][0] != "ACDirectDamage":
        raise KitError("B4 ACDirectDamage missing")
    log.setp("W1.B4_team.ACDirectDamage", dd, 0, 0, 30)
    log.setp("W1.B4_team.ACDirectDamage", dd, 1, _cmd(dd)[2],
             [["ACDirectDamage", [{"min": 1200, "max": 1200}], v["dd"], [{"min": 1, "max": 1}]]])
    log.setp("W1.B4_team.ACDirectDamage", dd, 6, "", KEY_DD)
    pc = copy.deepcopy(_get(MW, [11, 1, 3, 1, 9, 1, 0]))
    if _cmd(pc)[2][0][0] != "ACPiercing":
        raise KitError("B4 ACPiercing missing")
    log.setp("W1.B4_team.ACPiercing", pc, 0, 0, 30)
    log.setp("W1.B4_team.ACPiercing", pc, 1, _cmd(pc)[2], [["ACPiercing", v["pierce"]]])
    body[:] = [dd, pc]
    log.note("W1.B4_team", "FindAllSubjects", "p8 body", "[CC ACAttackPoint, CC ACDirectDamage]",
             "[CC ACDirectDamage(vlv vid1, fixed key), CC ACPiercing]")
    # B6 ≥5 层 → 暗主队最大速度固定（special_week_2 块形状）
    fs = copy.deepcopy(_get(SW, [11, 1, 4, 1, 1, 1, 0]))
    if not (_cmd(fs)[0] == "FindAllSubjects" and _cmd(fs)[2] == 82):
        raise KitError("B6 FindAll(82) missing")
    log.setp("W1.B6_layers5.f82", fs, 0, 1, 32)
    log.setp("W1.B6_layers5.f82", fs, 2, [], [6])
    fcc = _get(fs, [1, 9, 1, 0])
    if not (_cmd(fcc)[2][0][0] == "ACFixedSpeed" and _cmd(fcc)[10] == 3):
        raise KitError("B6 ACFixedSpeed (target kind 3) missing")
    log.setp("W1.B6_layers5.ACFixedSpeed", fcc, 0, 1, 32)
    log.setp("W1.B6_layers5.ACFixedSpeed", fcc, 1, _cmd(fcc)[2],
             [["ACFixedSpeed", v["fs_time"], v["fs_speed"], v["fs_charge"], [{"min": 1, "max": 1}]]])
    log.setp("W1.B6_layers5.ACFixedSpeed", fcc, 6, "スペシャルウィーク最大速度固定", KEY_FS)
    cond = ["Command", ["ConditionalsConditionAccumulationNumber", ["DCUnique", UID_INT], 5,
                        ["Block", [fs]], ["Block", []]]]
    log.note("W1.B6_layers5", "ConditionalsConditionAccumulationNumber", "new node",
             "combat_soldier_smr22_2 shape", f"[DCUnique {UID}],5,Block[FindAll(32,82,[6]) ACFixedSpeed],Block[]")
    w1b[:] = [b1, fa, cond]
    log.note("W1", "Wait", "p2 body", "[Bind vid1, CC(-17) ACSkillDamage]", "[Bind vid1, B4, B6]")
    root.append(w1)
    tree = ["ActionDsl", 1, ["None"], False, False, False, False, False, False, False, 0, ["Block", root]]
    if W[:11] != tree[:11]:
        raise KitError(f"root head differs from 161069 source: {W[:11]}")
    return tree, log.items


# ---------------------------------------------------------------- 静态校验（树）

def _tag(v):
    return v[0] if isinstance(v, list) and v and isinstance(v[0], str) else None


def _kind(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "num"
    if isinstance(v, str):
        return "str"
    if isinstance(v, dict):
        return "dict"
    if isinstance(v, list):
        if v and all(isinstance(x, dict) for x in v):
            return "slv"
        t = _tag(v)
        if t in ("Block", "Command", "Event"):
            return "expr"
        if t is not None:
            return "enum:" + t
        return "list"
    return type(v).__name__


def _typed(v):
    """带类型的规范形（AMF3 int/double 区分）。"""
    if isinstance(v, bool):
        return ["b", v]
    if isinstance(v, int):
        return ["i", v]
    if isinstance(v, float):
        return ["f", v]
    if isinstance(v, list):
        return ["l", [_typed(x) for x in v]]
    if isinstance(v, dict):
        return ["d", {k: _typed(x) for k, x in v.items()}]
    return ["s", v]


def signature_problems(tree, sig: dict | None) -> list[str]:
    """官方语料参数种类（official_sig.json）+ wf_dsl_sig 参数个数/嵌套枚举（审查 r6_tree.py）
    + ActionDslExpression 位必须是 Block/Command/Event（["DoNothing"] 放在表达式位 = F1009）。"""
    import wf_dsl_sig as SIG
    probs: list[str] = []

    def walk(n):
        if isinstance(n, list):
            t = _tag(n)
            if t in ("Command", "Event") and isinstance(n[1], list):
                c = n[1]
                exp = SIG.COMMANDS.get(c[0]) or SIG.EVENTS.get(c[0])
                if exp is None:
                    probs.append(f"unknown command {c[0]}")
                elif len(c) - 1 != len(exp):
                    probs.append(f"arity {c[0]} {len(c) - 1} != {len(exp)}")
                for i, p in enumerate(c[1:], 1):
                    k = _kind(p)
                    if exp is not None and i - 1 < len(exp) and exp[i - 1] == "ActionDslExpression" \
                            and _tag(p) not in ("Block", "Command", "Event"):
                        probs.append(f"{c[0]}#{i} expression slot holds {str(p)[:40]} (F1009)")
                    if sig is None:
                        continue
                    o = sig.get(f"{c[0]}#{i}")
                    if o is None:
                        probs.append(f"{c[0]}#{i} absent from official corpus")
                    elif k not in o and not (k == "list" and p == []):
                        probs.append(f"{c[0]}#{i} kind {k} not in official {o}")
                    if k.startswith("enum:"):
                        for j, q in enumerate(p[1:], 1):
                            o2 = sig.get(f"{c[0]}#{i}>{p[0]}#{j}")
                            if o2 is None:
                                probs.append(f"{c[0]}#{i}>{p[0]}#{j} absent from official corpus")
                            elif _kind(q) not in o2:
                                probs.append(f"{c[0]}#{i}>{p[0]}#{j} kind {_kind(q)} not in {o2}")
                    if k == "list":
                        for q in p:
                            if _tag(q) and _tag(q) not in ("Block", "Command", "Event"):
                                for j, r in enumerate(q[1:], 1):
                                    o3 = sig.get(f"{q[0]}#{j}")
                                    if o3 is None or _kind(r) not in o3:
                                        probs.append(f"{c[0]}>{q[0]}#{j} kind {_kind(r)} not in {o3}")
            for x in n:
                walk(x)
        elif isinstance(n, dict):
            for x in n.values():
                walk(x)
    walk(tree)
    return sorted(set(probs))


def effect_paths(tree) -> list[str]:
    out = set()

    def walk(n):
        if isinstance(n, list):
            if len(n) == 2 and n[0] == "SpecifyEffectDirectly" and isinstance(n[1], str):
                out.add(n[1])
            for x in n:
                walk(x)
        elif isinstance(n, dict):
            for x in n.values():
                walk(x)
    walk(tree)
    return sorted(out)


def create_conditions(tree) -> list[dict]:
    out = []

    def walk(n):
        if isinstance(n, list):
            if _tag(n) == "Command" and isinstance(n[1], list) and n[1][0] == "CreateCondition":
                c = n[1]
                out.append(dict(subject=c[1], ac=c[2][0][0], key=c[7], target_kind=c[10], force=c[12],
                                vlv="vlv" in json.dumps(c[2])))
            for x in n:
                walk(x)
    walk(tree)
    return out


def tree_checks(tree, sig: dict | None) -> dict[str, Any]:
    import wf_client_legality as LG
    import wf_dsl
    import wf_seasonal7_common as C
    import zlib
    result: dict[str, Any] = {}
    wrapper = isinstance(tree, dict) or not (isinstance(tree, list) and tree and tree[0] == "ActionDsl")
    result["bare_tree"] = not wrapper
    try:
        raw = C.amf_bytes(tree)
        back = wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"]
        result["roundtrip"] = _typed(back) == _typed(tree)
        result["deflated_bytes"] = len(raw)
    except Exception as exc:                       # noqa: BLE001
        result["roundtrip"] = False
        result["roundtrip_error"] = f"{type(exc).__name__}: {exc}"
    result["element"] = LG.action_dsl_element_problems(tree, ELEMENT)
    result["subject_binding"] = LG.action_dsl_subject_binding_problems(tree)
    result["hit_area_target"] = LG.action_dsl_hit_area_target_problems(tree)
    result["player_side"] = wf_dsl.player_side_dsl_problems(tree)
    result["signature"] = signature_problems(tree, sig)
    result["official_sig_loaded"] = sig is not None
    result["root_head"] = {"movementPriority": tree[1], "buffTargetAs": tree[10]}
    result["create_conditions"] = create_conditions(tree)
    result["effect_paths"] = effect_paths(tree)
    ok = (result["bare_tree"] and result["roundtrip"] and sig is not None
          and not any(result[k] for k in ("element", "subject_binding", "hit_area_target", "player_side", "signature")))
    # 固定区分键（审查 #1）：vlv CreateCondition 必须带非空键
    vlv_nokey = [c for c in result["create_conditions"] if c["vlv"] and not c["key"]]
    result["vlv_without_key"] = vlv_nokey
    result["ok"] = bool(ok and not vlv_nokey)
    return result


def _load_json(root: Path, rel: str):
    path = root / rel
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


# ---------------------------------------------------------------- 特效 timeline 内嵌 SE（预载引用）

def timeline_sound_report(timeline, locate) -> tuple[dict[str, bool], list[str]]:
    """timeline 的 ``sounds[].path`` 是战斗预载引用：写错前缀＝进战斗「数据不足」（1.4.529 魔王热修先例）。

    ``locate(logical) -> truthy`` 按 ``<path>.mp3`` 解析（包内或 live）。返回 ``({path: 是否解析}, problems)``；
    解析失败、条目不是对象、缺 path、``sounds`` 不是列表都记 problem。没有 SE 的 timeline 返回空。
    """
    resolved: dict[str, bool] = {}
    problems: list[str] = []
    if not isinstance(timeline, dict):
        return resolved, [f"timeline is {type(timeline).__name__}, not an object"]
    sounds = timeline.get("sounds")
    if sounds is None:
        return resolved, problems
    if not isinstance(sounds, list):
        return resolved, [f"sounds is {type(sounds).__name__}, not a list"]
    for i, entry in enumerate(sounds):
        path = entry.get("path") if isinstance(entry, dict) else None
        if not isinstance(path, str) or not path:
            problems.append(f"sounds[{i}] has no path: {entry!r}")
            continue
        ok = bool(locate(path + ".mp3"))
        resolved[path] = resolved.get(path, True) and ok
        if not ok:
            problems.append(f"sound unresolved: {path}.mp3")
    return resolved, problems


def sound_locator(pack):
    """SE 解析：包内任一客户端根，或 live store。"""
    import wf_seasonal7_common as C
    return lambda logical: any(pack.pkg_has(r, logical) for r in C.CLIENT_ROOTS) \
        or pack.live_locate(logical) is not None


def effect_timeline_gate(pack, families: dict[str, dict]) -> tuple[dict[str, dict], list[str]]:
    """kit 声明的特效族必须按 ``EFFECT_FAMILIES`` 复制齐；每个复制基名的 timeline 在包内且 SE 全部可解析。"""
    import wf_seasonal7_common as C
    problems: list[str] = []
    for fam in EFFECT_FAMILIES:
        dst = f"battle/effect/skill_unique/{CODE}_{fam['dst_subdir']}"
        got = sorted((families.get(dst) or {}).get("copied_bases") or [])
        if got != sorted(fam["fx_names"]):
            problems.append(f"effect family {dst} copied_bases {got} != {sorted(fam['fx_names'])}")
    locate = sound_locator(pack)
    report: dict[str, dict] = {}
    for dst_dir, fam in families.items():
        for base in fam.get("copied_bases") or []:
            tl = f"{dst_dir}/{base}.timeline.amf3.deflate"
            if not pack.pkg_has("common", tl):
                problems.append(f"effect timeline missing in package: {tl}")
                continue
            resolved, probs = timeline_sound_report(C.amf_parse(pack.pkg_path("common", tl).read_bytes()), locate)
            report[tl] = resolved
            problems += [f"{tl}: {p}" for p in probs]
    return report, problems


# ---------------------------------------------------------------- 集成待办（语音/像素，Integrate 阶段）

SPEECH = "master/character/character_speech.orderedmap"
PIXEL_SHEETS = (f"character/{CODE}/pixelart/sprite_sheet.png", f"character/{CODE}/pixelart/special_sprite_sheet.png")


def integration_pending(speech_rows: list[list[str]], owners: dict[str, str], files,
                        pixel_content_problems: list[str] | None = None) -> dict[str, Any]:
    """kit 范围之外、发布前必须由 Integrate 装好的内容（只报告，不计入 kit 门禁 ``all_pass``）。

    - 语音：``wf_seasonal7_voice.SLOTS`` 22 条 ``character/<code>/voice/<slot>.mp3`` 全在包内且登记 owner=voice；
      speech 表 8 行、voice_path（c4）全部落在 home_0..5/ally 规划槽内（母本占位名如 ``home/a_au_konokakko`` 不算）；
      包内 voice 目录不再残留规划槽之外的文件（母本旧语音已删除）。
    - 像素：两张 sheet 在包内且登记 owner=pixel；给出 ``pixel_content_problems``（``pixel_problems`` 结果）时还须为空。
    ``owners``：``{"common:<logical>": owner}``；``files``：包内 common 根 ``character/<code>/`` 下的逻辑路径集合。
    """
    import wf_seasonal7_voice as V
    files = set(files)
    voice_logical = {slot: f"character/{CODE}/voice/{slot}.mp3" for slot in V.SLOTS}
    missing = [s for s, lg in voice_logical.items() if lg not in files]
    not_owned = [s for s, lg in voice_logical.items() if lg in files and owners.get(f"common:{lg}") != "voice"]
    planned_speech = set(V.SUBTITLE_SLOTS)
    outside = [r[4] if len(r) > 4 else repr(r) for r in speech_rows if len(r) <= 4 or r[4] not in planned_speech]
    left = sorted(lg for lg in files if lg.startswith(f"character/{CODE}/voice/")
                  and lg not in set(voice_logical.values()))
    voice = {"slots_expected": len(voice_logical), "slots_missing": missing, "slots_not_voice_owned": not_owned,
             "speech_rows": len(speech_rows), "speech_paths_outside_plan": outside,
             "template_voice_files_left": left}
    voice["clear"] = not missing and not not_owned and not outside and not left \
        and len(speech_rows) == len(planned_speech)
    pixel = {"sheets": {lg: (owners.get(f"common:{lg}") if lg in files else None) for lg in PIXEL_SHEETS}}
    if pixel_content_problems is not None:
        pixel["content_problems"] = list(pixel_content_problems)
    pixel["clear"] = all(o == "pixel" for o in pixel["sheets"].values()) and not pixel_content_problems
    return {"voice": voice, "pixel": pixel, "clear": voice["clear"] and pixel["clear"],
            "note": "kit 门禁 all_pass 只覆盖 kit 范围；clear=false 时包内仍有母本语音/speech/像素占位，不得发布"}


def package_integration_pending(pack) -> dict[str, Any]:
    import wf_seasonal7_common as C
    speech = C.csv_split(pack.pkg_flat(SPEECH).get(CID) or "") if pack.pkg_has("common", SPEECH) else []
    base = pack.pkg_path("common", f"character/{CODE}")
    common = (pack.package / "roots" / "common").resolve()
    files = {p.relative_to(common).as_posix() for p in base.rglob("*") if p.is_file()} if base.is_dir() else set()
    return integration_pending(speech, pack.owned_outputs(), files, pixel_problems(pack, pack.root))


# ---------------------------------------------------------------- 像素小人（Integrate 阶段）

PIXEL_DIR = f"{BATCH}/pixel/primula"
PIXEL_REVIEW_JSON = f"{BATCH}/pixel/_review/verify_all.json"
PIXEL_REVIEW_MD = f"{BATCH}/pixel/REVIEW.md"
# sheet 基名 → 同组元数据（atlas / frame / timeline），元数据保持母本（仅 character/<母本>/ 前缀由 assets 改写）
PIXEL_GROUPS = {
    "sprite_sheet": ("sprite_sheet.atlas.amf3.deflate", "pixelart.frame.amf3.deflate",
                     "pixelart.timeline.amf3.deflate"),
    "special_sprite_sheet": ("special_sprite_sheet.atlas.amf3.deflate", "special.frame.amf3.deflate",
                             "special.timeline.amf3.deflate"),
}


def _review_md_verdict(text: str) -> str | None:
    """REVIEW.md「修复轮复核」段里 ``#### primula …`` 标题的判定（PASS/FAIL…）；段或标题缺失返回 None。"""
    head = text.find("修复轮复核")
    if head < 0:
        return None
    for line in text[head:].splitlines():
        if line.startswith("#### ") and "primula" in line:
            return "PASS" if "PASS" in line and "FAIL" not in line else "FAIL"
    return None


def pixel_inputs(root: Path) -> tuple[dict[str, Path], list[str]]:
    """像素染色产物能否装包：report 门禁全过；verify_all primula ``pass`` 且 hard/declared 全过；
    REVIEW.md 修复轮复核判 PASS；``out/<sheet>.png`` 为真 PNG 且 sha = report outputs = 复核 H8 sha。

    返回 ``({sheet 基名: PNG 路径}, problems)``；problems 非空 = pending（不装包）。"""
    import wf_assets
    probs: list[str] = []
    base = root / PIXEL_DIR
    report_path, review_path, md_path = base / "report.json", root / PIXEL_REVIEW_JSON, root / PIXEL_REVIEW_MD
    if not report_path.is_file():
        return {}, [f"pixel report absent: {PIXEL_DIR}/report.json"]
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("key") != "primula" or report.get("gates_passed") is not True:
        probs.append(f"pixel report key={report.get('key')} gates_passed={report.get('gates_passed')}")
    failed = sorted(k for k, v in (report.get("gates") or {}).items() if not (isinstance(v, dict) and v.get("ok")))
    if failed or not report.get("gates"):
        probs.append(f"pixel report gates failed/absent: {failed}")
    review = json.loads(review_path.read_text(encoding="utf-8")).get("primula") if review_path.is_file() else None
    if not review:
        probs.append(f"pixel review verdict absent: {PIXEL_REVIEW_JSON}")
    else:
        hard_bad = sorted(k for k, v in (review.get("hard") or {}).items() if not v.get("ok"))
        decl_bad = sorted(k for k, v in (review.get("declared") or {}).items() if not v.get("ok"))
        if review.get("pass") is not True or hard_bad or decl_bad or not review.get("hard"):
            probs.append(f"pixel review failed: pass={review.get('pass')} hard={hard_bad} declared={decl_bad}")
    verdict = _review_md_verdict(md_path.read_text(encoding="utf-8")) if md_path.is_file() else None
    if verdict != "PASS":
        probs.append(f"REVIEW.md 修复轮复核 primula verdict={verdict}")
    reviewed = ((((review or {}).get("hard") or {}).get("H8_png_roundtrip") or {}).get("detail") or {})
    out: dict[str, Path] = {}
    for name in PIXEL_GROUPS:
        png = base / "out" / f"{name}.png"
        if not png.is_file():
            probs.append(f"pixel output missing: out/{name}.png")
            continue
        raw = png.read_bytes()
        if raw[:8] != wf_assets.PNG_REAL:
            probs.append(f"out/{name}.png is not a real PNG (magic {raw[:8].hex()})")
        digest = hashlib.sha256(raw).hexdigest()
        if ((report.get("outputs") or {}).get(name) or {}).get("sha256") != digest:
            probs.append(f"out/{name}.png sha256 != pixel report outputs")
        if (reviewed.get(name) or {}).get("sha256") != digest:
            probs.append(f"out/{name}.png sha256 != reviewed verify_all H8 sha")
        out[name] = png
    return out, probs


def pixel_problems(pack, root: Path, sheet_bytes: dict[str, bytes] | None = None) -> list[str]:
    """包内像素小人核对（只读）：sheet = 染色 PNG 的存储态原字节；尺寸/alpha = 母本 sheet；
    atlas/frame/timeline = 母本树（仅 ``character/<母本>/``→``character/<code>/``）；owner=pixel。"""
    import wf_assets
    import wf_seasonal7_common as C
    spec = pack.spec
    pngs, probs = pixel_inputs(root)
    if probs:
        return [f"pixel inputs not ready: {p}" for p in probs]
    prefix = C.dir_prefix_map(spec.template_code, spec.code)
    for name, metas in PIXEL_GROUPS.items():
        logical = f"character/{CODE}/pixelart/{name}.png"
        if sheet_bytes is not None and logical in sheet_bytes:
            raw = sheet_bytes[logical]
        elif pack.pkg_has("common", logical):
            raw = pack.pkg_path("common", logical).read_bytes()
        else:
            probs.append(f"package pixel sheet missing {logical}")
            continue
        if raw != wf_assets.png_encode(pngs[name].read_bytes()):
            probs.append(f"{logical} != store form of {PIXEL_DIR}/out/{name}.png")
        _r, donor_raw, _s = pack.template_asset(f"character/{spec.template_code}/pixelart/{name}.png")
        img, donor = C.png_open(raw), C.png_open(donor_raw)
        if img.size != donor.size:
            probs.append(f"{logical} size {img.size} != template {donor.size}")
        elif img.getchannel("A").tobytes() != donor.getchannel("A").tobytes():
            probs.append(f"{logical} alpha differs from template sheet")
        elif img.tobytes() == donor.tobytes():
            probs.append(f"{logical} still template colours")
        if sheet_bytes is None and pack.owner_of("common", logical) != "pixel":
            probs.append(f"{logical} owner={pack.owner_of('common', logical)} (expected pixel)")
        for meta in metas:
            pkg_meta = f"character/{CODE}/pixelart/{meta}"
            if not pack.pkg_has("common", pkg_meta):
                probs.append(f"package pixel metadata missing {pkg_meta}")
                continue
            _r, tpl_raw, _s = pack.template_asset(f"character/{spec.template_code}/pixelart/{meta}")
            want = C.replace_strings(C.amf_parse(tpl_raw), prefix)
            got = C.amf_parse(pack.pkg_path("common", pkg_meta).read_bytes())
            if got != want:
                probs.append(f"{pkg_meta} differs from template metadata (only character/ prefix may change)")
            if f"character/{spec.template_code}/" in repr(got):
                probs.append(f"{pkg_meta} still references character/{spec.template_code}/")
    return probs


def install_pixel(ctx) -> dict[str, Any]:
    """复核通过的像素 sheet 以存储态（小写魔数，PNG 字节不重编码）写入包，owner=pixel。

    幂等：字节相同 ``write_pkg`` 不改盘；产物未就绪时不写、返回 pending。写后 ``pixel_problems`` 非空即报错。"""
    import wf_assets
    pngs, probs = pixel_inputs(ctx.root)
    if probs:
        return {"status": "pending", "problems": probs, "sheets": {}}
    sheets = {}
    for name, png in pngs.items():
        logical = f"character/{CODE}/pixelart/{name}.png"
        raw = png.read_bytes()
        data = wf_assets.png_encode(raw)
        ctx.write_asset("common", logical, data, owner="pixel")
        sheets[logical] = {"source": f"{PIXEL_DIR}/out/{name}.png", "source_sha256": hashlib.sha256(raw).hexdigest(),
                           "store_sha256": hashlib.sha256(data).hexdigest()}
    after = pixel_problems(ctx.pack, ctx.root)
    if after:
        raise KitError(f"pixel sheets did not land in the package: {after}")
    return {"status": "installed", "problems": [], "sheets": sheets}


# ---------------------------------------------------------------- 图标

def draw_icon(frame) -> Any:
    """48×48：沿用官方固有图标外框 alpha 与白边，内底夜靛渐变，白色百合 + 金团扇。"""
    from PIL import Image, ImageDraw
    if frame.size != (48, 48):
        raise KitError(f"icon frame donor must be 48x48, got {frame.size}")
    K = 8
    N = 48 * K
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    top, bot = (40, 26, 92), (116, 70, 186)
    grad = Image.new("RGBA", (1, N))
    for y in range(N):
        t = y / (N - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    grad = grad.resize((N, N))
    inner = Image.new("L", (N, N), 0)
    ImageDraw.Draw(inner).rounded_rectangle((3 * K, 3 * K, 45 * K - 1, 45 * K - 1), radius=5 * K, fill=255)
    layer.paste(grad, (0, 0), inner)
    d = ImageDraw.Draw(layer)
    gold, gold_dk = (236, 192, 90, 255), (170, 118, 38, 255)
    fcx, fcy, fr = 32.0 * K, 21.5 * K, 10.0 * K
    hx, hy = fcx - 2.5 * K, fcy + fr - 1.5 * K
    d.line((hx, hy, fcx - 6.0 * K, fcy + fr + 9.5 * K), fill=gold_dk, width=int(2.4 * K))
    d.ellipse((fcx - fr, fcy - fr, fcx + fr, fcy + fr), fill=gold)
    for a in range(-160, -10, 30):
        ang = math.radians(a)
        d.line((hx, hy, fcx + fr * 0.9 * math.cos(ang), fcy + fr * 0.9 * math.sin(ang)),
               fill=gold_dk, width=int(1.1 * K))
    d.ellipse((fcx - fr, fcy - fr, fcx + fr, fcy + fr), outline=gold_dk, width=int(1.2 * K))
    lcx, lcy = 18.0 * K, 27.0 * K
    white, vein = (255, 255, 255, 255), (196, 168, 242, 255)
    for i in range(6):
        ang = math.radians(-90 + i * 60 + 10)
        length, width = 16.0 * K, 5.2 * K
        pts = [(s / 40 * length, width * math.sin(math.pi * s / 40) ** 0.8 * (1 - 0.35 * s / 40))
               for s in range(41)]
        poly = pts + [(x, -y) for x, y in reversed(pts)]
        ca, sa = math.cos(ang), math.sin(ang)
        d.polygon([(lcx + x * ca - y * sa, lcy + x * sa + y * ca) for x, y in poly], fill=white)
    for i in range(6):
        ang = math.radians(-90 + i * 60 + 10)
        d.line((lcx + 3.5 * K * math.cos(ang), lcy + 3.5 * K * math.sin(ang),
                lcx + 11.0 * K * math.cos(ang), lcy + 11.0 * K * math.sin(ang)), fill=vein, width=int(1.4 * K))
    for i in range(3):
        ang = math.radians(-50 + i * 50)
        sx, sy = lcx + 4.6 * K * math.cos(ang), lcy + 4.6 * K * math.sin(ang)
        d.line((lcx, lcy, sx, sy), fill=gold_dk, width=int(0.9 * K))
        d.ellipse((sx - 1.5 * K, sy - 1.5 * K, sx + 1.5 * K, sy + 1.5 * K), fill=gold)
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


# ---------------------------------------------------------------- 特效 sheet 钩子（Effects 阶段）

def fx_sheet_overrides(root: Path) -> dict[str, Path]:
    """``fx/primula/out/manifest.json`` → {源（或目标）sheet 逻辑路径: 染色 PNG 文件}。

    接受 ``{logical: file}``、``{"sheets": {...}}``、``[{"source"/"logical": …, "png"/"file"/"path": …}]``；
    文件路径可为绝对、相对 manifest 目录或相对仓库根。不存在返回 {}。
    """
    path = root / FX_MANIFEST
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("sheets"), (dict, list)):
        data = data["sheets"]
    pairs: list[tuple[str, str]] = []
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, dict):
                v = v.get("png") or v.get("file") or v.get("path")
            if isinstance(k, str) and k.endswith(".png") and isinstance(v, str):
                pairs.append((k, v))
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                k = item.get("source") or item.get("logical") or item.get("src")
                v = item.get("png") or item.get("file") or item.get("path")
                if isinstance(k, str) and k.endswith(".png") and isinstance(v, str):
                    pairs.append((k, v))
    out: dict[str, Path] = {}
    for logical, file in pairs:
        cand = [Path(file), path.parent / file, root / file]
        hit = next((c for c in cand if c.is_absolute() and c.is_file()), None) \
            or next((c for c in cand[1:] if c.is_file()), None)
        if hit is None:
            raise KitError(f"fx manifest sheet file missing: {logical} -> {file}")
        out[logical] = hit
    return out


def fx_store_bytes(file: Path) -> bytes:
    """染色 PNG 的存储态原字节：真 PNG → 小写魔数（不经 PIL 重编码）；已是存储态原样返回。"""
    import wf_assets
    raw = file.read_bytes()
    if raw[:8] == wf_assets.PNG_FAKE:
        return raw
    if raw[:8] != wf_assets.PNG_REAL:
        raise KitError(f"fx override is not a PNG: {file} (magic {raw[:8].hex()})")
    return wf_assets.png_encode(raw)


def family_sheets() -> dict[str, str]:
    """{母本 sheet 逻辑路径: 包内克隆 sheet 逻辑路径}（sibling 形态）。"""
    out = {}
    for fam in EFFECT_FAMILIES:
        donor = fam["src_dir"].rsplit("/", 1)[-1]
        dst_dir = f"battle/effect/skill_unique/{CODE}_{fam['dst_subdir']}"
        out[f"{fam['src_dir']}/{donor}.png"] = f"{dst_dir}/{dst_dir.rsplit('/', 1)[-1]}.png"
    return out


def fx_sheet_problems(pack, root: Path, sheet_bytes: dict[str, bytes] | None = None) -> list[str]:
    """fx manifest 存在时：每张克隆 sheet 字节 = 对应染色 PNG 存储态；尺寸/alpha = 母本 sheet；owner=effects。
    manifest 不存在返回 ``[]``（克隆 sheet 保持官方原色是合法草稿态）；manifest 未覆盖某张 sheet 记问题。"""
    import wf_seasonal7_common as C
    overrides = fx_sheet_overrides(root)
    if not overrides:
        return []
    probs = []
    for src, dst in family_sheets().items():
        file = overrides.get(src) or overrides.get(dst)
        if file is None:
            probs.append(f"fx manifest does not cover {src}")
            continue
        if sheet_bytes is not None and dst in sheet_bytes:
            raw = sheet_bytes[dst]
        elif pack.pkg_has("common", dst):
            raw = pack.pkg_path("common", dst).read_bytes()
        else:
            probs.append(f"package effect sheet missing {dst}")
            continue
        if raw != fx_store_bytes(file):
            same_px = C.png_open(raw).tobytes() == C.png_open(fx_store_bytes(file)).tobytes()
            probs.append(f"{dst} bytes != store form of {file.name}" + (" (pixels equal: re-encoded)" if same_px else ""))
        _r, donor_raw, _s = pack.template_asset(src)
        img, donor = C.png_open(raw), C.png_open(donor_raw)
        if img.size != donor.size or img.getchannel("A").tobytes() != donor.getchannel("A").tobytes():
            probs.append(f"{dst} size/alpha differs from donor {src}")
        if sheet_bytes is None and pack.owner_of("common", dst) != "effects":
            probs.append(f"{dst} owner={pack.owner_of('common', dst)} (expected effects)")
    return probs


def _override_transform(file: Path, label: str):
    from PIL import Image
    import wf_assets

    def transform(img):
        raw = file.read_bytes()
        new = Image.open(io.BytesIO(wf_assets.png_decode(raw))).convert("RGBA")
        if new.size != img.size:
            raise KitError(f"fx override {label} size {new.size} != source sheet {img.size} (atlas rects)")
        src_clear = img.getchannel("A").histogram()[0]
        new_clear = new.getchannel("A").histogram()[0]
        if src_clear and new_clear * 2 < src_clear:
            raise KitError(f"fx override {label} lost transparency: alpha==0 pixels {new_clear} vs source {src_clear}")
        return new
    return transform


# ---------------------------------------------------------------- 摘要（kit 产物是否变化）

def kit_digest(pack) -> str:
    import wf_mod_tool as core
    import wf_seasonal7_common as C
    parts: dict[str, Any] = {}

    def flat(logical, keys):
        if not pack.pkg_has("common", logical):
            return None
        rows = pack.pkg_flat(logical)
        return {k: rows.get(k) for k in keys}

    parts["ability"] = flat(ABILITY, [f"{CID}{i}" for i in range(1, 7)])
    parts["leader"] = flat(LEADER, [CID])
    parts["unique"] = flat(UNIQUE, [UID])
    parts["text"] = flat(TEXT, [CID])
    char = flat(CHAR, [CID])
    parts["route"] = C.csv_split(char[CID])[0][9:17] if char and char.get(CID) else None
    for logical, outer in ((ACTION, CODE), (SWITCHED, VOICE_READY)):
        if pack.pkg_has("common", logical):
            nested = core.load_nested_table_bytes(pack.pkg_path("common", logical).read_bytes(), logical)
            parts[logical] = nested.rows[outer].text_rows() if outer in nested.rows else None
    owned = {}
    for key, rec in sorted(pack._owned_raw().items()):
        if rec.get("owner") in ("kit", "effects"):
            root, logical = key.split(":", 1)
            if rec.get("owner") == "effects" and logical.endswith(".png"):
                continue        # 染色 sheet 只换像素（尺寸/透明度由钩子断言），不影响结构门禁
            path = pack.pkg_path(root, logical)
            owned[key] = C.sha256(path.read_bytes()) if path.is_file() else None
    parts["files"] = owned
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- 行门禁

def row_gates(kind: str, rows: list[list[str]]) -> dict[str, Any]:
    import wf_client_legality as LG
    import wf_describe
    lines = []
    caps: list[str] = []
    ok = True
    descs = wf_describe.describe_rows(rows, kind)
    for row, desc in zip(rows, descs):
        probs = LG.client_legality_problems(kind, row) + LG.declared_block_field_problems(kind, row)
        elem = LG.ability_element_column_problems(kind, row, ELEMENT) if kind == "ability" else []
        need = LG.required_client_capabilities(kind, row)
        inv = LG.invoke_skill_string_problems(row, frozenset(), kind)
        ok &= not probs and not elem and not inv
        caps += [c for c in need if c not in caps]
        lines.append({"describe": desc, "legality": probs, "element": elem, "invoke_skill_string": inv,
                      "required_capabilities": need, "ncols": len(row), "c0": row[0]})
    return {"ok": ok, "rows": lines, "required_capabilities": caps}


# ---------------------------------------------------------------- build

def build(ctx) -> dict[str, Any]:
    import wf_seasonal7_common as C
    import wf_mod_tool as core
    spec = ctx.spec
    pack = ctx.pack
    if (spec.cid_s, spec.code) != (CID, CODE):
        raise KitError(f"kit bound to {CID}/{CODE}, spec is {spec.cid_s}/{spec.code}")
    root = ctx.root
    design = _load_json(root, DESIGN_JSON)
    notes: list[str] = []
    problems: list[str] = []

    # ---- 行
    leader_rows = build_leader_rows(pack)
    ability_rows = build_ability_rows(pack)
    unique_row = build_unique_row(pack)
    action_rows = build_action_rows(pack)
    trow = text_row()
    if design is not None:
        want_leader = [r["row"] for r in design["leader"]]
        if leader_rows != want_leader:
            problems.append("leader rows differ from design")
        for slot in range(1, 7):
            want = [r["row"] for r in design["abilities"][f"slot{slot}"]]
            if ability_rows[f"{CID}{slot}"] != want:
                problems.append(f"ability slot{slot} rows differ from design")
        if unique_row != design["unique_conditions"][0]["row"]:
            problems.append("unique_condition row differs from design")
        if trow != design["text"]["character_text_row"]:
            problems.append("character_text row differs from design")
        for level, edits in (("1", design["skills"]["action_skill_edits"]["inner1"]),
                             ("2", design["skills"]["action_skill_edits"]["inner2"])):
            for col, val in edits.items():
                if action_rows[level][int(col)] != val:
                    problems.append(f"action_skill {level} c{col} differs from design")
        if design["identity"]["character_row_edits"] and \
                [design["identity"]["character_row_edits"][str(c)] for c in range(9, 17)] != ROUTE_COLS:
            problems.append("voice route differs from design")
    else:
        notes.append("design JSON absent: rows not cross-checked against design")

    leader_gate = row_gates("leader_ability", leader_rows)
    ability_gate = row_gates("ability", [r for key in sorted(ability_rows) for r in ability_rows[key]])
    if not leader_gate["ok"] or not ability_gate["ok"]:
        problems.append("row legality problems (see kit-gates evidence)")

    ctx.write_flat(LEADER, {CID: leader_rows})
    ctx.write_flat(ABILITY, ability_rows)
    ctx.write_flat(UNIQUE, {UID: [unique_row]})
    ctx.write_flat(TEXT, {CID: [trow]})
    crow = list(pack.pkg_character_row())
    if crow[9] not in ("(None)",) and crow[9:17] != ROUTE_COLS:
        raise KitError(f"character c9-c16 holds an unrelated skill switch: {crow[9:17]}")
    crow[9:17] = ROUTE_COLS
    ctx.write_flat(CHAR, {CID: [crow]})

    # ---- 图标
    frame_loc = pack.live_locate(ICON_FRAME_DONOR)
    frame_raw = pack.official_read(ICON_FRAME_DONOR) or (frame_loc[1].read_bytes() if frame_loc else None)
    if frame_raw is None:
        raise KitError(f"icon frame donor missing: {ICON_FRAME_DONOR}")
    icon = draw_icon(C.png_open(frame_raw))
    icon_bytes = C.png_store_bytes(icon)
    ctx.write_asset("common", ICON_LOGICAL, icon_bytes)

    # ---- 特效族
    overrides = fx_sheet_overrides(root)
    families = []
    fx_applied = {}
    for fam in EFFECT_FAMILIES:
        donor = fam["src_dir"].rsplit("/", 1)[-1]
        src_sheet = f"{fam['src_dir']}/{donor}.png"
        dst_dir = f"battle/effect/skill_unique/{CODE}_{fam['dst_subdir']}"
        dst_sheet = f"{dst_dir}/{dst_dir.rsplit('/', 1)[-1]}.png"
        file = overrides.get(src_sheet) or overrides.get(dst_sheet)
        transform = _override_transform(file, src_sheet) if file is not None else None
        if file is not None:
            fx_applied[src_sheet] = {"file": str(file), "sha256": C.sha256(file.read_bytes())}
        result = ctx.clone_effect_family(fam["src_dir"], fam["dst_subdir"], fam["fx_names"],
                                         layout=fam["layout"], png_transform=transform)
        if result["missing_effects"]:
            raise KitError(f"effect family {donor} missing effects {result['missing_effects']}")
        if sorted(result["copied_bases"]) != sorted(fam["fx_names"]):
            raise KitError(f"effect family {donor} copied {result['copied_bases']} != {fam['fx_names']}")
        if file is not None:
            # 框架 clone 经 png_store_bytes 以 PIL 重编码写 sheet（逐像素等于染色 PNG，但字节不同）；
            # 这里改写为染色 PNG 的存储态原字节，使包内 sha = 复核过的产物存储态 sha。
            sheet_root = next(f["root"] for f in result["files"] if f["target"] == dst_sheet)
            exact = fx_store_bytes(file)
            if C.png_open(exact).tobytes() != C.png_open(pack.pkg_path(sheet_root, dst_sheet).read_bytes()).tobytes():
                raise KitError(f"fx store bytes decode differently from png_transform output: {dst_sheet}")
            ctx.write_asset(sheet_root, dst_sheet, exact, owner="effects")
            fx_applied[src_sheet].update({"target": dst_sheet, "root": sheet_root, "store_sha256": C.sha256(exact)})
        families.append(result)
    if not overrides:
        notes.append("fx/primula/out/manifest.json 不存在：特效 sheet 仍为官方原色（Effects 阶段染色后重跑 kit）")
    else:
        unused = sorted(set(overrides) - set(fx_applied) - set(family_sheets().values()))
        if unused:
            notes.append(f"fx manifest entries not matching any cloned sheet: {unused}")
    fx_problems_sheets = fx_sheet_problems(pack, root)
    if fx_problems_sheets:
        problems.append(f"effect sheet problems: {fx_problems_sheets}")

    # ---- 像素小人（复核通过的染色 sheet，owner=pixel；未就绪时不写，报 pending）
    pixel = install_pixel(ctx)
    ctx.evidence_write("pixel-report.json", {
        "summary": ("像素小人染色 sheet 2 张已按存储态装包（owner=pixel，atlas/frame/timeline 保持母本）"
                    if pixel["status"] == "installed" else "像素小人仍为母本原色（染色产物未就绪）"),
        "status": pixel["status"], "mode": "recolor-lut (seasonal7 pixel/primula)", **pixel})

    # ---- 技能树
    sig = _load_json(root, OFFICIAL_SIG)
    programs, tree_reports = [], {}
    for level in ("1", "2"):
        tree, log = compose_tree(pack, level)
        refs_total = {}
        for fam in families:
            tree, refs = ctx.rewrite_effect_refs(tree, fam, strict=True)
            refs_total[fam["dst_dir"]] = refs
        checks = tree_checks(tree, sig)
        want = _load_json(root, DESIGN_TREES[level])
        checks["equals_design_prototype"] = None if want is None else want == tree
        checks["equals_design_prototype_typed"] = None if want is None else _typed(want) == _typed(tree)
        if want is not None and want != tree:
            problems.append(f"skill tree {level} differs from design prototype")
        if not checks["ok"]:
            problems.append(f"skill tree {level} static checks failed")
        logical = ctx.write_dsl(ctx.program_path(level), tree)
        programs.append(logical)
        tree_reports[level] = {"logical": logical, "edits": len(log), "effect_refs": refs_total,
                               "checks": checks, "edit_log": log}

    # ---- action_skill / switched_action_skill
    ctx.write_nested(ACTION, CODE, {lv: [row] for lv, row in action_rows.items()}, replace_inner=True)
    switched = {lv: [row[7:24]] for lv, row in action_rows.items()}
    if any(len(r[0]) != 17 for r in switched.values()):
        raise KitError("switched_action_skill rows must be 17 cells (action_skill c7..c23)")
    ctx.write_nested(SWITCHED, VOICE_READY, switched, replace_inner=True)

    # ---- 未使用的框架克隆键（custom_ability_string）
    unclaimed = []
    claims = pack.load_claims()
    cas_claim = next((c for c in claims if (c["root"], c["logical_path"]) == ("common", CAS)), None)
    if cas_claim:
        referenced = {cell for rows in ability_rows.values() for r in rows for cell in r} \
            | {cell for r in leader_rows for cell in r}
        stale = [k for k in cas_claim["outer_keys"] if k not in referenced]
        if stale:
            unclaimed.append(ctx.unclaim(CAS, stale))

    mirrors = ctx.sync_character_mirrors()
    if mirrors["character"][9:17] != ROUTE_COLS:
        raise KitError("character mirror lost voice route")

    # ---- 引用可解析（包内或 live）
    ref_problems = []
    for level, rep in tree_reports.items():
        for p in rep["checks"]["effect_paths"]:
            for ext in (".parts.amf3.deflate", ".timeline.amf3.deflate"):
                lg = p + ext
                if not any(pack.pkg_has(r, lg) for r in C.CLIENT_ROOTS) and pack.live_locate(lg) is None:
                    ref_problems.append(lg)
    for level, row in action_rows.items():
        if not pack.pkg_has("common", C.wf_dsl.dsl_logical(row[7])):
            ref_problems.append(f"action_skill {level} program not in package: {row[7]}")
    if not pack.pkg_has("common", ICON_LOGICAL):
        ref_problems.append(ICON_LOGICAL)
    if ref_problems:
        problems.append(f"unresolved references: {ref_problems[:10]}")
    # 克隆特效 timeline 内嵌 SE（预载引用）
    fx_sounds, fx_problems = effect_timeline_gate(pack, {f["dst_dir"]: f for f in families})
    if fx_problems:
        problems.append(f"effect timeline problems: {fx_problems[:10]}")

    # 集成待办（kit 范围外，只进 kit-gates/gates 证据与步骤输出；不写 kit-report notes，
    # 否则 Integrate 装完后 manifest snapshot 会带着过期提示被封存）
    integration = package_integration_pending(pack)

    caps = sorted(set(leader_gate["required_capabilities"]) | set(ability_gate["required_capabilities"]))
    static_ok = not problems
    digest = kit_digest(pack)
    gates = _load_json(root, GATES_FILE)
    gates_ok = bool(isinstance(gates, dict) and gates.get("all_pass") and gates.get("kit_digest") == digest)
    status = "ready-for-review" if static_ok and gates_ok else "draft"
    if static_ok and not gates_ok:
        notes.append("静态门禁通过；等待离线门禁（python mod-tools/wf_seasonal7_kit_primula.py gates）")

    kit_gates = {"leader": leader_gate, "ability": ability_gate, "trees": tree_reports,
                 "unresolved_references": ref_problems, "problems": problems, "static_ok": static_ok,
                 "kit_digest": digest, "fx_sheet_overrides": fx_applied, "unclaimed": unclaimed,
                 "effect_timeline_sounds": fx_sounds, "effect_timeline_problems": fx_problems,
                 "effect_sheet_problems": fx_problems_sheets, "pixel": pixel,
                 "integration_pending": integration}
    ctx.evidence_write("kit-gates.json", kit_gates)
    panel = [f"队长{i + 1}：{r['describe']}" for i, r in enumerate(leader_gate["rows"])]
    idx = 0
    for slot in range(1, 7):
        for n in range(len(ability_rows[f"{CID}{slot}"])):
            panel.append(f"能力{slot}#{n + 1}：{ability_gate['rows'][idx]['describe']}")
            idx += 1
    ctx.report({
        "summary": "普莉姆拉·浴衣 kit：官方 donor 行 6+11、百合夜固有 16999201、两棵拼装技能树、两个 sibling 特效族、贯通语音路由",
        "status": status,
        "skills": {"programs": programs},
        "unique_condition": {UID: {"icon": ICON_LOGICAL, "name": "百合夜", "max_accumulation": 10}},
        "required_capabilities": caps,
        "panel": panel,
        "notes": notes + [f"problem: {p}" for p in problems],
        "kit_digest": digest,
    })
    return {"status": status, "static_ok": static_ok, "problems": problems, "programs": programs,
            "required_capabilities": caps, "kit_digest": digest, "fx_overrides": sorted(fx_applied),
            "effect_dirs": [f["dst_dir"] for f in families], "unclaimed": unclaimed,
            "effect_timeline_problems": fx_problems, "effect_sheet_problems": fx_problems_sheets,
            "pixel": pixel["status"], "pixel_problems": pixel["problems"],
            "integration_clear": integration["clear"]}


# ---------------------------------------------------------------- 离线门禁（manifest/status/inspect 之后）

def run_gates(write_status: bool = True) -> dict[str, Any]:
    import wf_client_legality as LG
    import wf_describe
    import wf_dsl
    import wf_mod_tool as core
    import wf_seasonal7_common as C
    import wf_seasonal7_specs as S
    import wf_seasonal7_voice as V
    spec = S.get_spec("primula")
    pack = C.S7Pack(spec)
    root = pack.root
    gates: dict[str, Any] = {"character": "primula", "cid": CID, "code": CODE}
    failures: list[str] = []

    # 包内全部本角色 ability/leader 行（从包字节读）
    abil = pack.pkg_flat(ABILITY)
    lead = pack.pkg_flat(LEADER)
    ability_rows = [r for i in range(1, 7) for r in C.csv_split(abil[f"{CID}{i}"])]
    leader_rows = C.csv_split(lead[CID])
    ag, lg_ = row_gates("ability", ability_rows), row_gates("leader_ability", leader_rows)
    gates["rows"] = {"ability": ag, "leader_ability": lg_,
                     "counts": {"leader": len(leader_rows), "ability": len(ability_rows)}}
    if not (ag["ok"] and lg_["ok"]):
        failures.append("row legality")
    if (len(leader_rows), len(ability_rows)) != (6, 11):
        failures.append(f"row counts {len(leader_rows)}/{len(ability_rows)} != 6/11")
    # 对照 kit 方案（官方 donor 重建）
    if leader_rows != build_leader_rows(pack):
        failures.append("package leader rows != kit plan")
    plan = build_ability_rows(pack)
    if [r for k in sorted(plan) for r in plan[k]] != ability_rows:
        failures.append("package ability rows != kit plan")
    uniq = C.csv_split(pack.pkg_flat(UNIQUE)[UID])[0]
    gates["unique_condition"] = {"row": uniq, "max_accumulation": uniq[4]}
    if uniq != build_unique_row(pack):
        failures.append("unique_condition row != kit plan")

    # 技能树（从包字节读）
    sig = _load_json(root, OFFICIAL_SIG)
    gates["trees"] = {}
    for level in ("1", "2"):
        logical = wf_dsl.dsl_logical(f"battle/action/skill/action/rare5/{CODE}${CODE}_{level}")
        tree = C.amf_parse(pack.pkg_path("common", logical).read_bytes())
        checks = tree_checks(tree, sig)
        want = _load_json(root, DESIGN_TREES[level])
        checks["equals_design_prototype"] = None if want is None else (want == tree)
        resolved = {}
        for p in checks["effect_paths"]:
            for ext in (".parts.amf3.deflate", ".timeline.amf3.deflate"):
                lgc = p + ext
                where = next((r for r in C.CLIENT_ROOTS if pack.pkg_has(r, lgc)), None)
                resolved[lgc] = f"package:{where}" if where else ("live" if pack.live_locate(lgc) else None)
        checks["effect_resolution"] = resolved
        gates["trees"][level] = checks
        if not checks["ok"] or checks["equals_design_prototype"] is False or not all(resolved.values()):
            failures.append(f"tree {level}")

    # 特效 timeline 内嵌 SE（预载引用，解析失败＝数据不足）/ parts 纹理
    fams = pack.read_evidence("effect-families.json", {}) or {}
    fx, fx_problems = effect_timeline_gate(pack, fams)
    gates["effect_timeline_sounds"] = fx
    gates["effect_timeline_problems"] = fx_problems
    failures += [f"effect timeline: {p}" for p in fx_problems]
    sheets = {}
    for dst_dir, fam in fams.items():
        name = dst_dir.rsplit("/", 1)[-1]
        sheet = f"{dst_dir}/{name}.png"
        donor = f"{fam['src_dir']}/{fam['donor']}.png"
        if not pack.pkg_has("common", sheet):
            failures.append(f"effect sheet missing {sheet}")
            continue
        new = C.png_open(pack.pkg_path("common", sheet).read_bytes())
        _r, src_raw, _s = pack.template_asset(donor)
        src = C.png_open(src_raw)
        clear = (new.getchannel("A").histogram()[0], src.getchannel("A").histogram()[0])
        sheets[sheet] = {"size": list(new.size), "donor_size": list(src.size), "alpha0": clear[0],
                         "donor_alpha0": clear[1], "sha256": C.sha256(pack.pkg_path("common", sheet).read_bytes()),
                         "recolored": new.tobytes() != src.tobytes()}
        if new.size != src.size or (clear[1] and clear[0] * 2 < clear[1]):
            failures.append(f"effect sheet shape/alpha {sheet}")
    gates["effect_sheets"] = sheets
    fx_manifest_present = bool(fx_sheet_overrides(root))
    sheet_probs = fx_sheet_problems(pack, root)
    gates["effect_sheet_recolor"] = {"fx_manifest": FX_MANIFEST if fx_manifest_present else None,
                                     "store_bytes_equal": fx_manifest_present and not sheet_probs,
                                     "problems": sheet_probs}
    failures += [f"effect sheet: {p}" for p in sheet_probs]
    icon_raw = pack.pkg_path("common", ICON_LOGICAL).read_bytes() if pack.pkg_has("common", ICON_LOGICAL) else b""
    icon_ok = False
    if icon_raw[:4] == b"\x89png":
        icon = C.png_open(icon_raw)
        frame = C.png_open(pack.official_read(ICON_FRAME_DONOR) or pack.live_read(ICON_FRAME_DONOR))
        icon_ok = icon.size == (48, 48) and icon.getchannel("A").tobytes() == frame.getchannel("A").tobytes()
    gates["unique_icon"] = {"logical": ICON_LOGICAL, "store_magic": icon_raw[:4].hex(), "ok": icon_ok,
                            "sha256": C.sha256(icon_raw) if icon_raw else None}
    if not icon_ok:
        failures.append("unique_condition icon")

    # action_skill / switched / 路由 / 文本
    action = core.load_nested_table_bytes(pack.pkg_path("common", ACTION).read_bytes(), ACTION).rows[CODE].text_rows()
    action = {k: C.csv_split(v)[0] for k, v in action.items()}
    switched = core.load_nested_table_bytes(pack.pkg_path("common", SWITCHED).read_bytes(), SWITCHED) \
        .rows[VOICE_READY].text_rows()
    switched = {k: C.csv_split(v)[0] for k, v in switched.items()}
    crow = pack.pkg_character_row()
    trow = pack.pkg_character_text_row()
    route = V.normalize_route(ROUTE_COLS, CODE)
    gates["action_skill"] = {"rows": action, "switched": switched, "route": crow[9:17]}
    if action != build_action_rows(pack):
        failures.append("action_skill rows != kit plan")
    if switched != V.switched_rows(action):
        failures.append("switched_action_skill rows != voice tool convention")
    if crow[9:17] != route:
        failures.append("character c9-c16 != voice route")
    if trow != text_row():
        failures.append("character_text row != design")
    server = json.loads(pack.pkg_path("server", "cdndata/character.json").read_bytes())[CID][0]
    if server != crow:
        failures.append("server cdndata/character.json mirror != package character row")

    # describe 全部行存档
    gates["describe"] = {
        "leader_ability": wf_describe.describe_rows(leader_rows, "leader_ability"),
        "ability": {f"{CID}{i}": wf_describe.describe_rows(C.csv_split(abil[f'{CID}{i}']), "ability")
                    for i in range(1, 7)},
    }

    # manifest / status / inspect
    manifest = json.loads((pack.package / "manifest.json").read_text(encoding="utf-8"))
    needed = sorted(set(ag["required_capabilities"]) | set(lg_["required_capabilities"]))
    declared = sorted(manifest.get("required_capabilities") or [])
    gates["capabilities"] = {"needed_by_rows": needed, "manifest": declared}
    if declared != needed:
        failures.append(f"manifest required_capabilities {declared} != rows {needed}")
    if manifest.get("unique_condition", {}).get(UID, {}).get("icon") != ICON_LOGICAL:
        failures.append("manifest unique_condition icon missing")
    mrep = pack.read_evidence("manifest_report.json", {}) or {}
    gates["manifest_report"] = {k: mrep.get(k) for k in ("validate_manifest", "reconcile", "required",
                                                          "missing_required", "manifest_errors",
                                                          "three_layer_claim_status", "manifest_sha256")}
    if mrep.get("validate_manifest") or any((mrep.get("reconcile") or {}).values()) \
            or mrep.get("missing_required") or mrep.get("manifest_errors"):
        failures.append("manifest report")
    status = pack.read_evidence("flow-status.json", {}) or {}
    gates["flow_status"] = {"ok": status.get("ok"), "errors": status.get("errors")}
    if status.get("ok") is False or status.get("errors"):
        failures.append("flow status")
    inspect = (pack.read_evidence("flow-inspect.json", {}) or {}).get("summary") or {}
    master = inspect.get("master_reference") or {}
    gates["inspect"] = {"returncode": inspect.get("returncode"), "structurally_ready": inspect.get("structurally_ready"),
                        "master_reference": master, "preflight": inspect.get("preflight"),
                        "chain": inspect.get("chain")}
    if master.get("problems") != [] or master.get("missing") not in ([], None) or not inspect.get("structurally_ready"):
        failures.append("inspect master_reference / structural readiness")
    if ((inspect.get("preflight") or {}).get("conflicts")):
        failures.append("inspect conflicts")

    digest = kit_digest(pack)
    kit_report = pack.read_evidence("kit-report.json", {}) or {}
    kit_gates = pack.read_evidence("kit-gates.json", {}) or {}
    if kit_gates.get("kit_digest") != digest or kit_report.get("kit_digest") != digest:
        failures.append("kit evidence stale (kit_digest changed since kit step)")
    if not kit_gates.get("static_ok"):
        failures.append("kit static gates")
    # manifest 须是当前盘面（kit/像素/语音写盘后必须重跑 manifest）
    import wf_seasonal7_manifest as M
    disk = {name: {e["logical_path"]: e["sha256"] for e in entries} for name, entries in M.scan_roots(pack).items()}
    listed = {name: {e["logical_path"]: e["sha256"] for e in (manifest.get("roots") or {}).get(name, [])}
              for name in disk}
    stale = sorted(f"{n}:{lg}" for n in disk for lg in set(disk[n]) | set(listed[n])
                   if disk[n].get(lg) != listed[n].get(lg))
    gates["manifest_roots_current"] = {"ok": not stale, "stale": stale[:20], "files": sum(map(len, disk.values()))}
    if stale:
        failures.append(f"manifest roots stale vs disk ({len(stale)}): rerun --step manifest")

    # 集成待办（语音 22 条 + speech 8 行 + 像素 2 张）：只报告，不计入 all_pass；发布前必须 clear
    integration = package_integration_pending(pack)
    gates["integration_pending"] = integration
    # 语音装包回执（impl/primula/voice_merge.py 写 evidence/voice-report.json）
    vrep = pack.read_evidence("voice-report.json", {}) or {}
    planned_voice = {f"character/{CODE}/voice/{s}.mp3" for s in V.SLOTS}
    vprobs = []
    if vrep.get("status") != "packed":
        vprobs.append(f"voice-report status={vrep.get('status')}")
    rep_assets = {a.get("logical_path"): a.get("sha256") for a in vrep.get("assets") or []}
    if set(rep_assets) != planned_voice:
        vprobs.append("voice-report assets != 22 planned slots")
    for lg, want in sorted(rep_assets.items()):
        if not pack.pkg_has("common", lg) or C.sha256(pack.pkg_path("common", lg).read_bytes()) != want:
            vprobs.append(f"voice file drifted from voice-report: {lg}")
    manifest_voice = sorted(lg for lg in listed.get("common", {}) if lg.startswith(f"character/{CODE}/voice/"))
    if manifest_voice != sorted(planned_voice):
        vprobs.append(f"manifest voice entries != 22 planned slots: {sorted(set(manifest_voice) ^ planned_voice)[:8]}")
    if trow[11] != V.VOICE_ACTOR:
        vprobs.append(f"character_text c11={trow[11]!r} != {V.VOICE_ACTOR}")
    gates["voice_report"] = {"status": vrep.get("status"), "run": vrep.get("run"), "problems": vprobs}
    gates.update({"kit_digest": digest, "failures": failures, "all_pass": not failures,
                  "release_ready_after_integration": bool(not failures and integration["clear"] and not vprobs)})
    out = root / GATES_FILE
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(gates, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if write_status and kit_report:
        kit_report["status"] = "ready-for-review" if not failures else "draft"
        pack.write_evidence("kit-report.json", kit_report)
    return {"all_pass": not failures, "failures": failures, "gates_file": str(out),
            "kit_status": kit_report.get("status"), "integration_clear": integration["clear"],
            "pixel_clear": integration["pixel"]["clear"], "voice_clear": integration["voice"]["clear"],
            "voice_report_problems": vprobs,
            "release_ready_after_integration": gates["release_ready_after_integration"]}


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if len(sys.argv) > 1 and sys.argv[1] == "gates":
        print(json.dumps(run_gates(), ensure_ascii=False, indent=1))
    else:
        print(__doc__)
