# -*- coding: utf-8 -*-
"""季节换装七角色 · 见岛勇希·泳装 129991 ``psychic_yuki_swim`` 套件（kit）。

按定稿设计 ``work/character_packs/seasonal7-20260916/design/yuki.json``（status=final）落地：

- 队长 6 行 + 词条 6 键 13 条：donor 行 + 声明列编辑重建，逐行 sha256 锁定到设计成品行
  （live donor 漂移时回落设计成品行并记 note；两者都对不上直接报错）；
- ``custom_ability_string`` 新键 ``change_skill_psychic_yuki_swim``（536 ChangeSkillFlag 行 c70 引用，
  缺键 = C8601）。power_up 表不写：同形在线先例 1299923 / 1699891 / 1499891 / 1499901 的 536 串都只在主表，
  客户端缺 power_up 键按等级 1 处理、等级≤1 不读 power_up 表（roster.md §1 读码依据，门禁复核）；
- character_text / TEXTS、character 行 c9–c16 语音路由（kind 3 ChangeSkillFlag）、三层镜像；
- action_skill 两档（名称/描述/图标/能量 c4–c6/程序 c7/自动施放 c8–c10）；
- 两棵技能 DSL：全部从官方基线按设计块拼装（不读设计 composed_tree 当输入，只拿来逐节点对照）；
- 两个特效族克隆（sibling 形态 ``skill_unique/psychic_yuki_swim_{wave,barrier}/``）+ 引用改写；
  若 ``seasonal7-20260916/fx/yuki/out/manifest.json`` 存在，按其 {源逻辑路径 → 染色 PNG} 替换 sheet，
  否则用本模块的保守回退染色（保留 alpha 与尺寸）；
- ``switched_action_skill`` ``psychic_yuki_swim_voice_ready`` 两档 = action_skill c7–c23
  （与 ``wf_seasonal7_voice.switched_rows`` 列约定一致）；
- 离线静态门禁（行合法性 / DSL 签名差分 / 作用域 / 元素码 / 方向 / 判定区目标 / DoNothing /
  AMF3 往返 / 特效引用解析 / wf_describe 渲染 / capability 一致 / 包内 PNG 存储魔数），结果写
  ``evidence/kit-gates.json``；全部通过才报 ``ready-for-review``。

Integrate 辅助（build 不调用）：``install_pixel_sheets(ctx)`` 把 ``pixel/yuki/out`` 两张标准魔数 PNG
转成 WF 存储魔数（小写 ``\\x89png``）后装包并登记 owner=pixel。

没有 PF 覆盖（722）、没有 422/724、没有 desc_override、没有 unique_condition（设计 §0/§3）。
只写 ``work/character_packs/s7-yuki/``；不发布、不写 live store / assets / .cdn / src。
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import zlib
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import wf_assets
import wf_mod_tool as core

KEY = "yuki"
CID = "129991"
CODE = "psychic_yuki_swim"
TEMPLATE_CODE = "psychic_yuki_ny23"
ELEMENT = 1                                   # 内部 0 基：水
BATCH = "work/character_packs/seasonal7-20260916"
DESIGN_REL = f"{BATCH}/design/yuki.json"
FX_MANIFEST_REL = f"{BATCH}/fx/{KEY}/out/manifest.json"

AB = "master/ability/ability.orderedmap"
LD = "master/ability/leader_ability.orderedmap"
CHAR = "master/character/character.orderedmap"
TEXT = "master/character/character_text.orderedmap"
CAS = "master/string/custom_ability_string.orderedmap"
ACTION = core.ACTION_SKILL_LOGICAL
SWITCHED = core.SWITCHED_ACTION_SKILL_LOGICAL
VOICE_READY_KEY = f"{CODE}_voice_ready"
CHANGE_SKILL_KEY = f"change_skill_{CODE}"
RARE5 = "battle/action/skill/action/rare5"

SKILL_NAME_1 = "浪花雪晶·多重结界"
SKILL_NAME_2 = "浪花雪晶·多重结界＋"
_DESC = ("向距离最近的敌人击出多重结界，对命中的敌人造成合计{mult}倍水属性伤害【根据连击数伤害提升】"
         "／提升连击数／赋予队伍角色及参战者队伍角色技能伤害提升效果【对水属性效果提升】"
         "／赋予水属性角色及水属性协力球屏障＋全属性抗性＋技能伤害提升效果"
         "／作为主要角色编成且水属性共鸣时，追加赋予队伍连击加成效果")
SKILL_DESC_1 = _DESC.format(mult=24)
SKILL_DESC_2 = _DESC.format(mult=34)

TEXTS = {
    "name": "见岛勇希",
    "furigana": "JIANDAOYONGXI",
    "title": "碧海雪华",
    "profile": ("为了暑假的海滩之行，见岛勇希换上蓝白泳装，披着白色防晒外套。她用结界把拍岸的浪花凝成细碎雪晶，"
                "替大家挡开烈日与暑气。本想坐在礁石边安静看书、摆出很酷的样子，却总被突然涌来的海浪弄得手忙脚乱。"),
    "leader": "我们的夏日结界",
    "skill1": SKILL_NAME_1, "desc1": SKILL_DESC_1,
    "skill2": SKILL_NAME_2, "desc2": SKILL_DESC_2,
    "cv": "AI 合成配音",
}

SPEC = {
    "extra_keys": {
        CAS: (CHANGE_SKILL_KEY,),
        SWITCHED: (VOICE_READY_KEY,),
    },
}

CHANGE_SKILL_TEXT = "强化技能：追加赋予队伍连击加成效果（之后3次弹射，每次弹射连击数+5）"
# character c9–c16：kind 3 ChangeSkillFlag（wf_seasonal7_voice.normalize_route 的规范形）
VOICE_ROUTE = ["3", "", "", "", "", VOICE_READY_KEY, "false", "false"]
ENERGY = {"1": ("550", "550", "1"), "2": ("550", "500", "1")}
SKILL_ICON = "dynamic/skill/atk_nearest"
AUTO_CAST = ("1", "0", "650")                 # c8–c10：新春版原值

# ---------------------------------------------------------------- 行配方（donor + 声明列编辑 + 成品行 sha256 锁）
# (来源 store|official, donor 键, donor 行号, {列: 新值}, 成品行 CSV sha256)
LEADER_RECIPE = (
    ('store', '129992', 2, {0: CODE, 49: '200000', 50: '200000'},
     'de099f1723e3cd0b70ea430f97e1945224ad2c94a8488b43db21a75f7a0c71b7'),  # L1 水共鸣 全队水攻击 200%
    ('store', '129992', 3, {0: CODE},
     '8edf4b09e2f7ba7ccd22383ef19bdb7d21bd9f88d2574c21c034594e93c31c9b'),  # L2 水共鸣 全队水技伤 300%
    ('store', '129992', 1, {0: CODE, 28: '3000000', 29: '3000000', 46: '5', 47: 'Blue', 49: '10000', 50: '10000'},
     'c591295aee1eca17f9ae02f7c958ae0748cfc6b4bd45d2b8469ba0c5fcdcec03'),  # L3 连击≥30(限10) 全队水技伤 10%
    ('store', '129970', 7, {0: CODE, 107: '2', 111: '100000', 112: '100000'},
     '7ede91b3340e03185a72076f60683e0d59f5d09e82e42aefc787e2030acd3d5b'),  # L4 自身屏障中 全队水技伤 100%
    ('official', '121117', 2, {0: CODE, 49: '800000', 50: '800000'},
     'bfd4fbc89812fc8e1b17d982f06414a383584acee29e459225c8dcf655e23de0'),  # L5 水属性施技 连击加成 8
    ('store', '129992', 8, {0: CODE},
     '386a986b9fc1f7a6c0d0857fd55812cef854f31731a95e172f87121ad16e539f'),  # L6 自身施技 除自身水技能槽 10%
)
ABILITY_RECIPE = {
    1: (
        ('store', '1299921', 1, {0: f'{CODE}_1', 2: 'action_skill'},
         '868f3cca3a48886ff640f0d1b2cee17d5e789fb2e8b9d3d1aecacb56e275d0b7'),  # 自身技能槽 100%
        ('official', '1210701', 1, {0: f'{CODE}_1', 51: '25000', 52: '50000'},
         '6ccb167453ba3023726957ac87fb12a3fc80879f70928d6b19a3f15f5637d620'),  # 全队水技伤 25→50%
    ),
    2: (
        ('store', '1299922', 2, {0: f'{CODE}_2', 51: '1000000', 52: '1500000'},
         'dddfb43f3345093055baf0265873d97e76df79a4e29eb18fc287521641bb4d3b'),  # 水属性施技 连击 +10→15
        ('official', '2410016', 0, {0: f'{CODE}_2', 2: 'action_skill', 47: '211', 49: 'Blue', 51: '2000', 52: '3000'},
         '5d79b133d2e6e753150345de04f83153315cef548d415ebaa432ce3f9e728112'),  # 连击≥30(限10) 全队水技能槽 2→3%
    ),
    3: (
        ('store', '1299923', 0, {0: f'{CODE}_3', 70: CHANGE_SKILL_KEY},
         'a09ca8b14311016d39e230fae472639c10edfe39c37946f6bd1ab218d7bb0d84'),  # Ⓜ 水共鸣 ChangeSkillFlag
        ('store', '2610896', 0, {0: f'{CODE}_3', 1: 'false', 11: 'Blue', 49: 'Blue', 51: '10000', 52: '20000'},
         'aed9cf881ce4e5b02f40be97ec816562554502f53f548b5a6a79d493daeddab5'),  # Ⓜ 水共鸣 全队水 694 10→20%
        ('official', '1211473', 0, {0: f'{CODE}_3', 2: 'special', 113: '500', 114: '1000'},
         'f7be0140c39ea69a905975089a737404d736cbb0ab8dc02c3c2b56b79790e6ae'),  # Ⓜ 队伍总HP 全队水技伤 0.5→1%/层
    ),
    4: (
        ('store', '1399951', 1, {0: f'{CODE}_4', 2: 'attack_blue', 51: '300000', 52: '500000'},
         'bbafb292df075d19209cb12d777b4499215492a8121efa35298cc22677e45821'),  # 冲刺 连击 +3→5
        ('store', '1299926', 1, {0: f'{CODE}_4', 2: 'attack_blue'},
         '180cb92faff2e4c90b203096411ce4faad67bea832e0e09b7a0d3d73871ccf01'),  # 全队水技能槽充能 10→20%
    ),
    5: (
        ('store', '1199896', 0, {0: f'{CODE}_5', 2: 'attack_blue', 29: 'Blue', 47: '34', 49: 'Blue'},
         'ca738fb47afa938999da3849e8f86f71c4864c8fac57d21dff100c4e58b9711d'),  # 水属性施技(限10) 全队水技伤 10%
        ('store', '1199896', 1, {0: f'{CODE}_5', 2: 'attack_blue', 13: '0', 29: 'Blue', 49: 'Blue'},
         '652c14d31d7d61c9dd4c8f36483a947a41c27fe60a7bace2c26439884f95902d'),  # 同触发 全队水攻击 10%
    ),
    6: (
        ('store', '1499882', 0, {0: f'{CODE}_6', 2: 'defense_blue', 6: '0', 11: '', 51: '5000', 52: '10000'},
         'fe0311302beaebf467f1202f4685c482610ab2d139b3678c581bf1b3b27dcd3d'),  # PF Lv3 全队屏障 5→10%
        ('store', '1299921', 0, {0: f'{CODE}_6', 2: 'defense_blue', 51: '50000', 52: '100000'},
         '694be59e30508cef5a32aa3facdbf98e612f9d0554e47788dd90a49834c66769'),  # 全队水攻击 50→100%
    ),
}

# ---------------------------------------------------------------- 技能树计划（设计 §4.2）
FX_WAVE = dict(src_dir="battle/effect/skill_unique/psychic_yuki_ny23", subdir="wave",
               fx_names=["psychic_yuki_ny23_attack", "psychic_yuki_ny23_hit", "psychic_yuki_ny23_player",
                         "psychic_yuki_ny23_character_back", "psychic_yuki_ny23_character_front"])
FX_BARRIER = dict(src_dir="battle/effect/skill_unique/psychic_yuki", subdir="barrier",
                  fx_names=["psychic_yuki_all", "psychic_yuki_barrier"])
PLAN = {
    "1": dict(cna=(12, 12), addcombo=(8, 8), d_sd_time=(720, 720), d_sd_value=(0.3, 0.3)),
    "2": dict(cna=(15, 17), addcombo=(12, 15), d_sd_time=(900, 900), d_sd_value=(0.3, 0.5)),
}
COMBOBOOST = dict(flips=3, combo=5)
EXPECTED_MULT = {"1": (24, 24), "2": (30, 34)}


# ================================================================ 纯函数（门禁脚本复用）

def slv(a, b):
    return [{"min": a, "max": b}]


def cmd(node):
    return node[1] if (isinstance(node, list) and len(node) == 2 and node[0] in ("Command", "Event")
                       and isinstance(node[1], list)) else None


def walk_cmds(node, out=None):
    out = [] if out is None else out
    if isinstance(node, list):
        c = cmd(node)
        if c:
            out.append(c)
        for x in node:
            walk_cmds(x, out)
    elif isinstance(node, dict):
        for x in node.values():
            walk_cmds(x, out)
    return out


def _find_root(children, name, pred=lambda c: True):
    hits = [n for n in children if cmd(n) and cmd(n)[0] == name and pred(cmd(n))]
    if len(hits) != 1:
        raise AssertionError(f"expected exactly one root {name}, got {len(hits)}")
    return hits[0]


def row_sha(row: list[str]) -> str:
    return hashlib.sha256(core.write_csv_lines([row]).rstrip("\n").encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- 技能树拼装（全部官方基线）

def compose_tree(read_dsl, level: str):
    """按设计 §4.2 拼装一档技能树（特效路径仍是官方路径，由调用方 rewrite_effect_refs）。

    ``read_dsl(program_path) -> tree`` 必须返回官方基线树（KitContext.template_dsl）。
    """
    plan = PLAN[level]
    ny = read_dsl(f"{RARE5}/psychic_yuki_ny23$psychic_yuki_ny23_{level}")
    yk = read_dsl(f"{RARE5}/psychic_yuki$psychic_yuki_{level}")
    pp = read_dsl(f"{RARE5}/psychic_projection_smr23$psychic_projection_smr23_2")
    sa = read_dsl(f"{RARE5}/sing_android_2halfanv$sing_android_2halfanv_{level}")
    if not (isinstance(ny, list) and ny[0] == "ActionDsl" and ny[1] == 2 and ny[10] == 0):
        raise AssertionError(f"ny23_{level} header unexpected: {ny[:11]}")
    ny_root, yk_root = ny[11][1], yk[11][1]
    # A 全屏雪花 + 屏障演出（121070）
    fx_all = copy.deepcopy(_find_root(yk_root, "ShowEffect", lambda c: c[1] == "全体演出"))
    fx_bar = copy.deepcopy(_find_root(yk_root, "ShowEffect", lambda c: c[1] == "バリア演出"))
    # B 结界弹 + 纵向冲击（121147 根#0）
    near = copy.deepcopy(_find_root(ny_root, "FindNearSubjects", lambda c: c[3] == 49))
    cnas = [c for c in walk_cmds(near) if c[0] == "CreateNormalAttack"]
    if len(cnas) != 2:
        raise AssertionError(f"ny23 B block CNA count {len(cnas)}")
    for c in cnas:
        c[6] = slv(*plan["cna"])                 # p5 攻击倍率
        if c[8] is not False:
            raise AssertionError("ny23 CNA p7 enablesComboBonus expected false")
        c[8] = True                              # p7 enablesComboBonus
    # C 分属性技伤 + 协力（121147 根#1..#6 原样）
    tiers = [copy.deepcopy(n) for n in ny_root if cmd(n) and (
        cmd(n)[0] in ("FindAllSubjects", "TargetMate")
        or (cmd(n)[0] == "CreateCondition" and cmd(n)[1] in (10, 11)))]
    if [cmd(n)[0] for n in tiers] != ["FindAllSubjects", "FindAllSubjects", "TargetMate", "CreateCondition",
                                      "TargetMate", "CreateCondition"]:
        raise AssertionError(f"ny23 C block shape {[cmd(n)[0] for n in tiers]}")
    # D 屏障 + 全属性耐性 + 全队技伤（121070 FindAll(0,33,[2])，绑定 0→12）
    fa = copy.deepcopy(_find_root(yk_root, "FindAllSubjects", lambda c: c[2] == 33))
    body = fa[1][9][1]
    if [cmd(n)[0] for n in body] != ["CreateCondition", "CreateCondition", "CreateBarrier"]:
        raise AssertionError(f"121070 D block shape {[cmd(n)[0] for n in body]}")
    sd = cmd(body[0])[2][0]
    if sd[0] != "ACSkillDamage" or cmd(body[1])[2][0][0] != "ACToleranceOfElement":
        raise AssertionError("121070 D block condition kinds unexpected")
    sd[1] = slv(*plan["d_sd_time"])
    sd[2] = slv(*plan["d_sd_value"])
    fa[1][1] = 12
    for n in body:
        if cmd(n)[1] != 0:
            raise AssertionError("121070 D block subject expected 0")
        cmd(n)[1] = 12
    # E1 施技加连击（sing_android_2halfanv）
    add = copy.deepcopy(_find_root(sa[11][1], "AddCombo"))
    cmd(add)[1] = slv(*plan["addcombo"])
    # E2 水共鸣 flag 分支内 ACComboBoost 挂球（psychic_projection_smr23_2）
    gate = _find_root(pp[11][1], "FindAllSubjects", lambda c: c[2] == 34)
    boost_fa = copy.deepcopy(gate[1][9][1][0])
    if not (cmd(boost_fa)[0] == "FindAllSubjects" and cmd(boost_fa)[2] == 97):
        raise AssertionError("smr23 E2 selector shape unexpected")
    boost_fa[1][1] = 13
    cc = cmd(boost_fa[1][9][1][0])
    if not (cc[0] == "CreateCondition" and cc[1] == 6 and cc[10] == 2 and cc[2][0][0] == "ACComboBoost"):
        raise AssertionError("smr23 E2 CreateCondition shape unexpected")
    cc[1] = 13
    cc[2][0][1] = slv(COMBOBOOST["flips"], COMBOBOOST["flips"])   # ballFlipLimit
    cc[2][0][2] = slv(COMBOBOOST["combo"], COMBOBOOST["combo"])   # 每次弹射回填连击
    flag = ["Command", ["ConditionalsChangeSkillFlag", 1, ["Block", [boost_fa]], ["Block", []]]]
    root = [fx_all, fx_bar, near] + tiers + [fa, add, flag]
    return copy.deepcopy(ny[:11]) + [["Block", root]]


# ---------------------------------------------------------------- DSL 静态门禁

def _kindof(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "str"
    if isinstance(v, dict):
        return "DICT"
    if isinstance(v, list):
        if not v:
            return "list"
        if isinstance(v[0], dict):
            return "slv"
        if isinstance(v[0], str):
            return "enum:" + v[0]
        return "list"
    return type(v).__name__


def signature_set(tree, acc=None):
    """(构造名, 参数位) -> {kind}；含 CreateCondition 内 AC 条目（F1034 签名差分口径）。"""
    acc = defaultdict(set) if acc is None else acc
    for c in walk_cmds(tree):
        for i, p in enumerate(c[1:]):
            acc[(c[0], i)].add(_kindof(p))
        if c[0] == "CreateCondition" and len(c) > 2 and isinstance(c[2], list):
            for ac in c[2]:
                if isinstance(ac, list) and ac and isinstance(ac[0], str):
                    for i, p in enumerate(ac[1:]):
                        acc[(ac[0], i)].add(_kindof(p))
    return acc


def signature_diff(tree, official: dict) -> list[str]:
    mine = signature_set(tree)
    out = []
    for (name, idx), kinds in sorted(mine.items()):
        extra = kinds - set(official.get(f"{name}#{idx}", ()))
        if extra:
            out.append(f"{name} p{idx} kinds {sorted(extra)} not seen in official skill DSL")
    return out


def arity_problems(tree) -> list[str]:
    import wf_dsl_sig
    probs = []
    for c in walk_cmds(tree):
        sig = wf_dsl_sig.COMMANDS.get(c[0]) or wf_dsl_sig.EVENTS.get(c[0])
        if sig is None:
            probs.append(f"unknown construct {c[0]}")
            continue
        if len(c) - 1 != len(sig):
            probs.append(f"{c[0]} arity {len(c) - 1} != {len(sig)}")
        for i, t in enumerate(sig):
            if i + 1 < len(c) and t == "Array" and not isinstance(c[i + 1], list):
                probs.append(f"{c[0]} p{i} expects Array, got {type(c[i + 1]).__name__}")
    return probs


# 比 wf_client_legality.action_dsl_subject_binding_problems 多查的 lookup 位
# （记忆卡 wf-dsl-subject-lookup-map：ShowEffect p2 / FindNearSubjects p0 / CreateReferencePoint p0 /
#  CreateHitArea p1 / ["GH",n]）。
_EXTRA_LOOKUPS = {"ShowEffect": (3,), "FindNearSubjects": (1,), "CreateReferencePoint": (1,),
                  "CreateHitArea": (2,)}


def scope_problems(tree) -> list[str]:
    import wf_client_legality as LEG
    consumers = {k: tuple(v) for k, v in LEG.DSL_SUBJECT_CONSUMERS.items()}
    for k, v in _EXTRA_LOOKUPS.items():
        consumers[k] = tuple(sorted(set(consumers.get(k, ())) | set(v)))
    builtin = LEG.DSL_BUILTIN_SUBJECTS
    probs: list[str] = []

    def gh_refs(value, out):
        if isinstance(value, list):
            if value and value[0] in ("Block", "Command", "Event"):
                return
            if len(value) == 2 and value[0] == "GH" and isinstance(value[1], int):
                out.append(value[1])
                return
            for x in value:
                gh_refs(x, out)

    def check(name, idx, v, bound):
        if isinstance(v, int) and not isinstance(v, bool) and v not in bound and v not in builtin:
            probs.append(f"{name}[{idx}]={v} unbound (bound={sorted(bound)})")

    def walk(node, bound: frozenset):
        if isinstance(node, list) and node and isinstance(node[0], str) and node[0] not in ("Block", "Command", "Event"):
            name = node[0]
            for idx in consumers.get(name, ()):
                if idx < len(node):
                    check(name, idx, node[idx], bound)
            refs: list[int] = []
            binders = LEG.DSL_SUBJECT_BINDERS.get(name) or ()
            handled = {blk for _, blk in binders}
            for i, p in enumerate(node[1:], 1):
                if i not in handled:
                    gh_refs(p, refs)
            for r in refs:
                check(f"{name}.GH", "coord", r, bound)
            if binders:
                for ids, blk in binders:
                    if blk < len(node):
                        walk(node[blk], bound | {node[i] for i in ids if i < len(node) and isinstance(node[i], int)})
                for i, child in enumerate(node[1:], 1):
                    if i not in handled:
                        walk(child, bound)
                return
            for child in node[1:]:
                walk(child, bound)
            return
        if isinstance(node, list):
            scope = set(bound)
            for child in node:
                walk(child, frozenset(scope))
                c = cmd(child)
                if c and c[0] in LEG.DSL_STATEMENT_BINDERS:
                    slot = LEG.DSL_STATEMENT_BINDERS[c[0]]
                    if slot < len(c) and isinstance(c[slot], int):
                        scope.add(c[slot])
        elif isinstance(node, dict):
            for child in node.values():
                walk(child, bound)

    walk(tree, frozenset())
    return probs


def donothing_branch_problems(tree) -> list[str]:
    """Conditionals* 分支写 ["DoNothing"] = 进战斗 F1009（记忆卡 wf-dsl-donothing-enum-trap）。"""
    probs = []
    for c in walk_cmds(tree):
        if c[0].startswith("Conditionals"):
            for i, p in enumerate(c[1:]):
                if isinstance(p, list) and p == ["DoNothing"]:
                    probs.append(f"{c[0]} p{i} is ['DoNothing'] (use ['Block', []])")
    return probs


def acskilldamage_gid_problems(tree) -> tuple[list[str], dict]:
    """同技能多条本地 ACSkillDamage：同时长下数值区间必须互不重合（含完全相等）。

    条件 gid = 派生/命中率/时长/层上限/内容数值/…（ConditionId_Impl_.as:23-80），时长与数值都相同
    的两条会互相覆盖而不是相加。TargetMate 送给联机参战者的条件不落在本地单位上，不参与比较。
    """
    mates = {c[1] for c in walk_cmds(tree) if c[0] == "TargetMate"}
    local: list[tuple] = []
    detail: dict[tuple, list] = {}
    for c in walk_cmds(tree):
        if c[0] == "CreateCondition" and isinstance(c[2], list) and c[2] and c[2][0][0] == "ACSkillDamage":
            t, v = c[2][0][1][0], c[2][0][2][0]
            detail.setdefault((t["min"], t["max"]), []).append((v["min"], v["max"]))
            if c[1] not in mates:
                local.append(((t["min"], t["max"]), (v["min"], v["max"]), c[1]))
    probs = []
    for i in range(len(local)):
        for j in range(i + 1, len(local)):
            (ta, (a0, a1), sa), (tb, (b0, b1), sb) = local[i], local[j]
            if ta != tb:
                continue
            if not (max(a0, a1) < min(b0, b1) or max(b0, b1) < min(a0, a1)):
                probs.append(f"ACSkillDamage subject {sa} {(a0, a1)} vs subject {sb} {(b0, b1)} overlap at duration {ta}")
    return probs, {f"{k[0]}f": sorted(set(v)) for k, v in detail.items()}


def effect_strings(tree) -> list[str]:
    return sorted({s for s in _walk_strings(tree) if s.startswith("battle/effect/")})


def _walk_strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, list):
        for x in node:
            yield from _walk_strings(x)
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _walk_strings(k)
            yield from _walk_strings(v)


def tree_gates(tree, official_signatures: dict | None) -> dict[str, Any]:
    import wf_client_legality as LEG
    import wf_dsl
    enc = wf_dsl.encode_amf3(tree)
    gid, gid_detail = acskilldamage_gid_problems(tree)
    mult = [c[6][0] for c in walk_cmds(tree) if c[0] == "CreateNormalAttack"]
    return {
        "bare_tree_root": [] if (isinstance(tree, list) and tree and tree[0] == "ActionDsl")
        else ["tree root is not a bare ActionDsl list (wrapper-shell trap)"],
        "amf3_roundtrip": [] if wf_dsl.parse_dsl(enc)["tree"] == tree else ["encode/parse roundtrip differs"],
        "signature_arity": arity_problems(tree),
        "signature_diff_vs_official": (signature_diff(tree, official_signatures)
                                       if official_signatures is not None else ["official signature set unavailable"]),
        "scope": scope_problems(tree),
        "subject_binding": LEG.action_dsl_subject_binding_problems(tree),
        "element_code": LEG.action_dsl_element_problems(tree, ELEMENT),
        "direction": wf_dsl.player_side_dsl_problems(tree),
        "hit_area_target": LEG.action_dsl_hit_area_target_problems(tree),
        "donothing_branch": donothing_branch_problems(tree),
        "acskilldamage_gid": gid,
        "_info": {"encoded_size": len(enc), "tree1_movementPriority": tree[1], "tree10_buffTargetAs": tree[10],
                  "cna_multipliers": mult, "acskilldamage_values": gid_detail},
    }


def official_signature_set(ctx, cache_path: Path | None = None) -> dict[str, list[str]]:
    """官方基线 action_skill 全部技能 DSL 的签名集（按官方表 sha256 缓存）。"""
    import wf_dsl
    raw = ctx.official_read(ACTION, "common")
    if raw is None:
        raise FileNotFoundError("official action_skill table unavailable")
    digest = hashlib.sha256(raw).hexdigest()
    if cache_path is not None and cache_path.is_file():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached.get("action_skill_sha256") == digest:
                return cached["signatures"]
        except (OSError, ValueError, KeyError):
            pass
    nested = core.load_nested_table_bytes(raw, ACTION)
    acc: defaultdict = defaultdict(set)
    count = 0
    for inner in nested.rows.values():
        for text in inner.text_rows().values():
            rows = core.read_csv_lines(text)
            if not rows or len(rows[0]) < 8 or not rows[0][7]:
                continue
            dsl_raw = ctx.official_read(wf_dsl.dsl_logical(rows[0][7]), "common")
            if dsl_raw is None:
                continue
            try:
                tree = wf_dsl.parse_dsl(zlib.decompress(dsl_raw, -15))["tree"]
            except Exception:
                continue
            signature_set(tree, acc)
            count += 1
    signatures = {f"{name}#{idx}": sorted(kinds) for (name, idx), kinds in sorted(acc.items())}
    if cache_path is not None:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"action_skill_sha256": digest, "programs": count,
                                          "signatures": signatures}, ensure_ascii=False, indent=0),
                              encoding="utf-8")
    return signatures


# ---------------------------------------------------------------- 行门禁 / 渲染

def row_gates(kind: str, row: list[str]) -> dict[str, list[str]]:
    import wf_client_legality as LEG
    return {"client_legality": LEG.client_legality_problems(kind, row),
            "declared_block_field": LEG.declared_block_field_problems(kind, row),
            "element_column": LEG.ability_element_column_problems(kind, row, ELEMENT),
            "required_capabilities": LEG.required_client_capabilities(kind, row)}


def package_row_report(ctx) -> dict[str, Any]:
    """对包内本角色全部 ability/leader 行跑合法性 + wf_describe 渲染（读包内候选表，不读内存）。"""
    import wf_describe
    out: dict[str, Any] = {"rows": [], "problems": [], "required_capabilities": []}
    tables = ((LD, "leader_ability", [CID]), (AB, "ability", [f"{CID}{s}" for s in range(1, 7)]))
    for logical, kind, keys in tables:
        flat = ctx.pkg_flat(logical)
        for key in keys:
            if key not in flat:
                out["problems"].append(f"{logical}#{key} missing in package")
                continue
            for li, row in enumerate(core.read_csv_lines(flat[key])):
                gates = row_gates(kind, row)
                entry = {"table": kind, "key": key, "line": li, "describe": wf_describe.describe_line(row, kind),
                         "cells": len(row), **{k: v for k, v in gates.items()}}
                out["rows"].append(entry)
                for gk in ("client_legality", "declared_block_field", "element_column"):
                    out["problems"].extend(f"{kind} {key}#{li} {gk}: {p}" for p in gates[gk])
                for cap in gates["required_capabilities"]:
                    if cap not in out["required_capabilities"]:
                        out["required_capabilities"].append(cap)
    cas = ctx.pkg_flat(CAS) if ctx.pack.pkg_has("common", CAS) else {}
    import wf_client_legality as LEG
    for key in sorted(k for k in cas if CODE in k):
        for cap in LEG.required_client_capabilities(LEG.CUSTOM_ABILITY_STRING_KIND, [key]):
            if cap not in out["required_capabilities"]:
                out["required_capabilities"].append(cap)
    return out


# ---------------------------------------------------------------- 特效资源解析

def resolve_effect_refs(ctx, trees: dict[str, Any]) -> dict[str, Any]:
    """DSL 里每条 battle/effect 引用：parts/timeline 与所在目录 sheet/atlas 在包内或 live 可解析；
    克隆 timeline 内嵌 SE：包内 / live 可解析，否则须有官方同 timeline 原文先例（APK 内置 SE）。"""
    import wf_assets
    pack = ctx.pack
    problems, resolved, sounds = [], [], []

    def where(logical: str) -> str | None:
        for root in ("common", "medium", "android"):
            if pack.pkg_has(root, logical):
                return f"package:{root}"
        return "live" if wf_assets.locate(ctx.store, logical) else None

    for label, tree in trees.items():
        for ref in effect_strings(tree):
            if "/.gen/" in ref:
                continue
            parts = where(f"{ref}.parts.amf3.deflate")
            timeline = where(f"{ref}.timeline.amf3.deflate")
            dir_ = ref.rsplit("/", 1)[0]
            dname = dir_.rsplit("/", 1)[-1]
            sheet, atlas = where(f"{dir_}/{dname}.png"), where(f"{dir_}/{dname}.atlas.amf3.deflate")
            entry = {"tree": label, "ref": ref, "parts": parts, "timeline": timeline, "sheet": sheet, "atlas": atlas}
            resolved.append(entry)
            if not (parts or timeline):
                problems.append(f"{label}: effect {ref} has neither parts nor timeline in package/live")
            if parts and not (sheet and atlas):
                problems.append(f"{label}: effect {ref} sheet/atlas {dir_}/{dname}.png|atlas unresolved")
    # 克隆 timeline 的 SE
    families = pack.read_evidence("effect-families.json", {}) or {}
    for dst_dir, fam in sorted(families.items()):
        for eff in fam.get("effects", []):
            logical = f"{eff['target']}.timeline.amf3.deflate"
            if not pack.pkg_has("common", logical):
                continue
            tl = ctx.amf_parse(pack.pkg_path("common", logical).read_bytes())
            for s in sorted({x for x in _walk_strings(tl) if x.startswith("sound_effect/")}):
                loc = where(s + ".mp3")
                entry = {"timeline": eff["target"], "sound": s, "resolved": loc}
                if loc is None:
                    src_raw = ctx.official_read(f"{eff['source']}.timeline.amf3.deflate", "common")
                    precedent = bool(src_raw) and s in set(_walk_strings(ctx.amf_parse(src_raw)))
                    entry["official_timeline_precedent"] = precedent
                    if not precedent:
                        problems.append(f"timeline {eff['target']} sound {s} unresolved and no official precedent")
                sounds.append(entry)
    return {"problems": problems, "refs": resolved, "sounds": sounds}


# ---------------------------------------------------------------- 染色：fx manifest 钩子 + 保守回退

def _load_fx_manifest(root: Path) -> tuple[dict[str, Path], str | None]:
    path = root / FX_MANIFEST_REL
    if not path.is_file():
        return {}, None
    data = json.loads(path.read_text(encoding="utf-8"))
    base = path.parent
    pairs: list[tuple[str, str]] = []
    if isinstance(data, dict):
        for field in ("sheets", "files", "map", "png"):
            if isinstance(data.get(field), dict):
                pairs.extend((str(k), str(v)) for k, v in data[field].items())
            elif isinstance(data.get(field), list):
                data.setdefault("_list", []).extend(data[field])
        pairs.extend((k, v) for k, v in data.items() if isinstance(v, str) and k.endswith(".png"))
        items = data.get("_list", [])
    else:
        items = data if isinstance(data, list) else []
    for item in items:
        if isinstance(item, dict):
            src = item.get("source") or item.get("src") or item.get("logical")
            png = item.get("png") or item.get("file") or item.get("path") or item.get("output")
            if src and png:
                pairs.append((str(src), str(png)))
    mapping = {}
    for src, png in pairs:
        p = Path(png)
        mapping[src] = p if p.is_absolute() else base / p
    return mapping, str(path)


def _rgb_to_hsv(rgb):
    import numpy as np
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    h = h * 60.0
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def _hsv_to_rgb(h, s, v):
    import numpy as np
    c = v * s
    hp = (h % 360) / 60.0
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(h)
    conds = [(hp < 1), (hp < 2), (hp < 3), (hp < 4), (hp < 5), (hp >= 5)]
    rgbs = [(c, x, z), (x, c, z), (z, c, x), (z, x, c), (x, z, c), (c, z, x)]
    r = np.select(conds, [t[0] for t in rgbs])
    g = np.select(conds, [t[1] for t in rgbs])
    b = np.select(conds, [t[2] for t in rgbs])
    m = v - c
    return np.stack([r + m, g + m, b + m], -1)


def _hue_band_remap(img, src_lo, src_hi, dst_lo, dst_hi, sat_mul=1.0):
    import numpy as np
    from PIL import Image
    arr = np.asarray(img.convert("RGBA")).astype(np.float64)
    rgb = arr[..., :3] / 255.0
    alpha = arr[..., 3]
    h, s, v = _rgb_to_hsv(rgb)
    band = (alpha > 0) & (s > 0.08) & (h >= src_lo) & (h <= src_hi)
    nh = np.where(band, dst_lo + (h - src_lo) / (src_hi - src_lo) * (dst_hi - dst_lo), h)
    ns = np.where(band, np.clip(s * sat_mul, 0, 1), s)
    out = np.where(band[..., None], _hsv_to_rgb(nh, ns, v), rgb)
    arr[..., :3] = np.clip(np.round(out * 255.0), 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA").copy()   # fromarray 共享内存 = 只读


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def _apply_lut_rect(img, rect, lut: dict[str, str], tol: int = 10):
    """小人贴图：按身体 LUT 近邻换色（设计 §6 / effects.clone[0].special_tiles）。"""
    px = img.load()
    x0, y0, w, h = rect
    table = [(_hex(k), _hex(v)) for k, v in lut.items()]
    changed = 0
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            best = min(table, key=lambda kv: abs(kv[0][0] - r) + abs(kv[0][1] - g) + abs(kv[0][2] - b))
            dist = max(abs(best[0][0] - r), abs(best[0][1] - g), abs(best[0][2] - b))
            if dist <= tol and best[0] != best[1]:
                px[x, y] = (*best[1], a)
                changed += 1
    return changed


def _atlas_rects(ctx, src_dir: str, needles: tuple[str, ...]) -> list[tuple[int, int, int, int]]:
    donor = src_dir.rsplit("/", 1)[-1]
    _root, raw, _src = ctx.pack.template_asset(f"{src_dir}/{donor}.atlas.amf3.deflate")
    # Starling atlas：x/y/w/h 就是图内存储矩形；r=True 只表示图块顺时针存放，宽高不用对调
    # （wf_pixelart_vfx.restore_frame 同口径；对调会越出 sheet 边界）
    return [(int(item["x"]), int(item["y"]), int(item["w"]), int(item["h"]))
            for item in ctx.amf_parse(raw)
            if isinstance(item, dict) and any(n in str(item.get("n", "")) for n in needles)]


def make_png_transform(ctx, family: dict, fx_map: dict[str, Path], log: list[dict], body_lut: dict[str, str]):
    """优先 fx manifest 替换 sheet（尺寸必须一致）；否则保守回退染色。"""
    src_dir = family["src_dir"]
    donor = src_dir.rsplit("/", 1)[-1]
    sheet_logical = f"{src_dir}/{donor}.png"
    dst_dir = f"battle/effect/skill_unique/{CODE}_{family['subdir']}"
    dst_logical = f"{dst_dir}/{CODE}_{family['subdir']}.png"
    replacement = fx_map.get(sheet_logical) or fx_map.get(dst_logical)

    def transform(img):
        if replacement is not None:
            raw = Path(replacement).read_bytes()
            new = ctx.png_open(raw).convert("RGBA")
            if new.size != img.size:
                raise ValueError(f"fx manifest sheet {replacement} size {new.size} != source {img.size}")
            import numpy as np
            a0, a1 = np.asarray(img.convert("RGBA"))[..., 3], np.asarray(new)[..., 3]
            log.append({"sheet": sheet_logical, "dst_sheet": dst_logical, "mode": "fx-manifest",
                        "file": str(replacement), "sha256": hashlib.sha256(raw).hexdigest(),
                        "alpha_identical": bool((a0 == a1).all()),
                        "alpha_zero_preserved": bool(((a0 == 0) == (a1 == 0)).all())})
            return new
        if family["subdir"] == "wave":
            # 小人贴图只走身体 LUT（先从原图取块换色，色相映射后贴回，避免被水色映射先染偏）
            base = img.convert("RGBA").copy()
            tiles, changed = [], 0
            for rect in _atlas_rects(ctx, src_dir, ("_character_back/a", "_character_front/a")):
                changed += _apply_lut_rect(base, rect, body_lut)
                x, y, w, h = rect
                tiles.append(((x, y), base.crop((x, y, x + w, y + h))))
            out = _hue_band_remap(img, 150.0, 192.0, 196.0, 212.0, sat_mul=0.92)
            for pos, tile in tiles:
                out.paste(tile, pos)
            log.append({"sheet": sheet_logical, "dst_sheet": dst_logical, "mode": "kit-fallback",
                        "recipe": "hue 150-192 -> 196-212 (sat x0.92); character_back/front/a body LUT",
                        "lut_pixels": changed})
            return out
        out = _hue_band_remap(img, 170.0, 215.0, 196.0, 210.0, sat_mul=1.05)
        log.append({"sheet": sheet_logical, "dst_sheet": dst_logical, "mode": "kit-fallback",
                    "recipe": "hue 170-215 -> 196-210 (sat x1.05)"})
        return out

    return transform


def fx_recolor_problems(ctx, fx_map: dict[str, Path], fx_manifest: str | None,
                        recolor_log: list[dict]) -> list[str]:
    """fx manifest 存在时：两族 sheet 都必须由它替换（不许与回退染色混用）、alpha==0 位置不变、
    包内落盘 sheet 与染色 PNG 逐像素相同（包内是 WF 小写魔数的存储态，解码后比较）。"""
    if fx_manifest is None:
        return []
    import numpy as np
    problems = []
    for entry in recolor_log:
        if entry["mode"] != "fx-manifest":
            problems.append(f"fx manifest present but {entry['sheet']} used {entry['mode']}")
            continue
        if not entry["alpha_zero_preserved"]:
            problems.append(f"fx sheet {entry['file']} changes alpha==0 coverage of {entry['sheet']}")
        want = np.asarray(ctx.png_open(Path(entry["file"]).read_bytes()).convert("RGBA"))
        got = np.asarray(ctx.png_open(ctx.pack.pkg_path("common", entry["dst_sheet"]).read_bytes()).convert("RGBA"))
        if want.shape != got.shape or not bool((want == got).all()):
            problems.append(f"package sheet {entry['dst_sheet']} pixels != fx manifest PNG {entry['file']}")
    if len(recolor_log) != 2:
        problems.append(f"expected 2 recolored sheets, got {len(recolor_log)}")
    return problems


# ---------------------------------------------------------------- PNG 存储态魔数：包级门禁 + Integrate 装像素 sheet

WF_PNG_MAGIC = wf_assets.PNG_FAKE             # 包 / store / CDN 存储态 b"\x89png\r\n\x1a\n"
STD_PNG_MAGIC = wf_assets.PNG_REAL            # 标准 PNG b"\x89PNG\r\n\x1a\n"（PIL/像素工具产物）
PACKAGE_PNG_ROOTS = ("common", "medium", "android")   # = wf_character_pack.CLIENT_ROOTS
PIXEL_DIR = f"character/{CODE}/pixelart"
PIXEL_SHEET_NAMES = ("sprite_sheet", "special_sprite_sheet")
PIXEL_OUT_REL = f"{BATCH}/pixel/{KEY}/out"


def package_png_storage_problems(package_dir: Path) -> tuple[list[str], int]:
    """包内三个客户端根下每个 .png 的前 8 字节都必须是 WF 存储态魔数。

    flow preflight（``wf_character_pack.validate_manifest``，production + require_referenced_assets）
    只在 manifest 重建后才拒标准魔数；本门禁在 kit / run_gates 阶段就报，且覆盖尚未进 manifest 的文件。
    返回 (problems, 检查的 PNG 数)。"""
    problems, count = [], 0
    for root in PACKAGE_PNG_ROOTS:
        base = Path(package_dir) / "roots" / root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix.lower() != ".png":
                continue
            count += 1
            with path.open("rb") as fh:
                head = fh.read(len(WF_PNG_MAGIC))
            if head != WF_PNG_MAGIC:
                kind = "standard PNG magic" if head == STD_PNG_MAGIC else f"magic {head!r}"
                problems.append(f"{root}:{path.relative_to(base).as_posix()} has {kind}; package PNGs must be "
                                "WF storage form (wf_assets.png_encode)")
    return problems, count


def _png_rgba(raw: bytes):
    import io
    from PIL import Image
    return Image.open(io.BytesIO(wf_assets.png_decode(raw))).convert("RGBA")


def pixel_sheet_store_bytes(raw: bytes, native_raw: bytes,
                            atlas_rects: Iterable[tuple[int, int, int, int]] = ()) -> tuple[bytes, dict[str, Any]]:
    """像素产物 PNG → 包内存储态字节。只换前 8 字节魔数，不重编码像素数据；同时做装包前核对：

    - 输入是标准 PNG（``png_encode``）或已是存储态（原样）；其他魔数报错；
    - 尺寸 == 包内现有 sheet（atlas 坐标绑定这个尺寸），atlas 每个矩形都落在图内；
    - 存在 alpha==0 像素（图集 alpha 硬门禁）；
    - 输出前 8 字节 == WF 存储魔数，解码后与输入逐像素相同。"""
    import numpy as np
    head = raw[:len(STD_PNG_MAGIC)]
    if head == STD_PNG_MAGIC:
        out, magic_in = wf_assets.png_encode(raw), "standard"
    elif head == WF_PNG_MAGIC:
        out, magic_in = raw, "wf-storage"
    else:
        raise ValueError(f"pixel sheet is not a PNG (magic {head!r})")
    img, native = _png_rgba(raw), _png_rgba(native_raw)
    if img.size != native.size:
        raise ValueError(f"pixel sheet size {img.size} != package sheet {native.size} (atlas is bound to it)")
    rects = list(atlas_rects)
    outside = [r for r in rects if r[0] < 0 or r[1] < 0 or r[0] + r[2] > img.width or r[1] + r[3] > img.height]
    if outside:
        raise ValueError(f"{len(outside)} atlas rects fall outside {img.size}: {outside[:3]}")
    src = np.asarray(img)
    alpha0 = int((src[..., 3] == 0).sum())
    if alpha0 == 0:
        raise ValueError("pixel sheet has no alpha==0 pixels (opaque background)")
    if out[:len(WF_PNG_MAGIC)] != WF_PNG_MAGIC:
        raise AssertionError("store bytes lack WF storage magic")
    got = np.asarray(_png_rgba(out))
    if got.shape != src.shape or not bool((got == src).all()):
        raise AssertionError("store bytes decode to different pixels")
    return out, {"magic_in": magic_in, "size": list(img.size), "alpha0_pixels": alpha0, "atlas_rects": len(rects),
                 "sha256_in": hashlib.sha256(raw).hexdigest(), "sha256_out": hashlib.sha256(out).hexdigest()}


def pixel_atlas_rects(ctx, name: str) -> list[tuple[int, int, int, int]]:
    raw = ctx.pack.pkg_path("common", f"{PIXEL_DIR}/{name}.atlas.amf3.deflate").read_bytes()
    return [(int(i["x"]), int(i["y"]), int(i["w"]), int(i["h"])) for i in ctx.amf_parse(raw) if isinstance(i, dict)]


def install_pixel_sheets(ctx, src_dir: Path | None = None, *, write: bool = True) -> list[dict[str, Any]]:
    """Integrate 阶段装像素小人 2 张 sheet（kit ``build`` 不调用，像素仍在修复轮）。

    用法::

        import wf_seasonal7_build as B, wf_seasonal7_common as C, wf_seasonal7_specs as S
        K.install_pixel_sheets(B.KitContext(C.S7Pack(S.get_spec("yuki"))))

    两张先全部核对（``pixel_sheet_store_bytes``）再写，不会只装一半；写入走 ``write_asset(owner="pixel")``
    （同时登记 sha），回读确认存储魔数。atlas / frame / timeline 元数据不动。
    装完重跑 ``--step manifest,status,inspect`` 与 impl/yuki/run_gates.py。``write=False`` 只核对不落盘。"""
    src = Path(src_dir) if src_dir is not None else ctx.root / PIXEL_OUT_REL
    staged: list[tuple[str, bytes, dict[str, Any]]] = []
    for name in PIXEL_SHEET_NAMES:
        logical = f"{PIXEL_DIR}/{name}.png"
        source = src / f"{name}.png"
        data, info = pixel_sheet_store_bytes(source.read_bytes(), ctx.pack.pkg_path("common", logical).read_bytes(),
                                             pixel_atlas_rects(ctx, name))
        staged.append((logical, data, {"logical": logical, "source": str(source), **info}))
    log = []
    for logical, data, entry in staged:
        if write:
            ctx.write_asset("common", logical, data, owner="pixel")
            back = ctx.pack.pkg_path("common", logical).read_bytes()
            if back != data or back[:len(WF_PNG_MAGIC)] != WF_PNG_MAGIC:
                raise AssertionError(f"pixel sheet readback mismatch: {logical}")
            entry["written"] = True
        log.append(entry)
    return log


def template_provenance_problems(ctx) -> list[str]:
    """技能树母本必须来自官方基线（template_dsl 缺官方件时会静默回落 live，框架 §8.8）。"""
    sources = ctx.pack.read_evidence("template_sources.json", {}) or {}
    problems = []
    for program in (f"{RARE5}/psychic_yuki_ny23$psychic_yuki_ny23_1", f"{RARE5}/psychic_yuki_ny23$psychic_yuki_ny23_2",
                    f"{RARE5}/psychic_yuki$psychic_yuki_1", f"{RARE5}/psychic_yuki$psychic_yuki_2",
                    f"{RARE5}/psychic_projection_smr23$psychic_projection_smr23_2",
                    f"{RARE5}/sing_android_2halfanv$sing_android_2halfanv_1",
                    f"{RARE5}/sing_android_2halfanv$sing_android_2halfanv_2"):
        src = (sources.get(f"{program}.action.dsl.amf3.deflate") or {}).get("source")
        if src != "official":
            problems.append(f"template DSL {program} source={src!r} (must be official baseline)")
    return problems


# ================================================================ build

def _design(ctx) -> dict | None:
    path = ctx.root / DESIGN_REL
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def _build_rows(ctx, design: dict | None, notes: list) -> tuple[list[list[str]], dict[str, list[list[str]]]]:
    live = {AB: ctx.live_flat(AB), LD: ctx.live_flat(LD)}
    official = {AB: ctx.official_flat(AB), LD: ctx.official_flat(LD)}

    def build(recipe, table, design_rows):
        out = []
        for i, (src, key, idx, edits, sha) in enumerate(recipe):
            rows = core.read_csv_lines((live if src == "store" else official)[table][key])
            row = list(rows[idx])
            for col, value in edits.items():
                row[col] = value
            if row_sha(row) == sha:
                out.append(row)
                continue
            fallback = design_rows[i]["row"] if design_rows and i < len(design_rows) else None
            if fallback is not None and row_sha(fallback) == sha:
                notes.append(f"donor drift {src}:{key}#{idx}; used locked design row (sha {sha[:12]})")
                out.append(list(fallback))
                continue
            raise AssertionError(f"row recipe {table} {src}:{key}#{idx} no longer matches locked sha {sha[:12]}")
        return out

    leader = build(LEADER_RECIPE, LD, (design or {}).get("leader"))
    abilities = {f"{CID}{slot}": build(recipe, AB, (design or {}).get("abilities", {}).get(f"slot{slot}"))
                 for slot, recipe in ABILITY_RECIPE.items()}
    return leader, abilities


def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.cid_s, spec.code, spec.template_code) != (CID, CODE, TEMPLATE_CODE):
        raise AssertionError(f"kit bound to {CID}/{CODE}, spec is {spec.cid_s}/{spec.code}")
    notes: list[str] = []
    design = _design(ctx)
    if design is not None and design.get("status") != "final":
        raise AssertionError(f"design status {design.get('status')!r} != final")

    # ---- 1 词条 / 队长
    leader, abilities = _build_rows(ctx, design, notes)
    ctx.write_flat(LD, {CID: leader})
    ctx.write_flat(AB, abilities)

    # ---- 2 custom_ability_string（536 行 c70 键；主表必须有）
    ctx.write_flat(CAS, {CHANGE_SKILL_KEY: [[CHANGE_SKILL_TEXT]]})
    if design is not None:
        want = {e["key"]: e["text"] for e in design.get("custom_strings", [])}
        if want != {CHANGE_SKILL_KEY: CHANGE_SKILL_TEXT}:
            raise AssertionError(f"custom string plan differs from design: {want}")
    # 框架自动克隆但无人引用的 change_skill/desc_override 键（勇希母本无，按通用规则撤）
    referenced = {cell for key in abilities for row in abilities[key] for cell in row}
    for claim in ctx.pack.load_claims():
        if claim["logical_path"] == CAS and claim["root"] == "common":
            stale = [k for k in claim["outer_keys"] if k != CHANGE_SKILL_KEY and k not in referenced]
            if stale:
                ctx.unclaim(CAS, stale)
                notes.append(f"unclaimed unused custom_ability_string keys {stale}")

    # ---- 3 action_skill 两档
    current = ctx.pkg_nested(CODE)
    if set(current) != {"1", "2"}:
        raise AssertionError(f"package action_skill {CODE} levels {sorted(current)}")
    template_nested = core.load_nested_table_bytes(ctx.pack.template_table_bytes(ACTION), ACTION)
    template_inner = {k: core.read_csv_lines(v)[0]
                      for k, v in template_nested.rows[TEMPLATE_CODE].text_rows().items()}
    action_rows = {}
    for level, name, desc in (("1", SKILL_NAME_1, SKILL_DESC_1), ("2", SKILL_NAME_2, SKILL_DESC_2)):
        cells = list(template_inner[level])
        if len(cells) != 24:
            raise AssertionError(f"template action_skill row width {len(cells)} != 24")
        cells[0], cells[1], cells[2], cells[3] = name, desc, SKILL_ICON, "true"
        cells[4:7] = list(ENERGY[level])
        cells[7] = ctx.program_path(level)
        cells[8:11] = list(AUTO_CAST)
        action_rows[level] = cells
        if design is not None:
            plan = design["skills"]["action_skill_rows"][level]
            for col, key in ((0, "c0"), (1, "c1"), (2, "c2"), (3, "c3"), (7, "c7")):
                if cells[col] != plan[key]:
                    raise AssertionError(f"action_skill {level} c{col} differs from design")
            if cells[8:11] != plan["c8_c10"]:
                raise AssertionError(f"action_skill {level} c8-c10 differs from design")
            energy = design["skills"]["energy"][level]
            if cells[4:7] != [str(energy["c4"]), str(energy["c5"]), str(energy["c6"])]:
                raise AssertionError(f"action_skill {level} energy differs from design")
    ctx.write_nested(ACTION, CODE, {lv: [cells] for lv, cells in action_rows.items()}, replace_inner=True)

    # ---- 4 switched_action_skill（语音 kind 3 路由）= action_skill c7–c23
    switched = {lv: cells[7:24] for lv, cells in action_rows.items()}
    ctx.write_nested(SWITCHED, VOICE_READY_KEY, {lv: [cells] for lv, cells in switched.items()},
                     replace_inner=True)

    # ---- 5 character / character_text / 三层镜像
    crow = ctx.pack.pkg_character_row()
    expected_fixed = {0: CODE, 2: "5", 3: str(ELEMENT), 6: "4", 8: CODE, 17: CID, 26: "Supporter", 27: CID,
                      36: "6,6,6,6,6,6"}
    for col, value in expected_fixed.items():
        if crow[col] != value:
            raise AssertionError(f"character c{col}={crow[col]!r} expected {value!r}")
    crow = list(crow)
    crow[9:17] = VOICE_ROUTE
    crow[18] = TEXTS["leader"]
    crow[19:25] = [f"{CID}{s}" for s in range(1, 7)]
    if design is not None:
        edits = design["identity"]["character_row_edits_vs_121147"]
        if crow[9:17] != edits["9..16"] or crow[18] != edits["18"] or crow[19:25] != edits["19..24"]:
            raise AssertionError("character row edits differ from design")
        if design["voice"]["route"]["character_c9_c16"] != VOICE_ROUTE:
            raise AssertionError("voice route differs from design")
    ctx.write_flat(CHAR, {CID: [crow]})
    trow = [TEXTS["name"], TEXTS["furigana"], TEXTS["profile"], TEXTS["title"],
            SKILL_NAME_1, SKILL_DESC_1, SKILL_NAME_2, SKILL_DESC_2, "(None)", "(None)", TEXTS["leader"], TEXTS["cv"]]
    if design is not None and design["text"]["character_text_row"] != trow:
        raise AssertionError("character_text row differs from design")
    ctx.write_flat(TEXT, {CID: [trow]})
    mirrors = ctx.sync_character_mirrors()

    # ---- 6 特效族克隆（sibling）+ 染色
    fx_map, fx_manifest = _load_fx_manifest(ctx.root)
    body_lut = (design or {}).get("pixel_palette", {}).get("body_lut") or {}
    recolor_log: list[dict] = []
    families = {}
    for fam in (FX_WAVE, FX_BARRIER):
        families[fam["subdir"]] = ctx.clone_effect_family(
            fam["src_dir"], fam["subdir"], fx_names=fam["fx_names"], layout="sibling",
            png_transform=make_png_transform(ctx, fam, fx_map, recolor_log, body_lut))
        missing = families[fam["subdir"]]["missing_effects"]
        if missing:
            raise AssertionError(f"effect family {fam['src_dir']} missing {missing}")

    # ---- 7 两棵技能树
    official_sig_cache = ctx.root / BATCH / "impl" / KEY / "official_dsl_signatures.json"
    try:
        official_signatures = official_signature_set(ctx, official_sig_cache)
    except Exception as exc:                          # 基线不可用时门禁判失败，不静默通过
        official_signatures = None
        notes.append(f"official signature set unavailable: {type(exc).__name__}: {exc}")
    trees, tree_reports = {}, {}
    for level in ("1", "2"):
        tree = compose_tree(ctx.template_dsl, level)
        rewrites = {}
        for sub, fam in families.items():
            tree, info = ctx.rewrite_effect_refs(tree, fam, strict=True)
            rewrites[sub] = info
        if design is not None:
            want = design["skills"][f"tree_plan_{level}"]["composed_tree"]
            if tree != want:
                raise AssertionError(f"composed tree {level} differs from design composed_tree")
        ctx.write_dsl(ctx.program_path(level), tree)
        logical = f"{ctx.program_path(level)}.action.dsl.amf3.deflate"
        back = ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes())
        report = tree_gates(tree, official_signatures)
        report["package_readback_equal"] = [] if back == tree else ["package DSL bytes do not parse back to tree"]
        lo, hi = EXPECTED_MULT[level]
        mults = report["_info"]["cna_multipliers"]
        if sum(m["min"] for m in mults) != lo or sum(m["max"] for m in mults) != hi:
            report["multiplier_plan"] = [f"CNA multiplier sum {mults} != {lo}/{hi}"]
        else:
            report["multiplier_plan"] = []
        report["_info"]["effect_rewrites"] = rewrites
        trees[f"skill_{level}"] = tree
        tree_reports[f"skill_{level}"] = report

    # ---- 8 门禁
    rows_report = package_row_report(ctx)
    effects = resolve_effect_refs(ctx, trees)
    recolor_problems = fx_recolor_problems(ctx, fx_map, fx_manifest, recolor_log)
    provenance_problems = template_provenance_problems(ctx)
    png_storage_problems, png_checked = package_png_storage_problems(ctx.pack.package)
    gate_failures = (list(rows_report["problems"]) + list(effects["problems"])
                     + recolor_problems + provenance_problems + png_storage_problems)
    for label, rep in tree_reports.items():
        for gk, value in rep.items():
            if not gk.startswith("_") and value:
                gate_failures.extend(f"{label} {gk}: {p}" for p in value)
    if rows_report["required_capabilities"]:
        gate_failures.append(f"rows need client capabilities {rows_report['required_capabilities']} "
                             "but design declares none")
    if rows_report["required_capabilities"] != list(spec.required_capabilities):
        gate_failures.append(f"spec.required_capabilities {list(spec.required_capabilities)} != rows "
                             f"{rows_report['required_capabilities']}")
    if sum(len(v) for v in abilities.values()) != 13 or len(leader) != 6:
        gate_failures.append("record counts differ from design (leader 6 / abilities 13)")
    fx_manifest_sha = (hashlib.sha256(Path(fx_manifest).read_bytes()).hexdigest() if fx_manifest else None)
    gates = {"kit_static": {"passed": not gate_failures, "failures": gate_failures},
             "rows": rows_report, "trees": tree_reports, "effects": effects,
             "recolor": recolor_log, "recolor_problems": recolor_problems,
             "template_provenance_problems": provenance_problems,
             "png_storage_signature": {"checked": png_checked, "problems": png_storage_problems},
             "fx_manifest": fx_manifest, "fx_manifest_sha256": fx_manifest_sha}
    ctx.evidence_write("kit-gates.json", gates)
    ctx.evidence_write("kit-rows-describe.json",
                       [{k: r[k] for k in ("table", "key", "line", "describe")} for r in rows_report["rows"]])

    programs = sorted(f"{ctx.program_path(lv)}.action.dsl.amf3.deflate" for lv in ("1", "2"))
    status = "ready-for-review" if not gate_failures else "draft"
    ctx.report({
        "summary": ("见岛勇希·泳装 129991 kit：队长 6 行 + 词条 13 条、结界弹+纵向冲击技能两档（24×/34×，连击增伤）、"
                    "水共鸣 ChangeSkillFlag 连击加成分支与语音路由、两个冰蓝特效族克隆"),
        "status": status,
        "skills": {"programs": programs},
        "unique_condition": {},
        "required_capabilities": rows_report["required_capabilities"],
        "panel": [f"{r['table']} {r['key']}#{r['line']}: {r['describe']}" for r in rows_report["rows"]],
        "notes": notes + [
            "PF 覆盖/422/724/desc_override/unique_condition：设计不使用",
            ("custom_ability_power_up_string：不写。CustomAbilityPowerUpStringTools.resolveDescriptionPowerLevel "
             "缺键返回 1，AbilityDescriptionStringfier_Impl_.addChangeSkillAbilityPower 在等级≤1 时不读 power_up 表；"
             "536 面板正文只取主表（AbilityDescriptionGenerator.as:8531）。在线 536 先例 1299923/1699891/1499891/1499901 同样只写主表（1199891 另有 power_up 键）"),
            f"特效染色：{'fx manifest ' + fx_manifest if fx_manifest else 'kit 保守回退染色（待 Effects 阶段 fx/yuki/out/manifest.json 覆盖）'}",
            ("像素小人 sheet 与语音不在 kit 范围（Integrate 阶段装包）。像素 sheet 用 install_pixel_sheets(ctx) 装："
             "标准魔数转 WF 存储魔数、尺寸/atlas/alpha 核对、登记 owner=pixel；包内 PNG 存储魔数由 kit 门禁 "
             "png_storage_signature 复核（flow preflight 另有 validate_manifest 同口径拦截）"),
            "见 evidence/kit-gates.json；包级 master_reference 以 --step inspect 为准",
        ],
        "gate_failures": gate_failures,
    })
    return {"status": status, "gate_failures": gate_failures[:20], "notes": notes,
            "rows": {"leader": len(leader), "abilities": sum(len(v) for v in abilities.values())},
            "programs": programs, "effect_families": {k: v["dst_dir"] for k, v in families.items()},
            "recolor": recolor_log, "mirror_character_c9_16": mirrors["character"][9:17]}
