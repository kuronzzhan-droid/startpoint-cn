# -*- coding: utf-8 -*-
"""菲莉亚·夏祭浴衣（159996 ``wind_oracle_yukata``）套件施工器。

真源：``work/character_packs/seasonal7-20260916/design/philia.json``（status=final）。
本模块只写 ``work/character_packs/s7-philia/``（经 KitContext）与本批 ``fx/philia``、``impl/philia``
下的证据；不写 live store / assets / .cdn / src，不发布。

落地内容（build(ctx)）：
- 词条 6 键 13 条、队长 6 行：按设计 donor（官方基线或 live 已上线行）+ edits 派生，
  逐格核对设计 ``full_row``；跑 wf_client_legality 三件套，非空即拒写。
- custom_ability_string：``change_skill_wind_oracle_yukata``（536 c70）、
  ``override_string_wind_oracle_yukata_pf``（722 c82）；撤销框架自动克隆但不用的
  ``change_skill_wind_oracle_yukata_2``。
- 特效三族克隆（codename 布局 sword/rain/heal，基名保留）；``fx/philia/out/manifest.json``
  存在时按其 {源 sheet 逻辑路径 → 染色 PNG} 替换 sheet（尺寸必须一致、alpha 默认必须一致）。
- 技能两档 DSL：meteor23 / 1anv / wind_oracle / light_ballot23_2 四母本拼树（官方基线，sha 锁定）；
  PF 覆盖三档：官方 supporter 整树（SOURCE_HASHES 锁定）+ 1anv_2 光剑单元 4/6/8 把。
  特效引用一律 ``rewrite_effect_refs(strict=True)``；写前跑 DSL 门禁（往返/主体绑定/命中目标/
  元素/方向/严格作用域/签名参数个数与形状/DoNothing/重复绑定 id）。
- action_skill 两档、power_flip_action、switched_action_skill ``<code>_voice_ready``（17 列 = c7..c23）、
  character c9–c16 语音路由与 c18 队长名、character_text 12 列；镜像同步。
- 像素小人（Integrate）：``pixel/philia/out/{sprite_sheet,special_sprite_sheet}.png`` 在 report 门禁全过、
  ``pixel/_review/verify_all.json`` 复核全过且 sha 一致时，以存储态写入 ``character/<code>/pixelart/``
  （owner=pixel），写后核对尺寸/alpha = 母本、元数据 = 母本（仅路径前缀）。语音由
  ``wf_seasonal7_voice pack`` + ``impl/philia/voice_merge.py`` 装包，kit 只读记录 ``voice_state``。
- kit-report：离线门禁（``impl/philia/run_gates.py`` → ``impl/philia/gates.json``）全过、且其
  ``kit_digest`` 与本次产物摘要一致时写 ``ready-for-review``，否则 ``draft``。
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import zlib
from pathlib import Path
from typing import Any, Callable

import wf_client_legality as L
import wf_dsl
import wf_dsl_sig
import wf_gerald_native_pf_dsl as GPF
import wf_seasonal7_common as C

KEY = "philia"
CID = 159996
CODE = "wind_oracle_yukata"
ELEMENT = 4                                    # 光（0 基内部）
BATCH = "work/character_packs/seasonal7-20260916"
DESIGN_REL = f"{BATCH}/design/philia.json"
FX_MANIFEST_REL = f"{BATCH}/fx/philia/out/manifest.json"
IMPL_REL = f"{BATCH}/impl/philia"
GATES_REL = f"{IMPL_REL}/gates.json"
SUPPORTER_SOURCES = (f"work/codex_out/newchars-r2-20260906/gerald-native-pf",
                     f"{IMPL_REL}/sources")

ABILITY = "master/ability/ability.orderedmap"
LEADER = "master/ability/leader_ability.orderedmap"
CAS = "master/string/custom_ability_string.orderedmap"
PFA = "master/skill/power_flip_action.orderedmap"
SW = "master/skill/switched_action_skill.orderedmap"
CHAR = "master/character/character.orderedmap"
TEXT = "master/character/character_text.orderedmap"
ACTION = "master/skill/action_skill.orderedmap"
SKILL_SRC = "battle/action/skill/action/rare5/"
PF_KEY = f"{CODE}_pf"
PF_PROGRAMS = tuple(f"battle/action/power_flip/action/override/{PF_KEY}${PF_KEY}_lv{n}" for n in (1, 2, 3))
VOICE_KEY = f"{CODE}_voice_ready"
CAS_CHANGE_SKILL = f"change_skill_{CODE}"
CAS_PF_OVERRIDE = f"override_string_{CODE}_pf"
UNUSED_FRAMEWORK_CAS = (f"change_skill_{CODE}_2",)

# ---- 模块级覆盖（get_spec 合并；tables 重跑时生效）。与设计 text 段逐字一致，build 时再核对。
_DESC = ("召唤光之剑追踪距离最近的敌人，贯穿路径上的敌人造成光属性伤害【伤害量随自身增益效果数量提升】"
         "／于弹射球上方降下剑雨，对范围内的敌人造成光属性伤害"
         "／恢复队伍角色及协力球与参战者队伍角色的生命值【对光属性效果提升】"
         "／赋予参战者全员浮游效果／赋予队伍强化弹射伤害提升效果／赋予队长攻击力提升效果／提升连击数／提升自身攻击力")
TEXTS = {
    "name": "菲莉亚",
    "furigana": "FEILIYA",
    "profile": ("换上白底青纹浴衣参加夏祭的风之巫女。绣球花与风铃摇曳的木台上，她为大家祈求平安，"
                "也悄悄期待夜空绽放的烟花。当晚风点亮光之剑，她会轻声许愿——愿今夜的欢笑，不被任何人夺走。"),
    "title": "绣球夜祭的光剑巫女",
    "leader": "夏祭夜空的祈愿",
    "skill1": "绣球光剑·夏夜花火",
    "desc1": _DESC,
    "skill2": "绣球光剑·夏夜花火＋",
    "desc2": _DESC,
    "cv": "AI 合成配音",
}
SPEC = {
    "required_capabilities": ("kyubi-fever-ratio-v1",),
    "extra_keys": {
        CAS: (CAS_PF_OVERRIDE, CAS_CHANGE_SKILL),
        PFA: (PF_KEY,),
        SW: (VOICE_KEY,),
    },
}

# ---- 技能树参数（design tree_plan_1/2；build 时与 tree_plan_2 的机器可读值核对）
SKILL_PARAMS = {
    "1": dict(sword=(0.65, 0.65), rain=(3.6, 3.6), alv=(0.5, 1.25), fly=(480, 480), heal=(0.06, 0.06),
              pfdmg_frames=900, pfdmg=(1.0, 1.0), ldatk_frames=900, ldatk=(0.8, 0.8), combo=(10, 10)),
    "2": dict(sword=(0.70, 0.80), rain=(4.2, 5.0), alv=(0.5, 1.25), fly=(600, 720), heal=(0.08, 0.10),
              pfdmg_frames=1200, pfdmg=(1.2, 1.5), ldatk_frames=1200, ldatk=(1.0, 1.2), combo=(10, 15)),
}
# PF 三档：(光剑数, 每把倍率, 外层 Wait 帧)
PF_PARAMS = {1: (4, 0.9, 6), 2: (6, 1.1, 6), 3: (8, 1.3, 6)}
PF_SUBJECT_OFFSET = 200
PF_EFFECT_LABEL_SUFFIX = "_pfsword"
HEAL_SLAYER_LIGHT = [5]                         # CreateRatioHeal p3：1 基光（官方 compliment_oiran_xm22_2 同构）

# 主体槽（命令数组下标，0 = 命令名）与 GH 坐标槽 —— 与 d8_proto / wf-dsl-subject-lookup-map 一致
SUBJECT_SLOTS = {"FindAllSubjects": (1,), "FindNearSubjects": (1, 5), "CreateReferencePoint": (1, 10),
                 "CreateHitArea": (2, 19, 21, 22), "ShowEffect": (3,), "MoveHitArea": (1,),
                 "CreateNormalAttack": (1,), "CreateCondition": (1,), "CreateRatioHeal": (1,)}
COORD_SLOTS = {"CreateHitArea": (3,), "ShowEffect": (6,), "MoveHitArea": (2,), "CreateReferencePoint": (2,)}


class KitError(C.S7Error):
    pass


# ================================================================ 纯函数：树工具

def slv(a, b, **extra) -> list[dict]:
    d = {"min": a, "max": b}
    d.update(extra)
    return [d]


def cmds(node, name: str | None = None, out: list | None = None) -> list[list]:
    out = [] if out is None else out
    if isinstance(node, list):
        if node and node[0] == "Command" and isinstance(node[1], list) and (name is None or node[1][0] == name):
            out.append(node[1])
        for child in node:
            cmds(child, name, out)
    return out


def events(node, out: list | None = None) -> list[list]:
    out = [] if out is None else out
    if isinstance(node, list):
        if node and node[0] == "Event" and isinstance(node[1], list):
            out.append(node[1])
        for child in node:
            events(child, out)
    return out


def spec_paths(node):
    if isinstance(node, list):
        if len(node) == 2 and node[0] == "SpecifyEffectDirectly" and isinstance(node[1], str):
            yield node[1]
        for child in node:
            yield from spec_paths(child)


def remap_subjects(node, mapping: Callable[[int], int]) -> None:
    """就地重映射非负主体 id（lookup 位 + 绑定位 + GH 坐标）。mapping 抛 KeyError = 出现计划外 id。"""
    if isinstance(node, list):
        if node and node[0] == "Command" and isinstance(node[1], list):
            cmd = node[1]
            for i in SUBJECT_SLOTS.get(cmd[0], ()):
                if isinstance(cmd[i], int) and not isinstance(cmd[i], bool) and cmd[i] >= 0:
                    cmd[i] = mapping(cmd[i])
            for i in COORD_SLOTS.get(cmd[0], ()):
                if isinstance(cmd[i], list) and cmd[i] and cmd[i][0] == "GH" and cmd[i][1] >= 0:
                    cmd[i][1] = mapping(cmd[i][1])
        for child in node:
            remap_subjects(child, mapping)


def find_one(block: list, pred, label: str) -> list:
    hits = [i for i, entry in enumerate(block) if pred(entry)]
    if len(hits) != 1:
        raise KitError(f"locate {label}: expected exactly one match, got {len(hits)}")
    return copy.deepcopy(block[hits[0]])


def is_cmd(name: str, **params):
    return lambda e: (e[0] == "Command" and e[1][0] == name
                      and all(e[1][int(k[1:])] == v for k, v in params.items()))


def is_find_all(kind: int):
    return lambda e: e[0] == "Command" and e[1][0] == "FindAllSubjects" and e[1][2] == kind


def bound_ids(tree) -> list[int]:
    ids: list[int] = []
    for c in cmds(tree):
        if c[0] == "FindAllSubjects":
            ids.append(c[1])
        elif c[0] == "FindNearSubjects":
            ids.append(c[5])
        elif c[0] == "CreateReferencePoint":
            ids.append(c[10])
        elif c[0] == "CreateHitArea":
            ids += [c[19], c[21], c[22]]
    return ids


# ================================================================ 纯函数：DSL 门禁

def scope_problems(tree) -> list[str]:
    """严格作用域：lookup 位 / GH 坐标只能引用外层已绑定 id（比 legality 更严）。"""
    probs: list[str] = []
    bind = {"FindAllSubjects": ((1,), 9), "FindNearSubjects": ((5,), 6), "CreateReferencePoint": ((10,), 11)}
    look = {"ShowEffect": (3,), "CreateHitArea": (2,), "FindNearSubjects": (1,), "CreateReferencePoint": (1,),
            "CreateNormalAttack": (1,), "CreateCondition": (1,), "CreateRatioHeal": (1,), "MoveHitArea": (1,),
            "StopBall": (1,)}

    def walk(node, bound: frozenset) -> None:
        if not isinstance(node, list):
            return
        if node and node[0] == "Command" and isinstance(node[1], list):
            c = node[1]
            name = c[0]
            for i in look.get(name, ()):
                v = c[i]
                if isinstance(v, int) and not isinstance(v, bool) and v >= 0 and v not in bound and v != 255:
                    probs.append(f"{name}[{i}]={v} unbound")
            for i in COORD_SLOTS.get(name, ()):
                v = c[i]
                if isinstance(v, list) and v and v[0] == "GH" and v[1] >= 0 and v[1] not in bound:
                    probs.append(f"{name} GH {v[1]} unbound")
            if name in bind:
                ids, blk = bind[name]
                walk(c[blk], bound | {c[i] for i in ids})
                return
            if name == "CreateHitArea":
                inner = bound | {c[19], c[21], c[22]}
                walk(c[20], inner)
                walk(c[23], inner)
                return
            for child in c[1:]:
                walk(child, bound)
            return
        for child in node:
            walk(child, bound)

    walk(tree, frozenset())
    return probs


_EXPR_TAGS = ("Block", "Command", "Event")


def _is_expr(value) -> bool:
    return (isinstance(value, list) and value and isinstance(value[0], str)
            and (value[0] in _EXPR_TAGS or value[0].startswith("Conditionals")))


def _is_num(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _shape_ok(value, typ: str, path: str, probs: list[str]) -> None:
    """按 wf_dsl_sig 类型表检查参数形状（F1034：非 Array 进 Array 参；F1009：DoNothing 进表达式槽）。

    null 一律放行：官方树大量可空参数（如 CreateCondition p7 HitCountCheckTargetKind=null），
    客户端 undefined/null 静默处理（记忆卡 wf-dsl-param-shape-f1034）。"""
    if value is None or typ in ("Object", "Dynamic"):
        return
    if typ in ("int", "Number"):
        if not _is_num(value):
            probs.append(f"{path}: want {typ} got {type(value).__name__}")
        return
    if typ == "Boolean":
        if not isinstance(value, bool):
            probs.append(f"{path}: want Boolean got {type(value).__name__}")
        return
    if typ == "String":
        if not isinstance(value, str):
            probs.append(f"{path}: want String got {type(value).__name__}")
        return
    if typ == "Array":
        if not isinstance(value, list):
            probs.append(f"{path}: want Array got {type(value).__name__}")
        return
    if typ == "ActionDslExpression":
        if not _is_expr(value):
            probs.append(f"{path}: want ActionDslExpression got {json.dumps(value, ensure_ascii=False)[:60]}")
        return
    enum = wf_dsl_sig.ENUMS.get(typ)
    if enum is None:
        return                                   # 未收录类型：不下结论
    if not (isinstance(value, list) and value and isinstance(value[0], str)):
        probs.append(f"{path}: want enum {typ} got {json.dumps(value, ensure_ascii=False)[:60]}")
        return
    ctor = value[0]
    if ctor not in enum:
        probs.append(f"{path}: {ctor!r} is not a constructor of {typ}")
        return
    args = enum[ctor]
    if len(value) - 1 != len(args):
        probs.append(f"{path}: {typ}.{ctor} arity {len(value) - 1} != {len(args)}")
        return
    for j, (arg, arg_t) in enumerate(zip(value[1:], args), 1):
        _shape_ok(arg, arg_t, f"{path}>{ctor}#{j}", probs)


def signature_problems(tree) -> list[str]:
    probs: list[str] = []
    for c in cmds(tree):
        sig = wf_dsl_sig.COMMANDS.get(c[0])
        if sig is None:
            probs.append(f"unknown command {c[0]}")
            continue
        if len(c) - 1 != len(sig):
            probs.append(f"arity {c[0]} {len(c) - 1} != {len(sig)}")
            continue
        for i, (value, typ) in enumerate(zip(c[1:], sig)):
            _shape_ok(value, typ, f"{c[0]}#p{i}", probs)
    for e in events(tree):
        sig = wf_dsl_sig.EVENTS.get(e[0])
        if sig is None:
            probs.append(f"unknown event {e[0]}")
            continue
        if len(e) - 1 != len(sig):
            probs.append(f"arity event {e[0]} {len(e) - 1} != {len(sig)}")
            continue
        for i, (value, typ) in enumerate(zip(e[1:], sig)):
            _shape_ok(value, typ, f"Event {e[0]}#p{i}", probs)

    def conditionals(node) -> None:
        if isinstance(node, list):
            if node and isinstance(node[0], str) and node[0].startswith("Conditionals"):
                for branch in node[1:]:
                    if isinstance(branch, list) and branch[:1] == ["DoNothing"]:
                        probs.append(f"{node[0]} branch is ['DoNothing'] (F1009; empty branch = ['Block', []])")
            for child in node:
                conditionals(child)
    conditionals(tree)
    return probs


def official_signature_problems(tree, official_sig: dict[str, list[str]]) -> list[str]:
    """官方全库 (构造, 参数位) → kind 集合差分（design/_tmp review_zehr_engine/sigdiff.py 同口径）。"""
    probs: list[str] = []
    known_cmds = {k.split("#")[0] for k in official_sig}

    def tag(v):
        return v[0] if isinstance(v, list) and v and isinstance(v[0], str) else None

    def kind(v):
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
            t = tag(v)
            if t in _EXPR_TAGS:
                return "expr"
            if t is not None:
                return "enum:" + t
            return "list"
        return type(v).__name__

    def add(key, k, where):
        allowed = official_sig.get(key)
        if allowed is None:
            probs.append(f"no official key {key} kind={k} @ {where}")
        elif k not in allowed:
            probs.append(f"{key}: kind {k} not in official {allowed} @ {where}")

    def walk(node, where):
        if isinstance(node, list):
            t = tag(node)
            if t in ("Command", "Event") and isinstance(node[1], list):
                c = node[1]
                if c[0] not in known_cmds:
                    probs.append(f"unknown command {c[0]}")
                for i, p in enumerate(c[1:], 1):
                    k = kind(p)
                    add(f"{c[0]}#{i}", k, where + "/" + c[0])
                    if k.startswith("enum:"):
                        for j, q in enumerate(p[1:], 1):
                            add(f"{c[0]}#{i}>{p[0]}#{j}", kind(q), f"{where}/{c[0]}#{i}")
                    if k == "list":
                        for q in p:
                            if tag(q) and tag(q) not in _EXPR_TAGS:
                                for j, r in enumerate(q[1:], 1):
                                    add(f"{q[0]}#{j}", kind(r), f"{where}/{c[0]}>{q[0]}")
            for child in node:
                walk(child, where)

    walk(tree[11], "root")
    return sorted(set(probs))


def dsl_gates(tree, *, element: int = ELEMENT) -> dict[str, Any]:
    """技能/PF 树静态门禁（与 design _tmp d8_proto.report 同口径，外加参数形状）。"""
    enc = wf_dsl.encode_amf3(tree)
    roundtrip = wf_dsl.parse_dsl(enc)["tree"] == tree
    raw = zlib.compress(enc, 9)[2:-4]
    ids = bound_ids(tree)
    return {
        "roundtrip": roundtrip,
        "deflate_bytes": len(raw),
        "wrapper": isinstance(tree, dict),
        "head_ok": isinstance(tree, list) and len(tree) == 12 and tree[0] == "ActionDsl"
                   and isinstance(tree[11], list) and tree[11][:1] == ["Block"],
        "legality_subject": L.action_dsl_subject_binding_problems(tree),
        "legality_hit_target": L.action_dsl_hit_area_target_problems(tree),
        "legality_element": L.action_dsl_element_problems(tree, element),
        "player_side": wf_dsl.player_side_dsl_problems(tree),
        "scope_strict": scope_problems(tree),
        "signature": signature_problems(tree),
        "dup_bind_ids": sorted({i for i in ids if ids.count(i) > 1}),
        "n_attacks": len(cmds(tree, "CreateNormalAttack")),
        "movementPriority": tree[1],
        "buffTargetAs": tree[10],
        "fx_paths": sorted(set(spec_paths(tree))),
    }


GATE_LIST_KEYS = ("legality_subject", "legality_hit_target", "legality_element", "player_side",
                  "scope_strict", "signature", "dup_bind_ids")


def dsl_gate_failures(gates: dict[str, Any]) -> list[str]:
    bad = [f"{k}={gates[k][:3]}" for k in GATE_LIST_KEYS if gates.get(k)]
    if not gates.get("roundtrip"):
        bad.append("roundtrip=false")
    if gates.get("wrapper") or not gates.get("head_ok"):
        bad.append("tree head/wrapper invalid")
    return bad


# ================================================================ 纯函数：行门禁

def row_problems(kind: str, row: list[str], element: int = ELEMENT) -> list[str]:
    probs = L.client_legality_problems(kind, row) + L.declared_block_field_problems(kind, row)
    if kind == "ability":
        probs += L.ability_element_column_problems(kind, row, element)
    return probs


def string_key_refs(kind: str, row: list[str]) -> list[tuple[str, int, str]]:
    """行内引用 custom_ability_string 的键：536 c70 / 629 c70（leader c68）/ 722 c82（leader）。"""
    import wf_describe
    blocks = wf_describe.layout(kind)["blocks"]
    base = int(blocks["instant_content"])
    refs = []
    content = row[base] if base < len(row) else ""
    sid_col = base + L.INVOKE_SKILL_STRING_OFFSET
    if content in ("536", "629") and sid_col < len(row):
        refs.append((content, sid_col, row[sid_col]))
    if kind == "leader_ability" and content == "722" and len(row) > 82:
        refs.append(("722", 82, row[82]))
    return refs


# ================================================================ 设计读取与派生

def load_design(root: Path) -> dict[str, Any]:
    design = json.loads((root / DESIGN_REL).read_text(encoding="utf-8"))
    ident = design.get("identity") or {}
    if design.get("status") != "final" or design.get("key") != KEY:
        raise KitError(f"design not final/philia: status={design.get('status')} key={design.get('key')}")
    if (ident.get("cid"), ident.get("code"), ident.get("element")) != (CID, CODE, ELEMENT):
        raise KitError(f"design identity drift: {ident.get('cid')}/{ident.get('code')}/{ident.get('element')}")
    return design


def _design_edit(block: dict, needle: str) -> Any:
    hits = [e["new"] for e in block["param_edits"] if needle in e["param"]]
    if len(hits) != 1:
        raise KitError(f"design block {block['order']} ({block['name']}): expected one param_edit with "
                       f"{needle!r}, got {len(hits)}")
    return hits[0]


def skill_param_drift(design: dict) -> list[str]:
    """SKILL_PARAMS 两档逐项对照 design tree_plan_1/2 的机器可读 param_edits（不止 ＋档）。"""
    drift: list[str] = []
    for level in ("1", "2"):
        blocks = {b["order"]: b for b in design["skills"][f"tree_plan_{level}"]["blocks"]}
        p = SKILL_PARAMS[level]
        pairs = {
            "fly": (_design_edit(blocks[3], "ACFlying"), slv(*p["fly"])),
            "heal": (_design_edit(blocks[4], "比例"), slv(*p["heal"])),
            "heal_slayer": (_design_edit(blocks[4], "slayer"), HEAL_SLAYER_LIGHT),
            "pfdmg_frames": (_design_edit(blocks[7], "帧"), slv(p["pfdmg_frames"], p["pfdmg_frames"])),
            "pfdmg": (_design_edit(blocks[7], "强度"), slv(*p["pfdmg"])),
            "ldatk_frames": (_design_edit(blocks[8], "帧"), slv(p["ldatk_frames"], p["ldatk_frames"])),
            "ldatk": (_design_edit(blocks[8], "强度"), slv(*p["ldatk"])),
            "combo": (_design_edit(blocks[9], "AddCombo"), slv(*p["combo"])),
            "sword": (_design_edit(blocks[10], "倍率"), slv(*p["sword"])),
            "rain": (_design_edit(blocks[11], "倍率"),
                     slv(p["rain"][0], p["rain"][1], alv_min=p["alv"][0], alv_max=p["alv"][1])),
        }
        for name, (want, have) in pairs.items():
            if want != have:
                drift.append(f"skill{level}.{name}: design {want} != kit {have}")
    return drift


def pf_param_drift(design: dict) -> list[str]:
    """PF_PARAMS（光剑数 / 每把倍率 / 外层 Wait）对照 design pf_override.lvN.donor 文字方案。"""
    import re
    drift: list[str] = []
    for level, (count, mult, delay) in PF_PARAMS.items():
        donor = design["pf_override"][f"lv{level}"]["donor"]
        m_count = re.search(r"前\s*(\d+)\s*个", donor["locate"])
        m_wait = re.search(r"Wait\((\d+)", donor["wrap"])
        mults = [json.loads(t.split("→", 1)[1].strip()) for t in donor["transform"] if t.startswith("CNA p5")]
        want = (int(m_count.group(1)) if m_count else None, mults[0] if len(mults) == 1 else None,
                int(m_wait.group(1)) if m_wait else None)
        have = (count, slv(mult, mult), delay)
        if want != have:
            drift.append(f"pf lv{level}: design {want} != kit {have}")
        if not any("p9" in t and "false" in t for t in donor["transform"]):
            drift.append(f"pf lv{level}: design no longer turns CNA p9 buff-count bonus off")
    return drift


def _donor_table(ctx, source: str, table: str, cache: dict) -> dict[str, str]:
    logical = f"master/ability/{table}.orderedmap"
    if source.startswith("官方"):
        kind = "official"
    elif source.startswith("live"):
        kind = "live"
    else:
        raise KitError(f"unknown donor source {source!r}")
    if (kind, logical) not in cache:
        cache[(kind, logical)] = ctx.official_flat(logical) if kind == "official" else ctx.live_flat(logical)
    return cache[(kind, logical)]


def derive_rows(ctx, entries: list[dict], table: str, label: str,
                cache: dict | None = None) -> tuple[list[list[str]], list[dict]]:
    cache = {} if cache is None else cache
    rows, trace = [], []
    for n, entry in enumerate(entries):
        flat = _donor_table(ctx, entry["donor_source"], table, cache)
        if entry["donor"] not in flat:
            raise KitError(f"{label}#{n}: donor {entry['donor']} missing from {entry['donor_source']}")
        donor_rows = C.csv_split(flat[entry["donor"]])
        row = list(donor_rows[entry["row_index"]])
        for col, want in entry.get("donor_before", {}).items():
            if row[int(col)] != want:
                raise KitError(f"{label}#{n}: donor {entry['donor']} c{col}={row[int(col)]!r} != design {want!r}")
        for col, value in entry["edits"].items():
            row[int(col)] = value
        if row != entry["full_row"]:
            diff = [(i, a, b) for i, (a, b) in enumerate(zip(row, entry["full_row"])) if a != b]
            raise KitError(f"{label}#{n}: derived row != design full_row: {diff[:5]}")
        if len(row) != entry["ncols"]:
            raise KitError(f"{label}#{n}: ncols {len(row)} != {entry['ncols']}")
        rows.append(row)
        trace.append({"donor": entry["donor"], "row_index": entry["row_index"],
                      "source": entry["donor_source"], "edits": entry["edits"]})
    return rows, trace


# ================================================================ 特效：fx 染色钩子

def load_fx_manifest(root: Path) -> tuple[dict[str, dict], dict[str, Any]]:
    """``fx/philia/out/manifest.json`` → {源 sheet 逻辑路径: {"file": Path, "allow_alpha_change": bool}}。

    接受三种写法（值为相对 manifest 目录的 PNG 路径，或 {"file"/"png": 路径, "allow_alpha_change": bool}）：
    ``{"sheets": {源: 值}}``、``{"entries": [{"source": 源, "file": 路径}]}``、或顶层直接 ``{源: 值}``。
    源可写 sheet 逻辑路径（``…/wind_oracle_1anv/wind_oracle_1anv.png``）或源目录（``…/wind_oracle_1anv``）。
    """
    path = root / FX_MANIFEST_REL
    info: dict[str, Any] = {"path": FX_MANIFEST_REL, "present": path.is_file()}
    if not path.is_file():
        return {}, info
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and data.get("all_gates_ok") is False:
        raise KitError(f"{FX_MANIFEST_REL}: Effects stage reports all_gates_ok=false")
    details = data.get("details") if isinstance(data, dict) and isinstance(data.get("details"), dict) else {}
    items: list[tuple[str, Any]] = []
    if isinstance(data, dict) and isinstance(data.get("sheets"), dict):
        items = list(data["sheets"].items())
    elif isinstance(data, dict) and isinstance(data.get("entries"), list):
        for entry in data["entries"]:
            if isinstance(entry, dict) and "source" in entry:
                items.append((entry["source"], entry))
    elif isinstance(data, dict):
        items = [(k, v) for k, v in data.items() if isinstance(k, str) and k.startswith("battle/")]
    out: dict[str, dict] = {}
    for source, value in items:
        source = str(source).rstrip("/")
        if not source.endswith(".png"):
            donor = source.rsplit("/", 1)[-1]
            source = f"{source}/{donor}.png"
        if isinstance(value, str):
            file, allow = value, False
        elif isinstance(value, dict):
            file = value.get("file") or value.get("png") or value.get("path")
            allow = bool(value.get("allow_alpha_change", False))
        else:
            raise KitError(f"fx manifest entry for {source} has unsupported value {value!r}")
        if not file:
            raise KitError(f"fx manifest entry for {source} lacks a PNG file")
        file_path = (path.parent / file).resolve()
        if not file_path.is_file():
            raise KitError(f"fx manifest PNG missing: {file_path}")
        detail = details.get(source) if isinstance(details.get(source), dict) else {}
        if detail.get("gates_all_ok") is False:
            raise KitError(f"fx manifest entry {source}: Effects stage gates_all_ok=false")
        out[source] = {"file": file_path, "allow_alpha_change": allow,
                       "source_rgba_sha256": detail.get("source_rgba_sha256"),
                       "out_rgba_sha256": detail.get("out_rgba_sha256")}
    info["entries"] = {k: {"file": str(v["file"]), "allow_alpha_change": v["allow_alpha_change"],
                           "sha256": C.sha256(v["file"].read_bytes()),
                           "source_rgba_sha256": v["source_rgba_sha256"],
                           "out_rgba_sha256": v["out_rgba_sha256"]} for k, v in sorted(out.items())}
    return out, info


def make_png_transform(sheet_logical: str, override: dict | None, log: dict[str, Any]):
    """无覆盖返回 None（官方原色）；有覆盖时整张替换并核对尺寸 / alpha。"""
    if override is None:
        log[sheet_logical] = {"recolor": None}
        return None

    def transform(img):
        from PIL import Image
        img = img.convert("RGBA")
        want_src = override.get("source_rgba_sha256")
        if want_src and hashlib.sha256(img.tobytes()).hexdigest() != want_src:
            raise KitError(f"fx recolor {sheet_logical}: source sheet RGBA drifted from what Effects stage recolored")
        raw = override["file"].read_bytes()
        new = C.png_open(raw) if raw[:4] == b"\x89png" else Image.open(io.BytesIO(raw)).convert("RGBA")
        want_out = override.get("out_rgba_sha256")
        if want_out and hashlib.sha256(new.tobytes()).hexdigest() != want_out:
            raise KitError(f"fx recolor {sheet_logical}: recolored PNG RGBA != manifest out_rgba_sha256")
        if new.size != img.size:
            raise KitError(f"fx recolor {sheet_logical}: size {new.size} != source {img.size} (atlas rects break)")
        alpha_changed = sum(1 for a, b in zip(img.getchannel("A").tobytes(), new.getchannel("A").tobytes())
                            if a != b)
        if alpha_changed and not override["allow_alpha_change"]:
            raise KitError(f"fx recolor {sheet_logical}: {alpha_changed} alpha pixels changed "
                           "(design rule: RGB only; set allow_alpha_change to accept)")
        log[sheet_logical] = {"recolor": str(override["file"]), "size": list(new.size),
                              "alpha_changed_pixels": alpha_changed}
        return new
    return transform


# ================================================================ 技能 / PF 组树

def _source_tree(ctx, program: str, want_sha: str | None) -> list:
    logical = wf_dsl.dsl_logical(program)
    raw = ctx.official_read(logical, "common")
    source = "official"
    if raw is None:
        raw = ctx.live_read(logical)
        source = "live"
    if want_sha is not None and C.sha256(raw) != want_sha:
        raise KitError(f"source DSL fingerprint drift ({source}): {program}")
    return ctx.template_dsl(program) if source == "official" else C.amf_parse(raw)


def design_source_hashes(design: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for plan in ("tree_plan_1", "tree_plan_2"):
        for block in design["skills"][plan]["blocks"]:
            src = block["source"]
            if out.setdefault(src["dsl"], src["sha256"]) != src["sha256"]:
                raise KitError(f"design lists two hashes for {src['dsl']}")
    return out


def build_skill_tree(ctx, level: str, params: dict, families: list[dict], hashes: dict[str, str]):
    wo = _source_tree(ctx, f"{SKILL_SRC}wind_oracle$wind_oracle_{level}",
                      hashes.get(f"{SKILL_SRC}wind_oracle$wind_oracle_{level}"))
    av = _source_tree(ctx, f"{SKILL_SRC}wind_oracle_1anv$wind_oracle_1anv_{level}",
                      hashes.get(f"{SKILL_SRC}wind_oracle_1anv$wind_oracle_1anv_{level}"))
    mt = _source_tree(ctx, f"{SKILL_SRC}wind_oracle_meteor23$wind_oracle_meteor23_{level}",
                      hashes.get(f"{SKILL_SRC}wind_oracle_meteor23$wind_oracle_meteor23_{level}"))
    lb = _source_tree(ctx, f"{SKILL_SRC}light_ballot23$light_ballot23_2",
                      hashes[f"{SKILL_SRC}light_ballot23$light_ballot23_2"])
    wb, ab, mb, lbb = wo[11][1], av[11][1], mt[11][1], lb[11][1]
    stop = find_one(mb, is_cmd("StopBall"), "meteor23 StopBall")
    fx_all = find_one(mb, is_cmd("ShowEffect"), "meteor23 ShowEffect 全体演出")
    rain = find_one(mb, is_cmd("CreateReferencePoint"), "meteor23 CreateReferencePoint")
    charge = find_one(ab, is_cmd("ShowEffect"), "1anv ShowEffect チャージ演出")
    swords = find_one(ab, lambda e: e[0] == "Event" and e[1][0] == "Wait" and e[1][1] == 20, "1anv Wait(20)")
    self_atk = find_one(ab, lambda e: (e[0] == "Command" and e[1][0] == "CreateCondition"
                                       and e[1][2][0][0] == "ACAttackPoint"), "1anv self ACAttackPoint")
    fly = find_one(wb, is_find_all(33), "wind_oracle FindAll(33)")
    heal113 = find_one(wb, is_find_all(113), "wind_oracle FindAll(113)")
    heal145 = find_one(wb, is_find_all(145), "wind_oracle FindAll(145)")
    heal_mate = find_one(wb, is_cmd("CreateRatioHeal", p1=-33), "wind_oracle CreateRatioHeal(-33)")
    pf_dmg = find_one(lbb, is_find_all(97), "light_ballot23 FindAll(97)")
    leader_atk = find_one(lbb, is_find_all(34), "light_ballot23 FindAll(34)")
    add_combo = find_one(lbb, is_cmd("AddCombo"), "light_ballot23 AddCombo")
    # 定位特征核对（design tree_plan locate）
    if stop[1][1] != -18 or stop[1][3] != ["Stop"]:
        raise KitError(f"StopBall shape drift: {stop[1][:4]}")
    if (fx_all[1][1], fx_all[1][3]) != ("全体演出", -1) or (charge[1][1], charge[1][3]) != ("チャージ演出", -18):
        raise KitError("ShowEffect label/subject drift in meteor23/1anv sources")
    if rain[1][1] != -18 or rain[1][9] != 160:
        raise KitError(f"rain CreateReferencePoint drift: origin={rain[1][1]} lifetime={rain[1][9]}")
    if self_atk[1][1] != -17:
        raise KitError("1anv self ACAttackPoint subject drift")
    head = ["ActionDsl", 2, ["None"], False, False, False, False, False, False, False, 0]
    if mt[:11] != head:
        raise KitError(f"meteor23 head drift: {mt[:11]}")

    remap_subjects(rain, {0: 100, 1: 101, 2: 102, 3: 103}.__getitem__)
    remap_subjects(fly, {0: 110}.__getitem__)
    remap_subjects(heal113, {1: 111}.__getitem__)
    remap_subjects(heal145, {2: 112}.__getitem__)
    remap_subjects(pf_dmg, {1: 120}.__getitem__)
    remap_subjects(leader_atk, {0: 121}.__getitem__)
    sword_attacks = cmds(swords, "CreateNormalAttack")
    if len(sword_attacks) != 16:
        raise KitError(f"expected 16 sword attacks, got {len(sword_attacks)}")
    for c in sword_attacks:
        c[6] = slv(*params["sword"])
        if c[10] is not True:
            raise KitError("1anv sword CNA p9 enablesBuffCountBonus expected true")
    rain_attacks = cmds(rain, "CreateNormalAttack")
    if len(rain_attacks) != 1:
        raise KitError("rain block must hold exactly one CreateNormalAttack")
    rain_attacks[0][6] = slv(params["rain"][0], params["rain"][1],
                             alv_min=params["alv"][0], alv_max=params["alv"][1])
    fly_cc = cmds(fly, "CreateCondition")
    if len(fly_cc) != 1 or fly_cc[0][2][0][0] != "ACFlying":
        raise KitError("fly block drift")
    fly_cc[0][2][0][1] = slv(*params["fly"])
    heals = cmds(heal113, "CreateRatioHeal") + cmds(heal145, "CreateRatioHeal") + [heal_mate[1]]
    if len(heals) != 3:
        raise KitError("heal blocks drift")
    for h in heals:
        h[3] = slv(*params["heal"])
        h[4] = list(HEAL_SLAYER_LIGHT)
    pc = cmds(pf_dmg, "CreateCondition")
    lc = cmds(leader_atk, "CreateCondition")
    if len(pc) != 1 or pc[0][2][0][0] != "ACPowerFlipDamage" or pc[0][10] != 2:
        raise KitError("light_ballot23 97 block drift (ACPowerFlipDamage / 付与种类 2)")
    if len(lc) != 1 or lc[0][2][0][0] != "ACAttackPoint" or lc[0][10] != 1:
        raise KitError("light_ballot23 34 block drift (ACAttackPoint / 付与种类 1)")
    pc[0][2][0][1] = slv(params["pfdmg_frames"], params["pfdmg_frames"])
    pc[0][2][0][2] = slv(*params["pfdmg"])
    lc[0][2][0][1] = slv(params["ldatk_frames"], params["ldatk_frames"])
    lc[0][2][0][2] = slv(*params["ldatk"])
    add_combo[1][1] = slv(*params["combo"])
    body = [stop, fx_all, charge, fly, heal113, heal145, heal_mate, pf_dmg, leader_atk, add_combo,
            swords, rain, self_atk]
    tree = head + [["Block", body]]
    return rewrite_all(ctx, tree, families)


def rewrite_all(ctx, tree, families: list[dict]):
    counts = {}
    for fam in families:
        tree, info = ctx.rewrite_effect_refs(tree, fam, strict=True)
        counts[fam["dst_dir"]] = info["rewritten"]
    return tree, counts


def supporter_raw(root: Path, level: int) -> bytes:
    name = f"supporter_lv{level}{GPF.SUFFIX}"
    for rel in SUPPORTER_SOURCES:
        path = root / rel / name
        if path.is_file():
            raw = path.read_bytes()
            if C.sha256(raw) != GPF.SOURCE_HASHES[f"supporter_lv{level}"]:
                raise KitError(f"official supporter PF lv{level} fingerprint drift: {path}")
            return raw
    raise KitError(f"official supporter PF lv{level} source not found in {SUPPORTER_SOURCES}")


def build_pf_tree(ctx, level: int, donor_1anv_2: list, families: list[dict]):
    count, mult, delay = PF_PARAMS[level]
    base = C.amf_parse(supporter_raw(ctx.root, level))
    if base[0] != "ActionDsl" or base[1] != 1 or base[10] != 0:
        raise KitError(f"supporter lv{level} head drift: {base[:11]}")
    outers = [e for e in donor_1anv_2[11][1] if e[0] == "Event" and e[1][0] == "Wait" and e[1][1] == 20]
    if len(outers) != 1:
        raise KitError("1anv_2 Wait(20) sword unit not unique")
    inner = copy.deepcopy(outers[0][1][3][1][:count])
    if [e[1][1] for e in inner] != [4 * i for i in range(count)]:
        raise KitError(f"1anv_2 sword sub-waits drift: {[e[1][1] for e in inner]}")
    block = ["Event", ["Wait", delay, "*", ["Block", inner]]]
    remap_subjects(block, lambda i: i + PF_SUBJECT_OFFSET)
    if cmds(block, "NotifyPowerflipEnd"):
        raise KitError("donor sword unit unexpectedly holds NotifyPowerflipEnd")
    attacks = cmds(block, "CreateNormalAttack")
    if len(attacks) != count:
        raise KitError(f"PF lv{level}: expected {count} sword attacks, got {len(attacks)}")
    for c in attacks:
        c[6] = slv(mult, mult)
        if c[10] is not True:
            raise KitError("1anv sword CNA p9 expected true before PF override")
        c[10] = False                             # PF 光剑不吃增益数加成（审查 minor#8）
    for c in cmds(block, "CreateHitArea"):
        if c[24] != 0:
            raise KitError("CreateHitArea p23 must stay 0 (4 skips the PF damage bucket)")
    for c in cmds(block, "ShowEffect"):
        c[1] = c[1] + PF_EFFECT_LABEL_SUFFIX
    block, counts = rewrite_all(ctx, block, families)
    tree = copy.deepcopy(base)
    tree[11][1].append(block)
    return tree, counts


# ================================================================ 像素小人 / 语音（Integrate 阶段）

PIXEL_DIR_REL = f"{BATCH}/pixel/philia"
PIXEL_VERIFY_REL = f"{BATCH}/pixel/_review/verify_all.json"
# sheet 基名 → 同组元数据（atlas / frame / timeline），元数据保持母本（只改 character/<母本>/ 前缀）
PIXEL_SHEETS = {
    "sprite_sheet": ("sprite_sheet.atlas.amf3.deflate", "pixelart.frame.amf3.deflate",
                     "pixelart.timeline.amf3.deflate"),
    "special_sprite_sheet": ("special_sprite_sheet.atlas.amf3.deflate", "special.frame.amf3.deflate",
                             "special.timeline.amf3.deflate"),
}


def pixel_inputs(root: Path) -> tuple[dict[str, Path], list[str]]:
    """像素染色产物是否可装包：``pixel/philia/report.json`` 门禁全过、``pixel/_review/verify_all.json``
    philia 复核全过（REVIEW.md §5 修复轮），且两者记录的 sha256 = ``out/<sheet>.png`` 当前字节；
    report 记录的母本 sha 必须 = 当前母本（染色基于同一份母本）。

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
        digest = C.sha256(png.read_bytes())
        rep_sha = ((report.get("outputs") or {}).get(name) or {}).get("sha256")
        if rep_sha != digest:
            probs.append(f"{name}.png sha256 != pixel report outputs ({rep_sha})")
        if (reviewed.get(name) or {}).get("sha256") != digest:
            probs.append(f"{name}.png sha256 != reviewed verify_all H8 sha")
        out[name] = png
    return out, probs


def _pixel_prefix(spec) -> dict[str, str]:
    return {f"character/{spec.template_code}/": f"character/{spec.code}/"}


def pixel_problems(ctx, *, check_owner: bool = True) -> list[str]:
    """包内像素小人核对（不写盘）：sheet 存储态（小写魔数）解码字节 = 染色 PNG 原字节；
    尺寸 / alpha = 母本；染色所据母本 sha = 当前母本；atlas/frame/timeline = 母本树（仅路径前缀改写）；
    归属 owner=pixel 且登记 sha = 盘上字节。"""
    import wf_assets
    spec = ctx.spec
    pngs, probs = pixel_inputs(ctx.root)
    if probs:
        return [f"pixel inputs not ready: {p}" for p in probs]
    report = json.loads((ctx.root / PIXEL_DIR_REL / "report.json").read_text(encoding="utf-8"))
    sources = report.get("source_files") or {}
    prefix = _pixel_prefix(spec)
    for name, metas in PIXEL_SHEETS.items():
        logical = f"character/{CODE}/pixelart/{name}.png"
        tpl_logical = f"character/{spec.template_code}/pixelart/{name}.png"
        if not ctx.pack.pkg_has("common", logical):
            probs.append(f"package pixel sheet missing {logical}")
            continue
        raw = ctx.pack.pkg_path("common", logical).read_bytes()
        if raw[:8] != wf_assets.PNG_FAKE:
            probs.append(f"{logical} lacks store PNG magic")
            continue
        if wf_assets.png_decode(raw) != pngs[name].read_bytes():
            probs.append(f"{logical} != {PIXEL_DIR_REL}/out/{name}.png (store form)")
        _r, donor_raw, _src = ctx.pack.template_asset(tpl_logical)
        if (sources.get(tpl_logical) or {}).get("sha256") != C.sha256(donor_raw):
            probs.append(f"{tpl_logical}: template bytes != pixel report source_files sha (recolor base drift)")
        pkg_img, donor = ctx.png_open(raw), ctx.png_open(donor_raw)
        if pkg_img.size != donor.size:
            probs.append(f"{logical} size {pkg_img.size} != donor {donor.size}")
        elif pkg_img.getchannel("A").tobytes() != donor.getchannel("A").tobytes():
            probs.append(f"{logical} alpha differs from donor {tpl_logical}")
        if check_owner:
            record = ctx.pack.owned_record("common", logical) or {}
            if record.get("owner") != "pixel" or record.get("sha256") != C.sha256(raw):
                probs.append(f"{logical} owner record {record} (expected pixel + current sha)")
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


def install_pixel(ctx) -> dict[str, Any]:
    """把复核通过的像素染色 sheet 以存储态（小写魔数、PNG 字节不重编码）写进包，owner=pixel。

    重跑幂等：字节相同不改盘，登记 sha 不变。产物未就绪时不写、返回 pending。"""
    import wf_assets
    pngs, probs = pixel_inputs(ctx.root)
    if probs:
        return {"status": "pending", "problems": probs}
    written = {}
    for name, png in pngs.items():
        logical = f"character/{CODE}/pixelart/{name}.png"
        data = wf_assets.png_encode(png.read_bytes())
        ctx.write_asset("common", logical, data, owner="pixel")
        written[logical] = {"source": f"{PIXEL_DIR_REL}/out/{png.name}", "decoded_sha256": C.sha256(png.read_bytes()),
                            "store_sha256": C.sha256(data)}
    after = pixel_problems(ctx)
    if after:
        raise KitError(f"pixel sheets did not land in the package: {after}")
    return {"status": "installed", "sheets": written, "problems": []}


def voice_state(ctx) -> dict[str, Any]:
    """只读：语音是否已由 wf_seasonal7_voice pack 装包（22 槽文件在包内且归属 voice、speech 行引用新槽、
    无多余旧母本语音）。"""
    import wf_seasonal7_voice as V
    missing = [s for s in V.SLOTS if not ctx.pack.pkg_has("common", f"character/{CODE}/voice/{s}.mp3")]
    not_voice_owned = [s for s in V.SLOTS if s not in missing
                       and ctx.pack.owner_of("common", f"character/{CODE}/voice/{s}.mp3") != "voice"]
    speech_flat = ctx.pkg_flat("master/character/character_speech.orderedmap") \
        if ctx.pack.pkg_has("common", "master/character/character_speech.orderedmap") else {}
    speech = ctx.csv_split(speech_flat.get(str(CID), "")) if speech_flat.get(str(CID)) else []
    refs = [cells[4] for cells in speech if len(cells) == 5]
    want_refs = [*V.HOME_SLOTS, "ally/join", "ally/evolution"]
    base = ctx.pack.package / "roots" / "common" / "character" / CODE / "voice"
    extra = sorted(p.relative_to(base).with_suffix("").as_posix() for p in base.rglob("*")
                   if p.is_file() and p.relative_to(base).with_suffix("").as_posix() not in V.SLOTS) \
        if base.is_dir() else []
    packed = not missing and not not_voice_owned and refs == want_refs and not extra
    return {"packed": packed, "missing_slots": missing, "not_voice_owned": not_voice_owned,
            "speech_refs": refs, "extra_voice_files": extra}


# ================================================================ 产物摘要（门禁绑定）

DIGEST_TABLE_KEYS = (
    (ABILITY, tuple(f"{CID}{slot}" for slot in range(1, 7))),
    (LEADER, (str(CID),)),
    (CAS, (CAS_CHANGE_SKILL, CAS_PF_OVERRIDE)),
    (PFA, (PF_KEY,)),
    (CHAR, (str(CID),)),
    (TEXT, (str(CID),)),
)


def kit_digest(ctx) -> dict[str, Any]:
    """kit 产物摘要：自有表行文本 + DSL 字节 + 特效族全部文件字节（含染色 sheet）。

    sheet 计入摘要：Effects 阶段改了染色产物、kit 重跑后摘要随之变化，status 回落 draft，
    必须重跑 run_gates（其中核对包内 sheet == fx manifest out_rgba）才能再次 ready-for-review。"""
    parts: dict[str, Any] = {}
    for logical, keys in DIGEST_TABLE_KEYS:
        flat = ctx.pkg_flat(logical) if ctx.pack.pkg_has("common", logical) else {}
        parts[logical] = {k: flat.get(k) for k in keys}
    parts[ACTION] = ctx.pkg_nested(CODE)
    parts[SW] = ctx.pkg_nested(VOICE_KEY, SW)
    files = {}
    programs = [wf_dsl.dsl_logical(ctx.program_path(lv)) for lv in ("1", "2")] + \
               [wf_dsl.dsl_logical(p) for p in PF_PROGRAMS]
    for logical in programs:
        path = ctx.pack.pkg_path("common", logical)
        files[logical] = C.sha256(path.read_bytes()) if path.is_file() else None
    fx_root = ctx.pack.pkg_path("common", f"battle/effect/skill_unique/{CODE}")
    if fx_root.is_dir():
        base = ctx.pack.package / "roots" / "common"
        for path in sorted(fx_root.rglob("*")):
            if path.is_file():
                files[path.relative_to(base).as_posix()] = C.sha256(path.read_bytes())
    parts["files"] = files
    blob = json.dumps(parts, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return {"sha256": hashlib.sha256(blob).hexdigest(), "files": len(files)}


def gate_status(root: Path, digest: str) -> tuple[str, str]:
    path = root / GATES_REL
    if not path.is_file():
        return "draft", f"{GATES_REL} 不存在：先跑 python {IMPL_REL}/run_gates.py"
    try:
        gates = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        return "draft", f"{GATES_REL} 无法解析: {exc}"
    if not gates.get("all_pass"):
        failed = [k for k, v in (gates.get("checks") or {}).items() if not v.get("pass")]
        return "draft", f"离线门禁未全过: {failed}"
    if gates.get("kit_digest") != digest:
        return "draft", "产物已变化（kit_digest 与 gates.json 不一致）：重跑 run_gates.py"
    return "ready-for-review", "离线门禁全过且产物摘要一致"


# ================================================================ build

def _write_checked_flat(ctx, logical: str, rows: dict[str, list[list[str]] | str]) -> None:
    ctx.write_flat(logical, rows)
    back = ctx.pkg_flat(logical)
    for key, value in rows.items():
        want = C.csv_split(value) if isinstance(value, str) else [list(r) for r in value]
        if C.csv_split(back[key]) != want:
            raise KitError(f"readback mismatch {logical}#{key}")


def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.cid, spec.code, spec.element) != (CID, CODE, ELEMENT):
        raise KitError(f"spec identity drift: {spec.cid}/{spec.code}/{spec.element}")
    root = Path(ctx.root)
    design = load_design(root)
    evidence: dict[str, Any] = {"design": DESIGN_REL}
    param_drift = skill_param_drift(design) + pf_param_drift(design)   # 写盘前的纯检查
    if param_drift:
        raise KitError(f"kit parameters drift from design: {param_drift}")

    # ---- 文案与设计核对（TEXTS 是 tables 的输入，必须与设计一致）
    text_row = list(design["text"]["character_text_row"])
    want_texts = {"name": text_row[0], "furigana": text_row[1], "profile": text_row[2], "title": text_row[3],
                  "skill1": text_row[4], "desc1": text_row[5], "skill2": text_row[6], "desc2": text_row[7],
                  "leader": text_row[10], "cv": text_row[11]}
    if TEXTS != want_texts or spec.texts != {**spec.texts, **want_texts}:
        raise KitError("module TEXTS drift from design text.character_text_row")
    if len(text_row) != 12 or text_row[8:10] != ["(None)", "(None)"]:
        raise KitError("design character_text_row shape drift")
    if design["text"].get("desc_override") is not None:
        raise KitError("design now asks for desc_override; kit does not implement it")

    # ---- 队长 6 行 / 词条 6 键 13 条
    donor_cache: dict = {}
    leader_rows, leader_trace = derive_rows(ctx, design["leader"], "leader_ability", "leader", donor_cache)
    ability_rows: dict[str, list[list[str]]] = {}
    ability_trace: dict[str, list[dict]] = {}
    for slot, entries in design["abilities"].items():
        key = design["ability_keys"][slot]
        rows, trace = derive_rows(ctx, entries, "ability", slot, donor_cache)
        for row in rows:
            if row[1] != design["ability_unisonable_c1"][slot] or row[2] != design["ability_statue_group_c2"][slot]:
                raise KitError(f"{slot}: c1/c2 drift from design")
        ability_rows[key] = rows
        ability_trace[key] = trace
    if sorted(ability_rows) != spec.ability_keys:
        raise KitError(f"ability keys {sorted(ability_rows)} != spec {spec.ability_keys}")
    if sum(len(v) for v in ability_rows.values()) != design["ability_record_total"]:
        raise KitError("ability record total drift")
    row_gate: dict[str, Any] = {"leader": [], "ability": {}}
    caps: list[str] = []
    for row in leader_rows:
        probs = row_problems("leader_ability", row)
        row_gate["leader"].append(probs)
        caps += L.required_client_capabilities("leader_ability", row)
    for key, rows in ability_rows.items():
        row_gate["ability"][key] = [row_problems("ability", row) for row in rows]
        for row in rows:
            caps += L.required_client_capabilities("ability", row)
    flat_probs = [p for probs in row_gate["leader"] for p in probs] + \
                 [p for rows in row_gate["ability"].values() for probs in rows for p in probs]
    if flat_probs:
        raise KitError(f"row legality problems: {flat_probs[:5]}")
    caps = sorted(set(caps))
    if caps != sorted(design["required_capabilities"]) or tuple(caps) != tuple(sorted(spec.required_capabilities)):
        raise KitError(f"capabilities {caps} != design {design['required_capabilities']} / spec "
                       f"{spec.required_capabilities}")

    # ---- 字符串键
    cas_rows = {item["key"]: item["text"] for item in design["custom_strings"]}
    if set(cas_rows) != {CAS_CHANGE_SKILL, CAS_PF_OVERRIDE}:
        raise KitError(f"design custom_strings keys drift: {sorted(cas_rows)}")
    refs = [ref for row in leader_rows for ref in string_key_refs("leader_ability", row)] + \
           [ref for rows in ability_rows.values() for row in rows for ref in string_key_refs("ability", row)]
    if sorted(r[2] for r in refs) != sorted(cas_rows):
        raise KitError(f"string key references {refs} != custom_strings {sorted(cas_rows)}")
    pf_leader = [row for row in leader_rows if row[45] == "722"]
    if len(pf_leader) != 1 or pf_leader[0][80] != PF_KEY or pf_leader[0][81] != "1,2,3":
        raise KitError("leader 722 row drift (c80/c81)")

    # ---- 写表：词条 / 队长 / 字符串（撤销框架克隆的未用键）
    _write_checked_flat(ctx, ABILITY, ability_rows)
    _write_checked_flat(ctx, LEADER, {spec.cid_s: leader_rows})
    _write_checked_flat(ctx, CAS, {k: [[v]] for k, v in cas_rows.items()})
    unclaimed = []
    claimed_cas = next((c for c in ctx.pack.load_claims() if c["logical_path"] == CAS and c["root"] == "common"), None)
    pkg_cas = ctx.pkg_flat(CAS)
    for key in UNUSED_FRAMEWORK_CAS:
        if (claimed_cas and key in claimed_cas["outer_keys"]) or key in pkg_cas:
            ctx.unclaim(CAS, [key])
            unclaimed.append(key)
    if any(key in ctx.pkg_flat(CAS) for key in UNUSED_FRAMEWORK_CAS):
        raise KitError("unused framework custom_ability_string key survived unclaim")
    claimed_cas = next((c for c in ctx.pack.load_claims() if c["logical_path"] == CAS and c["root"] == "common"), None)
    if claimed_cas is None or any(key in claimed_cas["outer_keys"] for key in UNUSED_FRAMEWORK_CAS):
        raise KitError("custom_ability_string claim missing or still holds the unused framework key")

    # ---- 特效三族
    fx_overrides, fx_info = load_fx_manifest(root)
    recolor_log: dict[str, Any] = {}
    families: list[dict] = []
    for clone in design["effects"]["clone"]:
        src_dir = clone["src_dir"].rstrip("/")
        dst = clone["dst"].rstrip("/")
        prefix = f"battle/effect/skill_unique/{CODE}/"
        if not dst.startswith(prefix) or "/" in dst[len(prefix):]:
            raise KitError(f"design effect dst {dst} is not codename layout")
        donor = src_dir.rsplit("/", 1)[-1]
        sheet = f"{src_dir}/{donor}.png"
        fam = ctx.clone_effect_family(src_dir, dst[len(prefix):], clone["fx_names"], layout="codename",
                                      png_transform=make_png_transform(sheet, fx_overrides.get(sheet),
                                                                       recolor_log))
        if fam["dst_dir"] != dst or fam["missing_effects"]:
            raise KitError(f"effect clone drift {src_dir}: dst={fam['dst_dir']} missing={fam['missing_effects']}")
        if sorted(fam["copied_bases"]) != sorted(clone["fx_names"]):
            raise KitError(f"effect clone {src_dir}: copied {fam['copied_bases']} != {clone['fx_names']}")
        pkg_sheet = ctx.pack.pkg_path("common", f"{fam['dst_dir']}/{fam['dst_name']}.png")
        pkg_rgba = hashlib.sha256(C.png_open(pkg_sheet.read_bytes()).tobytes()).hexdigest()
        want_rgba = (fx_overrides.get(sheet) or {}).get("out_rgba_sha256")
        if want_rgba and pkg_rgba != want_rgba:
            raise KitError(f"effect clone {src_dir}: package sheet RGBA != fx manifest out_rgba_sha256")
        recolor_log.setdefault(sheet, {})["package_sheet"] = {
            "logical": f"{fam['dst_dir']}/{fam['dst_name']}.png", "rgba_sha256": pkg_rgba,
            "file_sha256": C.sha256(pkg_sheet.read_bytes())}
        families.append(fam)
    unused_fx = sorted(k for k in fx_overrides
                       if not (recolor_log.get(k) or {}).get("recolor"))
    if unused_fx:
        raise KitError(f"fx manifest entries not applied to any cloned family: {unused_fx}")
    fx_info["unused_entries"] = unused_fx
    family_targets = {e["target"] for fam in families for e in fam["effects"]}

    # ---- 技能两档 DSL
    hashes = design_source_hashes(design)
    energy = design["skills"]["energy"]
    template_inner = C.core.load_nested_table_bytes(ctx.pack.template_table_bytes(ACTION), ACTION) \
        .rows["wind_oracle_1anv"].text_rows()
    skill_gates: dict[str, Any] = {}
    programs: list[str] = []
    action_rows: dict[str, list[list[str]]] = {}
    for level in ("1", "2"):
        tree, counts = build_skill_tree(ctx, level, SKILL_PARAMS[level], families, hashes)
        gates = dsl_gates(tree)
        bad = dsl_gate_failures(gates)
        if gates["movementPriority"] != 2 or gates["buffTargetAs"] != 0 or gates["n_attacks"] != 17:
            bad.append(f"head/attacks drift {gates['movementPriority']}/{gates['buffTargetAs']}/{gates['n_attacks']}")
        stray = [p for p in gates["fx_paths"] if p.startswith(f"battle/effect/skill_unique/{CODE}/")
                 and p not in family_targets]
        if stray:
            bad.append(f"fx refs outside cloned families: {stray}")
        if bad:
            raise KitError(f"skill {level} DSL gates failed: {bad}")
        gates["effect_rewrites"] = counts
        skill_gates[level] = gates
        programs.append(ctx.write_dsl(ctx.program_path(level), tree))
        src = C.csv_split(template_inner[level])[0]
        cells = [text_row[4] if level == "1" else text_row[6], text_row[5] if level == "1" else text_row[7],
                 "dynamic/skill/atk_nearest", "true", str(energy[level]["c4"]), str(energy[level]["c5"]),
                 str(energy[level]["c6"]), ctx.program_path(level), *src[8:24]]
        if len(cells) != 24:
            raise KitError(f"action_skill row length {len(cells)}")
        action_rows[level] = [cells]

    # ---- PF 覆盖三档
    donor_1anv_2 = _source_tree(ctx, f"{SKILL_SRC}wind_oracle_1anv$wind_oracle_1anv_2",
                                hashes[f"{SKILL_SRC}wind_oracle_1anv$wind_oracle_1anv_2"])
    pf_value = design["pf_override"]["power_flip_action"]["value"]
    if pf_value.split(",") != list(PF_PROGRAMS) or design["pf_override"]["power_flip_action"]["key"] != PF_KEY:
        raise KitError("design power_flip_action drift")
    pf_gates: dict[str, Any] = {}
    for level in (1, 2, 3):
        tree, counts = build_pf_tree(ctx, level, donor_1anv_2, families)
        gates = dsl_gates(tree)
        bad = dsl_gate_failures(gates)
        want_attacks = design["pf_override"][f"lv{level}"]["prototype_gate"]["n_attacks"]
        if gates["movementPriority"] != 1 or gates["buffTargetAs"] != 0 or gates["n_attacks"] != want_attacks:
            bad.append(f"PF head/attacks drift {gates['movementPriority']}/{gates['buffTargetAs']}/"
                       f"{gates['n_attacks']} (want {want_attacks})")
        stray = [p for p in gates["fx_paths"] if p.startswith(f"battle/effect/skill_unique/{CODE}/")
                 and p not in family_targets]
        if stray:
            bad.append(f"fx refs outside cloned families: {stray}")
        if bad:
            raise KitError(f"PF lv{level} DSL gates failed: {bad}")
        gates["effect_rewrites"] = counts
        pf_gates[str(level)] = gates
        programs.append(ctx.write_dsl(PF_PROGRAMS[level - 1], tree))
    _write_checked_flat(ctx, PFA, {PF_KEY: [list(PF_PROGRAMS)]})

    # ---- action_skill 两档 → switched_action_skill（语音路由）→ character / character_text
    ctx.write_nested(ACTION, CODE, action_rows, replace_inner=True)
    acts = ctx.pkg_nested(CODE)
    if set(acts) != {"1", "2"} or any(len(c) != 24 for c in acts.values()) \
            or any(acts[lv] != action_rows[lv][0] for lv in acts):
        raise KitError("action_skill readback mismatch")
    route = list(design["voice"]["route"]["character_c9_c16"])
    if route != ["3", "", "", "", "", VOICE_KEY, "false", "false"] or \
            design["skills"]["switched_action_skill"]["key"] != VOICE_KEY:
        raise KitError(f"design voice route drift: {route}")
    ctx.write_nested(SW, VOICE_KEY, {lv: [cells[7:24]] for lv, cells in acts.items()}, replace_inner=True)
    got = ctx.pkg_nested(VOICE_KEY, SW)
    if set(got) != {"1", "2"} or any(len(got[lv]) != 17 or got[lv] != acts[lv][7:24] for lv in ("1", "2")):
        raise KitError("switched_action_skill readback mismatch (17 columns = action_skill c7..c23)")
    char_row = ctx.pack.pkg_character_row()
    edits = design["identity"]["character_row_edits_from_template"]
    char_row[9:17] = route
    char_row[18] = text_row[10]
    for col in ("c0", "c2", "c3", "c4", "c6", "c7", "c8", "c17", "c25", "c26", "c27", "c36"):
        if char_row[int(col[1:])] != edits[col]:
            raise KitError(f"character {col}={char_row[int(col[1:])]!r} != design {edits[col]!r}")
    if char_row[19:25] != edits["c19..c24"] or char_row[18] != edits["c18"]:
        raise KitError("character ability keys / leader name drift")
    _write_checked_flat(ctx, CHAR, {spec.cid_s: [char_row]})
    _write_checked_flat(ctx, TEXT, {spec.cid_s: [text_row]})
    mirrors = ctx.sync_character_mirrors()

    # ---- 像素小人（复核通过才装，owner=pixel）；语音只读状态（由 wf_seasonal7_voice pack + impl/philia/voice_merge.py 装）
    pixel = install_pixel(ctx)
    voice = voice_state(ctx)
    ctx.evidence_write("pixel-report.json", {       # manifest 读 summary/status 进 snapshot
        "summary": (f"像素小人染色 sheet 已装包（{PIXEL_DIR_REL}/out，存储态，owner=pixel）"
                    if pixel["status"] == "installed" else "像素小人 pending（母本原色占位）"),
        "status": pixel["status"], **pixel})

    # ---- 证据与报告
    digest = kit_digest(ctx)
    status, reason = gate_status(root, digest["sha256"])
    import wf_describe
    panel = [f"队长{i}：{d}" for i, d in enumerate(wf_describe.describe_rows(leader_rows, "leader_ability"))]
    for key, rows in ability_rows.items():
        panel += [f"词条{key[-1]}#{i}：{d}" for i, d in enumerate(wf_describe.describe_rows(rows, "ability"))]
    evidence.update({
        "rows": {"leader": leader_trace, "ability": ability_trace, "legality": row_gate,
                 "required_capabilities": caps},
        "custom_ability_string": {"written": sorted(cas_rows), "unclaimed_this_run": unclaimed,
                                  "unused_framework_keys_absent": list(UNUSED_FRAMEWORK_CAS),
                                  "references": [list(r) for r in refs]},
        "effects": {"families": [{k: fam[k] for k in ("src_dir", "dst_dir", "copied_bases", "prefix_map")}
                                 for fam in families],
                    "fx_manifest": fx_info, "recolor": recolor_log},
        "skills": skill_gates, "power_flip": pf_gates,
        "power_flip_action": {PF_KEY: list(PF_PROGRAMS)},
        "action_skill": {lv: cells for lv, cells in acts.items()},
        "switched_action_skill": {VOICE_KEY: got},
        "character_c9_c16": route, "mirrors": mirrors.get("server_character"),
        "pixel": pixel, "voice": voice,
        "kit_digest": digest, "status": status, "status_reason": reason,
    })
    ctx.evidence_write("kit-build.json", evidence)
    notes = [
        "特效 sheet 仍为官方原色，等 Effects 阶段产出 fx/philia/out/manifest.json 后重跑 kit" if not fx_overrides
        else f"特效 sheet 染色来自 {FX_MANIFEST_REL}（{len(fx_overrides)} 张）",
        (f"像素小人已装包（{PIXEL_DIR_REL}/out 存储态，owner=pixel，复核 verify_all 通过）"
         if pixel["status"] == "installed" else f"像素小人 pending：{pixel['problems'][:3]}"),
        ("语音已装包（22 槽 AI 合成，speech 8 行引用新槽，旧母本语音已清）" if voice["packed"]
         else f"语音未装齐：missing={voice['missing_slots'][:3]} extra={voice['extra_voice_files'][:3]}；"
              "character c9–c16 已按 kind 3 路由写好，pack_voice 可直接接受"),
        f"已撤销框架自动克隆但未引用的字符串键 {list(UNUSED_FRAMEWORK_CAS)}",
        "静态门禁通过不等于真机验收；金丝雀清单见 design/philia.md §10",
        f"status={status}：{reason}",
    ]
    ctx.report({
        "summary": "菲莉亚·夏祭浴衣 kit：六词条13条/队长6行/技能两档/PF覆盖三档/语音路由/特效三族（design final）",
        "status": status,
        "skills": {"programs": sorted(programs)},
        "required_capabilities": caps,
        "panel": panel,
        "notes": notes,
        "kit_digest": digest["sha256"],
        "gates": GATES_REL,
    })
    return {"status": status, "reason": reason, "programs": len(programs), "kit_digest": digest["sha256"],
            "unclaimed_this_run": unclaimed, "fx_recolor": bool(fx_overrides)}
