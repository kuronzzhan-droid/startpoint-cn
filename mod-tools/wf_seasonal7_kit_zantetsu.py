# -*- coding: utf-8 -*-
"""季节换装 kit：斩铁·白梅（159998 ``samurai_robot_plum``，光/剑士/Attacker，表母本 151117）。

设计真源：``work/character_packs/seasonal7-20260916/design/zantetsu.json``（status=final）。
本模块按设计逐行回放 donor 行 + 列级 edits（donor 取官方基线 1.4.54，live 自制行取 live），
逐格断言与设计 ``row_final`` 相同后落包；两棵技能树从官方 131044 + 151117 两棵树重新拼装
（不直接吃设计里的 composed_tree，只拿它做逐节点对照），并自行复跑静态门禁。

主控拍板覆盖（优先于设计文件）：
- 词条槽 4 第 1 条的 112（全表零先例）不上，改用设计预置退路 F1：507「自身 光属性抗性降低中的
  敌人 攻击特攻 60%→120%」（``fallbacks.slot4_rec1_if_112_fails__F1_507``），面板文案随之调整。
- 设计里「需要作者拍板」的项一律取设计默认值（c27=自身、语音路由 kind3、旧版小人造型照用）。

写入边界：只写 ``work/character_packs/s7-zantetsu/`` 与 ``seasonal7-20260916/impl/zantetsu/``；
不发布、不重锚、不写 live store / assets / .cdn / src。

用法（Integrate / 发布前固定顺序）::

    python mod-tools/wf_seasonal7_build.py --char zantetsu --step tables,kit,assets,manifest,status,inspect
    python mod-tools/wf_seasonal7_kit_zantetsu.py gates     # 离线门禁 → impl/zantetsu/gates.json；
                                                           # 全过才把 kit-report 置 ready-for-review
    python mod-tools/wf_seasonal7_build.py --char zantetsu --step manifest,status   # 刷新 manifest 快照
    python mod-tools/wf_seasonal7_kit_zantetsu.py gates     # preflight/publish 前最后一次，必须 all_pass

- ``kit`` 必须排在 ``tables`` 之后：框架 tables 每次都按母本 151117 重写 character_stance_detail
  （``,1,1,1,,1,1,1``），kit 才能写回设计值 ``,1,"1,5",1,,1,"1,5",1``。单独重跑 tables 后必须再跑 kit；
  manifest/status/inspect 看不出这一行，只有本模块 ``gates`` 能拦（stance_detail + 指纹逐项差异）。
- 像素或特效任一重跑：像素定稿 → ``fx/zantetsu`` 下 ``python fx_recolor_zantetsu.py gate`` → ``--step kit`` → ``gates``。
  ``gates`` 的 doll_colors 门禁逐色核对特效 sheet 小人帧与像素小人（pixel/out 与包内已装像素）同色。

Integrate（媒体整合，幂等）：
- 特效：fx manifest 存在时经 ``png_transform`` 克隆，再把 sheet 改写为染色 PNG 的**存储态原字节**
  （框架 ``png_store_bytes`` 会 PIL 重编码，像素相同但 sha 不同），包内 sha = 染色产物存储态 sha。
- 像素：``pixel/REVIEW.md`` 修复轮复核 PASS + verify/report 门禁全过 + sha 一致时，``build`` 把
  ``pixel/zantetsu/out`` 两张 sheet 以存储态写入 ``character/<code>/pixelart/``（owner=pixel），元数据保持母本。
- 语音：kit 不写。主控 ``wf_seasonal7_voice.py pack … --write --apply-tables --replace`` 后跑
  ``python work/character_packs/seasonal7-20260916/impl/zantetsu/voice_merge.py``（并认领 / 登记 / 删母本旧语音 / CV / 镜像）。
  ``--step assets`` 会按母本清单把旧 home 语音补回，之后须再跑 voice_merge。``gates`` 要求像素已装、语音已装。
  固定顺序：``tables → kit → assets → (voice pack → voice_merge) → manifest → status → inspect → gates``。
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import sys
import zlib
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

KEY = "zantetsu"
CID = "159998"
CODE = "samurai_robot_plum"
ELEMENT = 4                                   # 光（character c3，0 基）
BATCH_REL = "work/character_packs/seasonal7-20260916"
DESIGN_REL = f"{BATCH_REL}/design/zantetsu.json"
IMPL_REL = f"{BATCH_REL}/impl/zantetsu"
FX_MANIFEST_REL = f"{BATCH_REL}/fx/zantetsu/out/manifest.json"
FX_REPORT_REL = f"{BATCH_REL}/fx/zantetsu/out/report.json"        # Effects 阶段报告：小人 LUT 来源 + 像素依赖 sha
FX_ANALYSIS_REL = f"{BATCH_REL}/fx/zantetsu/analysis.json"         # Effects 阶段 rect 分类（doll / group / keep）
PIXEL_REPORT_REL = f"{BATCH_REL}/pixel/zantetsu/report.json"
PIXEL_OUT_REL = f"{BATCH_REL}/pixel/zantetsu/out"
PIXEL_SHEETS = ("sprite_sheet", "special_sprite_sheet")
PIXEL_SHEET = "character/{code}/pixelart/{name}.png"
PIXEL_REVIEW_REL = f"{BATCH_REL}/pixel/REVIEW.md"                  # 末尾「修复轮复核」段为现行结论
PIXEL_REVIEW_HEADING = "修复轮复核"
PIXEL_VERIFY_REL = f"{BATCH_REL}/pixel/zantetsu/verify.json"
PIXEL_VERIFY_ALL_REL = f"{BATCH_REL}/pixel/_review/verify_all.json"
# sheet 基名 → 同组元数据（atlas / frame / timeline）：元数据保持母本（assets 只改 character/<code>/ 前缀）
PIXEL_METADATA = {
    "sprite_sheet": ("sprite_sheet.atlas.amf3.deflate", "pixelart.frame.amf3.deflate", "pixelart.timeline.amf3.deflate"),
    "special_sprite_sheet": ("special_sprite_sheet.atlas.amf3.deflate", "special.frame.amf3.deflate",
                             "special.timeline.amf3.deflate"),
}
SPEECH = "master/character/character_speech.orderedmap"
DOLL_KEEP = frozenset({"000000", "FFFFFF", "252525"})             # 像素管线 protected / fx DOLL_KEEP：保持原色
OFFICIAL_SIG_REL = f"{BATCH_REL}/research/_tmp/official_sig.json"
PROPOSAL_REL = f"{BATCH_REL}/design/_tmp/zantetsu/proposal_tree_{{level}}.json"

ABILITY = "master/ability/ability.orderedmap"
LEADER = "master/ability/leader_ability.orderedmap"
CHAR = "master/character/character.orderedmap"
TEXT = "master/character/character_text.orderedmap"
ACTION = "master/skill/action_skill.orderedmap"
SWITCHED = "master/skill/switched_action_skill.orderedmap"
CAS = "master/string/custom_ability_string.orderedmap"
UPSKILL = "master/mana_board/upskill.orderedmap"
STANCE = "master/stance_detail/character_stance_detail.orderedmap"
PREVIEW = f"character/{CODE}/battle/character_detail_skill_preview.battle.amf3.deflate"
TEMPLATE_PREVIEW = "character/samurai_robot_smr22/battle/character_detail_skill_preview.battle.amf3.deflate"
PREVIEW_END_FRAME = 420                       # 设计：新技能起跳→归还约 130 帧 + 60 帧 cutin；官方带内（420 有 3 例）

CAS_KEY = f"change_skill_{CODE}"
VOICE_READY = f"{CODE}_voice_ready"
ROUTE_COLS = ["3", "", "", "", "", VOICE_READY, "false", "false"]   # character c9–c16（kind 3 ChangeSkillFlag）
SLOT4_OVERRIDE = "slot4_rec1_if_112_fails__F1_507"
REQUIRED_CAPABILITIES = ("kyubi-fever-ratio-v1",)

DONOR_PROGRAM = "battle/action/skill/action/rare5/{code}${code}_{level}"
D2_CODE, D1_CODE = "samurai_robot", "samurai_robot_smr22"      # 131044 骨架 / 151117 一刀两断子树
SE_FROM = "sound_effect/water/se_water_stamp_heavy"
SE_TO = "sound_effect/slash/se_heavy_aura_critical"
HIT_TIMELINE_BASE = "samurai_robot_smr22_hit"
EXPECTED_ENCODED_BYTES = {1: 3168, 2: 3182}

# doll_lut：设计风险 8——smr22 族小人与像素小人是同一精灵，必须同一张映射（"pixel"）；
# 131044 族是旧版小人造型，单独一张 LUT（"separate"，按 fx 报告逐色来源核对）。
FAMILIES = (
    {"id": "S2_kanbai", "src_dir": "battle/effect/skill_unique/samurai_robot", "subdir": "kanbai", "doll_lut": "separate",
     "fx": ("samurai_robot_jump", "samurai_robot_land", "samurai_robot_land_slash", "samurai_robot_slash_finish")},
    {"id": "S1_ittou", "src_dir": "battle/effect/skill_unique/samurai_robot_smr22", "subdir": "ittou", "doll_lut": "pixel",
     "fx": ("samurai_robot_smr22_dot_front", "samurai_robot_smr22_dot_back", "samurai_robot_smr22_slash",
            HIT_TIMELINE_BASE)},
)

# ---- 框架 spec 覆盖（tables 重跑时生效；值与设计 text 段逐字一致，build 时断言）
TEXTS = {
    "name": "斩铁",
    "furigana": "ZHANTIE",
    "title": "白梅羽织的忍者武士",
    "profile": "早春时节，斩铁换上绣满白梅的羽织，系好青绿围巾，手里还拿着一串三色团子。"
               "他最爱坐在石栏上陪同伴赏梅，把落在机体上的花瓣当作勋章。寒梅傲然绽放——在下之剑，亦为守护这份温暖而鸣！",
    "leader": "寒梅武士道、比肩忍道",
    "skill1": "超振动斩铁剑·寒梅一闪",
    "desc1": "跃向敌人，以超振动剑落地连斩，对周围的敌人造成光属性伤害＋赋予其光属性抗性降低效果／"
             "接着横斩，对命中的敌人造成光属性伤害／最后踏步前冲，以一刀两断之击对周围的敌人造成光属性伤害",
    "skill2": "超振动斩铁剑·寒梅一闪＋",
    "desc2": "跃向敌人，以超振动剑落地连斩，对周围的敌人造成光属性伤害＋赋予其光属性抗性降低效果／"
             "接着横斩，对命中的敌人造成光属性伤害／最后踏步前冲，以一刀两断之击对周围的敌人造成光属性伤害",
    "cv": "AI 合成配音",
}
SPEC = {
    "required_capabilities": REQUIRED_CAPABILITIES,
    "extra_keys": {CAS: (CAS_KEY,), SWITCHED: (VOICE_READY,)},
}

KIT_TABLE_KEYS = {           # kit 拥有的表键（指纹与认领核对用）
    ABILITY: tuple(f"{CID}{i}" for i in range(1, 7)),
    LEADER: (CID,), CHAR: (CID,), TEXT: (CID,), CAS: (CAS_KEY,), UPSKILL: (CID,), STANCE: (CID,),
}
KIT_NESTED_KEYS = {ACTION: CODE, SWITCHED: VOICE_READY}


class KitError(RuntimeError):
    pass


def kit_source_sha256() -> str:
    """门禁结果绑定 kit 源码：改了门禁/拼装逻辑后旧 gates.json 不能继续放行。"""
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


# ======================================================================== 通用小工具

def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=1, sort_keys=False) + "\n"


def load_design(root: Path) -> dict:
    design = json.loads((root / DESIGN_REL).read_text(encoding="utf-8"))
    ident = design.get("identity") or {}
    if design.get("status") != "final" or design.get("key") != KEY:
        raise KitError(f"design not final or wrong key: {design.get('status')} {design.get('key')}")
    if (str(ident.get("cid")), ident.get("code"), ident.get("element")) != (CID, CODE, ELEMENT):
        raise KitError(f"design identity mismatch: {ident.get('cid')} {ident.get('code')} {ident.get('element')}")
    if design.get("pf_override") is not None or design.get("dash") is not None:
        raise KitError("design now carries a PF/dash override that this kit does not implement")
    return design


def _slv(a, b=None):
    return [{"min": a, "max": a if b is None else b}]


def _find_cmds(tree, name=None) -> list[list]:
    out: list[list] = []

    def walk(node):
        if isinstance(node, list):
            if (node and node[0] in ("Command", "Event") and len(node) > 1 and isinstance(node[1], list)
                    and node[1] and (name is None or node[1][0] == name)):
                out.append(node[1])
            for child in node:
                walk(child)
    walk(tree)
    return out


def _one(tree, name, pred=lambda a: True) -> list:
    found = [a for a in _find_cmds(tree, name) if pred(a)]
    if len(found) != 1:
        raise KitError(f"expected exactly one {name}, found {len(found)}")
    return found[0]


def _cmd(node: list) -> list:
    if not (isinstance(node, list) and node and node[0] in ("Command", "Event")):
        raise KitError(f"not a Command/Event node: {str(node)[:80]}")
    return node[1]


# ======================================================================== 行（词条/队长）

class _Donors:
    """donor 表缓存：official=官方基线（1.4.54），live=live store 只读。"""

    def __init__(self, ctx) -> None:
        self.ctx = ctx
        self._cache: dict[tuple[str, str], dict[str, str]] = {}

    def rows(self, source: str, kind: str, key: str) -> list[list[str]]:
        logical = LEADER if kind == "leader_ability" else ABILITY
        cache_key = (source, logical)
        if cache_key not in self._cache:
            if source == "official":
                self._cache[cache_key] = self.ctx.official_flat(logical)
            elif source == "live":
                self._cache[cache_key] = self.ctx.live_flat(logical)
            else:
                raise KitError(f"unknown donor source {source}")
        return self.ctx.csv_split(self._cache[cache_key][key])


def replay_row(donors: _Donors, rec: dict, kind: str) -> list[str]:
    """donor 行 + edits + copy_cells；断言 donor 原值（edits_before）与最终行（row_final）都和设计一致。"""
    donor = donors.rows(rec["donor_source"], kind, rec["donor_key"])[rec["row_index"] - 1]
    row = list(donor)
    width = 124 if kind == "leader_ability" else 126
    if len(row) != width:
        raise KitError(f"{rec['donor']}: donor width {len(row)} != {width}")
    for col, before in (rec.get("edits_before") or {}).items():
        if row[int(col)] != before:
            raise KitError(f"{rec['donor']}: donor c{col}={row[int(col)]!r} drifted from design {before!r}")
    for mapping in (rec.get("edits") or {}, rec.get("copy_cells") or {}):
        for col, value in mapping.items():
            row[int(col)] = value
    if row != rec["row_final"]:
        diff = [i for i, (a, b) in enumerate(zip(row, rec["row_final"])) if a != b]
        raise KitError(f"{rec['donor']}: replayed row differs from design row_final at cols {diff[:10]}")
    return row


def design_rows(ctx, design: dict) -> dict[str, Any]:
    donors = _Donors(ctx)
    leader = [replay_row(donors, rec, "leader_ability") for rec in design["leader"]]
    abilities: dict[str, list[list[str]]] = {}
    records: list[dict] = []
    for slot in range(1, 7):
        key = f"{CID}{slot}"
        rows = []
        for rec in design["abilities"][f"slot{slot}"]:
            if rec["key"] != key:
                raise KitError(f"design slot{slot} key {rec['key']} != {key}")
            used, override = rec, None
            if slot == 4 and rec["record"] == 1:
                used = design["fallbacks"][SLOT4_OVERRIDE]
                if (used["key"], used["record"]) != (key, 1):
                    raise KitError("F1 fallback does not target slot4 record1")
                override = SLOT4_OVERRIDE
            row = replay_row(donors, used, "ability")
            rows.append(row)
            records.append({"key": key, "record": rec["record"], "donor": used["donor"],
                            "intent": used["intent"], "override": override,
                            "replaced_design_row": rec["donor"] if override else None})
        head = design["abilities"][f"slot{slot}"][0]
        if (rows[0][1], rows[0][2]) != (head["unisonable_effective"], head["statue_group_effective"]):
            raise KitError(f"slot{slot} record0 unisonable/statue group drifted")
        abilities[key] = rows
    if sum(len(v) for v in abilities.values()) != design["ability_record_count"]:
        raise KitError("ability record count differs from design")
    return {"leader": leader, "abilities": abilities, "records": records}


def _block(kind: str) -> dict[str, int]:
    import wf_describe
    return {k: int(v) for k, v in wf_describe.layout(kind)["blocks"].items()}


PULLER_EMPTY_DURING = frozenset({"4", "30", "31", "136", "209"})
PULLER_ZERO_DURING = frozenset({"1", "9", "72"})


def row_gate(kind: str, row: list[str], cas_keys: set[str]) -> dict[str, Any]:
    import wf_client_legality as L
    import wf_describe
    blocks = _block(kind)
    mode = row[blocks["precondition1"] - 1]
    extra: list[str] = []
    if mode == "1":                           # 持续行：during puller 契约 + HP 恒真文案禁令
        trig = row[blocks["during_trigger"]]
        puller = row[blocks["during_trigger"] + 1]
        if trig in PULLER_EMPTY_DURING and puller != "":
            extra.append(f"during_trigger {trig} puller must be '' (got {puller!r})")
        if trig in PULLER_ZERO_DURING and puller != "0":
            extra.append(f"during_trigger {trig} puller must be '0' (got {puller!r})")
        if trig == "1":
            extra.append("during_trigger 1 (HpLow) is the banned constant-true HP text for this kit")
    else:
        content = row[blocks["instant_content"]]
        sid = row[blocks["instant_content"] + 23]
        if content in ("536", "629") and sid not in cas_keys:
            extra.append(f"instant {content} string id {sid!r} not in custom_ability_string (C8601)")
    return {
        "describe": wf_describe.describe_line(row, kind),
        "client_legality_problems": L.client_legality_problems(kind, row),
        "declared_block_field_problems": L.declared_block_field_problems(kind, row),
        "ability_element_column_problems": L.ability_element_column_problems(kind, row, ELEMENT),
        "invoke_skill_string_problems": L.invoke_skill_string_problems(row, frozenset(cas_keys), kind),
        "kit_row_problems": extra,
        "required_client_capabilities": L.required_client_capabilities(kind, row),
    }


def _row_gate_failed(entry: dict) -> bool:
    return any(entry[k] for k in ("client_legality_problems", "declared_block_field_problems",
                                  "ability_element_column_problems", "invoke_skill_string_problems",
                                  "kit_row_problems"))


# ======================================================================== 技能树

def compose_tree(A: list, B: list, level: int) -> list:
    """131044（A，骨架）+ 151117（B，一刀两断子树）→ 新技能树（特效路径仍指官方目录，
    之后统一走 rewrite_effect_refs）。步骤逐条对应 design skills.tree_plan_<level>.steps。"""
    T = copy.deepcopy(A)
    if not (T[0] == "ActionDsl" and T[1] == 1 and T[10] == 0):
        raise KitError("D2 root header drifted")
    T[1] = 2                                             # movementPriority 1→2（含 StopBall，与 smr22 一致）
    root = T[11][1]
    hide = _cmd(root[0])                                 # step 2
    if not (hide[0] == "HideCharacter" and hide[1] == -17 and hide[2] == 61):
        raise KitError(f"D2 HideCharacter drifted: {hide}")
    hide[2] = 130
    dummy = _cmd(root[1])                                # step 3
    if dummy[0] != "ShowEffect" or dummy[2] != ["ResolveByElement", "battle/effect/skill_general/decoration/dummy_ball", 3]:
        raise KitError("D2 dummy ball effect drifted")
    dummy[2][2] = 5
    if dummy[5] != ["SpecifyEffectLifetimeDirectly", 61]:
        raise KitError("D2 dummy ball lifetime drifted")
    dummy[5][1] = 130
    jump = _cmd(root[2])
    if not str(jump[2][1]).endswith(f"/{D2_CODE}/samurai_robot_jump"):
        raise KitError("D2 jump effect drifted")
    stop = copy.deepcopy(B[11][1][0])                    # step 1
    if not (_cmd(stop)[0] == "StopBall" and _cmd(stop)[1] == -18 and _cmd(stop)[2] == 45):
        raise KitError("D1 StopBall drifted")
    _cmd(stop)[2] = 93
    root.insert(0, stop)
    crp1 = _one(T, "CreateReferencePoint", lambda a: a[10] == 1)   # step 4
    if not (crp1[1] == 0 and crp1[9] == 60):
        raise KitError("D2 RP1 drifted")
    crp1[9] = 90
    land = _one(T, "CreateHitArea", lambda a: a[19] == 2)          # step 5
    if not (land[9] == ["Circle", _slv(100)] and land[14] == ["CalculatedUsingMaxNumOfHits", 4] and land[24] == 0):
        raise KitError("D2 landing hit area drifted")
    cna_land = _one(land[23], "CreateNormalAttack")
    if not (cna_land[1] == 4 and cna_land[2] == 255):
        raise KitError("D2 landing attack drifted")
    cna_land[6] = _slv(0.85) if level == 1 else _slv(1.08, 1.25)
    cc = _one(land[23], "CreateCondition")
    if not (cc[1] == 4 and cc[10] == 3 and cc[12] is False):
        raise KitError("D2 landing CreateCondition drifted")
    tol = cc[2][0]
    if not (tol[0] == "ACToleranceOfElement" and tol[2] == 3):
        raise KitError("D2 tolerance condition drifted")
    tol[2] = 5                                                      # 雷→光（DSL 码=内部+1）
    if tol[3] != (_slv(-0.1) if level == 1 else _slv(-0.15, -0.2)):
        raise KitError(f"D2 tolerance strength drifted: {tol[3]}")
    onhit = land[23][1]
    idx = [i for i, n in enumerate(onhit) if n[0] == "Command" and n[1] is cc]
    if len(idx) != 1:
        raise KitError("landing onHit CreateCondition not found as direct child")
    cc_on = copy.deepcopy(cc)
    cc_on[2][0][3] = _slv(-0.15) if level == 1 else _slv(-0.25, -0.3)
    # 光共鸣开关分支（蓝本 devil_clown_xm21）；两支都是非空 Block，禁 DoNothing
    onhit[idx[0]] = ["Command", ["ConditionalsChangeSkillFlag", 1,
                                 ["Block", [["Command", cc_on]]], ["Block", [["Command", cc]]]]]
    fin = _one(T, "CreateHitArea", lambda a: a[19] == 5)           # step 6
    if not (fin[9][0] == "Rectangle" and fin[24] == 0):
        raise KitError("D2 horizontal slash drifted")
    cna_fin = _one(fin[23], "CreateNormalAttack")
    if cna_fin[1] != 7:
        raise KitError("D2 horizontal slash attack drifted")
    cna_fin[6] = _slv(17) if level == 1 else _slv(21.6, 25)
    waits = [w for w in _find_cmds(T, "Wait") if w[1] == 19]       # step 7
    if len(waits) != 1:
        raise KitError("D2 Wait(19) not unique")
    w19 = waits[0]
    ret = w19[3][1][0]
    if not (_cmd(ret)[0] == "ShowEffect" and str(_cmd(ret)[2][1]).endswith(f"/{D2_CODE}/samurai_robot_land")):
        raise KitError("D2 return effect drifted")
    sub = copy.deepcopy(B[11][1][1])                                # step 8
    c = _cmd(sub)
    if not (c[0] == "CreateReferencePoint" and c[1] == -18 and c[10] == 0 and c[3] == 0 and c[4] == 0):
        raise KitError("D1 CreateReferencePoint drifted")
    remap = {0: 8, 1: 9, 2: 10, 3: 11}
    c[1] = 1                                   # 原点：球 → RP1（锁定敌人落点；敌人可能已死，不 lookup 绑定 0）
    c[4] = 300                                 # 敌人我方一侧 300px 起步，前冲 225 + 判定 v-75 → 圆心=锁定目标
    c[10] = remap[0]
    for se in _find_cmds(sub, "ShowEffect"):
        if se[3] in remap:
            se[3] = remap[se[3]]
    moves = _find_cmds(sub, "MoveHitArea")
    if len(moves) != 2 or any(m[1] != 0 for m in moves) or (moves[0][4], moves[1][4]) != (15, 0):
        raise KitError("D1 MoveHitArea drifted")
    for m in moves:
        m[1] = remap[0]
    big = _one(sub, "CreateHitArea")
    if not (big[2] == 0 and (big[19], big[21], big[22]) == (1, 2, 3)):
        raise KitError("D1 big slash hit area drifted")
    big[2] = remap[0]
    big[19], big[21], big[22] = remap[1], remap[2], remap[3]
    cna_big = _one(big[23], "CreateNormalAttack")
    if cna_big[1] != 3:
        raise KitError("D1 big slash attack drifted")
    cna_big[1] = remap[3]
    cna_big[6] = _slv(33) if level == 1 else _slv(43.2, 50)
    w28 = [w for w in _find_cmds(sub, "Wait") if w[1] == 28]
    if len(w28) != 1:
        raise KitError("D1 Wait(28) not unique")
    w28[0][3][1].append(["Event", ["Wait", 25, "*", ["Block", [ret]]]])   # 归还演出挪到 t=116
    w19[3][1][0] = sub
    return T


def _kind_of(v) -> str:
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
        if v and isinstance(v[0], str):
            return "expr" if v[0] in ("Block", "Command", "Event") else "enum:" + v[0]
        return "list"
    return type(v).__name__


def official_shape_problems(tree, official_sig: dict) -> list[str]:
    """设计 _tmp compose_skill_proposal.shape_problems 的移植：逐命令参数形状与官方全库签名差分。"""
    probs = []
    for a in _find_cmds(tree, None):
        for i, p in enumerate(a[1:], 1):
            key = f"{a[0]}#{i}"
            k = _kind_of(p)
            ok = official_sig.get(key)
            if ok is None:
                probs.append(f"{key} no official signature")
            elif k not in ok and not (k in ("list", "slv") and ({"list", "slv"} & set(ok))):
                probs.append(f"{key} kind {k} not in official {ok}")
    return probs


def _type_problems(value, typ: str, where: str, enums: dict) -> list[str]:
    if typ in ("Dynamic",):
        return []
    if typ in ("int", "Number"):
        return [] if isinstance(value, (int, float)) and not isinstance(value, bool) else [f"{where}: {typ} got {_kind_of(value)}"]
    if typ == "Boolean":
        return [] if isinstance(value, bool) else [f"{where}: Boolean got {_kind_of(value)}"]
    if typ == "String":
        return [] if isinstance(value, str) else [f"{where}: String got {_kind_of(value)}"]
    if typ == "Array":
        return [] if isinstance(value, list) and _kind_of(value) != "expr" else [f"{where}: Array got {_kind_of(value)} (F1034)"]
    if typ == "Object":
        return [] if isinstance(value, (dict, list, str, int, float)) else [f"{where}: Object got {_kind_of(value)}"]
    if typ == "ActionDslExpression":
        if not (isinstance(value, list) and value and value[0] in ("Block", "Command", "Event")):
            return [f"{where}: ActionDslExpression got {str(value)[:40]} (DoNothing/F1009)"]
        return []
    ctors = enums.get(typ)
    if ctors is None:
        return []
    if value is None:
        # haxe 枚举可空（官方 CreateCondition#8 HitCountCheckTargetKind 多为 null）；
        # 具体哪个位置允许 null 由 official_shape_problems（官方全库 kind 集合）把关。
        return []
    if not (isinstance(value, list) and value and isinstance(value[0], str)):
        return [f"{where}: enum {typ} got {_kind_of(value)}"]
    if value[0] not in ctors:
        return [f"{where}: {value[0]!r} is not a {typ} constructor"]
    params = ctors[value[0]]
    if len(value) - 1 != len(params):
        return [f"{where}: {typ}.{value[0]} arity {len(value) - 1} != {len(params)}"]
    out = []
    for j, (item, sub) in enumerate(zip(value[1:], params), 1):
        out += _type_problems(item, sub, f"{where}.{value[0]}#{j}", enums)
    return out


def sig_problems(tree) -> list[str]:
    """wf_dsl_sig（反编译命令/枚举签名）逐命令参数个数与类型；ActionDslExpression 槽禁非表达式。"""
    import wf_dsl_sig as SIG
    probs: list[str] = []

    def walk(node):
        if isinstance(node, list):
            if node and node[0] in ("Command", "Event") and len(node) > 1 and isinstance(node[1], list) and node[1]:
                cmd = node[1]
                table = SIG.COMMANDS if node[0] == "Command" else SIG.EVENTS
                sig = table.get(cmd[0])
                if sig is None:
                    probs.append(f"{node[0]} {cmd[0]} unknown to wf_dsl_sig")
                elif len(cmd) - 1 != len(sig):
                    probs.append(f"{cmd[0]} arity {len(cmd) - 1} != {len(sig)}")
                else:
                    for i, (value, typ) in enumerate(zip(cmd[1:], sig), 1):
                        probs.extend(_type_problems(value, typ, f"{cmd[0]}#{i}", SIG.ENUMS))
            for child in node:
                walk(child)
    walk(tree)
    return probs


# wf_client_legality.DSL_SUBJECT_CONSUMERS 只列了攻击/状态类主体位，漏了评估器真正 lookup 的
# ShowEffect node[3] / CreateHitArea node[2] / FindNearSubjects node[1] / CreateReferencePoint node[1]
# 与坐标系 ["GH", n]（记忆卡 wf-dsl-subject-lookup-map，C16103）。本树 151117 子树整体重映射到 8–11，
# 恰好落在这些位上，所以 kit 内补一层作用域检查（框架/工具缺口已在返回中报告）。
EXTRA_LOOKUP_CONSUMERS = {"ShowEffect": (3,), "CreateHitArea": (2,), "FindNearSubjects": (1,),
                          "CreateReferencePoint": (1,), "GH": (1,)}


def lookup_scope_problems(tree) -> list[str]:
    import wf_client_legality as L
    consumers = {name: tuple(sorted(set(L.DSL_SUBJECT_CONSUMERS.get(name, ())) | set(extra)))
                 for name, extra in EXTRA_LOOKUP_CONSUMERS.items()}
    consumers = {**L.DSL_SUBJECT_CONSUMERS, **consumers}
    probs: list[str] = []

    def is_node(v) -> bool:
        return isinstance(v, list) and bool(v) and isinstance(v[0], str)

    def walk(node, bound: frozenset) -> None:
        if is_node(node):
            name = node[0]
            for index in consumers.get(name, ()):
                if index < len(node):
                    subject = node[index]
                    if (isinstance(subject, int) and not isinstance(subject, bool)
                            and subject not in bound and subject not in L.DSL_BUILTIN_SUBJECTS):
                        probs.append(f"{name} lookup node[{index}]={subject} unbound (scope {sorted(bound)}) → C16103")
            binders = L.DSL_SUBJECT_BINDERS.get(name)
            if binders:
                handled = {block for _, block in binders}
                for ids, block in binders:
                    if block < len(node):
                        inner = set(bound) | {node[s] for s in ids if s < len(node) and isinstance(node[s], int)}
                        walk(node[block], frozenset(inner))
                for index, child in enumerate(node[1:], 1):
                    if index not in handled:
                        walk(child, bound)
                return
            for child in node[1:]:
                walk(child, bound)
            return
        if isinstance(node, list):
            scope = set(bound)
            for child in node:
                walk(child, frozenset(scope))
                if (isinstance(child, list) and len(child) == 2 and child[0] == "Command" and is_node(child[1])
                        and child[1][0] in L.DSL_STATEMENT_BINDERS):
                    slot = L.DSL_STATEMENT_BINDERS[child[1][0]]
                    if slot < len(child[1]) and isinstance(child[1][slot], int):
                        scope.add(child[1][slot])
        elif isinstance(node, dict):
            for child in node.values():
                walk(child, bound)

    walk(tree, frozenset())
    return probs


def dsl_gates(tree, raw: bytes, level: int, root: Path) -> dict[str, Any]:
    import wf_client_legality as L
    import wf_dsl
    enc = wf_dsl.encode_amf3(tree)
    back = wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"]
    sig_path = root / OFFICIAL_SIG_REL
    official_sig = json.loads(sig_path.read_text(encoding="utf-8")) if sig_path.is_file() else None
    strings = [s for s in _iter_strings(tree)]
    extra = []
    if not (tree[0] == "ActionDsl" and tree[1] == 2 and tree[10] == 0):
        extra.append(f"root header movementPriority/buffTargetAs = {tree[1]}/{tree[10]} (want 2/0)")
    if isinstance(tree, dict):
        extra.append("wrapper dict instead of bare tree")
    if any(s.startswith("battle/effect/enemy") for s in strings):
        extra.append("enemy effect path in player skill tree")
    if any(isinstance(n, list) and n == ["DoNothing"] for n in _iter_nodes(tree)
           if not _is_iftargetnotfound_slot(tree, n)):
        extra.append("bare ['DoNothing'] outside IfTargetNotFound slot (F1009)")
    flags = _find_cmds(tree, "ConditionalsChangeSkillFlag")
    if len(flags) != 1 or flags[0][1] != 1:
        extra.append(f"expected one ConditionalsChangeSkillFlag(1), got {len(flags)}")
    return {
        "level": level,
        "roundtrip_equal": back == tree and wf_dsl.parse_dsl(enc)["tree"] == tree,
        "encoded_bytes": len(enc),
        "encoded_bytes_expected": EXPECTED_ENCODED_BYTES[level],
        "deflate_bytes": len(raw),
        "subject_binding_problems": L.action_dsl_subject_binding_problems(tree),
        "lookup_scope_problems": lookup_scope_problems(tree),
        "hit_area_target_problems": L.action_dsl_hit_area_target_problems(tree),
        "element_problems": L.action_dsl_element_problems(tree, ELEMENT),
        "player_side_problems": wf_dsl.player_side_dsl_problems(tree),
        "official_shape_problems": (official_shape_problems(tree, official_sig)
                                    if official_sig is not None else [f"missing {OFFICIAL_SIG_REL}"]),
        "sig_problems": sig_problems(tree),
        "kit_tree_problems": extra,
    }


def _dsl_gate_failed(entry: dict) -> bool:
    return (not entry["roundtrip_equal"] or entry["encoded_bytes"] != entry["encoded_bytes_expected"]
            or any(entry[k] for k in ("subject_binding_problems", "lookup_scope_problems",
                                      "hit_area_target_problems", "element_problems",
                                      "player_side_problems", "official_shape_problems", "sig_problems",
                                      "kit_tree_problems")))


def _iter_nodes(node):
    yield node
    if isinstance(node, list):
        for child in node:
            yield from _iter_nodes(child)
    elif isinstance(node, dict):
        for child in node.values():
            yield from _iter_nodes(child)


def _iter_strings(node):
    for n in _iter_nodes(node):
        if isinstance(n, str):
            yield n


def _is_iftargetnotfound_slot(tree, candidate) -> bool:
    for cmd in _find_cmds(tree, "FindNearSubjects"):
        if len(cmd) > 4 and cmd[4] is candidate:
            return True
    return False


# ======================================================================== 特效

def fx_manifest(root: Path) -> tuple[dict[str, Path], dict | None]:
    """Effects 阶段产物钩子：``fx/zantetsu/out/manifest.json`` = {源（或目标）sheet 逻辑路径: 染色 PNG 文件}。

    兼容三种形状：扁平 dict；{"sheets": dict|list}；list[{source|src|logical: …, png|file|path|output: …}]。
    文件路径可为绝对、相对 manifest 目录或相对仓库根。"""
    path = root / FX_MANIFEST_REL
    if not path.is_file():
        return {}, None
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("sheets", data) if isinstance(data, dict) else data
    pairs: list[tuple[str, str]] = []
    if isinstance(entries, dict):
        pairs = [(k, v if isinstance(v, str) else (v or {}).get("png") or (v or {}).get("file") or (v or {}).get("path"))
                 for k, v in entries.items() if str(k).endswith(".png")]
    elif isinstance(entries, list):
        for item in entries:
            if not isinstance(item, dict):
                continue
            src = item.get("source") or item.get("src") or item.get("logical") or item.get("source_logical")
            dst = item.get("png") or item.get("file") or item.get("path") or item.get("output")
            if src and dst:
                pairs.append((src, dst))
    out: dict[str, Path] = {}
    for logical, file in pairs:
        if not file:
            continue
        candidate = Path(file)
        for base in (None, path.parent, root):
            p = candidate if base is None else base / candidate
            if p.is_file():
                out[str(logical).lstrip("/")] = p.resolve()
                break
        else:
            raise KitError(f"fx manifest PNG not found for {logical}: {file}")
    return out, {"path": str(path), "sha256": _sha(path.read_bytes())}


def _png_transform_for(src_sheet: str, dst_sheet: str, dyed: dict[str, Path], log: list[dict]):
    target = dyed.get(src_sheet) or dyed.get(dst_sheet)
    if target is None:
        return None

    def transform(img):
        import wf_assets
        from PIL import Image
        import io
        raw = target.read_bytes()
        new = Image.open(io.BytesIO(wf_assets.png_decode(raw))).convert("RGBA")
        entry = {"source_sheet": src_sheet, "target_sheet": dst_sheet, "file": str(target),
                 "file_sha256": _sha(raw), "size": list(new.size), "template_size": list(img.size),
                 "size_match": new.size == img.size,
                 "alpha_identical": new.size == img.size and new.getchannel("A").tobytes() == img.getchannel("A").tobytes()}
        log.append(entry)
        if not entry["size_match"]:
            raise KitError(f"dyed sheet size {new.size} != template {img.size}: {target}")
        if not entry["alpha_identical"]:                 # 设计 effects.clone[*].method：alpha 逐字节不变
            raise KitError(f"dyed sheet alpha differs from template (geometry/atlas would drift): {target}")
        return new
    return transform


def timeline_se_problems(ctx, family: dict) -> list[dict]:
    """克隆 timeline 的 sounds：mp3 必须在 live store，或与官方源 timeline 原文一致（APK 内置 SE）。"""
    out = []
    for base in family["copied_bases"]:
        logical = f"{family['dst_dir']}/{base}.timeline.amf3.deflate"
        src_logical = f"{family['src_dir']}/{base}.timeline.amf3.deflate"
        tree = ctx.amf_parse(ctx.pack.pkg_path(_family_root(family), logical).read_bytes())
        src_tree = ctx.amf_parse(ctx.pack.template_asset(src_logical)[1])
        src_paths = {s.get("path") for s in (src_tree.get("sounds") or []) if isinstance(s, dict)}
        for sound in tree.get("sounds") or []:
            se = sound.get("path") if isinstance(sound, dict) else None
            in_store = bool(se) and ctx.pack.live_locate(se + ".mp3") is not None
            verbatim = se in src_paths
            out.append({"timeline": logical, "se": se, "in_live_store": in_store,
                        "verbatim_official": verbatim, "ok": bool(se) and (in_store or verbatim)})
    return out


def fx_sheet_checks(pack) -> dict[str, Any]:
    """包内两族 sheet：尺寸/alpha 与官方母本逐字节一致；fx manifest 存在时像素必须等于染色产物
    （Effects 阶段重跑后包内仍是旧色 = 需重跑 --step kit），不存在时必须仍是官方原色。"""
    import io
    import wf_assets
    from PIL import Image
    dyed, info = fx_manifest(pack.root)
    sheets = []
    for fam in FAMILIES:
        donor = fam["src_dir"].rsplit("/", 1)[-1]
        dst = f"battle/effect/skill_unique/{CODE}_{fam['subdir']}"
        src_sheet = f"{fam['src_dir']}/{donor}.png"
        dst_sheet = f"{dst}/{dst.rsplit('/', 1)[-1]}.png"
        entry: dict[str, Any] = {"sheet": dst_sheet, "source_sheet": src_sheet, "problems": []}
        path = pack.pkg_path("common", dst_sheet)
        if not path.is_file():
            entry["problems"].append("sheet missing from package")
            sheets.append(entry)
            continue
        raw = path.read_bytes()
        _root, tpl_raw, _src = pack.template_asset(src_sheet)
        tpl = Image.open(io.BytesIO(wf_assets.png_decode(tpl_raw))).convert("RGBA")
        img = Image.open(io.BytesIO(wf_assets.png_decode(raw))).convert("RGBA")
        entry.update({"package_sha256": _sha(raw), "store_magic_lowercase": raw[:4] == b"\x89png",
                      "size": list(img.size), "size_equal_template": img.size == tpl.size})
        if not entry["size_equal_template"]:
            entry["problems"].append(f"size {img.size} != template {tpl.size}")
        else:
            entry["alpha_equal_template"] = img.getchannel("A").tobytes() == tpl.getchannel("A").tobytes()
            if not entry["alpha_equal_template"]:
                entry["problems"].append("alpha differs from official template sheet")
        if not entry["store_magic_lowercase"]:
            entry["problems"].append("package PNG not in store form (lowercase magic)")
        target = dyed.get(src_sheet) or dyed.get(dst_sheet)
        if target is not None:
            dyed_raw = target.read_bytes()
            new = Image.open(io.BytesIO(wf_assets.png_decode(dyed_raw))).convert("RGBA")
            store = fx_store_bytes(target)
            entry.update({"dyed_file": str(target), "dyed_sha256": _sha(dyed_raw),
                          "dyed_store_sha256": _sha(store),
                          "pixels_equal_dyed": new.size == img.size and new.tobytes() == img.tobytes(),
                          "bytes_equal_dyed_store_form": raw == store,
                          "owner": pack.owner_of("common", dst_sheet)})
            if not entry["pixels_equal_dyed"]:
                entry["problems"].append("package sheet != current fx manifest PNG (rerun --step kit)")
            elif not entry["bytes_equal_dyed_store_form"]:
                entry["problems"].append("package sheet bytes != store form of fx manifest PNG "
                                         "(pixels equal: framework PIL re-encode; rerun --step kit)")
            if entry["owner"] != "effects":
                entry["problems"].append(f"package sheet owner={entry['owner']} (expected effects)")
        else:
            entry["dyed_file"] = None
            entry["pixels_equal_template"] = img.size == tpl.size and img.tobytes() == tpl.tobytes()
            if not entry["pixels_equal_template"]:
                entry["problems"].append("sheet recoloured but no fx manifest entry backs it")
        sheets.append(entry)
    return {"fx_manifest": info, "sheets": sheets}


def _rgba_array(raw: bytes):
    import io
    import numpy as np
    import wf_assets
    from PIL import Image
    return np.asarray(Image.open(io.BytesIO(wf_assets.png_decode(raw))).convert("RGBA"))


def _color_votes(src, dst, mask) -> dict[str, Counter]:
    """同位不透明像素：源色 → 目标色计数。src/dst 必须同尺寸同 alpha（调用方先核对）。"""
    import numpy as np
    sel = mask & (src[..., 3] == 255)
    key = lambda px: ((px[:, 0].astype(np.int64) << 16) | (px[:, 1].astype(np.int64) << 8) | px[:, 2])  # noqa: E731
    pairs = np.stack([key(src[sel]), key(dst[sel])], axis=1)
    votes: dict[str, Counter] = defaultdict(Counter)
    if len(pairs):
        uniq, counts = np.unique(pairs, axis=0, return_counts=True)
        for (s, d), n in zip(uniq.tolist(), counts.tolist()):
            votes["%06X" % s]["%06X" % d] += int(n)
    return votes


def _mode(counter: Counter) -> tuple[str, float]:
    target, n = max(counter.items(), key=lambda kv: (kv[1], kv[0]))
    return target, n / sum(counter.values())


def doll_color_checks(pack, overrides: dict[str, Path] | None = None) -> dict[str, Any]:
    """设计 §5.1 / 风险 8 / 验收 8：特效里的小人帧必须和像素小人同色。

    - 像素参照：官方 smr22 sprite_sheet/special_sprite_sheet → ``pixel/zantetsu/out`` 同名 PNG，
      以及包内已装入（≠官方）的像素 sheet；逐源色取主映射色。
    - 特效：包内两族 sheet 只看 ``fx/zantetsu/analysis.json`` 判为 doll 的 rect 内部（去掉 S2 黄闪变体 rect），
      逐源色主映射色必须单值。
    - smr22 族（doll_lut="pixel"，与像素小人同一精灵）：像素 sheet 里有的源色，特效主映射色必须等于每个像素参照的
      主映射色（不看 fx 报告怎么说）。
    - 131044 旧小人（doll_lut="separate"，单独 LUT）：按 fx 报告逐色来源核对——pixel_mapping 色必须等于像素映射；
      old_doll_analog 色的同类源色在当前像素里的映射仍等于染色时记录的 analog_target，包内色等于报告目标。
    - 两族都：DOLL_KEEP 色（像素里没有该源色时）保持原色；没有来源说明的颜色一律报错。
    - 依赖链：fx 报告 pixel_dependency.sha256 == 当前像素报告；像素报告 outputs == pixel/out；
      fx 报告 output sha == fx manifest PNG；analysis 的源 sheet sha 与 rect 集合 == 官方母本。
    """
    import numpy as np
    root = pack.root
    paths = {"fx_report": root / FX_REPORT_REL, "fx_analysis": root / FX_ANALYSIS_REL,
             "pixel_report": root / PIXEL_REPORT_REL, "pixel_out": root / PIXEL_OUT_REL}
    paths.update({k: Path(v) for k, v in (overrides or {}).items()})
    problems: list[str] = []
    result: dict[str, Any] = {"paths": {k: str(v) for k, v in paths.items()}, "problems": problems}
    missing = [k for k in ("fx_report", "fx_analysis", "pixel_report") if not paths[k].is_file()]
    dyed, manifest_info = fx_manifest(root)
    if not dyed:
        missing.append("fx_manifest")
    if missing:
        problems.append(f"小人同色核对缺少输入 {missing}：特效小人帧无法证明与像素小人同色")
        return result
    fx_raw, px_raw = paths["fx_report"].read_bytes(), paths["pixel_report"].read_bytes()
    fx_rep, px_rep = json.loads(fx_raw), json.loads(px_raw)
    analysis = json.loads(paths["fx_analysis"].read_text(encoding="utf-8"))
    dep = fx_rep.get("pixel_dependency") or {}
    result["provenance"] = {"fx_report_sha256": _sha(fx_raw), "fx_gates_passed": fx_rep.get("gates_passed"),
                            "pixel_report_sha256": _sha(px_raw), "pixel_gates_passed": px_rep.get("gates_passed"),
                            "fx_pixel_dependency_sha256": dep.get("sha256"),
                            "fx_manifest_sha256": manifest_info["sha256"]}
    if fx_rep.get("gates_passed") is not True:
        problems.append("fx/zantetsu/out/report.json gates_passed != true")
    if px_rep.get("gates_passed") is not True:
        problems.append("pixel/zantetsu/report.json gates_passed != true（像素管线未定稿）")
    if dep.get("sha256") != _sha(px_raw):
        problems.append(f"像素报告已变（fx 染色时 sha {str(dep.get('sha256'))[:12]}…，当前 {_sha(px_raw)[:12]}…）："
                        "重跑 fx_recolor_zantetsu.py gate → --step kit → gates")

    # ---- 像素参照 LUT
    px_luts: dict[str, dict[str, Counter]] = {}
    sources: list[dict] = []
    for name in PIXEL_SHEETS:
        tpl = _rgba_array(pack.template_asset(PIXEL_SHEET.format(code=D1_CODE, name=name))[1])
        cands: list[tuple[str, bytes]] = []
        out_file = paths["pixel_out"] / f"{name}.png"
        if out_file.is_file():
            raw = out_file.read_bytes()
            want = ((px_rep.get("outputs") or {}).get(name) or {}).get("sha256")
            if want != _sha(raw):
                problems.append(f"pixel/out/{name}.png sha 与像素报告 outputs 不符（像素管线跑到一半？）")
            cands.append(("pixel_out", raw))
        pkg_file = pack.pkg_path("common", PIXEL_SHEET.format(code=CODE, name=name))
        installed = False
        if pkg_file.is_file():
            raw = pkg_file.read_bytes()
            arr = _rgba_array(raw)
            installed = not (arr.shape == tpl.shape and bool((arr == tpl).all()))
            if installed:
                cands.append(("package", raw))
        sources.append({"sheet": name, "pixel_out": str(out_file) if out_file.is_file() else None,
                        "package_installed": installed})
        for label, raw in cands:
            arr = _rgba_array(raw)
            if arr.shape != tpl.shape or not bool((arr[..., 3] == tpl[..., 3]).all()):
                problems.append(f"{label} {name}.png 尺寸/alpha 与官方 smr22 不同，无法逐色对照")
                continue
            lut = px_luts.setdefault(label, defaultdict(Counter))
            for src, counter in _color_votes(tpl, arr, np.ones(tpl.shape[:2], bool)).items():
                lut[src].update(counter)
    result["pixel_sources"] = sources
    if not px_luts:
        problems.append("没有可用的像素小人参照（pixel/out 缺失且包内仍是官方像素）")

    # ---- 两族特效 sheet 的小人帧
    families: list[dict] = []
    for fam in FAMILIES:
        sid, donor = fam["id"], fam["src_dir"].rsplit("/", 1)[-1]
        src_sheet = f"{fam['src_dir']}/{donor}.png"
        dst = f"battle/effect/skill_unique/{CODE}_{fam['subdir']}"
        dst_sheet = f"{dst}/{dst.rsplit('/', 1)[-1]}.png"
        entry: dict[str, Any] = {"family": sid, "sheet": dst_sheet, "colors": []}
        families.append(entry)
        ana = analysis.get(sid) or {}
        fx_sheet = (fx_rep.get("sheets") or {}).get(sid) or {}
        tpl_raw = pack.template_asset(src_sheet)[1]
        atlas = _amf_parse(pack.template_asset(f"{fam['src_dir']}/{donor}.atlas.amf3.deflate")[1])
        rects = {(int(e["x"]), int(e["y"]), int(e["w"]), int(e["h"])) for e in atlas}
        table = ana.get("rect_table") or []
        if ((ana.get("files") or {}).get(src_sheet) or {}).get("sha256") != _sha(tpl_raw):
            problems.append(f"{sid}: fx analysis 的源 sheet sha 与官方母本不符（analysis 过期）")
        if {tuple(r["rect"]) for r in table} != rects:
            problems.append(f"{sid}: fx analysis rect 集合与官方 atlas 不符")
        target = dyed.get(src_sheet) or dyed.get(dst_sheet)
        if target is None or (fx_sheet.get("output") or {}).get("sha256") != _sha(target.read_bytes()):
            problems.append(f"{sid}: fx 报告 output sha 与 fx manifest PNG 不符（报告与染色产物不是同一轮）")
        pkg_file = pack.pkg_path("common", dst_sheet)
        if not pkg_file.is_file():
            problems.append(f"{sid}: 包内缺 {dst_sheet}")
            continue
        tpl, pkg = _rgba_array(tpl_raw), _rgba_array(pkg_file.read_bytes())
        if tpl.shape != pkg.shape or not bool((tpl[..., 3] == pkg[..., 3]).all()):
            problems.append(f"{sid}: 包内 sheet 尺寸/alpha 与官方不同")
            continue
        mask = np.zeros(tpl.shape[:2], bool)
        for r in table:
            if r.get("cls") == "doll":
                x, y, w, h = r["rect"]
                mask[y:y + h, x:x + w] = True
        doll = fx_sheet.get("doll") or {}
        for flash in doll.get("flash") or []:           # 黄闪变体 = screen(本体, 闪光色)，不走小人 LUT
            x, y, w, h = flash["flash_rect"]
            mask[max(y - 1, 0):y + h + 1, max(x - 1, 0):x + w + 1] = False
        provenance = doll.get("provenance") or {}
        votes = _color_votes(tpl, pkg, mask)
        if not votes:
            problems.append(f"{sid}: doll rect 内没有不透明像素（analysis 分类失效？）")
        for color in sorted(votes):
            fx_target, share = _mode(votes[color])
            row: dict[str, Any] = {"source": color, "fx": fx_target, "fx_share": round(share, 4)}
            entry["colors"].append(row)
            if share != 1:
                problems.append(f"{sid}: 小人源色 #{color} 在特效里映射成多个颜色 {dict(votes[color])}")
            present = {label: _mode(lut[color])[0] for label, lut in px_luts.items() if color in lut}
            prov = provenance.get(color) or {}
            if fam["doll_lut"] == "pixel" and present:
                rule = "pixel_same_source"
            elif color in DOLL_KEEP:
                rule = "keep"
            else:
                rule = prov.get("rule")
            row["rule"] = rule
            if rule in ("pixel_same_source", "pixel_mapping"):
                row["pixel"] = present
                if not present:
                    problems.append(f"{sid}: 小人 #{color} fx 报告记为像素映射，但像素 sheet 里没有该源色")
                bad = {label: t for label, t in present.items() if t != fx_target}
                if bad:
                    problems.append(f"{sid}: 小人 #{color} 特效→#{fx_target}，像素→{bad}（重跑 fx 染色 → kit）")
            elif rule == "keep":
                if fx_target != color:
                    problems.append(f"{sid}: 保持色 #{color} 被改成 #{fx_target}")
            else:
                analog = prov.get("analog_source")
                row.update(analog_source=analog, analog_target=prov.get("analog_target"),
                           fx_report_target=prov.get("target"))
                if rule != "old_doll_analog" or not analog:
                    problems.append(f"{sid}: 小人 #{color} 没有来源（不在像素 sheet 同源色，fx 报告也不是同类源色映射）")
                    continue
                analog_now = {label: _mode(lut[analog])[0] for label, lut in px_luts.items() if analog in lut}
                row["analog_pixel"] = analog_now
                if not analog_now:
                    problems.append(f"{sid}: 同类源色 #{analog} 不在像素 sheet")
                elif any(t != prov.get("analog_target") for t in analog_now.values()):
                    problems.append(f"{sid}: 旧小人 #{color} 的同类源色 #{analog} 像素映射已变 "
                                    f"{analog_now} ≠ 染色时 #{prov.get('analog_target')}（重跑 fx 染色 → kit）")
                if prov.get("target") != fx_target:
                    problems.append(f"{sid}: 旧小人 #{color} 包内 #{fx_target} ≠ fx 报告 #{prov.get('target')}")
        entry["doll_lut"] = fam["doll_lut"]
        entry["summary"] = dict(Counter(str(r.get("rule")) for r in entry["colors"]))
    result["families"] = families
    return result


def _amf_parse(raw: bytes):
    import wf_seasonal7_common as C
    return C.amf_parse(raw)


def _family_root(family: dict) -> str:
    roots = {f["root"] for f in family["files"]}
    if len(roots) != 1:
        raise KitError(f"effect family spans roots {roots}")
    return roots.pop()


def effect_reference_problems(ctx, trees: dict[str, Any]) -> dict[str, Any]:
    """DSL 特效引用 → 客户端实际加载的 4 件（parts/timeline/sheet/atlas）在包内或 live 可解析；
    包内 parts 纹理全部落在包内 atlas。"""
    import wf_character_requirements as R
    refs = R.extract_master_asset_references({}, {}, trees, context_element=ELEMENT)
    checked, problems = [], []
    for ref in refs:
        if ref.kind != "skill_effect":
            continue
        for logical in R.required_asset_paths(ref):
            in_pkg = ctx.pack.pkg_has("common", logical)
            in_live = ctx.pack.live_locate(logical) is not None
            checked.append({"ref": ref.value, "logical": logical, "package": in_pkg, "live": in_live})
            if not (in_pkg or in_live):
                problems.append(f"unresolved {logical} (from {ref.source})")
        parts, _tl, _sheet, atlas = R.required_asset_paths(ref)
        if ctx.pack.pkg_has("common", parts):
            if not ctx.pack.pkg_has("common", atlas):
                problems.append(f"package parts without package atlas: {parts}")
                continue
            ptree = ctx.amf_parse(ctx.pack.pkg_path("common", parts).read_bytes())
            atree = ctx.amf_parse(ctx.pack.pkg_path("common", atlas).read_bytes())
            lost = sorted({i["p"] for i in ptree.get("i", []) if isinstance(i, dict)}
                          - {a["n"] for a in atree if isinstance(a, dict) and "n" in a})
            if lost:
                problems.append(f"{parts} textures missing from atlas: {lost[:5]}")
    return {"checked": checked, "problems": problems}


# ======================================================================== 指纹 / 静态门禁（build 与 gates 共用）

def kit_fingerprint(pack) -> str:
    """kit 拥有产物的内容指纹（表行明文 + DSL/特效/预览字节）。与 manifest/voice/pixel 无关。"""
    return _sha("\n".join(kit_fingerprint_parts(pack)).encode("utf-8"))


def fingerprint_part_changes(before: list[str], after: list[str]) -> list[str]:
    """两次指纹逐项差异（``<表>#<键>`` / ``<文件>`` 标签）：定位 kit 之后被谁改了哪一项。"""
    split = lambda parts: dict(p.rpartition("=")[::2] for p in parts)  # noqa: E731
    old, new = split(before), split(after)
    return sorted(k for k in old.keys() | new.keys() if old.get(k) != new.get(k))


def stance_detail_check(ctx, design: dict) -> dict[str, Any]:
    """stance_detail 设计值（官方 131044 行）与框架 tables 按母本 151117 回写值的区分。"""
    import wf_seasonal7_common as C
    import wf_seasonal7_tables as T
    spec = ctx.spec
    package = ctx.pack.pkg_flat(STANCE).get(CID) if ctx.pack.pkg_has("common", STANCE) else None
    want = design["identity"]["explicit_rows"][STANCE]["value"]
    template_char = C.csv_split(ctx.template_flat(CHAR)[spec.template_id_s])[0]      # 与 tables 同源
    template_rows = C.csv_split(ctx.template_flat(STANCE)[spec.template_id_s])
    tables_value = C.csv_join(T.stance_detail_rows(template_rows, template_char[26], spec.stance, []))
    return classify_stance_detail(package, want, tables_value)


def classify_stance_detail(package: str | None, design_value: str, tables_value: str) -> dict[str, Any]:
    ok = package == design_value
    return {"package": package, "design": design_value, "tables_template_value": tables_value, "ok": ok,
            "reverted_by_tables": (not ok) and package == tables_value}


def kit_fingerprint_parts(pack) -> list[str]:
    import wf_mod_tool as core
    import wf_seasonal7_common as C
    parts: list[str] = []
    for logical, keys in KIT_TABLE_KEYS.items():
        rows = pack.pkg_flat(logical) if pack.pkg_has("common", logical) else {}
        for key in keys:
            parts.append(f"{logical}#{key}={_sha(rows.get(key, '<missing>').encode('utf-8'))}")
    for logical, outer in KIT_NESTED_KEYS.items():
        if pack.pkg_has("common", logical):
            nested = core.load_nested_table_bytes(pack.pkg_path("common", logical).read_bytes(), logical)
            inner = nested.rows[outer].text_rows() if outer in nested.rows else {}
        else:
            inner = {}
        parts.append(f"{logical}#{outer}={_sha(json.dumps(inner, ensure_ascii=False, sort_keys=True).encode('utf-8'))}")
    files = [C.wf_dsl.dsl_logical(DONOR_PROGRAM.format(code=CODE, level=lv)) for lv in (1, 2)] + [PREVIEW]
    base = pack.package / "roots" / "common"
    for fam in FAMILIES:
        dst = f"battle/effect/skill_unique/{CODE}_{fam['subdir']}"
        d = base / Path(*dst.split("/"))
        if d.is_dir():
            files += sorted(p.relative_to(base).as_posix() for p in d.rglob("*") if p.is_file())
    for logical in files:
        path = pack.pkg_path("common", logical)
        parts.append(f"{logical}={_sha(path.read_bytes()) if path.is_file() else '<missing>'}")
    return parts


# ======================================================================== Integrate：特效存储态 / 像素小人 / 语音状态

def fx_store_bytes(file: Path) -> bytes:
    """染色 PNG 的存储态原字节：真 PNG → 小写魔数（``wf_assets.png_encode``，不经 PIL 重编码）；已是存储态原样返回。

    框架 ``clone_effect_family(png_transform=…)`` 经 ``png_store_bytes`` 以 PIL optimize 重编码写 sheet
    （逐像素等于染色 PNG，但字节 ≠ 复核过的产物存储态），kit 克隆后用本函数的字节覆盖。"""
    import wf_assets
    raw = Path(file).read_bytes()
    if raw[:8] == wf_assets.PNG_FAKE:
        return raw
    if raw[:8] != wf_assets.PNG_REAL:
        raise KitError(f"fx/pixel PNG has unknown magic {raw[:8].hex()}: {file}")
    store = wf_assets.png_encode(raw)
    if wf_assets.png_decode(store) != raw or store[:8] != wf_assets.PNG_FAKE:
        raise KitError(f"store-form roundtrip failed: {file}")
    return store


def pixel_review_verdict(text: str, key: str = KEY) -> tuple[bool, str]:
    """``pixel/REVIEW.md`` 「修复轮复核」段结论表里 ``| <key> …`` 行是否判 **PASS**（初审段已被取代，不认）。"""
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.startswith("## ") and PIXEL_REVIEW_HEADING in ln), None)
    if start is None:
        return False, f"REVIEW.md 尚无「{PIXEL_REVIEW_HEADING}」段"
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    rows = [ln for ln in lines[start:end] if ln.lstrip().startswith("|")
            and ln.strip().strip("|").strip().split(" ")[0] == key]
    if not rows:
        return False, f"「{PIXEL_REVIEW_HEADING}」段没有 {key} 结论行"
    cells = [c.strip() for c in rows[0].strip().strip("|").split("|")]
    if not any(c.startswith("**PASS") for c in cells):
        return False, f"{key} 修复轮复核未判 PASS: {rows[0].strip()}"
    return True, rows[0].strip()


def pixel_inputs(root: Path) -> dict[str, Any]:
    """像素染色产物是否可装包：修复轮复核 PASS + ``verify_all.json`` 本角色 pass（H 门禁全过）
    + ``pixel/zantetsu/verify.json`` all_ok + report gates 全过 + out PNG sha = report outputs = 复核 H8 sha。

    返回 ``{"ready", "problems", "review", "outputs": {name: {file, sha256}}}``；problems 非空 = pending（不装包）。"""
    probs: list[str] = []
    state: dict[str, Any] = {"ready": False, "problems": probs, "outputs": {}}
    review = root / PIXEL_REVIEW_REL
    if review.is_file():
        ok, detail = pixel_review_verdict(review.read_text(encoding="utf-8"))
        state["review"] = detail
        if not ok:
            probs.append(detail)
    else:
        probs.append(f"{PIXEL_REVIEW_REL} 不存在")
    report_path, verify_path, verify_all_path = root / PIXEL_REPORT_REL, root / PIXEL_VERIFY_REL, root / PIXEL_VERIFY_ALL_REL
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
    if not report:
        probs.append(f"{PIXEL_REPORT_REL} 不存在")
    elif (report.get("key"), report.get("code")) != (KEY, D1_CODE) or report.get("gates_passed") is not True:
        probs.append(f"pixel report key/code/gates_passed = {report.get('key')}/{report.get('code')}/{report.get('gates_passed')}")
    bad_gates = sorted(k for k, g in (report.get("gates") or {}).items() if not (isinstance(g, dict) and g.get("ok") is True))
    if report and (bad_gates or not report.get("gates")):
        probs.append(f"pixel report gates not all ok: {bad_gates}")
    verify = json.loads(verify_path.read_text(encoding="utf-8")) if verify_path.is_file() else {}
    if verify.get("all_ok") is not True:
        probs.append(f"{PIXEL_VERIFY_REL} all_ok != true")
    verify_all = (json.loads(verify_all_path.read_text(encoding="utf-8")).get(KEY) or {}) if verify_all_path.is_file() else {}
    hard_bad = sorted(k for k, v in (verify_all.get("hard") or {}).items() if not (isinstance(v, dict) and v.get("ok")))
    if verify_all.get("pass") is not True or hard_bad or not verify_all.get("hard"):
        probs.append(f"pixel review verify_all {KEY}: pass={verify_all.get('pass')} hard_failed={hard_bad}")
    reviewed = ((verify_all.get("hard") or {}).get("H8_png_roundtrip") or {}).get("detail") or {}
    for name in PIXEL_SHEETS:
        png = root / PIXEL_OUT_REL / f"{name}.png"
        if not png.is_file():
            probs.append(f"pixel out 缺 {name}.png")
            continue
        digest = _sha(png.read_bytes())
        if ((report.get("outputs") or {}).get(name) or {}).get("sha256") != digest:
            probs.append(f"pixel out {name}.png sha {digest[:12]}… != report outputs")
        if (reviewed.get(name) or {}).get("sha256") != digest:
            probs.append(f"pixel out {name}.png sha {digest[:12]}… != 复核 verify_all H8 sha")
        state["outputs"][name] = {"file": str(png), "sha256": digest}
    state["ready"] = not probs
    return state


def pixel_package_problems(pack, sheet_bytes: dict[str, bytes] | None = None) -> list[str]:
    """包内像素小人核对（只读）：sheet 字节 = pixel/out PNG 的存储态；尺寸 / alpha / alpha==0 像素 RGBA = 母本；
    atlas/frame/timeline = 母本树（仅 ``character/<母本>/``→``character/<code>/``）；sheet owner=pixel、元数据未被他人登记。"""
    import numpy as np
    import wf_seasonal7_common as C
    state = pixel_inputs(pack.root)
    if not state["ready"]:
        return [f"pixel inputs not ready: {p}" for p in state["problems"]]
    probs: list[str] = []
    prefix = C.dir_prefix_map(D1_CODE, CODE)
    for name, metas in PIXEL_METADATA.items():
        logical = PIXEL_SHEET.format(code=CODE, name=name)
        tpl_logical = PIXEL_SHEET.format(code=D1_CODE, name=name)
        if sheet_bytes is not None and logical in sheet_bytes:
            raw = sheet_bytes[logical]
        elif pack.pkg_has("common", logical):
            raw = pack.pkg_path("common", logical).read_bytes()
        else:
            probs.append(f"package pixel sheet missing {logical}")
            continue
        if raw != fx_store_bytes(Path(state["outputs"][name]["file"])):
            probs.append(f"{logical} bytes != store form of pixel/zantetsu/out/{name}.png")
        _r, tpl_raw, _src = pack.template_asset(tpl_logical)
        pkg_arr, tpl_arr = np.asarray(C.png_open(raw)), np.asarray(C.png_open(tpl_raw))
        if pkg_arr.shape != tpl_arr.shape:
            probs.append(f"{logical} size {pkg_arr.shape} != template {tpl_arr.shape}")
        else:
            if not bool((pkg_arr[..., 3] == tpl_arr[..., 3]).all()):
                probs.append(f"{logical} alpha differs from template {tpl_logical}")
            clear = tpl_arr[..., 3] == 0
            if not bool((pkg_arr[clear] == tpl_arr[clear]).all()):
                probs.append(f"{logical} alpha==0 RGBA differs from template")
        if sheet_bytes is None and pack.owner_of("common", logical) != "pixel":
            probs.append(f"{logical} owner={pack.owner_of('common', logical)} (expected pixel)")
        for meta in metas:
            pkg_meta = PIXEL_SHEET.format(code=CODE, name=name).rsplit("/", 1)[0] + f"/{meta}"
            tpl_meta = tpl_logical.rsplit("/", 1)[0] + f"/{meta}"
            if not pack.pkg_has("common", pkg_meta):
                probs.append(f"package pixel metadata missing {pkg_meta}")
                continue
            owner = pack.owner_of("common", pkg_meta)
            if owner not in (None, "assets"):
                probs.append(f"{pkg_meta} owner={owner} (metadata must stay the template copy)")
            want = C.replace_strings(_amf_parse(pack.template_asset(tpl_meta)[1]), prefix)
            got = _amf_parse(pack.pkg_path("common", pkg_meta).read_bytes())
            if got != want:
                probs.append(f"{pkg_meta} differs from template metadata (only the path prefix may change)")
            if f"character/{D1_CODE}/" in json.dumps(got, ensure_ascii=False):
                probs.append(f"{pkg_meta} still references character/{D1_CODE}/")
    return probs


def install_pixel(ctx) -> dict[str, Any]:
    """复核通过的像素 sheet 以存储态（小写魔数，PNG 字节不重编码）写入包，owner=pixel；元数据不动。

    幂等：字节相同时 ``write_pkg`` 不改盘，登记 sha 不变。产物未就绪时不写，返回 pending。"""
    pack = ctx.pack
    state = pixel_inputs(ctx.root)
    if not state["ready"]:
        return {"status": "pending", "problems": state["problems"], "review": state.get("review")}
    store = {PIXEL_SHEET.format(code=CODE, name=name): fx_store_bytes(Path(out["file"]))
             for name, out in state["outputs"].items()}
    before_write = pixel_package_problems(pack, store)       # 先按将写字节校验尺寸/alpha/元数据，再落盘
    if before_write:
        raise KitError(f"pixel sheets fail pre-write checks: {before_write}")
    sheets = {}
    for name, out in state["outputs"].items():
        logical = PIXEL_SHEET.format(code=CODE, name=name)
        prior = pack.pkg_path("common", logical).read_bytes() if pack.pkg_has("common", logical) else None
        ctx.write_asset("common", logical, store[logical], owner="pixel")
        sheets[logical] = {"source": f"{PIXEL_OUT_REL}/{name}.png", "source_sha256": out["sha256"],
                           "store_sha256": _sha(store[logical]),
                           "previous_package_sha256": None if prior is None else _sha(prior),
                           "changed": prior != store[logical]}
    after = pixel_package_problems(pack)
    if after:
        raise KitError(f"pixel sheets did not land in the package: {after}")
    return {"status": "installed", "review": state.get("review"), "sheets": sheets, "problems": []}


def voice_state(pack) -> dict[str, Any]:
    """只读：AI 语音是否已装包——22 槽 MP3 在包内且 owner=voice（登记后未被改过）、speech 8 行引用
    home_0..5/join/evolution、语音目录无多余文件（母本旧语音已删）、character_text c11 = VOICE_ACTOR。"""
    import wf_seasonal7_common as C
    import wf_seasonal7_voice as V
    planned = [f"character/{CODE}/voice/{s}.mp3" for s in V.SLOTS]
    missing = [lg for lg in planned if not pack.pkg_has("common", lg)]
    not_voice = [lg for lg in planned if lg not in missing and pack.owner_of("common", lg) != "voice"]
    modified = [lg for lg in planned if lg not in missing and pack.modified_since_registration("common", lg)]
    rows = pack.pkg_flat(SPEECH) if pack.pkg_has("common", SPEECH) else {}
    refs = [cells[4] for cells in C.csv_split(rows[CID])] if CID in rows else []
    want_refs = [*V.HOME_SLOTS, "ally/join", "ally/evolution"]
    common = pack.package / "roots" / "common"
    voice_dir = common / "character" / CODE / "voice"
    extra = sorted(p.relative_to(common).as_posix() for p in voice_dir.rglob("*")
                   if p.is_file() and p.relative_to(common).as_posix() not in planned) if voice_dir.is_dir() else []
    cv = pack.pkg_character_text_row()[11]
    report = pack.read_evidence("voice-report.json", None) or {}
    problems = []
    if missing:
        problems.append(f"voice slots missing: {len(missing)}")
    if not_voice:
        problems.append(f"voice files not owned by voice: {len(not_voice)}")
    if modified:
        problems.append(f"voice files modified since registration: {modified[:3]}")
    if refs != want_refs:
        problems.append(f"character_speech refs {refs} != {want_refs}")
    if extra:
        problems.append(f"stale voice files in package: {extra}")
    if cv != V.VOICE_ACTOR:
        problems.append(f"character_text c11 {cv!r} != {V.VOICE_ACTOR!r}")
    if report.get("status") != "packed":
        problems.append(f"evidence/voice-report.json status={report.get('status')}")
    return {"packed": not problems, "problems": problems, "speech_refs": refs, "extra_voice_files": extra,
            "run": report.get("run"), "voice_actor": cv}


# ======================================================================== build

def build(ctx) -> dict[str, Any]:
    import wf_mod_tool as core
    import wf_dsl
    spec = ctx.spec
    root = ctx.root
    if (spec.cid_s, spec.code, spec.element, spec.pf_type, spec.stance) != (CID, CODE, ELEMENT, 0, "Attacker"):
        raise KitError(f"spec identity mismatch: {spec.cid_s} {spec.code}")
    if spec.identity != int(CID):
        raise KitError(f"c27 identity {spec.identity} != self cid (roster c27_policy)")
    design = load_design(root)
    text = design["text"]
    want_texts = {"name": text["name"], "furigana": text["name_en"], "title": text["nickname"],
                  "profile": text["profile"], "leader": text["leader_name"], "skill1": text["skill1_name"],
                  "desc1": text["skill1_desc"], "skill2": text["skill2_name"], "desc2": text["skill2_desc"],
                  "cv": text["cv"]}
    if want_texts != TEXTS or any(spec.texts[k] != v for k, v in TEXTS.items()):
        raise KitError("TEXTS drifted from design text section (or spec did not merge TEXTS)")
    notes: list[str] = []

    # ---- 1. 词条 / 队长（donor 回放 + 主控覆盖 F1）
    rows = design_rows(ctx, design)
    cas_text = {c["key"]: c["value"] for c in design["custom_strings"] if c["table"] == CAS}
    if set(cas_text) != {CAS_KEY}:
        raise KitError(f"design custom strings {sorted(cas_text)} != {{{CAS_KEY}}}")
    row_gates = {"leader_ability": [row_gate("leader_ability", r, set(cas_text)) for r in rows["leader"]],
                 "ability": {k: [row_gate("ability", r, set(cas_text)) for r in v]
                             for k, v in rows["abilities"].items()}}
    failed_rows = [f"leader#L{i}" for i, g in enumerate(row_gates["leader_ability"]) if _row_gate_failed(g)]
    failed_rows += [f"{k}#L{i}" for k, gs in row_gates["ability"].items() for i, g in enumerate(gs) if _row_gate_failed(g)]
    if failed_rows:
        raise KitError(f"row gates failed before write: {failed_rows}: "
                       + json.dumps(row_gates, ensure_ascii=False)[:1500])
    ctx.write_flat(ABILITY, rows["abilities"])
    ctx.write_flat(LEADER, {CID: rows["leader"]})
    ctx.write_flat(CAS, {CAS_KEY: [[cas_text[CAS_KEY]]]})

    # ---- 2. upskill / stance_detail 显式行（照 131044，黄→白）
    explicit = design["identity"]["explicit_rows"]
    donor_up = ctx.official_flat(UPSKILL)["131044"]
    if donor_up.replace("condition_effect_yellow_up", "condition_effect_white_up") != explicit[UPSKILL]["value"]:
        raise KitError("upskill design value does not follow official 131044 row")
    donor_stance = ctx.official_flat(STANCE)["131044"]
    if donor_stance != explicit[STANCE]["value"]:
        raise KitError("stance_detail design value does not equal official 131044 row")
    ctx.write_flat(UPSKILL, {CID: explicit[UPSKILL]["value"]})
    ctx.write_flat(STANCE, {CID: explicit[STANCE]["value"]})
    notes.append("character_stance_detail 由框架 tables 每次按母本 151117 重写为 \",1,1,1,,1,1,1\"；固定顺序 "
                 "tables → kit → assets → manifest → status，单独重跑 tables 后必须再跑 kit，发布前跑 kit gates"
                 "（stance_detail 与指纹逐项差异会拦下；框架限制，已报告主控）。")

    # ---- 3. action_skill 两档 + switched_action_skill 语音路由行
    act_official = core.load_nested_table_bytes(ctx.official_read(ACTION, "common"), ACTION)
    donor_inner = act_official.rows[D2_CODE].text_rows()
    action_rows: dict[str, list[str]] = {}
    for level in ("1", "2"):
        cells = ctx.csv_split(donor_inner[level])[0]
        if len(cells) != 24:
            raise KitError("official action_skill row width != 24")
        want = design["skills"]["action_skill_rows"][f"inner_{level}"]
        new = list(cells)
        for col, value in want.items():
            if int(col) >= 8 and new[int(col)] != value:
                raise KitError(f"action_skill donor c{col}={new[int(col)]!r} != design {value!r}")
            new[int(col)] = value
        if new[7] != ctx.program_path(level) or any(new[17:24]):
            raise KitError("action_skill program path / trailing columns unexpected")
        energy = design["skills"]["energy"][f"inner_{level}"]
        if [new[4], new[5], new[6]] != [energy["c4"], energy["c5"], energy["c6"]]:
            raise KitError("energy columns drift from design")
        action_rows[level] = new
    ctx.write_nested(ACTION, CODE, {lv: [cells] for lv, cells in action_rows.items()}, replace_inner=True)
    switched = {lv: cells[7:24] for lv, cells in action_rows.items()}
    ctx.write_nested(SWITCHED, VOICE_READY, {lv: [cells] for lv, cells in switched.items()}, replace_inner=True)

    # ---- 4. character 行（c9–c16 语音路由）+ character_text + 三层镜像
    crow = list(ctx.pack.pkg_character_row())
    cedits = design["identity"]["character_row"]
    if cedits["edits"]["14"] != VOICE_READY or [cedits["edits"][str(i)] for i in range(9, 17)] != ROUTE_COLS:
        raise KitError("design route columns drifted")
    if crow[9:17] != ROUTE_COLS and not (crow[9] == "(None)" and not any(crow[10:17])):
        raise KitError(f"character row carries an unrelated skill switch: {crow[9:17]}")
    crow[9:17] = ROUTE_COLS
    for col, value in {**cedits["edits"], **cedits["inherit_unchanged"]}.items():
        if crow[int(col)] != value:
            raise KitError(f"character c{col}={crow[int(col)]!r} != design {value!r}")
    ctx.write_flat(CHAR, {CID: [crow]})
    trow = list(text["character_text_row"])
    pkg_trow = ctx.pack.pkg_character_text_row()
    if pkg_trow != trow:
        notes.append("character_text 行与 tables 产出不同，已按设计行写入（下次 tables 会按 TEXTS 回写成同值）")
    ctx.write_flat(TEXT, {CID: [trow]})
    mirrors = ctx.sync_character_mirrors()

    # ---- 5. 特效族（sibling 形态）+ Effects 阶段染色钩子 + hit 音效改写
    dyed, fx_manifest_info = fx_manifest(root)
    fx_log: list[dict] = []
    families: dict[str, dict] = {}
    for fam in FAMILIES:
        donor = fam["src_dir"].rsplit("/", 1)[-1]
        dst_dir = f"battle/effect/skill_unique/{CODE}_{fam['subdir']}"
        want = next(c for c in design["effects"]["clone"] if c["id"] == fam["id"])
        if (want["src_dir"].rstrip("/"), want["dst"].rstrip("/"), tuple(want["fx_names"])) != (fam["src_dir"], dst_dir, fam["fx"]):
            raise KitError(f"effect family {fam['id']} drifted from design")
        transform = _png_transform_for(f"{fam['src_dir']}/{donor}.png",
                                       f"{dst_dir}/{dst_dir.rsplit('/', 1)[-1]}.png", dyed, fx_log)
        result = ctx.clone_effect_family(fam["src_dir"], fam["subdir"], fx_names=list(fam["fx"]),
                                         layout="sibling", png_transform=transform)
        if result["dst_dir"] != dst_dir or result["missing_effects"] or sorted(result["copied_bases"]) != sorted(fam["fx"]):
            raise KitError(f"effect clone incomplete for {fam['id']}: {result['missing_effects']}")
        if transform is not None:
            # 框架 clone 经 png_store_bytes（PIL optimize 重编码）写 sheet：逐像素 = 染色 PNG，字节 ≠ 产物存储态。
            # 改写为染色 PNG 的存储态原字节（owner 仍 effects），使包内 sha = 复核过的染色产物存储态 sha。
            dst_sheet = f"{dst_dir}/{dst_dir.rsplit('/', 1)[-1]}.png"
            sheet_root = next(f["root"] for f in result["files"] if f["target"] == dst_sheet)
            hits = [e for e in fx_log if e["target_sheet"] == dst_sheet]
            if len(hits) != 1:
                raise KitError(f"png_transform for {dst_sheet} ran {len(hits)} times (expected 1)")
            target = hits[0]
            exact = fx_store_bytes(Path(target["file"]))
            framework_bytes = ctx.pack.pkg_path(sheet_root, dst_sheet).read_bytes()
            if ctx.png_open(exact).tobytes() != ctx.png_open(framework_bytes).tobytes():
                raise KitError(f"fx store bytes decode differently from png_transform output: {dst_sheet}")
            ctx.write_asset(sheet_root, dst_sheet, exact, owner="effects")
            target.update({"package_sheet": dst_sheet, "root": sheet_root, "store_sha256": _sha(exact),
                           "framework_reencode_sha256": _sha(framework_bytes)})
        families[fam["id"]] = result
    matched = {e["source_sheet"] for e in fx_log} | {e["target_sheet"] for e in fx_log}
    stray_dyed = sorted(set(dyed) - matched)
    if stray_dyed:                                   # 路径写错 = 静默不装，直接拦
        raise KitError(f"fx manifest sheets match no cloned family: {stray_dyed}")
    if dyed and len(fx_log) != len(FAMILIES):
        notes.append(f"fx manifest 只覆盖 {len(fx_log)}/{len(FAMILIES)} 族 sheet，其余仍为官方原色")
    if fx_log:
        notes.append("特效 sheet 已装入 Effects 阶段染色产物（fx/zantetsu/out/manifest.json sha256="
                     f"{fx_manifest_info['sha256'][:12]}…）：" + "；".join(
                         f"{e['target_sheet']} ← {Path(e['file']).name}（存储态 {e.get('store_sha256', '?')[:12]}…，"
                         "alpha 逐字节不变）" for e in fx_log))
    # ---- 5b. 像素小人（修复轮复核 PASS 的染色 sheet，owner=pixel；未就绪时不写）
    pixel = install_pixel(ctx)
    if pixel["status"] == "installed":
        notes.append("像素小人：pixel/zantetsu/out 两张染色 sheet 已按存储态装包（owner=pixel，PNG 字节不重编码；"
                     "尺寸/alpha/透明像素 = 母本 smr22，atlas/frame/timeline 保持母本仅改路径前缀）："
                     + "；".join(f"{lg}（{v['store_sha256'][:12]}…）" for lg, v in pixel["sheets"].items()))
    else:
        notes.append("像素小人 pending（包内仍为母本像素）：" + "；".join(pixel["problems"][:4]))
    if not dyed:
        notes.append("fx/zantetsu/out/manifest.json 不存在：特效 sheet 仍是官方原色（Effects 阶段产出后重跑 kit 即自动装入）")
    ittou = families["S1_ittou"]
    hit_logical = f"{ittou['dst_dir']}/{HIT_TIMELINE_BASE}.timeline.amf3.deflate"
    hit_root = _family_root(ittou)
    hit_tree = ctx.amf_parse(ctx.pack.pkg_path(hit_root, hit_logical).read_bytes())
    sounds = [s for s in hit_tree.get("sounds") or [] if isinstance(s, dict) and s.get("path") == SE_FROM]
    if len(sounds) != 1:
        raise KitError(f"hit timeline SE {SE_FROM} not found exactly once")
    if ctx.pack.live_locate(SE_TO + ".mp3") is None:
        raise KitError(f"target SE mp3 absent from live store: {SE_TO}")
    sounds[0]["path"] = SE_TO
    ctx.write_asset(hit_root, hit_logical, ctx.amf_bytes(hit_tree), owner="kit")

    # ---- 6. 两棵技能树（官方基线拼装 → 特效重定向 → 与设计提案逐节点对照 → 门禁 → 落包）
    trees: dict[str, Any] = {}
    dsl_report: dict[str, Any] = {}
    for level in (1, 2):
        donors = {}
        for code in (D2_CODE, D1_CODE):
            program = DONOR_PROGRAM.format(code=code, level=level)
            logical = wf_dsl.dsl_logical(program)
            official = ctx.official_read(logical, "common")
            live = ctx.live_read(logical)
            if official is None:
                raise KitError(f"official baseline lacks donor DSL {logical}")
            if _sha(official) != _sha(live):
                notes.append(f"donor DSL {logical} live != official; official used")
            donors[code] = ctx.amf_parse(official)
        tree = compose_tree(donors[D2_CODE], donors[D1_CODE], level)
        refs = {}
        for fam_id in ("S2_kanbai", "S1_ittou"):
            tree, refs[fam_id] = ctx.rewrite_effect_refs(tree, families[fam_id], strict=True)
        proposal_path = root / PROPOSAL_REL.format(level=level)
        proposal_equal = (json.loads(proposal_path.read_text(encoding="utf-8")) == tree
                          if proposal_path.is_file() else None)
        if proposal_equal is False:
            raise KitError(f"composed tree {level} differs from design proposal_tree_{level}.json")
        raw = ctx.amf_bytes(tree)
        gate = dsl_gates(tree, raw, level, root)
        gate["effect_refs"] = refs
        gate["design_proposal_equal"] = proposal_equal
        if _dsl_gate_failed(gate):
            raise KitError(f"skill tree {level} gates failed: " + json.dumps(gate, ensure_ascii=False)[:1500])
        logical = ctx.write_dsl(ctx.program_path(str(level)), tree)
        trees[logical] = tree
        dsl_report[logical] = gate

    effect_refs = effect_reference_problems(ctx, trees)
    se_checks = [c for fam in families.values() for c in timeline_se_problems(ctx, fam)]
    if effect_refs["problems"] or not all(c["ok"] for c in se_checks):
        raise KitError("effect reference gates failed: "
                       + json.dumps({"refs": effect_refs["problems"],
                                     "se": [c for c in se_checks if not c["ok"]]}, ensure_ascii=False))

    # ---- 7. 技能预览（smr22 版克隆，end_frame 300→420）
    _r, template_preview_raw, _src = ctx.pack.template_asset(TEMPLATE_PREVIEW)
    preview = ctx.amf_parse(template_preview_raw)
    if preview["config"]["end_frame"] != 300:
        raise KitError(f"template preview end_frame drifted: {preview['config']['end_frame']}")
    preview["config"]["end_frame"] = PREVIEW_END_FRAME
    ctx.write_asset("common", PREVIEW, ctx.amf_bytes(preview), owner="kit")

    # ---- 8. 认领核对：框架克隆但本 kit 不用的键撤销（本角色预期为空）
    unclaimed = []
    for claim in ctx.pack.load_claims():
        if claim["logical_path"] == CAS:
            stray = [k for k in claim["outer_keys"] if k != CAS_KEY]
            if stray:
                ctx.unclaim(CAS, stray)
                unclaimed.append({"table": CAS, "keys": stray})
        if claim["logical_path"] in (ACTION, SWITCHED):
            for item in claim.get("inner_keys", []):
                stray = [k for k in item["keys"] if k not in ("1", "2")]
                if stray:
                    ctx.unclaim(claim["logical_path"], inner_outer_key=item["outer_key"], inner_keys=stray)
                    unclaimed.append({"table": claim["logical_path"], "outer": item["outer_key"], "inner": stray})

    # ---- 9. 能力声明 + 证据 + 报告
    caps = sorted({c for gs in row_gates["ability"].values() for g in gs for c in g["required_client_capabilities"]}
                  | {c for g in row_gates["leader_ability"] for c in g["required_client_capabilities"]})
    if caps != sorted(REQUIRED_CAPABILITIES) or tuple(sorted(spec.required_capabilities)) != tuple(sorted(REQUIRED_CAPABILITIES)):
        raise KitError(f"row capabilities {caps} != declared {REQUIRED_CAPABILITIES} / spec {spec.required_capabilities}")
    doll = doll_color_checks(ctx.pack)
    if doll["problems"]:
        notes.append("小人同色核对未过（kit-report 保持 draft，gates 同样会拦）：" + "；".join(doll["problems"][:6]))
    voice = voice_state(ctx.pack)
    notes.append(f"语音：AI 合成配音 22 槽已装包（run={voice['run']}，speech 引用 home_0..5/join/evolution，母本旧语音已删）"
                 if voice["packed"] else
                 "语音 pending（kit 不写语音；装包后跑 impl/zantetsu/voice_merge.py）：" + "；".join(voice["problems"][:4]))
    fingerprint_parts = kit_fingerprint_parts(ctx.pack)
    fingerprint = _sha("\n".join(fingerprint_parts).encode("utf-8"))
    kit_gates = {
        "kit_fingerprint": fingerprint, "kit_fingerprint_parts": fingerprint_parts,
        "rows": row_gates, "records": rows["records"], "dsl": dsl_report,
        "effect_references": effect_refs, "timeline_sounds": se_checks,
        "fx_manifest": fx_manifest_info, "fx_ingested": fx_log, "doll_colors": doll,
        "pixel": pixel, "voice": voice,
        "required_capabilities": caps, "unclaimed": unclaimed,
        "mirrors": {"server_character": mirrors["server_character"]},
    }
    ctx.evidence_write("kit-gates.json", kit_gates)

    gates_path = root / IMPL_REL / "gates.json"
    prior = json.loads(gates_path.read_text(encoding="utf-8")) if gates_path.is_file() else {}
    ready = (bool(prior.get("all_pass")) and prior.get("kit_fingerprint") == fingerprint
             and prior.get("kit_source_sha256") == kit_source_sha256() and not doll["problems"]
             and pixel["status"] == "installed" and voice["packed"])
    panel = ["队长 L%d：%s" % (i + 1, g["describe"]) for i, g in enumerate(row_gates["leader_ability"])]
    for key, gs in row_gates["ability"].items():
        for i, g in enumerate(gs):
            panel.append(f"词条 {key}#{i + 1}：{g['describe']}")
    notes += [
        "主控覆盖：槽4 第1条 112（零先例）→ 退路 F1 507「自身 光属性抗性降低中的敌人 攻击特攻 60%→120%」；"
        "112 行与金丝雀①比值 A/B 不再适用，F2(694) 未启用。",
        "一刀两断「RP1 为原点的 RP 再移动」是零先例组合（设计金丝雀②），退路=CRP8 node[1] 1→-18、node[4] 300→0。",
        "custom_ability_power_up_string 未写：客户端缺键按等级 1 处理不崩（CustomAbilityPowerUpStringTools），设计未要求。",
        "静态门禁 ≠ 真机验收。",
    ]
    report = {
        "summary": "斩铁·白梅 kit：18 行（12 词条+6 队长，槽4#1 按主控覆盖用 F1/507）、两棵拼装技能树、"
                   "两族特效克隆（染色 sheet 存储态）、语音路由、预览 420 帧；像素小人 "
                   + ("已装包" if pixel["status"] == "installed" else "pending")
                   + "；AI 语音 " + ("已装包" if voice["packed"] else "pending"),
        "status": "ready-for-review" if ready else "draft",
        "skills": {"programs": sorted(trees)},
        "required_capabilities": list(REQUIRED_CAPABILITIES),
        "panel": panel,
        "notes": notes,
        "kit_fingerprint": fingerprint,
        "gates": str(gates_path),
    }
    ctx.report(report)
    return {"status": report["status"], "kit_fingerprint": fingerprint, "programs": sorted(trees),
            "effects": {k: v["dst_dir"] for k, v in families.items()}, "fx_ingested": len(fx_log),
            "pixel": pixel["status"], "voice_packed": voice["packed"],
            "unclaimed": unclaimed, "notes": notes}


# ======================================================================== 离线门禁 CLI

def run_gates() -> dict[str, Any]:
    """从包内现状复跑门禁（行/树/特效/描述/能力声明）+ 读 flow inspect 证据；结果写 impl/zantetsu/gates.json。
    全过 → 把 evidence/kit-report.json 置 ready-for-review（之后需重跑 --step manifest,status 刷新快照）。"""
    import wf_client_legality as L
    import wf_mod_tool as core
    import wf_seasonal7_build as B
    import wf_seasonal7_common as C
    import wf_seasonal7_specs as S
    spec = S.get_spec(KEY)
    pack = C.S7Pack(spec)
    ctx = B.KitContext(pack)
    root = pack.root
    impl = root / IMPL_REL
    impl.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    cas_keys = set(pack.pkg_flat(CAS)) if pack.pkg_has("common", CAS) else set()
    ability_rows = {k: C.csv_split(v) for k, v in pack.pkg_flat(ABILITY).items() if k in KIT_TABLE_KEYS[ABILITY]}
    leader_rows = C.csv_split(pack.pkg_flat(LEADER)[CID])
    rows = {"leader_ability": {CID: [row_gate("leader_ability", r, cas_keys) for r in leader_rows]},
            "ability": {k: [row_gate("ability", r, cas_keys) for r in ability_rows[k]] for k in sorted(ability_rows)}}
    if sorted(ability_rows) != list(KIT_TABLE_KEYS[ABILITY]):
        failures.append(f"ability keys in package {sorted(ability_rows)}")
    for kind, table in rows.items():
        for key, gs in table.items():
            for i, g in enumerate(gs):
                if _row_gate_failed(g):
                    failures.append(f"{kind} {key}#L{i}: row gate")
    design = load_design(root)
    expected = design_rows(ctx, design)
    if [list(r) for r in leader_rows] != expected["leader"] or {k: [list(r) for r in v] for k, v in ability_rows.items()} != expected["abilities"]:
        failures.append("package ability/leader rows differ from design replay (with F1 override)")
    if CAS_KEY not in cas_keys:
        failures.append(f"{CAS_KEY} missing from package custom_ability_string")

    row_caps = sorted({c for table in rows.values() for gs in table.values() for g in gs
                       for c in g["required_client_capabilities"]})
    manifest = json.loads((pack.package / "manifest.json").read_text(encoding="utf-8"))
    manifest_caps = sorted(manifest.get("required_capabilities") or [])
    if row_caps != manifest_caps:
        failures.append(f"manifest required_capabilities {manifest_caps} != row patch kinds {row_caps}")
    cas_caps = sorted({c for k in cas_keys if k in (CAS_KEY,) for c in L.required_client_capabilities(L.CUSTOM_ABILITY_STRING_KIND, [k])})
    if cas_caps:
        failures.append(f"custom_ability_string keys need panel capability {cas_caps}")

    dsl = {}
    trees = {}
    for level in (1, 2):
        logical = C.wf_dsl.dsl_logical(ctx.program_path(str(level)))
        raw = pack.pkg_path("common", logical).read_bytes()
        tree = C.amf_parse(raw)
        gate = dsl_gates(tree, raw, level, root)
        proposal_path = root / PROPOSAL_REL.format(level=level)
        if proposal_path.is_file():
            gate["design_proposal_equal"] = json.loads(proposal_path.read_text(encoding="utf-8")) == tree
            if not gate["design_proposal_equal"]:
                failures.append(f"tree {level} differs from design proposal")
        if _dsl_gate_failed(gate):
            failures.append(f"tree {level}: dsl gate")
        dsl[logical] = gate
        trees[logical] = tree
    effect_refs = effect_reference_problems(ctx, trees)
    if effect_refs["problems"]:
        failures.append("effect references unresolved")
    families = pack.read_evidence("effect-families.json", {}) or {}
    se_checks = []
    for fam in FAMILIES:
        dst = f"battle/effect/skill_unique/{CODE}_{fam['subdir']}"
        entry = families.get(dst)
        if entry is None:
            failures.append(f"effect family not registered: {dst}")
            continue
        entry = dict(entry, files=[{"root": "common"}])
        se_checks += timeline_se_problems(ctx, entry)
    if not all(c["ok"] for c in se_checks):
        failures.append("timeline SE unresolved")
    hit = [c for c in se_checks if c["timeline"].endswith(f"{HIT_TIMELINE_BASE}.timeline.amf3.deflate")]
    if [c["se"] for c in hit] != [SE_TO]:
        failures.append(f"hit timeline SE not rewritten: {[c['se'] for c in hit]}")
    fx_sheets = fx_sheet_checks(pack)
    for check in fx_sheets["sheets"]:
        if check["problems"]:
            failures.append(f"fx sheet {check['sheet']}: {check['problems']}")

    act = core.load_nested_table_bytes(pack.pkg_path("common", ACTION).read_bytes(), ACTION).rows[CODE].text_rows()
    sw = core.load_nested_table_bytes(pack.pkg_path("common", SWITCHED).read_bytes(), SWITCHED).rows[VOICE_READY].text_rows()
    action = {k: C.csv_split(v)[0] for k, v in act.items()}
    switched = {k: C.csv_split(v)[0] for k, v in sw.items()}
    if sorted(action) != ["1", "2"] or any(switched.get(k) != action[k][7:24] for k in action):
        failures.append("switched_action_skill rows != action_skill c7..c23")
    crow = pack.pkg_character_row()
    if crow[9:17] != ROUTE_COLS:
        failures.append(f"character c9-16 {crow[9:17]} != route {ROUTE_COLS}")
    import wf_seasonal7_voice as V
    try:
        V.route_character_row(crow, V.normalize_route({"columns": ROUTE_COLS}, CODE), CODE)
        V.switched_rows({k: action[k] for k in ("1", "2")})
    except ValueError as exc:
        failures.append(f"voice pack_voice column contract: {exc}")
    if pack.pkg_character_text_row() != design["text"]["character_text_row"]:
        failures.append("character_text row != design character_text_row")
    mirror = json.loads(pack.pkg_path("server", "cdndata/character.json").read_bytes()).get(CID)
    if not (isinstance(mirror, list) and mirror and mirror[0] == crow):
        failures.append("server cdndata/character.json mirror != package character row (sync_character_mirrors)")
    if pack.pkg_flat(UPSKILL).get(CID) != design["identity"]["explicit_rows"][UPSKILL]["value"]:
        failures.append("upskill row != design")
    if C.csv_split(pack.pkg_flat(CAS).get(CAS_KEY, "")) != [[next(c["value"] for c in design["custom_strings"])]]:
        failures.append("custom_ability_string text != design")
    claims = {(c["root"], c["logical_path"]): c for c in pack.load_claims()}
    for logical, keys in KIT_TABLE_KEYS.items():
        claim = claims.get(("common", logical))
        if claim is None or not set(keys) <= set(claim["outer_keys"]):
            failures.append(f"claim missing for {logical} {keys}")
    for logical, outer in KIT_NESTED_KEYS.items():
        claim = claims.get(("common", logical))
        inner = {i["outer_key"]: i["keys"] for i in (claim or {}).get("inner_keys", [])}
        if claim is None or sorted(inner.get(outer, [])) != ["1", "2"]:
            failures.append(f"nested claim missing for {logical}#{outer}")
    stance = stance_detail_check(ctx, design)
    if stance["reverted_by_tables"]:
        failures.append(f"stance_detail {stance['package']!r} = 框架 tables 按母本 151117 回写值（tables 在 kit 之后运行）："
                        f"按 tables → kit → assets → manifest → status 重跑 --step kit，恢复设计 {stance['design']!r}")
    elif not stance["ok"]:
        failures.append(f"stance_detail {stance['package']!r} != design {stance['design']!r}")
    doll = doll_color_checks(pack)
    for problem in doll["problems"]:
        failures.append(f"doll colors: {problem}")
    pixel_problems = pixel_package_problems(pack)
    for problem in pixel_problems:
        failures.append(f"pixel: {problem}")
    voice = voice_state(pack)
    for problem in voice["problems"]:
        failures.append(f"voice: {problem}")
    preview = C.amf_parse(pack.pkg_path("common", PREVIEW).read_bytes())
    if preview["config"]["end_frame"] != PREVIEW_END_FRAME:
        failures.append("skill preview end_frame not 420")
    owned = pack.owned_outputs()
    if owned.get(f"common:{PREVIEW}") != "kit":
        failures.append("skill preview not registered as kit output")

    inspect = pack.read_evidence("flow-inspect.json", {}) or {}
    summary = inspect.get("summary") or {}
    flow = {"master_reference": summary.get("master_reference"), "preflight": summary.get("preflight"),
            "structurally_ready": summary.get("structurally_ready"), "errors": summary.get("errors"),
            "missing_required": summary.get("missing_required"),
            "three_layer_claim_status": summary.get("three_layer_claim_status")}
    mr = summary.get("master_reference") or {}
    if mr.get("problems") != [] or mr.get("missing") not in ([], None):
        failures.append(f"inspect master_reference problems={mr.get('problems')} missing={mr.get('missing')}")
    pre = summary.get("preflight") or {}
    if not (summary.get("structurally_ready") and pre.get("can_prepare") and pre.get("conflicts") == []):
        failures.append("inspect: flow preflight not structurally ready")
    report_status = pack.read_evidence("status.json", None)
    manifest_report = pack.read_evidence("manifest_report.json", {}) or {}
    if manifest_report.get("validate_manifest") or any((manifest_report.get("reconcile") or {}).values()):
        failures.append("manifest gate problems")
    manifest_sha = _sha((pack.package / "manifest.json").read_bytes())
    if manifest_report.get("manifest_sha256") != manifest_sha:
        failures.append("manifest_report is stale (rerun --step manifest)")

    describe = {"leader_ability": {CID: [g["describe"] for g in rows["leader_ability"][CID]]},
                "ability": {k: [g["describe"] for g in gs] for k, gs in rows["ability"].items()}}
    (impl / "describe.json").write_text(_json(describe), encoding="utf-8")
    fingerprint_parts = kit_fingerprint_parts(pack)
    fingerprint = _sha("\n".join(fingerprint_parts).encode("utf-8"))
    kit_gates = pack.read_evidence("kit-gates.json", {}) or {}
    fingerprint_changes = None
    if kit_gates.get("kit_fingerprint") != fingerprint:
        if kit_gates.get("kit_fingerprint_parts"):
            fingerprint_changes = fingerprint_part_changes(kit_gates["kit_fingerprint_parts"], fingerprint_parts)
        failures.append("package kit outputs changed since last kit build (rerun --step kit)"
                        + (f": {fingerprint_changes}" if fingerprint_changes else ""))
    result = {
        "character": KEY, "cid": CID, "code": CODE,
        "all_pass": not failures, "failures": failures,
        "kit_fingerprint": fingerprint, "kit_fingerprint_changes_since_kit": fingerprint_changes,
        "kit_source_sha256": kit_source_sha256(),
        "manifest_sha256": manifest_sha,
        "override": {"slot4_record1": SLOT4_OVERRIDE, "note": "112 → F1 507（主控拍板）"},
        "stance_detail": stance, "doll_colors": doll,
        "pixel": {"problems": pixel_problems, "inputs": pixel_inputs(root)}, "voice": voice,
        "rows": rows, "row_required_capabilities": row_caps, "manifest_required_capabilities": manifest_caps,
        "dsl": dsl, "effect_references": effect_refs, "timeline_sounds": se_checks, "fx_sheets": fx_sheets,
        "flow_inspect": flow, "status_json_present": report_status is not None,
        "describe": str(impl / "describe.json"),
    }
    (impl / "gates.json").write_text(_json(result), encoding="utf-8")
    report = pack.read_evidence("kit-report.json", None)
    if isinstance(report, dict):
        report["status"] = "ready-for-review" if not failures else "draft"
        pack.write_evidence("kit-report.json", report)
    return {"all_pass": not failures, "failures": failures, "gates": str(impl / "gates.json"),
            "kit_fingerprint": fingerprint}


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    args = list(sys.argv[1:] if argv is None else argv)
    if args != ["gates"]:
        print("usage: python mod-tools/wf_seasonal7_kit_zantetsu.py gates")
        return 2
    result = run_gates()
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0 if result["all_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
