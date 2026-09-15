# -*- coding: utf-8 -*-
"""季节换装七角色 kit：雷吉斯·海滨 139994 ``rec_android_seaside``（设计定稿 design/regis.json）。

由 ``python mod-tools/wf_seasonal7_build.py --char regis --step kit`` 调用 :func:`build`。
只写 ``work/character_packs/s7-regis/``（经 KitContext）；live store / assets / .cdn / src 只读。

落地内容（全部以设计 JSON 为准，逐项断言）：
- character 行 c9–c16 语音路由、c18 队长名；character_text 12 列；三层镜像；
- 队长 6 行、词条 6 键 11 条：按 donor（官方基线 / live）+ 声明编辑重建，并与 ``row_built`` 逐格核对；
- custom_ability_string 7 条 ``desc_override_*``（panel-description-override-v2）；
- action_skill 两档（名称/描述/能量 c4–c6）；upskill ``skill_damage_up``→``ability_damage_up``
  （技能删 ACSkillDamage、加 ACAbilityDamage，与官方夏日莉莉丝 151045 同写法）；
- 两棵技能 DSL：官方 131020 骨架 + ★4 231003 光束 + 151045 雷队能力伤害状态（移植
  design/_tmp/regis/d09_compose_final.py），特效引用经 ``rewrite_effect_refs`` 改写，
  与设计定稿树逐节点严格比对；
- 两个特效族克隆（``seaside_beam`` / ``seaside_ray``，layout=codename）；按
  ``seasonal7-20260916/fx/regis/out/manifest.json`` 的 {源 sheet 逻辑路径 → 染色 PNG} 替换 sheet，
  写后逐像素核对包内 sheet = 染色 PNG、alpha = 母本（设计 §5 要求两张都换色）；
- switched_action_skill ``rec_android_seaside_voice_ready`` 两档（= action_skill c7–c23，
  与 ``wf_seasonal7_voice.switched_rows`` 同约定）；
- 像素小人（Integrate）：``seasonal7-20260916/pixel/regis/out/{sprite_sheet,special_sprite_sheet}.png``
  在 report 门禁全过、``pixel/_review/verify_all.json`` 复核全过且 sha 一致时，以存储态写入
  ``character/<code>/pixelart/``（owner=pixel），写后核对尺寸/alpha = 母本、元数据 = 母本（仅路径前缀）；
  未就绪时不写。语音由 ``impl/regis/voice_merge.py``（``wf_seasonal7_voice pack``）装包，kit 只读报告状态。

kit-report 的 ``status``：只有 ``impl/regis/gates.json`` 全过、其 ``kit_fingerprint`` 与本次产物
指纹一致、且两张特效 sheet 都已按 fx manifest 换色时才写 ``ready-for-review``，否则 ``draft``
（门禁脚本 ``impl/regis/gates.py``）。指纹含特效 sheet 字节与 fx manifest/染色 PNG 的 sha256：
kit 跑完后染色产物才出现或被重做，重算指纹即与 kit-report / gates.json 不一致。

未跟踪输入（``work/`` 被 .gitignore 排除；干净检出须先恢复 seasonal7-20260916 批目录，
build 开头统一检查并报清单）：``design/regis.json``、``design/_tmp/regis/final_rec_android_seaside_{1,2}.json``、
``research/_tmp/official_sig.json``（官方全库参数形状表，``research/_tmp/official_sig.py`` 生成）、
``fx/regis/out/``（缺失时不报错，只把 status 压成 draft）。设计期静态校验
（``research/_tmp/blueprint_build.check``）已移植为本模块 :func:`blueprint_check`，不再运行时 import。
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

KEY = "regis"
CID = "139994"
CODE = "rec_android_seaside"
ELEMENT = 2
BATCH = "work/character_packs/seasonal7-20260916"
DESIGN_REL = f"{BATCH}/design/regis.json"
DESIGN_TREE_REL = BATCH + "/design/_tmp/regis/final_rec_android_seaside_{level}.json"
FX_MANIFEST_REL = f"{BATCH}/fx/regis/out/manifest.json"
GATES_REL = f"{BATCH}/impl/regis/gates.json"
OFFICIAL_SIG_REL = f"{BATCH}/research/_tmp/official_sig.json"

CHAR = "master/character/character.orderedmap"
TEXT = "master/character/character_text.orderedmap"
ABILITY = "master/ability/ability.orderedmap"
LEADER = "master/ability/leader_ability.orderedmap"
CAS = "master/string/custom_ability_string.orderedmap"
ACTION = "master/skill/action_skill.orderedmap"
SW = "master/skill/switched_action_skill.orderedmap"
UPSKILL = "master/mana_board/upskill.orderedmap"
VOICE_KEY = f"{CODE}_voice_ready"

CAS_KEYS = (f"desc_override_{CODE}", *[f"desc_override_{CODE}_{i}" for i in range(1, 7)])
CAPABILITIES = ("kyubi-fever-ratio-v1", "panel-description-override-v2")

EFFECT_FAMILIES = (
    # (源目录, 目标子目录, 基名) —— 设计 effects.clone
    ("battle/effect/skill_unique/rec_android_1anv", "seaside_beam",
     ("rec_android_1anv_beam", "rec_android_1anv_beam_hit", "rec_android_1anv_beam_player",
      "rec_android_1anv_beam_shadow", "rec_android_1anv_laser", "rec_android_1anv_charge",
      "rec_android_1anv_charge_back")),
    ("battle/effect/skill_unique/rec_android", "seaside_ray", ("rec_android",)),
)

# 设计 §4 倍率（[{min,max}]），与 d09_compose_final.LEVELS 相同
LEVELS = {
    "1": dict(fever=[{"min": 3.8, "max": 3.8}], laser=[{"min": 0.9, "max": 0.9}],
              ray=[{"min": 2.0, "max": 2.0}], abd=[{"min": 1.0, "max": 1.0}]),
    "2": dict(fever=[{"min": 4.5, "max": 5.0}], laser=[{"min": 1.25, "max": 1.4}],
              ray=[{"min": 2.6, "max": 2.8}], abd=[{"min": 1.25, "max": 1.5}]),
}
SOURCE_PROGRAMS = {
    "skeleton": "battle/action/skill/action/rare5/rec_android_1anv$rec_android_1anv_{level}",
    "ray": "battle/action/skill/action/rare4/rec_android$rec_android_{level}",
    "smr21": "battle/action/skill/action/rare5/resistance_princess_smr21$resistance_princess_smr21_{level}",
}
# 设计记录的官方 deflate sha256（只登记了内层 1；内层 2 取官方基线并与定稿树比对）
SOURCE_SHA_L1 = {
    "skeleton": "14f6659eb98177f791bbd11e9fab3dac6fc88057f8c3b87557a86b81a318b88f",
    "ray": "53783e54097edcd47882cfc3899594b3f91d86802b7a80e1e9e8c2234b483ac2",
    "smr21": "c6b561867bb2d30e2ea5f6ef1a997b40f4c7d5caa5877457bc1304527488face",
}

# 覆盖文案禁词（记忆卡 wf-leader-override-text-rules / wf-no-hplow-text-discipline）
FORBIDDEN_PANEL_WORDS = ("自身为队长时", "觉醒后", "生命值100%以下", "HP100%以下", "null")

TEXTS = {
    "title": "海滨约会的白花机人",
    "profile": ("为了一场海边约会，特意换上白礼服与草帽的机人绅士。花形浮游机替他捕捉浪花里的光，"
                "白伞总是先倾向身旁的人。他自称此行只为记录人类的休日文化——至于记录里为何总有同一个人的笑容，"
                "想必又是另一桩计谋。"),
    "leader": "约会纪念模式",
    "skill1": "浪花爆破",
    "desc1": ("【通常】向距离最近的敌人同时释放激光炮与电子光束，对命中的敌人造成雷属性伤害＋赋予自身攻击力提升效果／FEVER槽增加\n"
              "【FEVER状态中】向距离最近的敌人释放超高功率激光炮，对命中的敌人造成雷属性伤害\n"
              "发动时赋予雷属性角色能力伤害提升效果。技能伤害量以能力伤害加成判定。"),
    "skill2": "浪花爆破＋",
    "desc2": ("【通常】向距离最近的敌人同时释放激光炮与电子光束，对命中的敌人造成雷属性伤害＋赋予自身攻击力提升效果／FEVER槽增加\n"
              "【FEVER状态中】向距离最近的敌人释放超高功率激光炮，对命中的敌人造成雷属性伤害\n"
              "发动时赋予雷属性角色能力伤害提升效果。技能伤害量以能力伤害加成判定。"),
    "cv": "AI 合成配音",
}

SPEC = {
    "required_capabilities": CAPABILITIES,
    "extra_keys": {CAS: CAS_KEYS, SW: (VOICE_KEY,)},
}


class KitError(RuntimeError):
    pass


# ---------------------------------------------------------------- 纯函数

def strict_equal(a: Any, b: Any) -> bool:
    """树逐节点比较：bool/int/float 类型也必须一致（AMF3 int 与 double 编码不同）。"""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) or isinstance(b, (int, float)):
        return type(a) is type(b) and a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(strict_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(strict_equal(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b


def first_difference(a: Any, b: Any, path: str = "$") -> str | None:
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: len {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            return f"{path}: keys {sorted(a)} != {sorted(b)}"
        for k in a:
            d = first_difference(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    return None if strict_equal(a, b) else f"{path}: {a!r} != {b!r}"


def cmd(node):
    return node[1] if isinstance(node, list) and node and node[0] == "Command" else None


def iter_commands(node, name: str | None = None):
    """深度优先枚举 ``["Command", [name, ...]]`` 的参数表。"""
    if isinstance(node, list):
        if node and node[0] == "Command" and len(node) == 2 and isinstance(node[1], list):
            if name is None or node[1][0] == name:
                yield node[1]
        for child in node:
            yield from iter_commands(child, name)
    elif isinstance(node, dict):
        for child in node.values():
            yield from iter_commands(child, name)


def first_cna(block) -> list:
    for x in block[1]:
        c = cmd(x)
        if c and c[0] == "CreateNormalAttack":
            return c
    raise KitError("no CreateNormalAttack in onHit block")


def hits_by_formula(cha: list) -> int:
    life, n = cha[13][1], cha[14][1]
    interval = life / (n - 0.5)
    return math.floor((life - 1e-9) / interval) + 1


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_design(root: Path) -> dict:
    design = json.loads((root / DESIGN_REL).read_text(encoding="utf-8"))
    if design.get("status") != "final" or design.get("key") != KEY:
        raise KitError(f"design not final for {KEY}: status={design.get('status')}")
    ident = design["identity"]
    if (ident["cid"], ident["code"], ident["element"]) != (CID, CODE, ELEMENT):
        raise KitError(f"design identity mismatch: {ident['cid']}/{ident['code']}")
    return design


def design_text_rows(design: dict) -> dict:
    t = design["text"]
    return {
        "character_text": [t["name"], t["furigana_c1"], t["profile_c2"], t["nickname_c3"],
                           t["skill1_name_c4"], t["skill1_desc_c5"], t["skill2_name_c6"], t["skill2_desc_c7"],
                           t["c8"], t["c9"], t["leader_name_c10"], t["cv_c11"]],
        "action": {lv: list(v) for lv, v in t["action_skill_c0_c1"].items()},
    }


def check_texts_constant(design: dict) -> list[str]:
    """模块常量 TEXTS 必须与设计一致（tables 重跑时靠 TEXTS 写 character_text / action_skill）。"""
    t = design["text"]
    want = {"title": t["nickname_c3"], "profile": t["profile_c2"], "leader": t["leader_name_c10"],
            "skill1": t["skill1_name_c4"], "desc1": t["skill1_desc_c5"], "skill2": t["skill2_name_c6"],
            "desc2": t["skill2_desc_c7"], "cv": t["cv_c11"]}
    probs = [f"TEXTS.{k} != design" for k, v in want.items() if TEXTS.get(k) != v]
    if design["text"]["name"] != "雷吉斯" or design["text"]["furigana_c1"] != "LEIJISI":
        probs.append("design name/furigana differs from spec")
    return probs


def panel_text_problems(text: str) -> list[str]:
    return [f"panel text contains forbidden word {w!r}" for w in FORBIDDEN_PANEL_WORDS if w in text]


def untracked_input_problems(root: Path) -> list[str]:
    """kit 运行必需、但位于被 .gitignore 排除的 ``work/`` 下的输入；缺失时给出清单而不是深处的
    ImportError / FileNotFoundError。fx manifest 与 gates.json 可缺（只影响 status）。"""
    needed = {
        DESIGN_REL: "设计定稿（全部行 / 文案 / 语音路由的来源）",
        DESIGN_TREE_REL.format(level="1"): "设计定稿技能树 1（严格逐节点比对）",
        DESIGN_TREE_REL.format(level="2"): "设计定稿技能树 2（严格逐节点比对）",
        OFFICIAL_SIG_REL: "官方全库 DSL 参数形状表（F1034 形状差分；research/_tmp/official_sig.py 生成）",
    }
    return [f"{rel}: {why}" for rel, why in needed.items() if not (root / rel).is_file()]


# ---- 设计期静态校验：移植自 research/_tmp/blueprint_build.check（逐条等价，见 impl/regis/fix-log.md）
_BP_LOOKUP = {"StopBall": [1], "ShowEffect": [3], "AddSkillPoint": [1], "CreateCondition": [1], "CreateHitArea": [2],
              "CreateNormalAttack": [1], "CreateRatioAttack": [1], "CreateFixedAttack": [1], "CreateRatioHeal": [1],
              "FindNearSubjects": [1], "CreateReferencePoint": [1], "MoveHitArea": [1], "RotateHitArea": [1]}
_BP_BUILTIN = {-1, -2, -17, -18, -33}
_OFFICIAL_SIG_CACHE: dict[str, dict[str, list[str]]] = {}


def _bp_tag(v):
    return v[0] if isinstance(v, list) and v and isinstance(v[0], str) else None


def _bp_kind(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "num"
    if isinstance(v, str):
        return "str"
    if isinstance(v, list):
        if v and all(isinstance(x, dict) for x in v):
            return "slv"
        t = _bp_tag(v)
        if t in ("Block", "Command", "Event"):
            return "expr"
        if t is not None:
            return "enum:" + t
        return "list"
    return "dict"


def load_official_sig(root: Path) -> dict[str, list[str]]:
    path = root / OFFICIAL_SIG_REL
    cache_key = str(path)
    if cache_key not in _OFFICIAL_SIG_CACHE:
        if not path.is_file():
            raise KitError(f"official DSL signature table missing: {OFFICIAL_SIG_REL} "
                           "(work/ is gitignored; regenerate with research/_tmp/official_sig.py)")
        _OFFICIAL_SIG_CACHE[cache_key] = json.loads(path.read_text(encoding="utf-8"))
    return _OFFICIAL_SIG_CACHE[cache_key]


def blueprint_check_with_sig(tree, off: dict[str, list[str]]) -> tuple[list[str], int, bool]:
    """官方签名差分 / 参数个数 / 作用域 C16103 / GH / CD 挂 -17/-18 / Rectangle 三元组 / 绑定 id 重复 /
    AMF3 往返 / 我方方向。与 blueprint_build.check 同口径（问题文本逐字相同）。"""
    import wf_dsl
    import wf_dsl_sig as SIG
    probs: list[str] = []
    ids_seen: dict[Any, int] = {}

    def seen(x):
        ids_seen[x] = ids_seen.get(x, 0) + 1

    def walk(n, scope):
        t = _bp_tag(n)
        if t == "Block":
            for x in n[1]:
                walk(x, scope)
            return
        if t == "Event":
            ev = n[1]
            if ev[0] not in SIG.EVENTS:
                probs.append("未知事件 " + ev[0])
            elif len(ev) - 1 != len(SIG.EVENTS[ev[0]]):
                probs.append(f"事件参数数 {ev[0]} {len(ev) - 1}")
            for x in ev[1:]:
                if _bp_tag(x) in ("Block", "Command", "Event"):
                    walk(x, scope)
            return
        if t == "Command":
            c = n[1]
            nm = c[0]
            if nm not in SIG.COMMANDS:
                probs.append("未知命令 " + nm)
                return
            if len(c) - 1 != len(SIG.COMMANDS[nm]):
                probs.append(f"参数数 {nm} {len(c) - 1}!={len(SIG.COMMANDS[nm])}")
            for i, p in enumerate(c[1:], 1):
                k = _bp_kind(p)
                official = set(off.get(f"{nm}#{i}", []))
                kk = "enum" if k.startswith("enum:") else k
                offk = {("enum" if x.startswith("enum:") else x) for x in official}
                if official and kk not in offk:
                    probs.append(f"形状 {nm} p{i} kind={k} 官方={sorted(official)}")
                if k.startswith("enum:"):
                    en = p[0]
                    for j, q in enumerate(p[1:], 1):
                        o2 = set(off.get(f"{nm}#{i}>{en}#{j}", [])) or set(off.get(f"{en}#{j}", []))
                        if o2 and _bp_kind(q) not in o2:
                            probs.append(f"形状 {nm} p{i} {en}#{j} kind={_bp_kind(q)} 官方={sorted(o2)}")
            for i in _BP_LOOKUP.get(nm, []):
                if isinstance(c[i], int) and c[i] not in _BP_BUILTIN and c[i] not in scope:
                    probs.append(f"C16103风险 {nm} p{i}={c[i]} 不在作用域 {sorted(scope)}")
            for p in c[1:]:
                if _bp_tag(p) == "GH" and p[1] not in _BP_BUILTIN and p[1] not in scope:
                    probs.append(f"GH({p[1]}) 不在作用域")
                if _bp_tag(p) == "CD" and nm in _BP_LOOKUP and c[_BP_LOOKUP[nm][0]] in (-17, -18):
                    probs.append(f"{nm} CD 挂在 {c[_BP_LOOKUP[nm][0]]} 必 throw")
            if nm == "FindAllSubjects":
                walk(c[9], scope | {c[1]})
                seen(c[1])
            elif nm == "FindNearSubjects":
                walk(c[6], scope | {c[5]})
                seen(c[5])
            elif nm == "CreateReferencePoint":
                walk(c[11], scope | {c[10]})
                seen(c[10])
            elif nm == "CreateReferencePointAtSpecifiedPosition":
                walk(c[5], scope | {c[4]})
            elif nm == "CreateHitArea":
                walk(c[20], scope | {c[19]})
                walk(c[23], scope | {c[21], c[22]})
                for x in (c[19], c[21], c[22]):
                    seen(x)
                sh = c[9]
                if _bp_tag(sh) == "Rectangle" and len(sh) != 3:
                    probs.append("Rectangle 非三元组(F1009)")
            else:
                for x in c[1:]:
                    if _bp_tag(x) in ("Block", "Command", "Event"):
                        walk(x, scope)
            return
        probs.append("非法节点 " + json.dumps(n, ensure_ascii=False)[:60])

    if tree[0] != "ActionDsl" or len(tree) != 12:
        probs.append("根头形状不对")
    walk(tree[11], set())
    dup = [k for k, v in ids_seen.items() if v > 1]
    if dup:
        probs.append(f"绑定 id 重复 {dup}")
    enc = wf_dsl.encode_amf3(tree)
    rt = wf_dsl.parse_dsl(enc)["tree"] == tree
    probs += wf_dsl.player_side_dsl_problems(tree)
    return probs, len(enc), rt


def blueprint_check(root: Path, tree) -> tuple[list[str], int, bool]:
    """设计 _tmp 用的静态校验（官方签名差分 / 作用域 C16103 / Rectangle / CD / 方向）。"""
    probs, size, rt = blueprint_check_with_sig(tree, load_official_sig(root))
    return list(probs), size, bool(rt)


def dsl_problems(root: Path, tree) -> dict[str, Any]:
    import wf_client_legality as L
    import wf_dsl
    bp, size, rt = blueprint_check(root, tree)
    enc = wf_dsl.encode_amf3(tree)
    rt2 = strict_equal(wf_dsl.parse_dsl(enc)["tree"], tree)
    donothing = []
    for c in iter_commands(tree):
        for p in c[1:]:
            if isinstance(p, list) and p and p[0] == "Block":
                for item in p[1]:
                    if item == ["DoNothing"]:
                        donothing.append(c[0])
    probs = {
        "blueprint_check": bp,
        "element": L.action_dsl_element_problems(tree, ELEMENT),
        "subject_binding": L.action_dsl_subject_binding_problems(tree),
        "hit_area_target": L.action_dsl_hit_area_target_problems(tree),
        "player_side_direction": wf_dsl.player_side_dsl_problems(tree),
        "donothing_in_block": donothing,
    }
    return {"problems": probs, "all_empty": not any(probs.values()), "amf3_bytes": size,
            "roundtrip": bool(rt and rt2)}


# ---------------------------------------------------------------- 行构建

def donor_row(ctx, spec: str, table: str, index: int) -> list[str]:
    source, key = spec.split(":", 1)
    if source == "official":
        rows = ctx.official_flat(table)
    elif source == "store":
        rows = ctx.live_flat(table)
    else:
        raise KitError(f"unknown donor source {spec}")
    if key not in rows:
        raise KitError(f"donor {spec} missing in {table}")
    lines = ctx.csv_split(rows[key])
    return list(lines[index])


def build_rows(ctx, design: dict) -> tuple[dict, list[dict]]:
    """donor + 声明编辑重建全部行，与设计 ``row_built`` 逐格核对（不一致即报错）。"""
    import wf_client_legality as L
    import wf_describe
    evidence: list[dict] = []
    leader_rows: list[list[str]] = []
    for entry in design["leader"]:
        row = donor_row(ctx, entry["donor"], entry["donor_table"], entry["row_index"])
        for col, val in entry["edits"].items():
            row[int(col)] = val
        if row != entry["row_built"]:
            diff = {i: (a, b) for i, (a, b) in enumerate(zip(row, entry["row_built"])) if a != b}
            raise KitError(f"leader {entry['id']} donor+edits != design row_built: {diff}")
        leader_rows.append(row)
        evidence.append({"table": LEADER, "key": CID, "id": entry["id"], "donor": entry["donor"],
                         "row": row})
    ability_rows: dict[str, list[list[str]]] = {}
    for slot in range(1, 7):
        entries = sorted(design["abilities"][f"slot{slot}"], key=lambda e: e["record"])
        key = f"{CID}{slot}"
        lines = []
        for entry in entries:
            if entry["key"] != key:
                raise KitError(f"design slot{slot} key {entry['key']} != {key}")
            row = donor_row(ctx, entry["donor"], entry["donor_table"], entry["row_index"])
            for col, val in entry["edits"].items():
                row[int(col)] = val
            if row != entry["row_built"]:
                diff = {i: (a, b) for i, (a, b) in enumerate(zip(row, entry["row_built"])) if a != b}
                raise KitError(f"ability {key}#{entry['record']} donor+edits != design: {diff}")
            if row[0] != f"{CODE}_{slot}":
                raise KitError(f"ability {key} c0 {row[0]}")
            lines.append(row)
            evidence.append({"table": ABILITY, "key": key, "record": entry["record"],
                             "donor": entry["donor"], "row": row})
        if len({r[1] for r in lines}) != 1 or len({r[2] for r in lines}) != 1:
            # 词条键内 c1（主位限制）与 c2（玛纳雕像组）必须一致
            raise KitError(f"ability {key} mixed c1/c2 {[(r[1], r[2]) for r in lines]}")
        ability_rows[key] = lines
    total = sum(len(v) for v in ability_rows.values())
    if total != design["ability_record_count"] or len(leader_rows) != 6:
        raise KitError(f"row counts ability={total} leader={len(leader_rows)}")
    for item in evidence:
        kind = "leader_ability" if item["table"] == LEADER else "ability"
        row = item["row"]
        item["describe"] = wf_describe.describe_rows([row], kind)[0]
        item["problems"] = (L.client_legality_problems(kind, row) + L.declared_block_field_problems(kind, row)
                            + (L.ability_element_column_problems(kind, row, ELEMENT) if kind == "ability" else []))
        item["capabilities"] = L.required_client_capabilities(kind, row)
    return {"leader": leader_rows, "ability": ability_rows}, evidence


# ---------------------------------------------------------------- 特效

def load_fx_manifest(root: Path) -> tuple[dict[str, Path], dict | None]:
    """``fx/regis/out/manifest.json`` → {源 sheet 逻辑路径: 染色 PNG 文件}；不存在返回 ({}, None)。

    兼容三种写法：顶层平铺 ``{logical: path}``；``{"sheets"|"recolor"|"png"|"files": {logical: path}}``；
    ``{"sheets": [{"source"|"src"|"logical_path": …, "png"|"file"|"path"|"output": …}]}``。相对路径先按
    manifest 所在目录解析，再按批目录。
    """
    path = root / FX_MANIFEST_REL
    if not path.is_file():
        return {}, None
    data = json.loads(path.read_text(encoding="utf-8"))
    table: Any = data
    if isinstance(data, dict):
        for name in ("sheets", "recolor", "png", "pngs", "files", "outputs"):
            if name in data:
                table = data[name]
                break
    pairs: list[tuple[str, str]] = []
    if isinstance(table, dict):
        pairs = [(k, v) for k, v in table.items() if isinstance(k, str) and isinstance(v, str)]
    elif isinstance(table, list):
        for item in table:
            if not isinstance(item, dict):
                continue
            src = item.get("source") or item.get("src") or item.get("logical_path")
            png = item.get("png") or item.get("file") or item.get("path") or item.get("output")
            if isinstance(src, str) and isinstance(png, str):
                pairs.append((src, png))
    out: dict[str, Path] = {}
    for src, png in pairs:
        if not src.endswith(".png") or not src.startswith("battle/effect/"):
            continue
        cand = Path(png)
        if not cand.is_absolute():
            for base in (path.parent, root / BATCH, root):
                if (base / cand).is_file():
                    cand = base / cand
                    break
        if not cand.is_file():
            raise KitError(f"fx manifest PNG missing for {src}: {png}")
        out[src] = cand
    if isinstance(data, dict) and data.get("gates_ok") is False:
        raise KitError(f"fx manifest {FX_MANIFEST_REL} reports gates_ok=false; refusing to apply its sheets")
    return out, {"path": str(path), "sha256": sha256(path.read_bytes()), "entries": len(out),
                 "png_sha256": {src: sha256(p.read_bytes()) for src, p in sorted(out.items())}}


def family_sheets() -> dict[str, str]:
    """{母本 sheet 逻辑路径: 包内克隆 sheet 逻辑路径}（EFFECT_FAMILIES 派生，layout=codename）。"""
    out = {}
    for src_dir, sub, _bases in EFFECT_FAMILIES:
        donor = src_dir.rsplit("/", 1)[-1]
        out[f"{src_dir}/{donor}.png"] = f"battle/effect/skill_unique/{CODE}/{sub}/{sub}.png"
    return out


def fx_input_state(root: Path) -> dict | None:
    """指纹用：fx manifest 与其染色 PNG 的 sha256（manifest 不存在为 None）。"""
    _fx_map, info = load_fx_manifest(root)
    if info is None:
        return None
    return {"manifest_sha256": info["sha256"], "png_sha256": info["png_sha256"]}


def recolor_problems(ctx, report: dict | None = None,
                     sheet_bytes: dict[str, bytes] | None = None) -> list[str]:
    """设计 §5 要求两张克隆 sheet 都换色。逐项核对（不写盘）：

    - fx manifest 存在且覆盖 EFFECT_FAMILIES 的全部 sheet；
    - 包内 sheet（或 ``sheet_bytes`` 覆盖值，负向对照用）RGBA 像素 = 染色 PNG；alpha = 母本；
    - 给出 ``report``（kit-report）时：``effects.fx_manifest.sha256`` = 当前 manifest，
      ``effects.recolor`` 覆盖全部 sheet 且 ``png_sha256`` = 当前染色 PNG。
    """
    from PIL import Image
    probs: list[str] = []
    try:
        fx_map, info = load_fx_manifest(ctx.root)
    except KitError as exc:
        return [f"fx manifest unusable: {exc}"]
    sheets = family_sheets()
    if info is None:
        return [f"fx manifest absent ({FX_MANIFEST_REL}): cloned sheets keep donor colours"]
    uncovered = sorted(set(sheets) - set(fx_map))
    if uncovered:
        probs.append(f"fx manifest does not cover sheets {uncovered}")
    for src, dst in sheets.items():
        if src not in fx_map:
            continue
        if sheet_bytes is not None and dst in sheet_bytes:
            raw = sheet_bytes[dst]
        elif ctx.pack.pkg_has("common", dst):
            raw = ctx.pack.pkg_path("common", dst).read_bytes()
        else:
            probs.append(f"package sheet missing {dst}")
            continue
        pkg_img = ctx.png_open(raw)
        dyed = Image.open(fx_map[src]).convert("RGBA")
        _root, donor_raw, _src = ctx.pack.template_asset(src)
        donor = ctx.png_open(donor_raw)
        if pkg_img.size != dyed.size or pkg_img.tobytes() != dyed.tobytes():
            same_as_donor = pkg_img.size == donor.size and pkg_img.tobytes() == donor.tobytes()
            probs.append(f"{dst} pixels != recoloured {fx_map[src].name}"
                         + (" (still donor colours: rerun --step kit)" if same_as_donor else ""))
        if pkg_img.size != donor.size or pkg_img.getchannel("A").tobytes() != donor.getchannel("A").tobytes():
            probs.append(f"{dst} alpha differs from donor {src}")
    if report is not None:
        eff = report.get("effects") or {}
        rep_info = eff.get("fx_manifest") or {}
        if rep_info.get("sha256") != info["sha256"]:
            probs.append("kit-report effects.fx_manifest sha256 != current fx manifest (rerun --step kit)")
        logged = {e.get("source_sheet"): e for e in (eff.get("recolor") or [])}
        for src in sorted(sheets):
            if src not in fx_map:
                continue
            entry = logged.get(src)
            if entry is None:
                probs.append(f"kit-report effects.recolor lacks {src}")
            elif entry.get("png_sha256") != info["png_sha256"][src]:
                probs.append(f"kit-report effects.recolor png_sha256 stale for {src}")
    return probs


def recolor_transform(ctx, src_sheet: str, fx_map: dict[str, Path], log: list[dict]):
    target = fx_map.get(src_sheet)
    if target is None:
        return None

    def transform(img):
        raw = target.read_bytes()
        new = ctx.png_open(raw)
        if new.size != img.size:
            raise KitError(f"recolored sheet size {new.size} != donor {img.size}: {target}")
        a_old, a_new = img.getchannel("A").tobytes(), new.getchannel("A").tobytes()
        alpha_diff = sum(1 for x, y in zip(a_old, a_new) if x != y)
        log.append({"source_sheet": src_sheet, "png": str(target), "png_sha256": sha256(raw),
                    "size": list(new.size), "alpha_pixels_changed": alpha_diff})
        return new
    return transform


def fx_manifest_clone_problems(root: Path) -> list[str]:
    """fx manifest 可选的 ``clone`` 段须与 EFFECT_FAMILIES 一致（染色产物是按同一 dst/基名做的）。"""
    path = root / FX_MANIFEST_REL
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    clone = data.get("clone") if isinstance(data, dict) else None
    if clone is None:
        return []
    sheets = family_sheets()
    bases = {f"{src_dir}/{src_dir.rsplit('/', 1)[-1]}.png": sorted(b) for src_dir, _sub, b in EFFECT_FAMILIES}
    probs = []
    for item in clone:
        src = item.get("src")
        if src not in sheets:
            probs.append(f"fx manifest clone.src {src} not a regis family sheet")
            continue
        if item.get("dst") != sheets[src]:
            probs.append(f"fx manifest clone.dst {item.get('dst')} != {sheets[src]}")
        if item.get("fx_names") is not None and sorted(item["fx_names"]) != bases[src]:
            probs.append(f"fx manifest clone.fx_names for {src} != kit bases")
    return probs


def clone_families(ctx) -> tuple[list[dict], list[dict], dict | None]:
    fx_map, fx_info = load_fx_manifest(ctx.root)
    unknown = sorted(set(fx_map) - set(family_sheets()))
    if unknown:
        raise KitError(f"fx manifest names sheets outside regis families: {unknown}")
    clone_probs = fx_manifest_clone_problems(ctx.root)
    if clone_probs:
        raise KitError(f"fx manifest clone section disagrees with kit: {clone_probs}")
    recolor_log: list[dict] = []
    families = []
    for src_dir, sub, bases in EFFECT_FAMILIES:
        donor = src_dir.rsplit("/", 1)[-1]
        sheet = f"{src_dir}/{donor}.png"
        fam = ctx.clone_effect_family(src_dir, sub, fx_names=list(bases), layout="codename",
                                      png_transform=recolor_transform(ctx, sheet, fx_map, recolor_log))
        if fam["missing_effects"] or sorted(fam["copied_bases"]) != sorted(bases):
            raise KitError(f"effect family {src_dir} incomplete: missing={fam['missing_effects']}")
        if fam["dst_dir"] != f"battle/effect/skill_unique/{CODE}/{sub}":
            raise KitError(f"unexpected effect dst {fam['dst_dir']}")
        families.append(fam)
    # 换色钩子必须对 manifest 里每张 sheet 都真正执行过，且写盘结果逐像素 = 染色 PNG
    applied = sorted(e["source_sheet"] for e in recolor_log)
    if applied != sorted(fx_map):
        raise KitError(f"recolor not applied to every manifest sheet: applied={applied} manifest={sorted(fx_map)}")
    if fx_map:
        probs = [p for p in recolor_problems(ctx) if "does not cover" not in p]
        if probs:
            raise KitError(f"recoloured sheets did not land in the package: {probs}")
        for entry in recolor_log:
            if entry["alpha_pixels_changed"]:
                raise KitError(f"recolour changed alpha of {entry['source_sheet']}: {entry['alpha_pixels_changed']}")
    return families, recolor_log, fx_info


# ---------------------------------------------------------------- 像素小人（Integrate 阶段）

PIXEL_DIR_REL = f"{BATCH}/pixel/regis"
PIXEL_VERIFY_REL = f"{BATCH}/pixel/_review/verify_all.json"
# sheet 基名 → 同组元数据（atlas / frame / timeline），元数据保持母本（只改 character/<code>/ 前缀）
PIXEL_SHEETS = {
    "sprite_sheet": ("sprite_sheet.atlas.amf3.deflate", "pixelart.frame.amf3.deflate",
                     "pixelart.timeline.amf3.deflate"),
    "special_sprite_sheet": ("special_sprite_sheet.atlas.amf3.deflate", "special.frame.amf3.deflate",
                             "special.timeline.amf3.deflate"),
}


def pixel_inputs(root: Path) -> tuple[dict[str, Path], list[str]]:
    """像素染色产物是否可装包：``pixel/regis/report.json`` 门禁全过、``_review/verify_all.json``
    regis 全过（修复轮复核），且两者记录的 sha256 = ``out/<sheet>.png`` 当前字节。

    返回 ({sheet 基名: PNG 路径}, problems)；problems 非空 = pending（不装包）。"""
    probs: list[str] = []
    base = root / PIXEL_DIR_REL
    report_path, verify_path = base / "report.json", root / PIXEL_VERIFY_REL
    if not report_path.is_file():
        return {}, [f"pixel report absent: {PIXEL_DIR_REL}/report.json"]
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("key") != KEY or report.get("gates_passed") is not True:
        probs.append(f"pixel report gates_passed={report.get('gates_passed')} key={report.get('key')}")
    failed = sorted(k for k, v in (report.get("gates") or {}).items() if not (isinstance(v, dict) and v.get("ok")))
    if failed:
        probs.append(f"pixel report gates failed: {failed}")
    verify = json.loads(verify_path.read_text(encoding="utf-8")).get(KEY) if verify_path.is_file() else None
    if not verify:
        probs.append(f"pixel review verdict absent: {PIXEL_VERIFY_REL}")
    else:
        hard_bad = sorted(k for k, v in (verify.get("hard") or {}).items() if not v.get("ok"))
        if verify.get("pass") is not True or hard_bad:
            probs.append(f"pixel review failed: pass={verify.get('pass')} hard={hard_bad}")
    out: dict[str, Path] = {}
    reviewed = (((verify or {}).get("hard") or {}).get("H8_png_roundtrip") or {}).get("detail") or {}
    for name in PIXEL_SHEETS:
        png = base / "out" / f"{name}.png"
        if not png.is_file():
            probs.append(f"pixel output missing: {png.name}")
            continue
        digest = sha256(png.read_bytes())
        rep_sha = ((report.get("outputs") or {}).get(name) or {}).get("sha256")
        if rep_sha != digest:
            probs.append(f"{name}.png sha256 != pixel report outputs ({rep_sha})")
        if (reviewed.get(name) or {}).get("sha256") != digest:
            probs.append(f"{name}.png sha256 != reviewed verify_all H8 sha")
        out[name] = png
    return out, probs


def pixel_problems(ctx, sheet_bytes: dict[str, bytes] | None = None) -> list[str]:
    """包内像素小人核对（不写盘）：sheet 解码字节 = 染色 PNG；尺寸 / alpha = 母本；
    atlas/frame/timeline = 母本树（仅 ``character/<母本>/``→``character/<code>/``）；归属 owner=pixel。"""
    import wf_assets
    spec = ctx.spec
    pngs, probs = pixel_inputs(ctx.root)
    if probs:
        return [f"pixel inputs not ready: {p}" for p in probs]
    prefix = _pixel_prefix(spec)
    for name, metas in PIXEL_SHEETS.items():
        logical = f"character/{CODE}/pixelart/{name}.png"
        tpl_logical = f"character/{spec.template_code}/pixelart/{name}.png"
        if sheet_bytes is not None and logical in sheet_bytes:
            raw = sheet_bytes[logical]
        elif ctx.pack.pkg_has("common", logical):
            raw = ctx.pack.pkg_path("common", logical).read_bytes()
        else:
            probs.append(f"package pixel sheet missing {logical}")
            continue
        if raw[:8] != wf_assets.PNG_FAKE:
            probs.append(f"{logical} lacks store PNG magic")
            continue
        dyed_raw = pngs[name].read_bytes()
        if wf_assets.png_decode(raw) != dyed_raw:
            probs.append(f"{logical} != pixel/regis/out/{name}.png (store form)")
        _r, donor_raw, _src = ctx.pack.template_asset(tpl_logical)
        pkg_img, donor = ctx.png_open(raw), ctx.png_open(donor_raw)
        if pkg_img.size != donor.size:
            probs.append(f"{logical} size {pkg_img.size} != donor {donor.size}")
        elif pkg_img.getchannel("A").tobytes() != donor.getchannel("A").tobytes():
            probs.append(f"{logical} alpha differs from donor {tpl_logical}")
        if sheet_bytes is None and ctx.pack.owner_of("common", logical) != "pixel":
            probs.append(f"{logical} owner={ctx.pack.owner_of('common', logical)} (expected pixel)")
        for meta in metas:
            pkg_meta = f"character/{CODE}/pixelart/{meta}"
            if not ctx.pack.pkg_has("common", pkg_meta):
                probs.append(f"package pixel metadata missing {pkg_meta}")
                continue
            _r, tpl_raw, _src = ctx.pack.template_asset(f"character/{spec.template_code}/pixelart/{meta}")
            want = ctx.replace_strings(ctx.amf_parse(tpl_raw), prefix)
            if ctx.amf_parse(ctx.pack.pkg_path("common", pkg_meta).read_bytes()) != want:
                probs.append(f"{pkg_meta} differs from donor metadata (only path prefix may change)")
    return probs


def _pixel_prefix(spec) -> dict[str, str]:
    return {f"character/{spec.template_code}/": f"character/{spec.code}/"}


def install_pixel(ctx) -> dict[str, Any]:
    """把复核通过的像素染色 sheet 以存储态（小写魔数、PNG 字节不重编码）写进包，owner=pixel。

    重跑幂等：字节相同不改盘（write_pkg），登记 sha 不变。产物未就绪时不写、返回 pending。"""
    import wf_assets
    pngs, probs = pixel_inputs(ctx.root)
    if probs:
        return {"status": "pending", "problems": probs}
    written = {}
    for name, png in pngs.items():
        logical = f"character/{CODE}/pixelart/{name}.png"
        data = wf_assets.png_encode(png.read_bytes())
        ctx.write_asset("common", logical, data, owner="pixel")
        written[logical] = {"source": f"{PIXEL_DIR_REL}/out/{png.name}", "decoded_sha256": sha256(png.read_bytes()),
                            "store_sha256": sha256(data)}
    after = pixel_problems(ctx)
    if after:
        raise KitError(f"pixel sheets did not land in the package: {after}")
    return {"status": "installed", "sheets": written, "problems": []}


def voice_state(ctx) -> dict[str, Any]:
    """只读：语音是否已由 wf_seasonal7_voice pack 装包（22 槽文件在包内、speech 行引用新槽、归属 voice）。"""
    import wf_seasonal7_voice as V
    missing = [s for s in V.SLOTS if not ctx.pack.pkg_has("common", f"character/{CODE}/voice/{s}.mp3")]
    not_voice_owned = [s for s in V.SLOTS if s not in missing
                       and ctx.pack.owner_of("common", f"character/{CODE}/voice/{s}.mp3") != "voice"]
    speech = ctx.csv_split(ctx.pkg_flat("master/character/character_speech.orderedmap").get(CID, ""))
    refs = [cells[4] for cells in speech if len(cells) == 5]
    want_refs = [*V.HOME_SLOTS, "ally/join", "ally/evolution"]
    base = ctx.pack.package / "roots" / "common" / "character" / CODE / "voice"
    extra = sorted(p.relative_to(base).with_suffix("").as_posix() for p in base.rglob("*.mp3")
                   if p.relative_to(base).with_suffix("").as_posix() not in V.SLOTS) if base.is_dir() else []
    packed = not missing and not not_voice_owned and refs == want_refs and not extra
    return {"packed": packed, "missing_slots": missing, "not_voice_owned": not_voice_owned,
            "speech_refs": refs, "extra_voice_files": extra}


# ---------------------------------------------------------------- 技能 DSL

def compose_skill(ctx, level: str, families: list[dict]) -> tuple[Any, dict]:
    """移植 design/_tmp/regis/d09_compose_final.py；特效改写换成 rewrite_effect_refs(strict)。"""
    import wf_dsl
    P = LEVELS[level]
    raws = {}
    for name, prog in SOURCE_PROGRAMS.items():
        program = prog.format(level=level)
        raw = ctx.official_read(wf_dsl.dsl_logical(program), "common")
        if raw is None:
            raise KitError(f"official baseline lacks {program} (store 版被增强过，禁止回落 live)")
        if level == "1" and sha256(raw) != SOURCE_SHA_L1[name]:
            raise KitError(f"official {program} sha256 differs from design record")
        raws[name] = raw
    base = ctx.template_dsl(SOURCE_PROGRAMS["skeleton"].format(level=level))
    ray = ctx.template_dsl(SOURCE_PROGRAMS["ray"].format(level=level))
    smr = ctx.template_dsl(SOURCE_PROGRAMS["smr21"].format(level=level))
    for name, tree in (("skeleton", base), ("ray", ray), ("smr21", smr)):
        if not strict_equal(tree, ctx.amf_parse(raws[name])):
            raise KitError(f"template_dsl for {name} did not come from the official baseline")
    edits: list[str] = []
    t = copy.deepcopy(base)
    if not (t[0] == "ActionDsl" and t[1] == 2 and t[10] == 0 and all(x is False for x in t[3:10])):
        raise KitError("skeleton root header unexpected")
    t[10] = 2
    edits.append("root tree[10] buffTargetAs 0->2")
    top = t[11][1]
    if not (len(top) == 2 and cmd(top[0])[0] == "StopBall" and cmd(top[1])[0] == "ConditionalsFeverMode"):
        raise KitError("skeleton root block unexpected")
    cfm = cmd(top[1])
    fever_blk, normal_blk = cfm[1][1], cfm[2][1]
    fn0 = cmd(fever_blk[0])
    if not (fn0[0] == "FindNearSubjects" and fn0[5] == 0):
        raise KitError("fever branch FindNearSubjects unexpected")
    cha0 = cmd(fn0[6][1][0])
    if not (cha0[0] == "CreateHitArea" and cha0[9][1][0]["min"] == 300):
        raise KitError("fever CreateHitArea unexpected")
    cna0 = first_cna(cha0[23])
    edits.append(f"Fever CNA p6 {cna0[6]} -> {P['fever']}")
    cna0[6] = copy.deepcopy(P["fever"])
    names = [cmd(x)[0] for x in normal_blk]
    if names != ["FindNearSubjects", "AddFeverPoint", "CreateCondition", "CreateCondition"]:
        raise KitError(f"normal branch unexpected {names}")
    fn4 = cmd(normal_blk[0])
    cha4 = cmd(fn4[6][1][0])
    if not (fn4[5] == 4 and cha4[9][1][0]["min"] == 100):
        raise KitError("normal CreateHitArea unexpected")
    cna4 = first_cna(cha4[23])
    edits.append(f"Normal laser CNA p6 {cna4[6]} -> {P['laser']}")
    cna4[6] = copy.deepcopy(P["laser"])
    cc_sd = cmd(normal_blk[3])
    if not (cc_sd[1] == -17 and cc_sd[2][0][0] == "ACSkillDamage"):
        raise KitError("normal branch 4th node is not CreateCondition(-17, ACSkillDamage)")
    del normal_blk[3]
    edits.append("Normal: delete CreateCondition(-17, ACSkillDamage)")
    # D2 ★4 光束
    rtop = ray[11][1]
    if [cmd(x)[0] for x in rtop] != ["StopBall", "FindNearSubjects"]:
        raise KitError("rare4 ray root unexpected")
    fnr = copy.deepcopy(rtop[1])
    c = cmd(fnr)
    if c[5] != 0:
        raise KitError("ray FindNearSubjects bind != 0")
    c[5] = 8
    chr_ = cmd(c[6][1][0])
    if not (chr_[0] == "CreateHitArea" and chr_[3] == ["GH", 0] and (chr_[19], chr_[21], chr_[22]) == (1, 2, 3)
            and chr_[13] == ["SpecifyHitAreaLifetimeDirectly", 80]):
        raise KitError("ray CreateHitArea unexpected")
    chr_[3] = ["GH", 8]
    chr_[19], chr_[21], chr_[22] = 9, 10, 11
    chr_[13] = ["SpecifyHitAreaLifetimeDirectly", 70]
    se = cmd(chr_[20][1][0])
    if not (se[0] == "ShowEffect" and se[3] == 1 and se[5] == ["SpecifyEffectLifetimeDirectly", 80]):
        raise KitError("ray ShowEffect unexpected")
    se[3] = 9
    se[5] = ["SpecifyEffectLifetimeDirectly", 70]
    cnr = first_cna(chr_[23])
    if cnr[1] != 3:
        raise KitError("ray CNA target != 3")
    cnr[1] = 11
    old_ray = cnr[6]
    cnr[6] = copy.deepcopy(P["ray"])
    normal_blk.insert(1, fnr)
    edits.append(f"Normal: insert rec_android_{level} ray bind 0->8, GH 8, ids 9/10/11, life 80->70, "
                 f"ShowEffect subj 1->9 life 70, CNA target 3->11 p6 {old_ray}->{P['ray']}")
    # D3 雷队能力伤害状态
    fa = None
    for x in smr[11][1]:
        if cmd(x) and cmd(x)[0] == "FindAllSubjects":
            if fa is not None:
                raise KitError("smr21 has more than one root FindAllSubjects")
            fa = copy.deepcopy(x)
    c = cmd(fa)
    if not (c[1] == 3 and c[2] == 33 and c[3] == [5]):
        raise KitError("smr21 FindAllSubjects unexpected")
    c[1] = 12
    c[3] = [3]
    cc = cmd(c[9][1][0])
    if not (cc[0] == "CreateCondition" and cc[1] == 3 and cc[2][0][0] == "ACAbilityDamage" and cc[10] == 3):
        raise KitError("smr21 CreateCondition unexpected")
    old_abd = cc[2][0][2]
    cc[1] = 12
    cc[2][0][2] = copy.deepcopy(P["abd"])
    top.append(fa)
    edits.append(f"Root: append FindAllSubjects(12,33,[3]) CreateCondition(12, ACAbilityDamage "
                 f"dur {cc[2][0][1]} value {old_abd}->{P['abd']})")
    n24 = 0
    for c_ in iter_commands(t, "CreateHitArea"):
        if c_[24] != 0:
            raise KitError("CreateHitArea cmd[24] not 0 before edit")
        c_[24] = 2
        n24 += 1
    if n24 != 3:
        raise KitError(f"expected 3 CreateHitArea, got {n24}")
    edits.append("all 3 CreateHitArea cmd[24] buffTargetAs 0->2")
    before_fx = [c_[2][1] for c_ in iter_commands(t, "ShowEffect")]
    rewrites = []
    for fam in families:
        t, info = ctx.rewrite_effect_refs(t, fam, strict=True)
        rewrites.append({"family": fam["dst_dir"], **info})
    after_fx = [c_[2][1] for c_ in iter_commands(t, "ShowEffect")]
    if any(p.startswith("battle/effect/skill_unique/rec_android") and f"/{CODE}/" not in p for p in after_fx):
        raise KitError(f"ShowEffect still points at donor dirs: {after_fx}")
    est = {}
    cfm2 = cmd(t[11][1][1])
    for label, blk in (("fever", cfm2[1]), ("normal", cfm2[2])):
        nominal, formula = [0.0, 0.0], [0.0, 0.0]
        for c_ in iter_commands(blk, "CreateHitArea"):
            n, h = c_[14][1], hits_by_formula(c_)
            for a in iter_commands(c_[23], "CreateNormalAttack"):
                mn, mx = a[6][0]["min"], a[6][0]["max"]
                nominal = [nominal[0] + mn * n, nominal[1] + mx * n]
                formula = [formula[0] + mn * h, formula[1] + mx * h]
        est[label] = {"nominal": [round(v, 3) for v in nominal], "formula": [round(v, 3) for v in formula]}
    return t, {"level": level, "edits": edits, "effect_rewrites": rewrites,
               "show_effect_paths": {"before": before_fx, "after": after_fx},
               "source_sha256": {k: sha256(v) for k, v in raws.items()}, "multiplier_estimate": est}


def effect_ref_problems(ctx, tree) -> list[str]:
    """ShowEffect 引用在包内（含 parts 或 timeline）或 live store 可解析。"""
    import wf_assets
    probs = []
    for c in iter_commands(tree, "ShowEffect"):
        spec = c[2]
        if not (isinstance(spec, list) and spec and spec[0] == "SpecifyEffectDirectly"):
            continue
        path = spec[1]
        found = False
        for kind in ("parts", "timeline"):
            logical = f"{path}.{kind}.amf3.deflate"
            if ctx.pack.pkg_has("common", logical) or wf_assets.locate(ctx.store, logical):
                found = True
        if not found:
            probs.append(f"unresolved ShowEffect {path}")
    return probs


# ---------------------------------------------------------------- 指纹

def kit_fingerprint(ctx) -> tuple[str, dict]:
    """kit 自有产物指纹：表行 / DSL / 特效族全部文件字节（含 sheet PNG）/ 能力声明，外加换色输入
    （fx manifest 与染色 PNG 的 sha256）。不含语音、像素小人（Integrate 阶段的产物）。

    特效 sheet 必须计入：换色产物晚于 kit 出现时，旧实现忽略 PNG，包里仍是母本原色却与门禁指纹一致，
    status 保持 ready-for-review（审查 major）。"""
    parts: dict[str, Any] = {}
    parts["character_c9_16_c18"] = ctx.pack.pkg_character_row()[9:19]
    parts["character_text"] = ctx.pack.pkg_character_text_row()
    ab = ctx.pkg_flat(ABILITY)
    parts["ability"] = {k: ab[k] for k in [f"{CID}{i}" for i in range(1, 7)]}
    parts["leader"] = ctx.pkg_flat(LEADER)[CID]
    cas = ctx.pkg_flat(CAS)
    parts["custom_ability_string"] = {k: cas[k] for k in CAS_KEYS}
    parts["upskill"] = ctx.pkg_flat(UPSKILL)[CID]
    parts["action_skill"] = ctx.pkg_nested(CODE)
    parts["switched_action_skill"] = ctx.pkg_nested(VOICE_KEY, SW)
    import wf_dsl
    progs = {}
    for level in ("1", "2"):
        logical = wf_dsl.dsl_logical(ctx.program_path(level))
        progs[logical] = sha256(ctx.pack.pkg_path("common", logical).read_bytes())
    parts["dsl"] = progs
    fx = {}
    for src_dir, sub, _bases in EFFECT_FAMILIES:
        base = ctx.pack.package / "roots" / "common" / "battle" / "effect" / "skill_unique" / CODE / sub
        for p in sorted(base.rglob("*")):
            if p.is_file():
                rel = p.relative_to(ctx.pack.package / "roots" / "common").as_posix()
                fx[rel] = sha256(p.read_bytes())
    parts["effects"] = fx
    parts["fx_inputs"] = fx_input_state(ctx.root)
    parts["required_capabilities"] = sorted(CAPABILITIES)
    blob = json.dumps(parts, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return sha256(blob), parts


def gates_status(root: Path, fingerprint: str, blockers: list[str] | None = None) -> tuple[str, str]:
    """``blockers`` 非空（如特效未换色）时一律 draft，不看 gates.json。"""
    if blockers:
        return "draft", "; ".join(blockers)
    path = root / GATES_REL
    if not path.is_file():
        return "draft", "impl/regis/gates.json 不存在（门禁未跑）"
    try:
        gates = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return "draft", "gates.json 无法解析"
    if not gates.get("all_pass"):
        return "draft", "gates.json all_pass=false"
    if gates.get("kit_fingerprint") != fingerprint:
        return "draft", "gates.json kit_fingerprint 与当前产物不一致（需重跑门禁）"
    return "ready-for-review", f"gates.json all_pass @ {gates.get('generated_at')}"


# ---------------------------------------------------------------- 主流程

def build(ctx) -> dict[str, Any]:
    import wf_client_legality as L
    import wf_dsl
    import wf_seasonal7_voice as V
    spec = ctx.spec
    if (spec.key, spec.cid_s, spec.code, spec.element) != (KEY, CID, CODE, ELEMENT):
        raise KitError(f"spec identity mismatch {spec.key}/{spec.cid}/{spec.code}")
    missing_inputs = untracked_input_problems(ctx.root)
    if missing_inputs:
        raise KitError("kit inputs under gitignored work/ are missing (restore the seasonal7-20260916 batch "
                       f"directory before running the kit): {missing_inputs}")
    design = load_design(ctx.root)
    problems: list[str] = check_texts_constant(design)
    if problems:
        raise KitError(f"TEXTS constant drifted from design: {problems}")
    texts = design_text_rows(design)
    notes: list[str] = []

    # ---- character 行：spec 列断言 + c9–c16 语音路由 + c18 队长名
    crow = ctx.pack.pkg_character_row()
    ident = design["identity"]
    expect = {0: CODE, 2: str(ident["rarity"]), 3: str(ident["element"]), 4: ident["race"], 6: str(ident["pf_type"]),
              7: ident["gender"], 8: CODE, 17: CID, 26: ident["stance"], 27: str(ident["c27_policy"]["value"])}
    for i, key in enumerate(range(19, 25)):
        expect[key] = f"{CID}{i + 1}"
    bad = {i: (crow[i], v) for i, v in expect.items() if crow[i] != v}
    if bad:
        raise KitError(f"package character row spec columns differ from design (rerun tables): {bad}")
    route_cols = V.normalize_route(design["voice"]["route"], CODE)
    if route_cols != ["1", "29", "0", "", "", VOICE_KEY, "false", "false"]:
        raise KitError(f"voice route unexpected {route_cols}")
    new_crow = list(crow)
    new_crow[9:17] = route_cols
    new_crow[18] = design["text"]["leader_name_c10"]
    V.route_character_row(new_crow, route_cols, CODE)          # 语音装包约定自检
    ctx.write_flat(CHAR, {CID: [new_crow]})
    ctx.write_flat(TEXT, {CID: [texts["character_text"]]})

    # ---- 词条 / 队长
    rows, row_evidence = build_rows(ctx, design)
    row_problems = {f"{e['table'].rsplit('/', 1)[-1]}#{e['key']}#{e.get('record', e.get('id'))}": e["problems"]
                    for e in row_evidence if e["problems"]}
    if row_problems:
        raise KitError(f"row legality problems: {row_problems}")
    ctx.write_flat(LEADER, {CID: rows["leader"]})
    ctx.write_flat(ABILITY, rows["ability"])

    # ---- 面板覆盖文案
    cas_rows = {}
    for item in design["custom_strings"]:
        if item["table"] != CAS or item["capability"] != "panel-description-override-v2":
            raise KitError(f"unexpected custom string entry {item['key']}")
        if L.panel_override_capability(item["key"]) != "panel-description-override-v2":
            raise KitError(f"panel capability mismatch for {item['key']}")
        text_probs = panel_text_problems(item["text"])
        if text_probs:
            raise KitError(f"{item['key']}: {text_probs}")
        cas_rows[item["key"]] = [[item["text"]]]
    if sorted(cas_rows) != sorted(CAS_KEYS):
        raise KitError(f"custom string keys {sorted(cas_rows)} != {sorted(CAS_KEYS)}")
    # 覆盖键 = desc_override_ + 第 0 行 string_id(c0)；逐条核对确有行引用
    string_ids = {rows["leader"][0][0]} | {lines[0][0] for lines in rows["ability"].values()}
    if {f"desc_override_{s}" for s in string_ids} != set(CAS_KEYS):
        raise KitError(f"desc_override keys do not match row string ids {sorted(string_ids)}")
    ctx.write_flat(CAS, cas_rows)

    # ---- action_skill：名称 / 描述 / 能量
    inner = ctx.pkg_nested(CODE)
    if set(inner) != {"1", "2"}:
        raise KitError(f"package action_skill inner keys {sorted(inner)}")
    energy = design["skills"]["energy"]
    new_inner = {}
    for level, cells in inner.items():
        cells = list(cells)
        if len(cells) != 24 or cells[7] != ctx.program_path(level):
            raise KitError(f"action_skill {level} schema/program unexpected")
        cells[0], cells[1] = texts["action"][level]
        e = energy[level]
        cells[4], cells[5], cells[6] = (str(e["c4_min_skill_weight"]), str(e["c5_max_skill_weight"]),
                                        str(e["c6_skill_chain_strength"]))
        if cells[2:4] != ["dynamic/skill/atk_nearest", "true"] or cells[8:17] != \
                ["1", "2", "2400", "3000", "0", "0", "0", "0", "(None)"]:
            raise KitError(f"action_skill {level} other cols differ from official 131020: {cells}")
        new_inner[level] = [cells]
    ctx.write_nested(ACTION, CODE, new_inner, replace_inner=True)

    # ---- upskill：技能强化项与新技能一致
    template_up = ctx.csv_split(ctx.template_flat(UPSKILL)[str(spec.template_id)])
    if len(template_up) != 1 or template_up[0].count("skill_damage_up") != 2:
        raise KitError(f"template upskill row unexpected: {template_up}")
    new_up = [["ability_damage_up" if c == "skill_damage_up" else c for c in template_up[0]]]
    current_up = ctx.csv_split(ctx.pkg_flat(UPSKILL)[CID])
    if current_up not in (template_up, new_up):
        raise KitError(f"package upskill row edited by someone else: {current_up}")
    ctx.write_flat(UPSKILL, {CID: new_up})
    notes.append("upskill: skill_damage_up→ability_damage_up（技能删 ACSkillDamage、加 ACAbilityDamage；"
                 "官方 151045 同写法；设计未单列，kit 按技能改动同步）")

    # ---- 特效族 + 技能 DSL
    families, recolor_log, fx_info = clone_families(ctx)
    skills_report = {}
    for level in ("1", "2"):
        tree, info = compose_skill(ctx, level, families)
        design_tree = json.loads((ctx.root / DESIGN_TREE_REL.format(level=level)).read_text(encoding="utf-8"))
        diff = first_difference(tree, design_tree)
        if diff:
            raise KitError(f"composed skill {level} differs from design final tree: {diff}")
        checks = dsl_problems(ctx.root, tree)
        if not checks["all_empty"] or not checks["roundtrip"]:
            raise KitError(f"skill {level} static checks failed: {checks}")
        ref_probs = effect_ref_problems(ctx, tree)
        if ref_probs:
            raise KitError(f"skill {level} effect refs unresolved: {ref_probs}")
        logical = ctx.write_dsl(ctx.program_path(level), tree)
        info.update(checks=checks, effect_ref_problems=ref_probs, logical=logical,
                    equals_design_tree=True, sha256=sha256(ctx.pack.pkg_path("common", logical).read_bytes()))
        skills_report[level] = info

    # ---- switched_action_skill（语音 matched_skill_ready 路由的目标技能）
    action_now = {lv: list(c) for lv, c in ctx.pkg_nested(CODE).items()}
    switched = V.switched_rows(action_now)
    ctx.write_nested(SW, VOICE_KEY, {lv: [cells] for lv, cells in switched.items()}, replace_inner=True)

    # ---- 三层镜像
    mirrors = ctx.sync_character_mirrors()

    # ---- 像素小人（复核通过的染色 sheet，owner=pixel；未就绪时不写）与语音装包状态（只读）
    pixel = install_pixel(ctx)
    ctx.evidence_write("pixel-report.json", {
        "summary": ("像素小人染色 sheet 2 张已装包（owner=pixel，存储态，元数据保持母本）" if pixel["status"] == "installed"
                    else "像素小人产物未就绪，包内仍为母本原色"),
        "status": pixel["status"], "mode": "recolor-lut (pixel/regis)",
        "source": {"report": f"{PIXEL_DIR_REL}/report.json", "review": PIXEL_VERIFY_REL},
        **{k: v for k, v in pixel.items() if k != "status"}})
    voice = voice_state(ctx)

    # ---- 能力声明一致性
    row_caps = sorted({c for e in row_evidence for c in e["capabilities"]}
                      | {L.panel_override_capability(k) for k in CAS_KEYS})
    if row_caps != sorted(CAPABILITIES) or sorted(spec.required_capabilities) != sorted(CAPABILITIES):
        raise KitError(f"capabilities rows={row_caps} spec={spec.required_capabilities}")

    fingerprint, _parts = kit_fingerprint(ctx)
    recolor_blockers = recolor_problems(ctx)
    status, status_reason = gates_status(ctx.root, fingerprint, recolor_blockers)
    programs = [wf_dsl.dsl_logical(ctx.program_path(lv)) for lv in ("1", "2")]
    panel = [f"{e['table'].rsplit('/', 1)[-1].split('.')[0]} {e['key']}"
             f"#{e.get('record', e.get('id'))}: {e['describe']}" for e in row_evidence]
    if fx_info is None:
        notes.append("特效 sheet 仍为母本原色：fx/regis/out/manifest.json 未产出（Effects 阶段后重跑 kit 即换色；"
                     "未换色时 status 固定为 draft）")
    else:
        notes.append(f"特效 sheet 已按 fx manifest 换色 {len(recolor_log)} 张（manifest sha256 "
                     f"{fx_info['sha256'][:12]}…；包内像素 = 染色 PNG、alpha = 母本已逐像素核对）")
    if voice["packed"]:
        notes.append("语音：c9–c16 ConditionExist(29) 路由与 switched_action_skill 已写；22 槽 AI 合成语音已由 "
                     "wf_seasonal7_voice pack 装包（owner=voice，speech 8 行引用 home_0..5/join/evolution，母本旧语音已移除）")
    else:
        notes.append("语音：c9–c16 已写 ConditionExist(29) 路由与 switched_action_skill；matched_skill_ready.mp3 "
                     "等 22 条须由 wf_seasonal7_voice pack 装包（Integrate 阶段）；当前 "
                     f"missing={len(voice['missing_slots'])} extra={len(voice['extra_voice_files'])}")
    if pixel["status"] == "installed":
        notes.append("像素小人：pixel/regis/out 两张染色 sheet 已按存储态装包（owner=pixel；解码字节 = 复核 sha，"
                     "尺寸/alpha = 母本，atlas/frame/timeline = 母本仅路径前缀改写）")
    else:
        notes.append(f"像素小人仍为母本原色（pixel 产物未就绪：{pixel['problems'][:3]}）")
    notes.append("待作者拍板（取设计默认）：光束能力伤害轴放大效应（退路 A/B）、c27=自身 cid、语音参考 A/B")
    report = {
        "summary": "雷吉斯·海滨 kit：6 队长行 / 11 词条行 / 7 覆盖文案 / 两档技能（能力伤害轴光束 + 雷队能力伤害状态）/ "
                   "两特效族克隆 / 语音路由",
        "status": status,
        "status_reason": status_reason,
        "kit_fingerprint": fingerprint,
        "design": {"path": DESIGN_REL, "sha256": sha256((ctx.root / DESIGN_REL).read_bytes())},
        "skills": {"programs": programs},
        "unique_condition": {},
        "required_capabilities": list(CAPABILITIES),
        "panel": panel,
        "notes": notes,
        "rows": row_evidence,
        "skill_trees": skills_report,
        "effects": {"families": [{k: f[k] for k in ("src_dir", "dst_dir", "copied_bases", "missing_effects")}
                                 | {"files": len(f["files"])} for f in families],
                    "fx_manifest": fx_info, "recolor": recolor_log, "recolor_problems": recolor_blockers},
        "pixel": pixel,
        "voice": voice,
        "switched_action_skill": {VOICE_KEY: switched},
        "character_route": route_cols,
        "mirrors": {"server_character": mirrors["server_character"]},
    }
    ctx.report(report)
    return {"status": status, "status_reason": status_reason, "kit_fingerprint": fingerprint,
            "rows": {"leader": len(rows["leader"]), "ability_records": sum(len(v) for v in rows["ability"].values())},
            "skills": {lv: {"bytes": s["checks"]["amf3_bytes"], "estimate": s["multiplier_estimate"]}
                       for lv, s in skills_report.items()},
            "effects": [f["dst_dir"] for f in families], "recolored": len(recolor_log),
            "pixel": pixel["status"], "voice_packed": voice["packed"]}
