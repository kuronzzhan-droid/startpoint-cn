# -*- coding: utf-8 -*-
"""季节换装 · 特克托·燕尾礼服（139993 ``super_robot_tailcoat``）套件 kit。

按 ``work/character_packs/seasonal7-20260916/design/tekuto.json``（status=final）落地：

- character 行 c9–c16 语音路由（ChangeSkillFlag → ``<code>_voice_ready``）+ 三层镜像；
- character_text / 技能名与描述（``TEXTS``，tables 重跑同样生效）；
- 队长 6 行、词条 6 键 10 条（设计行逐字写入；同时按 donor+列编辑复算核对）；
- custom_ability_string ``change_skill_super_robot_tailcoat``（ability 1399933#1 c70）与
  custom_ability_power_up_string 同键（潜能 2–6「伤害强化」，克隆官方 change_skill_super_robot）；
  撤掉框架自动克隆、本套件不引用的 ``change_skill_2_super_robot_tailcoat``；
- action_skill 两档（名称/描述/图标/能量/程序/AUTO）与 switched_action_skill ``<code>_voice_ready``
  （= action_skill c7–c23，与 ``wf_seasonal7_voice.switched_rows`` 同列约定）；
- 两棵技能 DSL：按设计 f07 定稿蓝图用官方母本路径拼装 → ``rewrite_effect_refs`` 改写到克隆族 →
  与设计 ``composed_tree`` 类型严格比对 → 母本派生节点核对 → 客户端合法性检查 → 裸树 encode；
- 5 个特效族克隆（codename 布局：cannon / laser_s / laser_l / laser_ll / laser_lll）；
  若 ``fx/tekuto/out/manifest.json`` 存在，按其 {源逻辑路径 → 染色 PNG} 在 png_transform 中换 sheet；
- 详情页技能预览 ``config.end_frame`` 350 → 600（owner=kit）；
- 像素小人（Integrate）：``pixel/REVIEW.md`` 修复轮复核判 tekuto PASS、``pixel/tekuto/{verify,report}.json``
  门禁全过且产物 sha 与 report 一致时，把 ``pixel/tekuto/out/{sprite_sheet,special_sprite_sheet}.png``
  原字节转存储态（仅换小写魔数）写入 ``character/<code>/pixelart/``（owner=pixel）；校验尺寸/alpha/透明像素
  RGBA 与母本一致，atlas/frame/timeline 仍等于母本改前缀后的树（不写元数据）。未通过时保持母本原色（pending）。

语音装包不在 kit 内：由 ``impl/tekuto/voice_merge.py`` 调 ``wf_seasonal7_voice.py pack`` 完成；kit 只在报告里读状态。
不写 live store / assets / .cdn / src；不发布。``evidence/kit-report.json`` 只有在
``impl/tekuto/gates.json`` 全过且指纹与当前包内 kit 产物一致时才写 ``ready-for-review``。
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import math
import zlib
from pathlib import Path
from typing import Any

import wf_seasonal7_specs as S

KEY = "tekuto"
CID = "139993"
CODE = "super_robot_tailcoat"
TEMPLATE_CODE = "super_robot"
ELEMENT = 2

CHAR = "master/character/character.orderedmap"
TEXT = "master/character/character_text.orderedmap"
ABILITY = "master/ability/ability.orderedmap"
LEADER = "master/ability/leader_ability.orderedmap"
ACTION = "master/skill/action_skill.orderedmap"
SWITCHED = "master/skill/switched_action_skill.orderedmap"
CAS = "master/string/custom_ability_string.orderedmap"
CAPS = "master/string/custom_ability_power_up_string.orderedmap"
PREVIEW = f"character/{CODE}/battle/character_detail_skill_preview.battle.amf3.deflate"
TEMPLATE_PREVIEW = f"character/{TEMPLATE_CODE}/battle/character_detail_skill_preview.battle.amf3.deflate"

CHANGE_SKILL_KEY = f"change_skill_{CODE}"
UNUSED_CAS_KEYS = (f"change_skill_2_{CODE}",)            # tables 自动克隆，本套件不引用
POWER_UP_SOURCE_KEY = f"change_skill_{TEMPLATE_CODE}"     # 官方潜能 2–6「伤害强化」
VOICE_READY_KEY = f"{CODE}_voice_ready"
PREVIEW_END_FRAME = 600

DESIGN_REL = f"{S.BATCH_DIR}/design/{KEY}.json"
FX_MANIFEST_REL = f"{S.BATCH_DIR}/fx/{KEY}/out/manifest.json"
GATES_REL = f"{S.BATCH_DIR}/impl/{KEY}/gates.json"
PIXEL_REL = f"{S.BATCH_DIR}/pixel/{KEY}"
PIXEL_REVIEW_REL = f"{S.BATCH_DIR}/pixel/REVIEW.md"
PIXEL_REVIEW_HEADING = "修复轮复核"
# sheet → (atlas, 该 sheet 的 frame/timeline)；只写 sheet，元数据保持 assets 复制的母本（前缀已改写）
PIXEL_SHEETS = {
    "sprite_sheet": ("sprite_sheet.atlas.amf3.deflate", ("pixelart.frame.amf3.deflate", "pixelart.timeline.amf3.deflate")),
    "special_sprite_sheet": ("special_sprite_sheet.atlas.amf3.deflate",
                             ("special.frame.amf3.deflate", "special.timeline.amf3.deflate")),
}
VOICE_RUN = "take1"
KIT_SOURCE = Path(__file__).resolve()

# ---- 文案（tables 读 TEXTS 重写 character_text 与 action_skill c0/c1；与设计 JSON 逐字一致，build 时断言）
_DESC = ("锁定距离最近的敌人，在施放位置架设重炮（炮台固定在原地，发射期间可照常弹射）：赋予自身技能伤害提升效果；"
         "对炮口前方射线上的敌人赋予雷属性抗性降低效果，雷达扫描到炮台附近的敌人时发射导弹追击；"
         "随后朝锁定方向持续发射充能激光炮，光束分4段逐渐变粗，对命中的敌人造成雷属性伤害")
TEXTS = {
    "profile": ("被朋友们拉去参加舞会的机人青年，换上了黑黄配色的燕尾礼服，胸前别着系黄丝带的白玫瑰。"
                "为了保护大家，他把重炮和导航无人机也带进了会场——虽然大家都说那样一点都不优雅。"),
    "skill1": "多重爆破·礼装重炮",
    "desc1": _DESC,
    "skill2": "多重爆破·礼装重炮＋",
    "desc2": _DESC,
    "cv": "AI 合成配音",
}
SPEC = {
    "extra_keys": {
        CAS: (CHANGE_SKILL_KEY,),
        CAPS: (CHANGE_SKILL_KEY,),
        SWITCHED: (VOICE_READY_KEY,),
    },
}

# ---- 特效族（design.effects.clone；codename 布局）
CANNON_SRC = "battle/effect/skill_unique/super_robot"
CANNON_FX = ["super_robot_radar", "super_robot_radar_hit", "super_robot_missile", "super_robot_missile_hit",
             "super_robot_laser_100px", "super_robot_laser_100px_end", "super_robot_laser_200px",
             "super_robot_laser_200px_end"]
LASER_FAMS = ("s", "l", "ll", "lll")


def laser_src(fam: str) -> str:
    return f"battle/effect/enemy_general/enemy_shot_laser_{fam}/enemy_shot_laser_{fam}_yellow"


FAMILIES = [(CANNON_SRC, "cannon", CANNON_FX)] + [
    (laser_src(f), f"laser_{f}", [f"enemy_shot_laser_{f}_yellow"]) for f in LASER_FAMS]


class KitError(RuntimeError):
    pass


# ================================================================ 技能树（设计 f07 定稿蓝图，母本路径）

PI = math.pi
SR_SRC = f"{CANNON_SRC}/super_robot_"                       # 官方 cannon 族（rewrite 后 → <code>/cannon/）
NOTICE = "battle/effect/enemy_unique/enemy_laser_notice/laser_notice"   # 直引，不克隆
CHARGE = "battle/effect/skill_general/decoration/charge"                # ResolveByElement 直引

# ---- 收炮余晖宽度（审查 minor 修复，2026-09-16）
# 官方 super_robot_2：laser_100px(_end) 与 laser_200px(_end) 是同一组贴图，parts 根 s=1；
# 主光柱层 g10 = 106px 宽贴图 'e' 纵向镜像平铺（s=1 时宽约 107px），DSL 配对为
# Some(1)↔Rect100、Some(2)↔Rect200，即 Some(k) ≈ 100k px（200px 变体只把火花层 g12 预缩 0.5）。
# 设计把 200px_end 的 Some(1) 当成 200px，写成 Some(3.8)，实际约 406px，只有 LLL 光束 Rect760 的一半；
# 设计本意是「≈760 宽收炮余晖」，按官方 k = Rect/100 取 7.6（约 812px，与官方 107/100 同比例外扩）。
LLL_RECT_WIDTH = 760
COOLDOWN_SCALE = 7.6
# 设计 JSON 不在 kit 写入范围；这里对设计 composed_tree 做单节点、带原值断言的修正（设计同步为 7.6 后自动变 no-op）
DESIGN_TREE_FIXES = (
    {"id": "review-minor-cannon-cooldown-width", "command": "ShowEffect", "label": "cannon_cooldown", "arg": 12,
     "design": ["Some", [{"min": 3.8, "max": 3.8}]], "fixed": ["Some", [{"min": COOLDOWN_SCALE, "max": COOLDOWN_SCALE}]],
     "reason": "laser_200px_end Some(k)≈100k px（官方 Some(1)↔Rect100 / Some(2)↔Rect200）；3.8≈406px 只有 LLL Rect760 一半，"
               "改 7.6 与设计本意「≈760 宽」一致"},
)
RP, E = 1, 0

# 每跳 (SLv min, SLv max, alv min, alv max)；alv = 开关1（能力3 ChangeSkillFlag）潜能插值
NUM = {
    "2": dict(self_sd=(600, 0.85, 1.0), missile=(1.5, 1.75, 0.2, 0.35), S=(1.6, 1.8, 0.2, 0.4),
              L=(1.8, 2.05, 0.25, 0.45), LL=(1.95, 2.25, 0.25, 0.45), LLL=(2.0, 2.3, 0.3, 0.5),
              burst=(7.3, 8.4), resist=(600, -0.10, -0.15)),
    "1": dict(self_sd=(480, 0.65, 0.65), missile=(1.25, 1.25, 0.2, 0.35), S=(1.3, 1.3, 0.2, 0.4),
              L=(1.5, 1.5, 0.25, 0.45), LL=(1.6, 1.6, 0.25, 0.45), LLL=(1.65, 1.65, 0.3, 0.5),
              burst=(6.0, 6.0), resist=(600, -0.10, -0.10)),
}


def _slv(a, b=None, alv=None):
    d = {"min": a, "max": a if b is None else b}
    if alv:
        d["alv_min"], d["alv_max"] = alv
    return [d]


def _C(name, *p):
    return ["Command", [name, *p]]


def _B(*items):
    return ["Block", list(items)]


def _W(n, name, *items):
    return ["Event", ["Wait", n, name, _B(*items)]]


def _FX(label, eff, subj, lifetime, coord, ang, scale=None, tp=True, td=False, layer="ForesideOfCharacter"):
    return _C("ShowEffect", label, eff, subj, [layer], lifetime, [coord], 0, 0, ang, tp, td,
              ["None"] if scale is None else ["Some", _slv(scale)])


def _D(path):
    return ["SpecifyEffectDirectly", path]


def _CNA(tgt, flat, mul, brk, fev, hit):
    return _C("CreateNormalAttack", tgt, 255, [], [], flat, mul, _slv(0), False, False, False, False, False,
              _slv(brk), _slv(fev), [hit], True)


def _HA(subj, coord, ang, shape, va, life, interval, cap, ids, on_create, on_hit, tp=True, td=False):
    cid, hid, tid = ids
    return _C("CreateHitArea", "*", subj, [coord], 0, 0, ang, tp, td, shape, ["Center"], [va], ["Single"],
              ["SpecifyHitAreaLifetimeDirectly", life], interval,
              ["Some", _slv(cap)] if cap else ["None"], False, True, ["None"],
              cid, _B(*on_create), hid, tid, _B(*on_hit), 0, 0, ["None"])


def _RECT(w, h=2400):
    return ["Rectangle", _slv(w), _slv(h)]


def donor_tree(level: str) -> list:
    """设计 f07 ``tree(lv)`` 的逐节点移植；特效引用写官方母本路径（之后由 rewrite_effect_refs 改写）。"""
    n = NUM[level]

    def m(k):
        return _slv(n[k][0], n[k][1], (n[k][2], n[k][3]))

    radar_hit_block = [
        _C("RemoveEvent", "missile_cancel"),
        _FX("radar_hit", _D(SR_SRC + "radar_hit"), 22, ["PlayOnlyFirstSequence"], "AB", 0, tp=True, td=False),
        _W(80, "*", _C("CreateReferencePoint", 22, ["AB"], 0, 0, 0, False, False, ["Single"], 65, 23, _B(
            _FX("missile_drop", _D(SR_SRC + "missile_hit"), 23, ["PlayOnlyFirstSequence"], "AB", 0, tp=False, td=False),
            _W(9, "*", _HA(23, "AB", 0, ["Circle", _slv(50)], "Center", 15, ["CalculatedUsingMaxNumOfHits", 4], None,
                           (24, 25, 26), [], [_C("ShakeCamera", 1), _CNA(26, 16, m("missile"), 2, 1, "Fine")])),
        ))),
    ]
    radar = _HA(RP, "CD", -1.0471975511965976, ["Sector", _slv(400), _slv(0.5235987755982988)], "Center", 22,
                ["CalculatedUsingMaxNumOfHits", 1], 1, (20, 21, 22),
                [_C("RotateHitArea", 20, 0.09599310885968812, ["None"])], radar_hit_block)
    # 射线标记：炮口前方 800×2400、寿命 325、每敌 1 次 → 雷属性抗性降低（审查 major#6）
    lane_mark = _HA(RP, "CD", 0, _RECT(800), "Bottom", 325, ["CalculatedUsingMaxNumOfHits", 1], 1, (27, 28, 29), [],
                    [_C("CreateCondition", 29, [["ACToleranceOfElement", _slv(n["resist"][0]), 3,
                                                  _slv(n["resist"][1], n["resist"][2]), _slv(1)]],
                        _slv(1), ["GenericConditionHitEffect"], True, False, "", None, False, 3, _slv(1), False)])

    def stage(t, w, ids, fx, key, charge_scale, shake):
        on_create = ([fx] if fx else []) + [_C("ShakeCamera", shake)]
        body = [_HA(RP, "CD", 0, _RECT(w), "Bottom", 60, ["SpecifyMinHitIntervalDirectly", 10], 6, ids, on_create,
                    [_CNA(ids[2], 10, m(key), 1, 0.6, "ThunderSmall")])]
        if charge_scale:
            body.insert(0, _FX("charge_core", ["ResolveByElement", CHARGE, 255], RP,
                               ["SpecifyEffectLifetimeDirectly", 60], "AB", 0, scale=charge_scale, tp=True, td=False))
        return _W(t, "*", *body)

    def laser(fam, cid, scale=None):
        return _FX("beam_" + fam, _D(f"{laser_src(fam)}/enemy_shot_laser_{fam}_yellow"), cid,
                   ["UntilTargetTerminates"], "CD", PI, scale=scale, tp=True, td=True)

    rp_body = [
        _FX("aim_line", _D(NOTICE), RP, ["SpecifyEffectLifetimeDirectly", 90], "CD", PI, tp=True, td=True),
        _FX("radar", _D(SR_SRC + "radar"), RP, ["PlayOnlyFirstSequence"], "CD", 0, scale=8, tp=True, td=False),
        _W(5, "*", lane_mark, radar),
        _W(23, "missile_cancel", _C("RemoveEvent", "missile_event")),
        _W(24, "missile_event", _FX("missile_launch", _D(SR_SRC + "missile"), RP, ["PlayOnlyFirstSequence"], "CD", 0,
                                    tp=True, td=False)),
        _W(20, "*", _FX("charge_S", _D(SR_SRC + "laser_100px"), RP, ["SpecifyEffectLifetimeDirectly", 70], "CD", 0,
                        scale=1, tp=True, td=False)),
        stage(90, 100, (30, 31, 32), laser("s", 30), "S", None, 2),
        stage(150, 320, (33, 34, 35), laser("l", 33), "L", 3, 2),
        stage(210, 490, (36, 37, 38), laser("ll", 36), "LL", 4, 2),
        stage(270, LLL_RECT_WIDTH, (39, 40, 41), laser("lll", 39), "LLL", 5, 3),
        _C("ConditionalsChangeSkillFlag", 1, _B(
            _W(300, "*", _HA(RP, "CD", 0, _RECT(900), "Bottom", 10, ["CalculatedUsingMaxNumOfHits", 1], 1, (42, 43, 44),
                             [laser("lll", 42, scale=7), _C("ShakeCamera", 3)],
                             [_CNA(44, 33, _slv(n["burst"][0], n["burst"][1]), 4, 2, "ThunderLight")]))
        ), _B()),
        _W(330, "*", _FX("cannon_cooldown", _D(SR_SRC + "laser_200px_end"), RP, ["PlayOnlyFirstSequence"], "CD", 0,
                         scale=COOLDOWN_SCALE, tp=False, td=False)),
    ]
    sd = n["self_sd"]
    body = _B(
        _C("StopBall", -18, 10, ["RestoreToSpeedBeforeActionExecution"], ["EF"], 0),
        _C("CreateCondition", -17, [["ACSkillDamage", _slv(sd[0]), _slv(sd[1], sd[2]), _slv(1)]], _slv(1),
           ["GenericConditionHitEffect"], True, False, "", None, False, 3, _slv(1), False),
        _C("FindNearSubjects", -18, 1, 49, ["CreateImaginaryTarget", -100000], E, _B(
            _C("CreateReferencePoint", -18, ["GH", E], 0, 0, 0, False, False, ["Single"], 390, RP, _B(*rp_body))
        )),
    )
    return ["ActionDsl", 1, ["None"], False, False, False, False, False, False, False, 0, body]


# ================================================================ 纯函数校验

def strict_diff(a, b, path="$", out=None, limit=20):
    """类型敏感的树比较（int≠float≠bool；AMF3 编码按类型区分）。返回差异路径列表。"""
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if type(a) is not type(b):
        out.append(f"{path}: type {type(a).__name__} != {type(b).__name__} ({a!r} vs {b!r})")
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append(f"{path}: len {len(a)} != {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            strict_diff(x, y, f"{path}[{i}]", out, limit)
    elif isinstance(a, dict):
        if list(a) != list(b):
            out.append(f"{path}: keys {list(a)} != {list(b)}")
        for k in a:
            if k in b:
                strict_diff(a[k], b[k], f"{path}.{k}", out, limit)
    elif a != b:
        out.append(f"{path}: {a!r} != {b!r}")
    return out


def _iter_lists(node):
    if isinstance(node, list):
        yield node
        for x in node:
            yield from _iter_lists(x)
    elif isinstance(node, dict):
        for x in node.values():
            yield from _iter_lists(x)


def _command_nodes(tree, name: str, label: str | None = None) -> list[list]:
    return [n for n in _iter_lists(tree) if n and n[0] == name and (label is None or (len(n) > 1 and n[1] == label))]


def apply_design_tree_fixes(composed: list, fixes=DESIGN_TREE_FIXES) -> tuple[list, list[dict]]:
    """对设计 composed_tree 的副本做审查修正。每条修正必须恰好命中一个节点，且原值严格等于记录的设计值
    （改为 applied）或已等于修正值（设计已同步，记 already-in-design）；其他值一律报错，不静默放过。"""
    tree = copy.deepcopy(composed)
    applied = []
    for fix in fixes:
        nodes = _command_nodes(tree, fix["command"], fix["label"])
        if len(nodes) != 1 or len(nodes[0]) <= fix["arg"]:
            raise KitError(f"design tree fix {fix['id']}: expected exactly 1 {fix['command']} {fix['label']!r}, "
                           f"found {len(nodes)}")
        node = nodes[0]
        current = node[fix["arg"]]
        if not strict_diff(current, fix["design"]):
            node[fix["arg"]] = copy.deepcopy(fix["fixed"])
            state = "applied"
        elif not strict_diff(current, fix["fixed"]):
            state = "already-in-design"
        else:
            raise KitError(f"design tree fix {fix['id']}: design value {current!r} is neither "
                           f"{fix['design']!r} nor {fix['fixed']!r}; re-check the design")
        applied.append({"id": fix["id"], "label": fix["label"], "arg": fix["arg"], "state": state,
                        "design": fix["design"], "fixed": fix["fixed"], "reason": fix["reason"]})
    return tree, applied


def design_composed_tree(design: dict, level: str) -> tuple[list, list[dict]]:
    return apply_design_tree_fixes(design["skills"][f"tree_plan_{level}"]["composed_tree"])


def cooldown_width_problems(tree) -> list[str]:
    """收炮余晖宽度与 LLL 光束配对：laser_200px_end 的 Some(k) 应满足 k×100 == LLL Rect 宽（官方配对口径）。"""
    probs = []
    fx = _command_nodes(tree, "ShowEffect", "cannon_cooldown")
    if len(fx) != 1:
        return [f"cannon_cooldown ShowEffect count {len(fx)} != 1"]
    eff = fx[0][2]
    if not (isinstance(eff, list) and len(eff) > 1 and str(eff[1]).endswith("/super_robot_laser_200px_end")):
        probs.append(f"cannon_cooldown effect is not super_robot_laser_200px_end: {eff!r}")
    scale = fx[0][12]
    if not (isinstance(scale, list) and scale[0] == "Some" and len(scale[1]) == 1
            and scale[1][0].get("min") == scale[1][0].get("max")):
        return probs + [f"cannon_cooldown scale shape unexpected: {scale!r}"]
    k = scale[1][0]["min"]
    widths = []
    for ev in _command_nodes(tree, "Wait"):
        if len(ev) > 3 and ev[1] == 270:
            for ha in _command_nodes(ev[3], "CreateHitArea"):
                if isinstance(ha[9], list) and ha[9][0] == "Rectangle":
                    widths.append(ha[9][1][0]["min"])
    if widths != [LLL_RECT_WIDTH]:
        probs.append(f"LLL stage (Wait 270) Rectangle widths {widths} != [{LLL_RECT_WIDTH}]")
    elif abs(k * 100 - widths[0]) > 1e-9:
        probs.append(f"cannon_cooldown Some({k}) ≈ {k * 100:g}px does not match LLL Rect {widths[0]} (expect Some({widths[0] / 100:g}))")
    return probs


def _tag(v):
    return v[0] if isinstance(v, list) and v and isinstance(v[0], str) else None


def donothing_problems(tree) -> list[str]:
    """F1009 陷阱：Conditionals* 的分支必须是 Block/Command/Event，不能是 ["DoNothing"] 等枚举。"""
    probs = []

    def rec(node):
        if isinstance(node, list):
            if _tag(node) == "Command" and isinstance(node[1], list) and str(node[1][0]).startswith("Conditionals"):
                for i, p in enumerate(node[1][1:], 1):
                    if isinstance(p, list) and _tag(p) not in (None, "Block", "Command", "Event") \
                            and _tag(p) in ("DoNothing",):
                        probs.append(f"{node[1][0]} p{i} 是枚举 {_tag(p)}（F1009，空分支须写 [\"Block\", []]）")
            if node == ["DoNothing"]:
                probs.append("树中出现 [\"DoNothing\"] 节点（F1009）")
            for child in node:
                rec(child)
        elif isinstance(node, dict):
            for child in node.values():
                rec(child)
    rec(tree)
    return probs


def template_derivation_problems(ours: list, template: list, level: str) -> tuple[list[str], dict]:
    """母本（官方 super_robot_<lv>）派生节点核对：根头、自身技伤、雷达扇形/旋转、导弹参数。"""
    import wf_seasonal7_common as C
    probs, facts = [], {}
    if template[0] != "ActionDsl" or template[2:11] != ours[2:11] or ours[1] != 1 or template[1] != 2:
        probs.append(f"根头与母本不符: ours={ours[:11]} template={template[:11]}")
    facts["header_template"] = template[:11]

    def self_sd(tree):
        return [c for c in C.commands(tree, "CreateCondition")
                if c[1] == -17 and c[2] and c[2][0][0] == "ACSkillDamage"]
    t_sd, o_sd = self_sd(template), self_sd(ours)
    if len(t_sd) != 1 or len(o_sd) != 1 or t_sd[0][1:] != o_sd[0][1:]:
        probs.append(f"ACSkillDamage 与母本原值不符: ours={o_sd} template={t_sd}")
    facts["self_skill_damage"] = t_sd[0][2] if t_sd else None

    def sector(tree):
        return [c for c in C.commands(tree, "CreateHitArea") if _tag(c[9]) == "Sector"]
    t_sec, o_sec = sector(template), sector(ours)
    if len(t_sec) != 1 or len(o_sec) != 1:
        probs.append("雷达扇形判定区数量异常")
    else:
        t, o = t_sec[0], o_sec[0]
        for idx, label in ((6, "angle"), (9, "shape"), (14, "hit_count"), (15, "per_target_cap"), (13, "lifetime")):
            if t[idx] != o[idx]:
                probs.append(f"雷达 {label} 与母本不符: {o[idx]} vs {t[idx]}")
        t_rot = C.commands(t, "RotateHitArea")
        o_rot = C.commands(o, "RotateHitArea")
        if not t_rot or not o_rot or t_rot[0][2:] != o_rot[0][2:]:
            probs.append(f"RotateHitArea 与母本不符: {o_rot} vs {t_rot}")
    circle_t = [c for c in C.commands(template, "CreateHitArea") if _tag(c[9]) == "Circle"]
    circle_o = [c for c in C.commands(ours, "CreateHitArea") if _tag(c[9]) == "Circle"]
    if len(circle_t) != 1 or len(circle_o) != 1 or circle_t[0][9] != circle_o[0][9] or circle_t[0][14] != circle_o[0][14]:
        probs.append("导弹圆判定与母本不符")
    t_mis = [c for c in C.commands(template, "CreateNormalAttack") if c[5] == 16]
    o_mis = [c for c in C.commands(ours, "CreateNormalAttack") if c[5] == 16]
    if len(t_mis) != 1 or len(o_mis) != 1 or [t_mis[0][i] for i in (13, 14, 15)] != [o_mis[0][i] for i in (13, 14, 15)]:
        probs.append("导弹 CNA 削韧/Fever/命中特效与母本不符")
    radar_fx_t = [c for c in C.commands(template, "ShowEffect") if str(c[2][1]).endswith("super_robot_radar")]
    radar_fx_o = [c for c in C.commands(ours, "ShowEffect") if str(c[2][1]).endswith("super_robot_radar")]
    if not radar_fx_t or not radar_fx_o or radar_fx_t[0][12] != radar_fx_o[0][12]:
        probs.append("雷达特效缩放与母本不符")
    facts["level"] = level
    return probs, facts


def dsl_quick_problems(tree) -> list[str]:
    """kit 内快速门禁（完整签名差分在 impl/tekuto/gates.py）。"""
    import wf_client_legality as LG
    import wf_dsl
    probs = []
    probs += LG.action_dsl_element_problems(tree, ELEMENT)
    probs += LG.action_dsl_subject_binding_problems(tree)
    probs += LG.action_dsl_hit_area_target_problems(tree)
    probs += wf_dsl.player_side_dsl_problems(tree)
    probs += donothing_problems(tree)
    return probs


# ================================================================ 特效染色钩子

def load_fx_manifest(root: Path) -> tuple[dict[str, Path], dict]:
    """``fx/tekuto/out/manifest.json`` → {源 sheet 逻辑路径: 染色 PNG 文件}；不存在返回 ({}, info)。

    接受形态：顶层 ``{src: file}``，或 ``{"sheets"|"map"|"recolor"|"files": {...}}``，或列表
    ``[{"source"|"src"|"logical": ..., "png"|"file"|"path"|"target": ...}]``。键可以是 sheet
    逻辑路径（``…/<donor>.png``）或族目录（自动补 ``/<donor>.png``）。相对文件路径按 manifest 所在目录解析。
    """
    path = root / FX_MANIFEST_REL
    info: dict[str, Any] = {"manifest": str(path), "present": path.is_file()}
    if not path.is_file():
        return {}, info
    data = json.loads(path.read_text(encoding="utf-8"))
    info["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    entries: list[tuple[str, str]] = []
    container = data
    if isinstance(data, dict):
        for name in ("sheets", "map", "recolor", "files", "mapping"):
            if isinstance(data.get(name), (dict, list)):
                container = data[name]
                break
    if isinstance(container, dict):
        for k, v in container.items():
            if isinstance(v, dict):
                v = v.get("png") or v.get("file") or v.get("path") or v.get("target")
            if isinstance(k, str) and isinstance(v, str) and (k.startswith("battle/effect/")):
                entries.append((k, v))
    elif isinstance(container, list):
        for item in container:
            if not isinstance(item, dict):
                continue
            src = item.get("source") or item.get("src") or item.get("logical") or item.get("source_logical")
            dst = item.get("png") or item.get("file") or item.get("path") or item.get("target")
            if isinstance(src, str) and isinstance(dst, str):
                entries.append((src, dst))
    known_dirs = {src for src, _sub, _fx in FAMILIES}
    mapping: dict[str, Path] = {}
    unknown = []
    for src, file in entries:
        src = src.rstrip("/")
        if not src.endswith(".png"):
            src = f"{src}/{src.rsplit('/', 1)[-1]}.png"
        family_dir = src.rsplit("/", 1)[0]
        if family_dir not in known_dirs or src != f"{family_dir}/{family_dir.rsplit('/', 1)[-1]}.png":
            unknown.append(src)
            continue
        fp = Path(file)
        if not fp.is_absolute():
            fp = path.parent / fp
        if not fp.is_file():
            raise KitError(f"fx manifest points at missing PNG for {src}: {fp}")
        mapping[src] = fp
    if unknown:
        raise KitError(f"fx manifest entries do not match any cloned tekuto family sheet: {unknown}")
    info["entries"] = {k: str(v) for k, v in sorted(mapping.items())}
    return mapping, info


def make_png_transform(sheet_logical: str, png_file: Path, stats: dict):
    import wf_assets
    from PIL import Image, ImageChops

    def transform(img):
        raw = png_file.read_bytes()
        dyed = Image.open(io.BytesIO(wf_assets.png_decode(raw))).convert("RGBA")
        if dyed.size != img.size:
            raise KitError(f"recolored sheet size {dyed.size} != source {img.size}: {sheet_logical}")
        alpha_diff = ImageChops.difference(dyed.getchannel("A"), img.getchannel("A")).getbbox()
        stats[sheet_logical] = {"file": str(png_file), "sha256": hashlib.sha256(raw).hexdigest(),
                                "size": list(dyed.size), "alpha_changed_bbox": list(alpha_diff) if alpha_diff else None}
        return dyed
    return transform


# ================================================================ 像素小人（Integrate）

def pixel_review_verdict(text: str, key: str = KEY) -> tuple[bool, str]:
    """``pixel/REVIEW.md`` 末尾「修复轮复核」段的结论表里 ``| <key> …`` 行是否判 **PASS**。

    只认该段（初审段已被修复轮取代）；段缺失 / 行缺失 / 非 PASS 一律返回 False 与原因。"""
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.startswith("## ") and PIXEL_REVIEW_HEADING in ln), None)
    if start is None:
        return False, f"REVIEW.md 尚无「{PIXEL_REVIEW_HEADING}」段"
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    rows = [ln for ln in lines[start:end] if ln.lstrip().startswith("|")
            and ln.strip().strip("|").strip().split(" ")[0] == key]
    if not rows:
        return False, f"「{PIXEL_REVIEW_HEADING}」段没有 {key} 结论行"
    row = rows[0]
    cells = [c.strip() for c in row.strip().strip("|").split("|")]
    if not any(c.startswith("**PASS") for c in cells):
        return False, f"{key} 修复轮复核未判 PASS: {row.strip()}"
    return True, row.strip()


def pixel_gate_state(root: Path) -> dict[str, Any]:
    """像素产物是否可装包：复核 PASS + verify.json all_ok + report 门禁全过 + 产物 sha 与 report 一致。"""
    base = root / PIXEL_REL
    state: dict[str, Any] = {"pass": False, "reasons": []}
    review = root / PIXEL_REVIEW_REL
    if review.is_file():
        ok, detail = pixel_review_verdict(review.read_text(encoding="utf-8"))
        state["review"] = detail
        if not ok:
            state["reasons"].append(detail)
    else:
        state["reasons"].append("pixel/REVIEW.md 不存在")
    verify = base / "verify.json"
    report = base / "report.json"
    if not verify.is_file() or not report.is_file():
        state["reasons"].append("pixel verify.json/report.json 缺失")
        return state
    v = json.loads(verify.read_text(encoding="utf-8"))
    r = json.loads(report.read_text(encoding="utf-8"))
    state["verify_all_ok"] = v.get("all_ok") is True
    bad_gates = sorted(k for k, g in (r.get("gates") or {}).items() if not (isinstance(g, dict) and g.get("ok") is True))
    state["report_gates_passed"] = r.get("gates_passed") is True and not bad_gates and bool(r.get("gates"))
    if not state["verify_all_ok"]:
        state["reasons"].append("pixel verify.json all_ok != true")
    if not state["report_gates_passed"]:
        state["reasons"].append(f"pixel report gates not all ok: {bad_gates or r.get('gates_passed')}")
    if r.get("key") != KEY or r.get("code") != TEMPLATE_CODE:
        state["reasons"].append(f"pixel report identity {r.get('key')}/{r.get('code')} != {KEY}/{TEMPLATE_CODE}")
    outputs, sources = {}, {}
    for name in PIXEL_SHEETS:
        file = base / "out" / f"{name}.png"
        rec = (r.get("outputs") or {}).get(name) or {}
        if not file.is_file():
            state["reasons"].append(f"pixel out 缺 {name}.png")
            continue
        sha = hashlib.sha256(file.read_bytes()).hexdigest()
        if sha != rec.get("sha256"):
            state["reasons"].append(f"pixel out {name}.png sha {sha[:12]} != report {str(rec.get('sha256'))[:12]}")
        outputs[name] = {"file": str(file), "sha256": sha}
        src = (r.get("source_files") or {}).get(f"character/{TEMPLATE_CODE}/pixelart/{name}.png") or {}
        sources[name] = src.get("sha256")
    state["outputs"], state["source_sha256"] = outputs, sources
    state["pass"] = not state["reasons"]
    return state


def pixel_sheet_problems(dyed, template) -> list[str]:
    """dyed/template 为 RGBA ndarray：尺寸相同、alpha 逐字节相同、alpha==0 像素 RGBA 逐字节相同。"""
    import numpy as np
    if dyed.shape != template.shape:
        return [f"size {dyed.shape} != template {template.shape}"]
    probs = []
    if not (dyed[..., 3] == template[..., 3]).all():
        probs.append(f"alpha differs at {int((dyed[..., 3] != template[..., 3]).sum())} px")
    clear = template[..., 3] == 0
    if not (dyed[clear] == template[clear]).all():
        probs.append(f"alpha==0 RGBA differs at {int(np.any(dyed[clear] != template[clear], axis=-1).sum())} px")
    return probs


def atlas_bounds_problems(atlas, size: tuple[int, int]) -> list[str]:
    """atlas 条目 x/y/w/h 为 sheet 空间矩形（``r`` 旋转不交换 w/h，母本实测），须落在 sheet 内。"""
    width, height = size
    probs = []
    for item in atlas:
        if not isinstance(item, dict) or "n" not in item:
            probs.append(f"atlas entry malformed: {item!r}"[:120])
            continue
        if item["x"] < 0 or item["y"] < 0 or item["x"] + item["w"] > width or item["y"] + item["h"] > height:
            probs.append(f"atlas rect outside sheet: {item['n']} ({item['x']},{item['y']},{item['w']},{item['h']})")
    return probs


def integrate_pixel(ctx) -> dict[str, Any]:
    """门禁通过时写 2 张染色 sheet（存储态，owner=pixel），重跑幂等；否则 pending 不动包。"""
    import numpy as np
    import wf_assets
    import wf_seasonal7_common as C
    pack = ctx.pack
    state = pixel_gate_state(ctx.root)
    result: dict[str, Any] = {"status": "pending", "gate": state, "sheets": {}}
    if not state["pass"]:
        return result
    subs = C.dir_prefix_map(TEMPLATE_CODE, CODE)
    for name, (atlas_name, meta_names) in PIXEL_SHEETS.items():
        out_raw = Path(state["outputs"][name]["file"]).read_bytes()
        tpl_logical = f"character/{TEMPLATE_CODE}/pixelart/{name}.png"
        _root, tpl_raw, tpl_source = pack.template_asset(tpl_logical)
        tpl_sha = hashlib.sha256(tpl_raw).hexdigest()
        if state["source_sha256"].get(name) not in (None, tpl_sha):
            raise KitError(f"pixel {name}: dyed against template sha {state['source_sha256'][name][:12]}, "
                           f"current template {tpl_sha[:12]}")
        dyed = np.asarray(ctx.png_open(out_raw))
        template = np.asarray(ctx.png_open(tpl_raw))
        probs = pixel_sheet_problems(dyed, template)
        if probs:
            raise KitError(f"pixel {name}: {probs}")
        store = wf_assets.png_encode(out_raw)
        if wf_assets.png_decode(store) != out_raw or store[1:4] != b"png":
            raise KitError(f"pixel {name}: store-form roundtrip failed")
        logical = f"character/{CODE}/pixelart/{name}.png"
        before = pack.pkg_path("common", logical).read_bytes() if pack.pkg_has("common", logical) else None
        ctx.write_asset("common", logical, store, owner="pixel")
        if pack.pkg_path("common", logical).read_bytes() != store:
            raise KitError(f"pixel {name}: readback mismatch")
        height, width = dyed.shape[:2]
        meta: dict[str, Any] = {}
        for meta_name in (atlas_name, *meta_names):
            tpl_meta = f"character/{TEMPLATE_CODE}/pixelart/{meta_name}"
            pkg_meta = f"character/{CODE}/pixelart/{meta_name}"
            expect = ctx.replace_strings(ctx.amf_parse(pack.template_asset(tpl_meta)[1]), subs)
            if f"character/{TEMPLATE_CODE}/" in repr(expect):
                raise KitError(f"pixel {meta_name}: template prefix survived rewrite")
            if meta_name == atlas_name:
                bprobs = atlas_bounds_problems(expect, (width, height))
                if bprobs:
                    raise KitError(f"pixel {meta_name}: {bprobs[:3]}")
            if pack.pkg_has("common", pkg_meta):
                owner = pack.owner_of("common", pkg_meta)
                if owner not in (None, "assets"):
                    raise KitError(f"pixel metadata {pkg_meta} owned by {owner}; metadata must stay template copy")
                if ctx.amf_parse(pack.pkg_path("common", pkg_meta).read_bytes()) != expect:
                    raise KitError(f"pixel metadata {pkg_meta} differs from template (prefix-rewritten)")
                meta[meta_name] = "equal template (prefix rewritten)"
            else:
                meta[meta_name] = "absent (assets will copy template)"
        result["sheets"][name] = {
            "logical": logical, "source_file": state["outputs"][name]["file"],
            "source_sha256": state["outputs"][name]["sha256"], "store_sha256": hashlib.sha256(store).hexdigest(),
            "template": {"logical": tpl_logical, "source": tpl_source, "sha256": tpl_sha},
            "size": [width, height], "changed_rgb_px": int(np.any(dyed[..., :3] != template[..., :3], axis=-1).sum()),
            "previous_package_sha256": None if before is None else hashlib.sha256(before).hexdigest(),
            "metadata": meta,
        }
    result["status"] = "integrated"
    return result


def voice_state(pack) -> dict[str, Any]:
    """语音装包状态（只读）：speech 行引用 22 槽且全部在包内、owner=voice、语音目录无多余文件。"""
    import wf_seasonal7_voice as V
    import wf_seasonal7_common as C
    info: dict[str, Any] = {"status": "pending"}
    speech_logical = "master/character/character_speech.orderedmap"
    refs = []
    if pack.pkg_has("common", speech_logical):
        rows = pack.pkg_flat(speech_logical)
        refs = [cells[4] for cells in C.csv_split(rows[CID])] if CID in rows else []
    info["speech_refs"] = refs
    voice_dir = pack.pkg_path("common", f"character/{CODE}/voice")
    files = sorted(p.relative_to(voice_dir).as_posix() for p in voice_dir.rglob("*") if p.is_file()) \
        if voice_dir.is_dir() else []
    planned = {f"{slot}.mp3" for slot in V.SLOTS}
    info["extra_files"] = sorted(set(files) - planned)
    info["missing_slots"] = sorted(planned - set(files))
    not_voice = sorted(f for f in planned & set(files)
                       if pack.owner_of("common", f"character/{CODE}/voice/{f}") != "voice")
    info["not_owned_by_voice"] = not_voice
    speech_ok = sorted(refs) == sorted([*V.HOME_SLOTS, "ally/join", "ally/evolution"])
    info["speech_rows_generated"] = speech_ok
    if speech_ok and not info["extra_files"] and not info["missing_slots"] and not not_voice:
        info["status"] = "packed"
    return info


# ================================================================ 设计读取

def load_design(root: Path) -> dict:
    path = root / DESIGN_REL
    design = json.loads(path.read_text(encoding="utf-8"))
    ident = design.get("identity", {})
    if design.get("status") != "final" or design.get("key") != KEY:
        raise KitError(f"design not final/{KEY}: status={design.get('status')} key={design.get('key')}")
    if str(ident.get("cid")) != CID or ident.get("code") != CODE or int(ident.get("element")) != ELEMENT:
        raise KitError(f"design identity mismatch: {ident.get('cid')}/{ident.get('code')}/{ident.get('element')}")
    if design.get("pf_override") is not None or design.get("dash") is not None:
        raise KitError("tekuto design declares pf_override/dash; kit does not implement them")
    if design.get("unique_conditions"):
        raise KitError("tekuto design declares unique_conditions; kit does not implement them")
    return design


def design_ability_rows(design: dict) -> dict[str, list[list[str]]]:
    out = {}
    for slot in range(1, 7):
        key = design["ability_keys"][f"slot{slot}"]["key"]
        out[key] = [list(rec["row"]) for rec in design["abilities"][f"slot{slot}"]]
    return out


def design_leader_rows(design: dict) -> list[list[str]]:
    return [list(rec["row"]) for rec in design["leader"]]


def donor_reconstruction(ctx, design: dict) -> list[dict]:
    """按设计 donor + edits 从官方/live 复算每一行，与设计定稿行比对（live donor 漂移时仅记录）。"""
    results = []
    live_cache: dict[str, dict] = {}

    def donor_row(spec: str, table: str):
        src, rest = spec.split(":", 1)
        key = rest.split("[", 1)[1].split("]", 1)[0]
        idx = int(rest.rsplit("#", 1)[1])
        logical = f"master/ability/{table}.orderedmap"
        if src == "official":
            rows = ctx.official_rows(table, key)
        else:
            if logical not in live_cache:
                live_cache[logical] = ctx.live_flat(logical)
            rows = ctx.csv_split(live_cache[logical][key])
        return list(rows[idx])

    groups = [("leader_ability", f"leader#{i}", rec, None) for i, rec in enumerate(design["leader"])]
    for slot in range(1, 7):
        recs = design["abilities"][f"slot{slot}"]
        for i, rec in enumerate(recs):
            groups.append(("ability", f"slot{slot}#{i}", rec, recs[0]["row"][1] if i > 0 else None))
    for table, label, rec, unison in groups:
        row = donor_row(rec["donor"], table)
        before = {k: row[int(k)] for k in rec["edits"]}
        for col, value in rec["edits"].items():
            row[int(col)] = value
        if unison is not None:
            row[1] = unison
        diff = [i for i, (a, b) in enumerate(zip(row, rec["row"])) if a != b]
        results.append({"row": label, "donor": rec["donor"], "match": row == rec["row"] and len(row) == len(rec["row"]),
                        "diff_cols": diff, "donor_before": before})
    return results


# ================================================================ 指纹（kit 产物 → gates 绑定）

def owned_table_rows(pack) -> dict[str, Any]:
    import wf_mod_tool as core
    import wf_seasonal7_common as C
    out: dict[str, Any] = {}
    flat = {CHAR: [CID], TEXT: [CID], LEADER: [CID], ABILITY: [f"{CID}{i}" for i in range(1, 7)],
            CAS: [CHANGE_SKILL_KEY]}
    for logical, keys in flat.items():
        rows = pack.pkg_flat(logical) if pack.pkg_has("common", logical) else {}
        out[logical] = {k: rows.get(k) for k in keys}
    for logical, key in ((ACTION, CODE), (SWITCHED, VOICE_READY_KEY)):
        if pack.pkg_has("common", logical):
            nested = core.load_nested_table_bytes(pack.pkg_path("common", logical).read_bytes(), logical)
            out[logical] = {key: nested.rows[key].text_rows() if key in nested.rows else None}
        else:
            out[logical] = {key: None}
    if pack.pkg_has("common", CAPS):
        om = core.read_orderedmap_raw_rows_from_bytes(pack.pkg_path("common", CAPS).read_bytes(), CAPS)
        blob = dict(zip(om.keys, om.rows)).get(CHANGE_SKILL_KEY)
        out[CAPS] = {CHANGE_SKILL_KEY: None if blob is None else C.sha256(blob)}
    else:
        out[CAPS] = {CHANGE_SKILL_KEY: None}
    return out


def kit_fingerprint(pack) -> dict[str, Any]:
    """kit 产物指纹：设计 JSON、kit 源码、kit/effects/pixel 登记的文件字节与 kit 自有表行。"""
    import wf_seasonal7_common as C
    files = {}
    for entry, record in sorted(pack._owned_raw().items()):
        if record.get("owner") not in ("kit", "effects", "pixel"):
            continue
        root, logical = entry.split(":", 1)
        path = pack.pkg_path(root, logical)
        files[entry] = C.sha256(path.read_bytes()) if path.is_file() else None
    payload = {
        "design_sha256": C.sha256((pack.root / DESIGN_REL).read_bytes()),
        "kit_source_sha256": C.sha256(KIT_SOURCE.read_bytes()),
        "files": files,
        "rows": owned_table_rows(pack),
    }
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    return {"sha256": digest, "file_count": len(files)}


# ================================================================ build

def build(ctx) -> dict[str, Any]:
    import wf_client_legality as LG
    import wf_describe
    import wf_mod_tool as core
    import wf_seasonal7_voice as V
    spec, pack = ctx.spec, ctx.pack
    if (spec.key, spec.cid_s, spec.code, spec.template_code, spec.element) != (KEY, CID, CODE, TEMPLATE_CODE, ELEMENT):
        raise KitError(f"spec mismatch for tekuto kit: {spec.key}/{spec.cid}/{spec.code}")
    design = load_design(ctx.root)
    notes: list[str] = []
    derivation: dict[str, Any] = {}

    # ---- 文案一致性（TEXTS 必须与设计定稿逐字一致，否则 tables 重跑会和 kit 行打架）
    text_row = list(design["text"]["character_text_row"])
    want = {"profile": text_row[2], "skill1": text_row[4], "desc1": text_row[5], "skill2": text_row[6],
            "desc2": text_row[7], "cv": text_row[11]}
    for name, value in want.items():
        if spec.texts.get(name) != value:
            raise KitError(f"TEXTS[{name}] differs from design text row")
    for name, idx in (("name", 0), ("furigana", 1), ("title", 3), ("leader", 10)):
        if spec.texts.get(name) != text_row[idx]:
            raise KitError(f"spec texts[{name}]={spec.texts.get(name)!r} != design {text_row[idx]!r}")

    # ---- 队长 / 词条：设计定稿行 + donor 复算核对 + 合法性
    leader_rows = design_leader_rows(design)
    ability_rows = design_ability_rows(design)
    recon = donor_reconstruction(ctx, design)
    derivation["donor_reconstruction"] = recon
    drift = [r for r in recon if not r["match"]]
    if drift:
        notes.append(f"donor 复算与定稿行不一致（写入定稿行）: {[(r['row'], r['diff_cols']) for r in drift]}")
    legality: dict[str, list[str]] = {}
    for i, row in enumerate(leader_rows):
        probs = (LG.client_legality_problems("leader_ability", row)
                 + LG.declared_block_field_problems("leader_ability", row)
                 + LG.ability_element_column_problems("leader_ability", row, ELEMENT))
        if len(row) != 124 or row[0] != CODE:
            probs.append(f"leader row shape/id: len={len(row)} c0={row[0]}")
        legality[f"leader#{i}"] = probs
    for key, rows in ability_rows.items():
        if len(rows) > 2:
            raise KitError(f"{key}: more than 2 records")
        for i, row in enumerate(rows):
            probs = (LG.client_legality_problems("ability", row)
                     + LG.declared_block_field_problems("ability", row)
                     + LG.ability_element_column_problems("ability", row, ELEMENT))
            if len(row) != 126 or row[0] != f"{CODE}_{key[-1]}":
                probs.append(f"ability row shape/id: len={len(row)} c0={row[0]}")
            if row[1] != rows[0][1]:
                probs.append("c1 unisonable differs within key")
            legality[f"{key}#{i}"] = probs
    bad = {k: v for k, v in legality.items() if v}
    if bad:
        raise KitError(f"row legality problems: {bad}")
    caps = sorted({cap for row in leader_rows for cap in LG.required_client_capabilities("leader_ability", row)}
                  | {cap for rows in ability_rows.values() for row in rows
                     for cap in LG.required_client_capabilities("ability", row)})
    if caps:
        raise KitError(f"tekuto rows unexpectedly need client capabilities {caps} (design: none)")
    ctx.write_flat(LEADER, {CID: leader_rows})
    ctx.write_flat(ABILITY, ability_rows)

    # ---- 字符串：custom_ability_string + power_up；撤掉未用的自动克隆键
    cas_rows = {s["key"]: s["text"] for s in design["custom_strings"] if s["table"] == CAS}
    if set(cas_rows) != {CHANGE_SKILL_KEY}:
        raise KitError(f"design custom_strings unexpected: {sorted(cas_rows)}")
    referenced = {row[70] for rows in ability_rows.values() for row in rows if row[47] in ("536", "629", "722")}
    if referenced != {CHANGE_SKILL_KEY}:
        raise KitError(f"ability string refs {referenced} != {{{CHANGE_SKILL_KEY}}}")
    ctx.write_flat(CAS, cas_rows)
    unclaimed = []
    pkg_cas = ctx.pkg_flat(CAS)
    claimed_cas = next((c for c in pack.load_claims() if c["logical_path"] == CAS), {"outer_keys": []})
    for key in UNUSED_CAS_KEYS:
        if key in pkg_cas or key in claimed_cas["outer_keys"]:
            ctx.unclaim(CAS, [key])
            unclaimed.append(key)
    live_caps = core.read_orderedmap_raw_rows_from_bytes(core.table_path(ctx.store, CAPS).read_bytes(), CAPS)
    caps_src = dict(zip(live_caps.keys, live_caps.rows)).get(POWER_UP_SOURCE_KEY)
    official_caps_raw = ctx.official_read(CAPS, "common")
    official_note = "official baseline missing"
    if official_caps_raw is not None:
        off = core.read_orderedmap_raw_rows_from_bytes(official_caps_raw, CAPS)
        off_blob = dict(zip(off.keys, off.rows)).get(POWER_UP_SOURCE_KEY)
        official_note = "live==official" if off_blob == caps_src else "live differs from official; official used"
        if off_blob is not None:
            caps_src = off_blob
    if caps_src is None:
        raise KitError(f"power_up source key missing: {POWER_UP_SOURCE_KEY}")
    inner = core.read_orderedmap_raw_rows_from_bytes(caps_src, "levels")
    power_up_text = {k: zlib.decompress(r).decode("utf-8") for k, r in zip(inner.keys, inner.rows)}
    if set(power_up_text.values()) != {"伤害强化"}:
        raise KitError(f"unexpected official power_up text: {power_up_text}")
    ctx.write_raw_outer(CAPS, {CHANGE_SKILL_KEY: caps_src})
    derivation["power_up_string"] = {"source": POWER_UP_SOURCE_KEY, "levels": power_up_text, "basis": official_note}

    # ---- action_skill 两档 + switched_action_skill（语音路由）
    placeholder = ctx.pkg_nested(CODE)
    action_rows = {lv: list(cells) for lv, cells in design["skills"]["action_skill_rows"].items()}
    if set(action_rows) != {"1", "2"} or set(placeholder) != {"1", "2"}:
        raise KitError("action_skill levels must be 1/2")
    for lv, cells in action_rows.items():
        if len(cells) != 24 or cells[7] != ctx.program_path(lv):
            raise KitError(f"action_skill row {lv} shape/program mismatch")
        energy = design["skills"]["energy"][lv]
        if (cells[4], cells[5], cells[6]) != (energy["c4"], energy["c5"], energy["c6"]):
            raise KitError(f"action_skill row {lv} energy mismatch")
        if (cells[0], cells[1]) != (spec.texts[f"skill{lv}"], spec.texts[f"desc{lv}"]):
            raise KitError(f"action_skill row {lv} text differs from TEXTS")
        changed = [i for i, (a, b) in enumerate(zip(placeholder[lv], cells)) if a != b]
        if not set(changed) <= {0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16}:
            raise KitError(f"action_skill row {lv} changes unexpected columns vs template placeholder: {changed}")
        derivation.setdefault("action_skill_changed_cols", {})[lv] = changed
    ctx.write_nested(ACTION, CODE, {lv: [cells] for lv, cells in action_rows.items()})
    route = design["voice"]["route"]
    route_cols = V.normalize_route(route["c9_16"], CODE)
    switched = V.switched_rows(action_rows)
    design_switched = route["switched_action_skill"]
    if design_switched["key"] != VOICE_READY_KEY or design_switched["inner"] != switched:
        raise KitError("design switched_action_skill inner rows differ from action_skill c7-c23")
    ctx.write_nested(SWITCHED, VOICE_READY_KEY, {lv: [cells] for lv, cells in switched.items()}, replace_inner=True)

    # ---- character 行：c9–c16 路由；其余 spec 列核对设计
    crow = pack.pkg_character_row()
    edits = design["identity"]["character_row_edits_vs_131092"]
    checks = {0: CODE, 8: CODE, 17: CID, 18: edits["18"], 26: edits["26"], 27: edits["27"], 36: edits["36"],
              6: str(design["identity"]["pf_type"]), 3: str(ELEMENT), 2: "5"}
    for col, value in checks.items():
        if crow[col] != value:
            raise KitError(f"character c{col}={crow[col]!r} != design {value!r} (rerun tables?)")
    if crow[19:25] != edits["19..24"]:
        raise KitError("character c19-c24 ability keys differ from design")
    if list(edits["9..16"]) != route_cols:
        raise KitError("design c9-16 differs from voice route")
    crow = V.route_character_row(crow, route_cols, CODE)
    ctx.write_flat(CHAR, {CID: [crow]})
    trow = pack.pkg_character_text_row()
    if trow != text_row:
        # tables 按 TEXTS 生成；仍不同说明 tables 未重跑，这里按设计写并提示
        notes.append("character_text 行与设计不一致，已按设计写入（请确认 tables 已带 TEXTS 重跑）")
        ctx.write_flat(TEXT, {CID: [text_row]})
    mirrors = ctx.sync_character_mirrors()

    # ---- 特效族克隆（染色钩子）
    fx_map, fx_info = load_fx_manifest(ctx.root)
    recolor_stats: dict[str, Any] = {}
    families = []
    for src_dir, sub, fx_names in FAMILIES:
        donor = src_dir.rsplit("/", 1)[-1]
        sheet = f"{src_dir}/{donor}.png"
        transform = make_png_transform(sheet, fx_map[sheet], recolor_stats) if sheet in fx_map else None
        fam = ctx.clone_effect_family(src_dir, sub, fx_names=fx_names, layout="codename", png_transform=transform)
        if fam["missing_effects"] or sorted(fam["copied_bases"]) != sorted(fx_names):
            raise KitError(f"effect family {sub} incomplete: missing={fam['missing_effects']}")
        families.append(fam)
    unused_fx = sorted(set(fx_map) - set(recolor_stats))
    if unused_fx:
        raise KitError(f"fx manifest sheets not applied: {unused_fx}")
    fx_sheets = {}
    for fam in families:
        sheet_logical = f"{fam['dst_dir']}/{fam['dst_dir'].rsplit('/', 1)[-1]}.png"
        src_sheet = f"{fam['src_dir']}/{fam['src_dir'].rsplit('/', 1)[-1]}.png"
        pkg_raw = pack.pkg_path("common", sheet_logical).read_bytes()
        entry = {"logical": sheet_logical, "package_sha256": hashlib.sha256(pkg_raw).hexdigest(),
                 "owner": pack.owner_of("common", sheet_logical)}
        if src_sheet in fx_map:
            dyed_raw = fx_map[src_sheet].read_bytes()
            want = ctx.png_store_bytes(ctx.png_open(dyed_raw))   # 框架存储态（PIL optimize 重编码 + 小写魔数）
            entry.update(dyed_file=str(fx_map[src_sheet]), dyed_sha256=hashlib.sha256(dyed_raw).hexdigest(),
                         framework_store_sha256=hashlib.sha256(want).hexdigest(),
                         package_equals_framework_store=pkg_raw == want)
            if pkg_raw != want:
                raise KitError(f"recolored sheet not applied byte-exact (framework store form): {sheet_logical}")
        fx_sheets[fam["dst_dir"].rsplit("/", 1)[-1]] = entry

    # ---- 像素小人（门禁通过才写；否则保持母本原色）
    pixel = integrate_pixel(ctx)

    # ---- 技能 DSL
    dsl_report: dict[str, Any] = {}
    programs = []
    for lv in ("1", "2"):
        tree = donor_tree(lv)
        kept_all: set[str] = set()
        rewritten = 0
        for fam in families:
            tree, info = ctx.rewrite_effect_refs(tree, fam)
            rewritten += info["rewritten"]
            kept_all |= set(info["kept_donor"])
        leftover = sorted(v for v in ctx.walk(tree) if isinstance(v, str)
                          and (v.startswith(CANNON_SRC + "/") or "enemy_shot_laser_" in v and "/enemy_general/" in v))
        if leftover:
            raise KitError(f"level {lv}: donor effect refs not rewritten: {leftover[:5]}")
        composed, tree_fixes = design_composed_tree(design, lv)
        diff = strict_diff(tree, composed)
        if diff:
            raise KitError(f"level {lv}: assembled tree differs from design composed_tree (+review fixes): {diff[:5]}")
        wprobs = cooldown_width_problems(tree)
        if wprobs:
            raise KitError(f"level {lv}: cooldown effect width problems: {wprobs}")
        template = ctx.template_dsl(f"battle/action/skill/action/rare5/{TEMPLATE_CODE}${TEMPLATE_CODE}_{lv}")
        tprobs, tfacts = template_derivation_problems(tree, template, lv)
        if tprobs:
            raise KitError(f"level {lv}: template derivation problems: {tprobs}")
        qprobs = dsl_quick_problems(tree)
        if qprobs:
            raise KitError(f"level {lv}: DSL problems: {qprobs}")
        logical = ctx.write_dsl(ctx.program_path(lv), tree)
        programs.append(logical)
        dsl_report[lv] = {"logical": logical, "rewritten_refs": rewritten, "design_composed_equal": True,
                          "design_tree_fixes": tree_fixes, "cooldown_width_problems": wprobs,
                          "template_derivation": tfacts, "quick_problems": qprobs}
        derivation.setdefault("design_tree_fixes", {})[lv] = [f["state"] for f in tree_fixes]

    # ---- 详情页技能预览 end_frame
    _root, template_raw, source = pack.template_asset(TEMPLATE_PREVIEW)
    preview = ctx.amf_parse(template_raw)
    before = copy.deepcopy(preview)
    edit = design["skills"]["preview_edit"]
    if edit["logical"] != PREVIEW or edit["edits"] != {"config.end_frame": PREVIEW_END_FRAME}:
        raise KitError("design preview_edit changed; update kit")
    if preview["config"]["end_frame"] != 350 or preview["config"]["start_frame"] != 90:
        raise KitError(f"template preview config unexpected: {preview['config']}")
    preview["config"]["end_frame"] = PREVIEW_END_FRAME
    ctx.write_asset("common", PREVIEW, ctx.amf_bytes(preview), owner="kit")
    derivation["preview"] = {"source": source, "before": before["config"], "after": preview["config"],
                             "log_parts": preview["log_parts"]}

    # ---- 面板（wf_describe）
    panel = []
    for line in wf_describe.describe_rows(leader_rows, "leader_ability"):
        panel.append("队长：" + line)
    for key, rows in ability_rows.items():
        for line in wf_describe.describe_rows(rows, "ability"):
            panel.append(f"能力{key[-1]}（{'Ⓜ' if rows[0][1] == 'false' else '—'}）：{line}")

    evidence = {
        "design": DESIGN_REL, "design_sha256": hashlib.sha256((ctx.root / DESIGN_REL).read_bytes()).hexdigest(),
        "derivation": derivation, "legality": legality, "required_capabilities": caps,
        "unclaimed": unclaimed, "effects": [{k: f[k] for k in ("src_dir", "dst_dir", "copied_bases")} for f in families],
        "fx_manifest": fx_info, "recolor": recolor_stats, "fx_sheets": fx_sheets, "pixel": pixel,
        "voice": voice_state(pack), "dsl": dsl_report,
        "voice_route": route_cols, "mirrors": {"server_character": mirrors["server_character"]},
        "notes": notes,
    }
    ctx.evidence_write("kit-derivation.json", evidence)

    fingerprint = kit_fingerprint(pack)
    gates_path = ctx.root / GATES_REL
    status, gate_state = "draft", "gates.json missing"
    if gates_path.is_file():
        gates = json.loads(gates_path.read_text(encoding="utf-8"))
        if not gates.get("all_pass"):
            gate_state = "gates.json present but not all_pass"
        elif gates.get("kit_fingerprint", {}).get("sha256") != fingerprint["sha256"]:
            gate_state = "gates.json fingerprint stale (kit outputs changed since gates ran)"
        else:
            status, gate_state = "ready-for-review", "gates all_pass, fingerprint matches"
    risks = list(design.get("risks", []))
    voice = evidence["voice"]
    report_notes = [
        f"gate: {gate_state}",
        ("voice: 22 槽 AI 合成语音已装包（run=take1，owner=voice，speech 8 行引用 home_0..5/join/evolution，"
         "母本旧 home 语音已移除）；route c9-16=ChangeSkillFlag" if voice["status"] == "packed" else
         "voice route c9-16=ChangeSkillFlag 已写；22 条语音待 Integrate 装包（impl/tekuto/voice_merge.py）"
         f"（现状: missing={len(voice['missing_slots'])} extra={voice['extra_files']} "
         f"not_owned_by_voice={len(voice['not_owned_by_voice'])}）"),
        ("pixel: 染色 sprite_sheet/special_sprite_sheet 已装包（owner=pixel，存储态=out 原字节换小写魔数；"
         "alpha/透明像素/尺寸与母本一致，atlas/frame/timeline 未改）" if pixel["status"] == "integrated" else
         f"pixel sheet 仍为母本原色（pending: {pixel['gate']['reasons']}）"),
        ("effects recolor applied from fx manifest（包内 5 张 sheet == 染色 PNG 的框架存储态）" if recolor_stats
         else "effects cloned with official colors (fx/tekuto/out/manifest.json 不存在)"),
        "custom_ability_power_up_string 同键潜能 2–6「伤害强化」克隆自官方 change_skill_super_robot（设计未列，属官方同形补全）",
        *[f"审查修正 {f['id']}（{lv} 档 {f['state']}）：cannon_cooldown {f['design']} → {f['fixed']}；{f['reason']}"
          + ("；设计 JSON/md 仍写 3.8，待主控同步" if f["state"] == "applied" else "")
          for lv, rep in dsl_report.items() for f in rep["design_tree_fixes"]],
        *notes,
        *[r + ("（收炮已按审查修正改为 Some(7.6)，放大倍数更高，发虚风险同样需真机看）" if "Some(3.8)" in r else "")
          for r in risks],
    ]
    ctx.report({
        "summary": ("tekuto kit: 队长6行/词条10条/两档技能DSL(四段加粗激光炮台)/5特效族克隆(染色)/预览600/语音路由"
                    f"；pixel={pixel['status']}；voice={voice['status']}"),
        "status": status,
        "skills": {"programs": programs},
        "required_capabilities": [],
        "panel": panel,
        "notes": report_notes,
        "kit_fingerprint": fingerprint,
    })
    return {"status": status, "gate_state": gate_state, "programs": programs, "fingerprint": fingerprint["sha256"],
            "unclaimed": unclaimed, "recolored": sorted(recolor_stats), "pixel": pixel["status"],
            "voice": voice["status"], "notes": notes}
