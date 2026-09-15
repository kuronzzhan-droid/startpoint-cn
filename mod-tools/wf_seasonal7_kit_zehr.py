# -*- coding: utf-8 -*-
"""季节换装七角色 kit：泽赫尔·灯火酒馆 159997 ``guildknight_leader_tavern``（设计定稿 design/zehr.json）。

由 ``python mod-tools/wf_seasonal7_build.py --char zehr --step kit`` 调用 :func:`build`。
只写 ``work/character_packs/s7-zehr/``（经 KitContext）；live store / assets / .cdn / src / APK 只读。

落地内容（以设计 JSON 为准，逐项断言；主控拍板的覆盖见 ``OVERRIDES``）：
- character 行 c9–c16 语音路由（ConditionExist + Unique 159997）、c18 队长名；character_text 12 列；三层镜像；
- 队长 6 行、词条 6 键 14 条：donor（官方基线 / live）+ 声明编辑重建，与设计 ``row`` 逐格核对；
- unique_condition 159997「灯火正旺」+ 48×48 官方风固有图标（kit 绘制，WF 小写魔数）；
- custom_ability_string 4 键 + custom_ability_power_up_string 1 键（官方原行字节）；
- action_skill 两档（名称/描述/能量 c4–c6/DSL 路径）；两棵技能 DSL（官方 151069 骨架 + 助战技 5 发光弹 +
  浮游/全队 PF 伤害，移植 design/_tmp/zehr/c8_final_build.py），与设计定稿树逐节点严格比对；
- 722 双形态 PF：power_flip_action 新键 + 三档 DSL（APK 内官方 knight/supporter 经
  ``wf_gerald_native_pf_dsl.compose`` 组合），**每段倍率恢复官方 3.25/4.75/6.3**，寿命/命中/Notify ×3，
  suppress 保持官方；在 spin 之外叠一层新演出（官方火光族 ``master_knight_blaze`` 克隆到
  ``skill_unique/<code>/pf_blaze/``，染暖金暗红，timeline sounds 清空；与 Effects 阶段推荐族一致）；
  满命中预算（剑士段恰为官方 3 倍，Lv3 含辅助全屏合计约 2.77 倍；削韧约 1.5 倍、Fever 持平）写入报告；
  程序路径用 ``override/<code>_pf$<code>_pf_lvN``（设计长路径在框架 inspect 副本里超 MAX_PATH），键不变；
- 4 个特效族克隆（layout=codename）+ kit 默认染色；若 ``seasonal7-20260916/fx/zehr/out/manifest.json`` 存在，
  按其 {源 sheet 逻辑路径 → 染色 PNG} 替换对应 sheet；
- switched_action_skill ``guildknight_leader_tavern_voice_ready`` 两档（= action_skill c7–c23，
  与 ``wf_seasonal7_voice.switched_rows`` 同约定）。
- 像素小人（Integrate）：``seasonal7-20260916/pixel/zehr/out/{sprite_sheet,special_sprite_sheet}.png``
  在 report 门禁全过、``pixel/_review/verify_all.json`` 复核全过且 sha 一致时，以存储态写入
  ``character/<code>/pixelart/``（owner=pixel），写后核对尺寸/alpha = 母本、元数据 = 母本（仅路径前缀）；
  未就绪时 pending、保持母本原色。语音由 ``wf_seasonal7_voice pack`` + ``impl/zehr/voice_merge.py`` 装包，
  kit 只读 ``voice_state``；像素 / 语音字节计入 kit 指纹（换了必须重跑门禁）。

kit-report 的 ``status``：只有 ``impl/zehr/gates.json`` 全过且其 ``kit_fingerprint`` 与本次产物指纹一致时
才写 ``ready-for-review``，否则 ``draft``（门禁脚本 ``impl/zehr/gates.py``）。

未跟踪输入（``work/`` 被 gitignore；build 开头由 :func:`required_input_problems` 统一核对并报清单）：
``design/zehr.json``、``design/_tmp/zehr/final_skill_{1,2}.json``、``final_pf_lv{1,2,3}.json``、
官方 DSL 参数形状表 ``official_sig.json``（``impl/zehr/`` 自有副本优先，``research/_tmp/`` 原件回退，均按 sha 锁定）。
DSL 静态校验 ``blueprint_check_with_sig`` 移植自 ``research/_tmp/blueprint_build.py``，运行时不再 import 研究目录。
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import sys
import zipfile
import zlib
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

KEY = "zehr"
CID = "159997"
CODE = "guildknight_leader_tavern"
TEMPLATE_CODE = "guildknight_leader"
ELEMENT = 4
BATCH = "work/character_packs/seasonal7-20260916"
DESIGN_REL = f"{BATCH}/design/zehr.json"
DESIGN_TMP_REL = f"{BATCH}/design/_tmp/zehr"
FX_MANIFEST_REL = f"{BATCH}/fx/zehr/out/manifest.json"
GATES_REL = f"{BATCH}/impl/zehr/gates.json"
# 官方全库 DSL 参数形状表（research/_tmp/official_sig.py 生成，751 条）。kit 自有副本放 impl/zehr/，
# 研究目录原件只作回退；两处都按 sha 锁定，缺失/漂移时报清单而不是在深处 ImportError。
OFFICIAL_SIG_PIN = "2383feedc25dde84a19fc19ac2c89a0847768098bd261277ccaced73bdc094c5"
OFFICIAL_SIG_CANDIDATES = (f"{BATCH}/impl/zehr/official_sig.json", f"{BATCH}/research/_tmp/official_sig.json")
DESIGN_BLUEPRINT_REL = f"{BATCH}/research/_tmp/blueprint_build.py"      # 只供单测做移植等价核对，运行时不 import

CHAR = "master/character/character.orderedmap"
TEXT = "master/character/character_text.orderedmap"
ABILITY = "master/ability/ability.orderedmap"
LEADER = "master/ability/leader_ability.orderedmap"
CAS = "master/string/custom_ability_string.orderedmap"
CAPS = "master/string/custom_ability_power_up_string.orderedmap"
UC = "master/character/unique_condition.orderedmap"
PFA = "master/skill/power_flip_action.orderedmap"
ACTION = "master/skill/action_skill.orderedmap"
SW = "master/skill/switched_action_skill.orderedmap"

VOICE_KEY = f"{CODE}_voice_ready"
PF_KEY = f"override_{CODE}_dual_pf"
PF_STRING_KEY = f"override_string_{CODE}_dual_pf"
CHANGE_SKILL_KEY = f"change_skill_{CODE}"
LEADER_OVERRIDE_KEY = f"desc_override_{CODE}"
SLOT3_OVERRIDE_KEY = f"desc_override_{CODE}_3"
CAS_KEYS = (PF_STRING_KEY, CHANGE_SKILL_KEY, LEADER_OVERRIDE_KEY, SLOT3_OVERRIDE_KEY)
UC_ID = "159997"
UC_ICON = f"battle/common/unique_condition/unique_{CODE}_lamp.png"
CAPABILITIES = ("dash-parameter-v1", "panel-description-override-v2")
FORBIDDEN_PANEL_WORDS = ("自身为队长时", "觉醒后", "生命值100%以下", "HP100%以下", "null")

# 722 PF 程序路径与 power_flip_action 键解耦（live 先例：键 wind_spgirl_campus_fever → campus_celtie_fever/…）。
# 设计路径 override/<键>$<键>_lvN 在框架 inspect 副本（_inspect/zehr-<pid>/s7-zehr/…）里全长 263–265 字符，
# 超过 Windows MAX_PATH，copytree 失败；程序名改用 <code>_pf（与 149990 white_tiger_summer_pf 同形），
# 键 / 文案键 / 队长行 c80 仍按设计。
PF_PROGRAM_DIR = "battle/action/power_flip/action/override"
PF_PROGRAM_NAME = f"{CODE}_pf"
DESIGN_PF_PROGRAM = PF_PROGRAM_DIR + "/{key}${key}_lv{level}"
WIN_MAX_PATH = 259                      # MAX_PATH 260 含结尾 NUL
INSPECT_PID_DIGITS = 7                  # 框架副本目录 <key>-<pid>：按 7 位 PID 留余量


def pf_program(level: int | str) -> str:
    return f"{PF_PROGRAM_DIR}/{PF_PROGRAM_NAME}${PF_PROGRAM_NAME}_lv{level}"


def design_pf_program(level: int | str) -> str:
    return DESIGN_PF_PROGRAM.format(key=PF_KEY, level=level)
SKILL_SOURCES = {
    "guildknight_leader_1": ("battle/action/skill/action/rare5/guildknight_leader$guildknight_leader_1",
                             "32b61cfd5fec339cdf3ca07701562a49e1c03541c11ac1302601806682439ad9"),
    "guildknight_leader_2": ("battle/action/skill/action/rare5/guildknight_leader$guildknight_leader_2",
                             "268f7e6d3cb6e10d5bebd3d98f2d086f8acf873040d098b41514ea35536be903"),
    "assist": ("battle/action/skill/action/skill_invoker/zehheru_assist_skill_invoker",
               "d32ef7ea97e82206a32d039d285df8d7deb3666821b2d1b4fad6420aee9ec63a"),
    "spry_sailor_hw21_2": ("battle/action/skill/action/rare4/spry_sailor_hw21$spry_sailor_hw21_2",
                           "6679dd3701dab5387f2f2e9cf47feec4dffe52a7bbcb15d245d0ba6d337a9bcf"),
    "minamoto_sakura_2": ("battle/action/skill/action/rare5/minamoto_sakura$minamoto_sakura_2",
                          "1a7f32aa4a6d1a8085912fddbd3c89a813117e9a23d6307d6e3e105ac5b3f394"),
}

# ---- 主控拍板的覆盖（优先于设计文件）
PF_SEGMENT_MULTIPLIER = {1: 3.25, 2: 4.75, 3: 6.3}        # 官方 knight 三档每段倍率（设计原值 2.0/3.0/4.0）
DESIGN_PF_SEGMENT_MULTIPLIER = {1: 2.0, 2: 3.0, 3: 4.0}
TEXT_DROPPED_BY_OVERRIDE = "（每段伤害降低）"
# blaze loop 包围盒半宽 90px：scale 2.1/2.5/5.6 → 189/225/504px，约为 spin 2.8/3.2/5.6 屏上半宽 213/253/566px 的 0.9×
PF_BLAZE_SCALE = {1: 2.1, 2: 2.5, 3: 5.6}
PF_BLAZE_LABEL = "灯火炎光演出"
PF_BLAZE_BASE = "master_knight_blaze"
OVERRIDES = {
    "pf_segment_multiplier": "PF 三档每段倍率恢复官方 3.25/4.75/6.3；寿命/命中/NotifyPowerflipEnd ×3 与 suppress 70/90/110 保持设计",
    "pf_blaze_layer": "PF DSL 在 spin 之外叠一层 master_knight_blaze 火光（克隆到 skill_unique/<code>/pf_blaze，暖金暗红，sounds 清空，AB 不随球向旋转）",
    "texts": f"覆盖文案与 722 文案删去「{TEXT_DROPPED_BY_OVERRIDE}」（倍率已恢复官方）",
}

# PF 三档（设计 pf_override.compose.post_edits_per_level；倍率走 PF_SEGMENT_MULTIPLIER）
PF_LEVELS = {1: dict(life=210, hits=9, supp=70, wait=209, det=0.75, fev=2, atk_dur=150, pf_dur=90),
             2: dict(life=270, hits=12, supp=90, wait=269, det=1.0, fev=2, atk_dur=180, pf_dur=150),
             3: dict(life=330, hits=15, supp=110, wait=329, det=1.5, fev=3, atk_dur=240, pf_dur=240)}
PF_OFFICIAL = {1: dict(supp=70, life=70, hits=3, wait=69, mult=3.25, det=1.5, fev=6),
               2: dict(supp=90, life=90, hits=4, wait=89, mult=4.75, det=2, fev=6),
               3: dict(supp=110, life=110, hits=5, wait=109, mult=6.3, det=3, fev=8)}

# 技能两档（设计 tree_plan_1/2）
SKILL_LEVELS = {1: dict(pierce=(630, 630), fly=(630, 630), pfd_dur=(900, 900), pfd=(0.65, 0.65),
                        combo=(15, 15), slash=(24, 24), orb=(3.0, 3.0)),
                2: dict(pierce=(720, 810), fly=(720, 810), pfd_dur=(1200, 1200), pfd=(0.85, 1.0),
                        combo=(20, 25), slash=(30, 36), orb=(3.2, 3.8))}

# 特效族：(源目录, 目标子目录, 基名)
EFFECT_FAMILIES = (
    ("battle/effect/skill_unique/guildknight_leader", "skill",
     ("guildknight_leader_black", "guildknight_leader_dash", "guildknight_leader_slash",
      "guildknight_leader_hit", "guildknight_leader_hit_damage", "assist_skill")),
    ("battle/effect/powerflip/effect_powerflip_attack_spin", "pf_spin",
     ("powerflip_attack_spin_one", "powerflip_attack_spin_two", "powerflip_attack_spin_three")),
    ("battle/effect/powerflip/effect_powerflip_attack_support", "pf_support",
     ("powerflip_enhancing_support_one", "powerflip_enhancing_support_two", "powerflip_attack_support_three")),
    ("battle/effect/skill_unique/master_knight", "pf_blaze", (PF_BLAZE_BASE,)),
)
SILENT_TIMELINE_FAMILIES = ("pf_blaze",)

# 同键多记录的 c1/c2 不要求一致：官方 790 个多记录键虽无混写，live 1161 个多记录键里有 152 个混写
# （含已上线 1499993 杰拉德 special/attack_common/power_flip/attack_white、1699991 基诺维 c1 true/false），
# c2 只需属于 ability_statue_group 25 键（wf_client_legality 已查）。行一律按设计逐格落地，混写只记入报告。

TEXTS = {
    "name": "泽赫尔",
    "furigana": "ZEHEER",
    "title": "灯火酒馆的团长",
    "profile": "公会骑士团团长泽赫尔难得的休假之夜。卸下铠甲，只穿一件敞开的白衬衣、围上暗红领巾，提着灯走进常去的酒馆。"
               "嘴上说着今晚不谈工作，那把金蓝长剑却始终靠在手边。",
    "leader": "今晚由团长买单",
    "skill1": "白银一闪·打烊时刻",
    "desc1": "向距离最近的敌人使出白银闪击，对接触到的敌人造成光属性伤害／赋予自身攻击力提升效果／"
             "赋予己方贯穿、浮游、强化弹射伤害提升效果／增加连击数／随后5次对距离最近的敌人放出灯火光弹，造成光属性伤害",
    "skill2": "白银一闪·打烊时刻＋",
    "desc2": "向距离最近的敌人使出白银闪击，对接触到的敌人造成光属性伤害／赋予自身攻击力提升效果／"
             "赋予己方贯穿、浮游、强化弹射伤害提升效果／增加连击数／随后5次对距离最近的敌人放出灯火光弹，造成光属性伤害",
    "cv": "AI 合成配音",
}

SPEC = {
    "required_capabilities": CAPABILITIES,
    "extra_keys": {
        CAS: CAS_KEYS,
        CAPS: (CHANGE_SKILL_KEY,),
        UC: (UC_ID,),
        PFA: (PF_KEY,),
        SW: (VOICE_KEY,),
    },
}


class KitError(RuntimeError):
    pass


# ---------------------------------------------------------------- 通用小工具

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def slv(a, b=None) -> list[dict]:
    return [{"min": a, "max": a if b is None else b}]


def cmd(node):
    return node[1]


def strict_equal(a: Any, b: Any) -> bool:
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(strict_equal(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(strict_equal(x, y) for x, y in zip(a, b))
    return a == b


def first_difference(a: Any, b: Any, path: str = "$") -> str | None:
    if type(a) is not type(b):
        return f"{path}: type {type(a).__name__} != {type(b).__name__} ({str(a)[:80]} vs {str(b)[:80]})"
    if isinstance(a, dict):
        if a.keys() != b.keys():
            return f"{path}: keys {sorted(a)} != {sorted(b)}"
        for k in a:
            d = first_difference(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: len {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    return None if a == b else f"{path}: {a!r} != {b!r}"


def iter_commands(node, name: str | None = None):
    if isinstance(node, list):
        if len(node) == 2 and node[0] == "Command" and isinstance(node[1], list) and node[1]:
            if name is None or node[1][0] == name:
                yield node[1]
        for child in node:
            yield from iter_commands(child, name)


def find_cmd(node, name: str):
    return next(iter_commands(node, name), None)


def panel_text_problems(text: str) -> list[str]:
    return [f"panel text contains forbidden word {w!r}" for w in FORBIDDEN_PANEL_WORDS if w in text]


def load_design(root: Path) -> dict:
    design = json.loads((root / DESIGN_REL).read_text(encoding="utf-8"))
    if design.get("status") != "final" or design.get("key") != KEY:
        raise KitError(f"design {DESIGN_REL} is not final zehr design")
    ident = design["identity"]
    if (ident["cid"], ident["code"], int(ident["element"])) != (CID, CODE, ELEMENT):
        raise KitError(f"design identity mismatch {ident}")
    return design


def check_texts_constant(design: dict) -> list[str]:
    t = design["text"]
    want = {"name": t["name"], "furigana": t["furigana"], "title": t["nickname"],
            "profile": t["character_text_row"][2], "leader": t["leader_skill_name"],
            "skill1": t["skill_name_1"], "desc1": t["skill_desc_1"], "skill2": t["skill_name_2"],
            "desc2": t["skill_desc_2"], "cv": t["cv"]}
    probs = [f"TEXTS[{k}] != design" for k, v in want.items() if TEXTS.get(k) != v]
    row = t["character_text_row"]
    expect_row = [TEXTS["name"], TEXTS["furigana"], TEXTS["profile"], TEXTS["title"], TEXTS["skill1"],
                  TEXTS["desc1"], TEXTS["skill2"], TEXTS["desc2"], "(None)", "(None)", TEXTS["leader"], TEXTS["cv"]]
    if row != expect_row:
        probs.append("design character_text_row != TEXTS-derived row")
    return probs


def apply_text_override(text: str, label: str) -> str:
    if TEXT_DROPPED_BY_OVERRIDE not in text:
        raise KitError(f"{label}: override phrase {TEXT_DROPPED_BY_OVERRIDE!r} not found (design changed?)")
    return text.replace(TEXT_DROPPED_BY_OVERRIDE, "")


# ---------------------------------------------------------------- 行构建

def donor_row(ctx, donor: str, index: int) -> tuple[list[str], str]:
    """design donor 写法 ``"<table> OFF:<key>#<i>"`` / ``"<table> LIVE:<key>#<i>"``。"""
    table, rest = donor.split(" ", 1)
    source, key_idx = rest.split(":", 1)
    key, idx = key_idx.split("#", 1)
    if int(idx) != index:
        raise KitError(f"donor index mismatch {donor} vs row_index {index}")
    logical = f"master/ability/{table}.orderedmap"
    if source == "OFF":
        rows = ctx.official_flat(logical)
    elif source == "LIVE":
        rows = ctx.live_flat(logical)
    else:
        raise KitError(f"unknown donor source {donor}")
    if key not in rows:
        raise KitError(f"donor {donor} missing")
    lines = ctx.csv_split(rows[key])
    return list(lines[index]), table


def row_checks(kind: str, row: list[str]) -> dict[str, Any]:
    import wf_client_legality as L
    import wf_describe
    return {
        "describe": wf_describe.describe_rows([row], kind)[0],
        "client_legality_problems": L.client_legality_problems(kind, row),
        "declared_block_field_problems": L.declared_block_field_problems(kind, row),
        "ability_element_column_problems": (L.ability_element_column_problems(kind, row, ELEMENT)
                                            if kind == "ability" else []),
        "capabilities": L.required_client_capabilities(kind, row),
    }


def build_rows(ctx, design: dict) -> tuple[dict, list[dict]]:
    evidence: list[dict] = []
    leader_rows: list[list[str]] = []
    for i, entry in enumerate(design["leader"]):
        if entry["target_record"] != i:
            raise KitError(f"leader record order {entry['target_record']} != {i}")
        row, table = donor_row(ctx, entry["donor"], entry["row_index"])
        if table != "leader_ability":
            raise KitError(f"leader donor table {table}")
        for col, val in entry["edits"].items():
            if row[int(col)] != entry["old_values"][col]:
                raise KitError(f"leader#{i} donor c{col}={row[int(col)]!r} != design old {entry['old_values'][col]!r}")
            row[int(col)] = val
        if row != entry["row"]:
            diff = {j: (a, b) for j, (a, b) in enumerate(zip(row, entry["row"])) if a != b}
            raise KitError(f"leader#{i} donor+edits != design row: {diff}")
        leader_rows.append(row)
        evidence.append({"table": "leader_ability", "key": CID, "record": i, "donor": entry["donor"], "row": row})
    ability_rows: dict[str, list[list[str]]] = {}
    for slot in range(1, 7):
        block = design["abilities"][f"slot{slot}"]
        key = f"{CID}{slot}"
        if block["key"] != key:
            raise KitError(f"design slot{slot} key {block['key']} != {key}")
        lines = []
        for j, entry in enumerate(block["records"]):
            if entry["target_record"] != j:
                raise KitError(f"ability {key} record order")
            row, table = donor_row(ctx, entry["donor"], entry["row_index"])
            if table != "ability":
                raise KitError(f"ability donor table {table}")
            for col, val in entry["edits"].items():
                if row[int(col)] != entry["old_values"][col]:
                    raise KitError(f"ability {key}#{j} donor c{col}={row[int(col)]!r} != design old "
                                   f"{entry['old_values'][col]!r}")
                row[int(col)] = val
            if row != entry["row"]:
                diff = {c: (a, b) for c, (a, b) in enumerate(zip(row, entry["row"])) if a != b}
                raise KitError(f"ability {key}#{j} donor+edits != design row: {diff}")
            if row[0] != f"{CODE}_{slot}":
                raise KitError(f"ability {key} c0 {row[0]}")
            lines.append(row)
            evidence.append({"table": "ability", "key": key, "record": j, "donor": entry["donor"], "row": row})
        ability_rows[key] = lines
    total = sum(len(v) for v in ability_rows.values())
    counts = design["record_counts"]
    if total != counts["abilities"] or len(leader_rows) != counts["leader"]:
        raise KitError(f"row counts ability={total} leader={len(leader_rows)} design={counts}")
    for item in evidence:
        item.update(row_checks(item["table"], item["row"]))
    return {"leader": leader_rows, "ability": ability_rows}, evidence


def mixed_c1_c2(ability_rows: dict[str, list[list[str]]]) -> dict[str, list[tuple[str, str]]]:
    """同键多记录 c1/c2 混写清单（仅信息，不是缺陷）。"""
    return {key: [(r[1], r[2]) for r in lines] for key, lines in ability_rows.items()
            if len({r[1] for r in lines}) > 1 or len({r[2] for r in lines}) > 1}


# ---------------------------------------------------------------- 固有状态图标

def draw_lamp_icon():
    """48×48 官方风固有状态图标：白色圆角框 + 暗红渐变底 + 白色提灯 + 金色灯芯火苗（8× 超采样）。"""
    from PIL import Image, ImageDraw, ImageFilter
    k = 8
    size = 48 * k
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=7 * k, fill=(255, 255, 255, 255))
    grad = Image.new("RGBA", (size, size))
    top, bottom = (170, 52, 60), (98, 22, 32)
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / (size - 1)
        gd.line([(0, y), (size, y)], fill=tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)) + (255,))
    inner = Image.new("L", (size, size), 0)
    ImageDraw.Draw(inner).rounded_rectangle([3 * k, 3 * k, size - 1 - 3 * k, size - 1 - 3 * k], radius=5 * k, fill=255)
    base.paste(grad, (0, 0), inner)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([12 * k, 13 * k, 36 * k, 37 * k], fill=(255, 179, 71, 150))
    glow = glow.filter(ImageFilter.GaussianBlur(4 * k))
    glow_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glow_mask).rounded_rectangle([3 * k, 3 * k, size - 1 - 3 * k, size - 1 - 3 * k],
                                                radius=5 * k, fill=255)
    clipped = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    clipped.paste(glow, (0, 0), glow_mask)
    base = Image.alpha_composite(base, clipped)
    d = ImageDraw.Draw(base)
    white = (255, 255, 255, 255)
    s = k
    d.arc([19 * s, 6 * s, 29 * s, 16 * s], start=180, end=360, fill=white, width=int(2 * s))       # 提环
    d.polygon([(17 * s, 15 * s), (31 * s, 15 * s), (28 * s, 12 * s), (20 * s, 12 * s)], fill=white)  # 顶盖
    d.rounded_rectangle([16 * s, 15 * s, 32 * s, 35 * s], radius=3 * s, outline=white, width=int(2.2 * s))  # 灯罩
    d.line([(24 * s, 15 * s), (24 * s, 18 * s)], fill=white, width=int(1.5 * s))
    d.polygon([(17 * s, 35 * s), (31 * s, 35 * s), (29 * s, 39 * s), (19 * s, 39 * s)], fill=white)   # 底座
    d.polygon([(24 * s, 18.5 * s), (28.2 * s, 27 * s), (27.6 * s, 30.5 * s), (24 * s, 33 * s),
               (20.4 * s, 30.5 * s), (19.8 * s, 27 * s)], fill=(255, 211, 106, 255))                   # 火苗
    d.polygon([(24 * s, 23 * s), (26.2 * s, 28 * s), (24 * s, 31.2 * s), (21.8 * s, 28 * s)],
              fill=(255, 246, 224, 255))
    return base.resize((48, 48), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------- 特效染色

def _hex(value: str) -> tuple[float, float, float]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def _grad(stops, t):
    import numpy as np
    pos = np.array([p for p, _ in stops], dtype=np.float32)
    cols = np.array([_hex(c) for _, c in stops], dtype=np.float32)
    t = np.clip(t, pos[0], pos[-1])
    out = np.empty(t.shape + (3,), dtype=np.float32)
    for ch in range(3):
        out[..., ch] = np.interp(t, pos, cols[:, ch])
    return out


def _hsv(rgb):
    import numpy as np
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    delta = np.maximum(mx - mn, 1e-6)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    hue = np.where(mx == r, ((g - b) / delta) % 6, np.where(mx == g, (b - r) / delta + 2, (r - g) / delta + 4)) * 60
    return hue, sat, mx


def _hue_in(hue, lo, hi):
    return (hue >= lo) & (hue <= hi) if lo <= hi else (hue >= lo) | (hue <= hi)


# 规则：hue=(lo,hi) 或 None；sat/val 闭区间；lum=(lo,hi) 把亮度线性拉到 0..1 再查渐变；alpha_scale 仅该类像素
PALETTES: dict[str, list[dict]] = {
    "skill_blade": [   # 青白风刃/冲刺环 → 暖白金；橙黑爆炸 → 琥珀+暗红烟；白 → 微暖
        {"hue": (150, 265), "sat": (0.10, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#4A2A14"), (0.35, "#C99A4A"), (0.72, "#F2D48A"), (1.0, "#FFF3D6")]},
        {"hue": (330, 75), "sat": (0.25, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#3A0E12"), (0.3, "#8E2A2F"), (0.55, "#D9563A"), (0.75, "#FFB94A"), (1.0, "#FFE27A")]},
        {"hue": None, "sat": (0, 0.25), "val": (0, 0.40), "lum": (0.0, 0.40),
         "stops": [(0.0, "#1E0609"), (1.0, "#5E1820")]},
        {"hue": None, "sat": (0, 0.10), "val": (0.40, 1), "lum": (0.40, 1.0),
         "stops": [(0.0, "#B8A58A"), (1.0, "#FFF8EE")]},
    ],
    "skill_orb": [     # 光弹蓝环 → 金灯芯 + 暗红晕，中心暖白
        {"hue": (150, 265), "sat": (0.10, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#3A0E12"), (0.3, "#A8323C"), (0.65, "#FFD36A"), (1.0, "#FFF6E0")]},
        {"hue": (330, 75), "sat": (0.25, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#5E1820"), (0.5, "#FF8A3C"), (1.0, "#FFE27A")]},
        {"hue": None, "sat": (0, 0.10), "val": (0.40, 1), "lum": (0.40, 1.0),
         "stops": [(0.0, "#D9B98A"), (1.0, "#FFF6E0")]},
    ],
    "pf_spin_core": [  # 白核刀弧 → 暖白/金；青/黄绿弧 → 琥珀；黄辉光 → 提灯暖橙；蓝黑爆芒 → 暗红黑 + 金边
        {"hue": (275, 345), "sat": (0.25, 1), "lum": "stripe",
         "stops": [(0.0, "#3A0E12"), (0.33, "#8E2430"), (0.66, "#C2413F"), (1.0, "#F2B09A")]},
        {"hue": (40, 75), "sat": (0.20, 1), "lum": (0.45, 1.0),
         "stops": [(0.0, "#E07A2A"), (0.6, "#FFB347"), (1.0, "#FFF1C1")]},
        {"hue": (75, 200), "sat": (0.15, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#4A1208"), (0.4, "#9A3A1E"), (0.7, "#E3A33A"), (1.0, "#FFE8A0")]},
        {"hue": (200, 275), "sat": (0.15, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#2A0609"), (0.35, "#8E2430"), (0.7, "#C2413F"), (1.0, "#E8B84A")]},
        {"hue": None, "sat": (0, 0.15), "val": (0.35, 1), "lum": (0.35, 1.0),
         "stops": [(0.0, "#6B5A4A"), (0.55, "#D8CFC2"), (0.85, "#FFE3A0"), (1.0, "#FFF6E0")]},
    ],
    "pf_support": [    # 青绿 → 金；深蓝 → 暗红；橙红 → 灯火橙；黄绿 → 琥珀；白保持
        {"hue": (140, 190), "sat": (0.20, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#6A4A16"), (0.6, "#FFD36A"), (1.0, "#FFF3C8")]},
        {"hue": (190, 270), "sat": (0.20, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#1A0406"), (0.3, "#5E1820"), (1.0, "#C2413F")]},
        {"hue": (340, 30), "sat": (0.40, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#6E1A10"), (0.5, "#FF8A3C"), (1.0, "#FFD0A0")]},
        {"hue": (30, 140), "sat": (0.20, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#7A4A14"), (0.6, "#F2B84B"), (1.0, "#FFE27A")]},
    ],
    "pf_blaze": [      # 橙黄火焰/光球 → 暗红底 + 暖金亮部；褐烟 → 暗红烟；白保持微暖（Effects 未产出时的兜底）
        {"hue": (330, 75), "sat": (0.20, 1), "lum": (0.0, 1.0),
         "stops": [(0.0, "#2A0609"), (0.3, "#8E2430"), (0.52, "#D9563A"), (0.72, "#F2B84B"),
                   (0.9, "#FFD36A"), (1.0, "#FFF1C1")]},
        {"hue": None, "sat": (0, 0.12), "val": (0.40, 1), "lum": (0.40, 1.0),
         "stops": [(0.0, "#D9B98A"), (1.0, "#FFF6E0")]},
        {"hue": None, "sat": (0, 1), "val": (0, 0.45), "lum": (0.0, 0.45),
         "stops": [(0.0, "#1E0609"), (1.0, "#6E1A24")]},
    ],
}


def region_masks(shape, atlas: list[dict], groups: dict[str, Callable[[str], bool]]):
    import numpy as np
    h, w = shape
    masks = {name: np.zeros((h, w), dtype=bool) for name in groups}
    for entry in atlas:
        if not isinstance(entry, dict) or "n" not in entry:
            continue
        base = entry["n"].split("/.gen/", 1)[-1].split("/", 1)[0]
        for name, pred in groups.items():
            if pred(base):
                masks[name][entry["y"]:entry["y"] + entry["h"], entry["x"]:entry["x"] + entry["w"]] = True
                break
    return masks


def apply_palette(arr, rules: list[dict], region, *, alpha_scale_mask=None, alpha_scale: float = 1.0):
    """按 hue/sat/val 分类、亮度查渐变换色；alpha 逐字节保留（alpha_scale_mask 内的条纹除外，且非零不降到 0）。"""
    import numpy as np
    rgb = arr[..., :3].astype(np.float32) / 255.0
    alpha = arr[..., 3]
    hue, sat, val = _hsv(rgb)
    lum = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
    out = arr.copy()
    assigned = np.zeros(alpha.shape, dtype=bool)
    counts = []
    visible = (alpha > 0) & region
    for rule in rules:
        m = visible & ~assigned
        if rule.get("hue") is not None:
            m &= _hue_in(hue, *rule["hue"])
        lo, hi = rule.get("sat", (0, 1))
        m &= (sat >= lo) & (sat <= hi)
        if "val" in rule:
            vlo, vhi = rule["val"]
            m &= (val >= vlo) & (val <= vhi)
        n = int(m.sum())
        counts.append(n)
        if not n:
            continue
        spec = rule["lum"]
        if spec in ("stripe", "family"):
            top = float(lum[m].max()) or 1.0
            t = lum / top
        else:
            llo, lhi = spec
            t = (lum - llo) / max(lhi - llo, 1e-6)
        new = _grad(rule["stops"], t)
        out[..., :3][m] = np.clip(np.rint(new[m] * 255), 0, 255).astype(np.uint8)
        assigned |= m
        if spec == "stripe" and alpha_scale_mask is not None and alpha_scale != 1.0:
            sm = m & alpha_scale_mask
            scaled = np.maximum(1, np.rint(alpha[sm].astype(np.float32) * alpha_scale)).astype(np.uint8)
            out[..., 3][sm] = scaled
    return out, counts


def family_recolor(name: str, atlas: list[dict]) -> Callable:
    import numpy as np
    from PIL import Image

    def transform(img):
        arr = np.array(img.convert("RGBA"))
        full = np.ones(arr.shape[:2], dtype=bool)
        stats: dict[str, Any] = {}
        if name == "skill":
            masks = region_masks(arr.shape[:2], atlas, {
                "black": lambda b: b == "guildknight_leader_black",
                "orb": lambda b: b == "assist_skill",
                "blade": lambda b: True})
            arr, stats["blade"] = apply_palette(arr, PALETTES["skill_blade"], masks["blade"])
            arr, stats["orb"] = apply_palette(arr, PALETTES["skill_orb"], masks["orb"])
            stats["black_kept_px"] = int(masks["black"].sum())
        elif name == "pf_spin":
            masks = region_masks(arr.shape[:2], atlas, {
                "outer": lambda b: b in ("powerflip_attack_spin_two", "powerflip_attack_spin_three")})
            arr, stats["spin"] = apply_palette(arr, PALETTES["pf_spin_core"], full,
                                               alpha_scale_mask=masks["outer"], alpha_scale=0.8)
        elif name == "pf_support":
            arr, stats["support"] = apply_palette(arr, PALETTES["pf_support"], full)
        elif name == "pf_blaze":
            arr, stats["blaze"] = apply_palette(arr, PALETTES["pf_blaze"], full)
        else:
            raise KitError(f"no palette for family {name}")
        transform.stats = stats
        return Image.fromarray(arr, "RGBA")

    transform.stats = {}
    return transform


def load_fx_manifest(root: Path) -> tuple[dict[str, Path], dict | None]:
    """``fx/zehr/out/manifest.json`` → {源 sheet 逻辑路径: 染色 PNG 文件}；不存在返回 ({}, None)。

    兼容：顶层平铺 ``{logical: path}``；``{"sheets"|"recolor"|"png"|"pngs"|"files"|"outputs": {…}}``；
    ``{"sheets": [{"source"|"src"|"logical_path": …, "png"|"file"|"path"|"output": …}]}``。
    相对路径先按 manifest 所在目录，再按批目录、仓库根解析。
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
            if isinstance(item, dict):
                src = item.get("source") or item.get("src") or item.get("logical_path")
                png = item.get("png") or item.get("file") or item.get("path") or item.get("output")
                if isinstance(src, str) and isinstance(png, str):
                    pairs.append((src, png))
    out: dict[str, Path] = {}
    for src, png in pairs:
        if not (src.startswith("battle/effect/") and src.endswith(".png")):
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
    return out, {"path": FX_MANIFEST_REL, "sha256": sha256(path.read_bytes()), "entries": len(out)}


def clone_families(ctx) -> tuple[dict[str, dict], list[dict], dict | None]:
    fx_map, fx_info = load_fx_manifest(ctx.root)
    recolor_log: list[dict] = []
    families: dict[str, dict] = {}
    known = set()
    for src_dir, sub, bases in EFFECT_FAMILIES:
        donor = src_dir.rsplit("/", 1)[-1]
        sheet = f"{src_dir}/{donor}.png"
        known.add(sheet)
        _root, atlas_raw, _src = ctx.pack.template_asset(f"{src_dir}/{donor}.atlas.amf3.deflate")
        atlas = ctx.amf_parse(atlas_raw)
        target = fx_map.get(sheet)
        if target is not None:
            def transform(img, target=target, sheet=sheet):
                raw = target.read_bytes()
                new = ctx.png_open(raw)
                if new.size != img.size:
                    raise KitError(f"fx manifest sheet size {new.size} != donor {img.size}: {target}")
                recolor_log.append({"sheet": sheet, "mode": "fx-manifest", "png": str(target),
                                    "png_sha256": sha256(raw)})
                return new
            fam = ctx.clone_effect_family(src_dir, sub, fx_names=list(bases), layout="codename",
                                          png_transform=transform)
        else:
            transform = family_recolor(sub, atlas)
            fam = ctx.clone_effect_family(src_dir, sub, fx_names=list(bases), layout="codename",
                                          png_transform=transform)
            recolor_log.append({"sheet": sheet, "mode": "kit-palette", "family": sub,
                                "pixels_per_rule": transform.stats})
        if fam["missing_effects"] or sorted(fam["copied_bases"]) != sorted(bases):
            raise KitError(f"effect family {src_dir} incomplete: missing={fam['missing_effects']}")
        if fam["dst_dir"] != f"battle/effect/skill_unique/{CODE}/{sub}":
            raise KitError(f"unexpected effect dst {fam['dst_dir']}")
        if sub in SILENT_TIMELINE_FAMILIES:
            fam["silenced_timelines"] = silence_timelines(ctx, fam)
        families[sub] = fam
    unknown = sorted(set(fx_map) - known)
    if unknown:
        raise KitError(f"fx manifest names sheets outside zehr families: {unknown}")
    return families, recolor_log, fx_info


def silence_timelines(ctx, fam: dict) -> list[dict]:
    """新演出层：timeline sounds 清空（避免怪音），sequences 等其余字段原样。"""
    done = []
    for item in fam["files"]:
        target = item["target"]
        if not target.endswith(".timeline.amf3.deflate"):
            continue
        path = ctx.pack.pkg_path(item["root"], target)
        tree = ctx.amf_parse(path.read_bytes())
        before = list(tree.get("sounds") or [])
        if before:
            tree = dict(tree)
            tree["sounds"] = []
            ctx.write_asset(item["root"], target, ctx.amf_bytes(tree), owner="effects")
        done.append({"timeline": target, "sounds_removed": [s.get("path") for s in before],
                     "sequences": tree.get("sequences")})
    return done


# ---------------------------------------------------------------- 技能 DSL

def load_program(ctx, name: str) -> tuple[Any, dict]:
    import wf_dsl
    program, expect = SKILL_SOURCES[name]
    logical = wf_dsl.dsl_logical(program)
    raw = ctx.official_read(logical, "common")
    source = "official"
    if raw is None:
        raw = ctx.live_read(logical)
        source = "live"
    if sha256(raw) != expect:
        raise KitError(f"source DSL fingerprint drift {name} ({source}): {sha256(raw)} != {expect}")
    return ctx.amf_parse(raw), {"program": program, "source": source, "sha256": expect}


def compose_skill(ctx, level: int, sources: dict) -> tuple[list, dict]:
    """移植 design/_tmp/zehr/c8_final_build.py（特效改写换成 rewrite_effect_refs 在调用方做）。"""
    P = SKILL_LEVELS[level]
    tree = copy.deepcopy(sources[f"guildknight_leader_{level}"])
    HW, MS, AS = sources["spry_sailor_hw21_2"], sources["minamoto_sakura_2"], sources["assist"]
    blk = tree[11][1]
    if not (tree[1] == 3 and tree[10] == 0):
        raise KitError("skill head unexpected")
    fa = cmd(blk[0])
    if not (fa[0] == "FindAllSubjects" and fa[1] == 0 and fa[2] == 33):
        raise KitError("skill block0 not FindAllSubjects(0,33)")
    body = fa[9][1]
    if not (cmd(body[0])[0] == "CreateCondition" and cmd(body[0])[2][0][0] == "ACPiercing"):
        raise KitError("skill block0 body[0] not ACPiercing")
    cmd(body[0])[2][0][1] = slv(*P["pierce"])
    fly = copy.deepcopy(cmd(HW[11][1][1])[9][1][1])
    if not (cmd(fly)[2][0][0] == "ACFlying" and cmd(fly)[1] == 3):
        raise KitError("spry_sailor ACFlying donor moved")
    cmd(fly)[1] = 0
    cmd(fly)[2][0][1] = slv(*P["fly"])
    body.append(fly)
    pfd = copy.deepcopy(cmd(MS[11][1][4])[9][1][0])
    if not (cmd(pfd)[2][0][0] == "ACPowerFlipDamage" and cmd(pfd)[1] == 4):
        raise KitError("minamoto_sakura ACPowerFlipDamage donor moved")
    cmd(pfd)[1] = 0
    cmd(pfd)[2][0][1] = slv(*P["pfd_dur"])
    cmd(pfd)[2][0][2] = slv(*P["pfd"])
    body.append(pfd)
    atk = cmd(blk[1])
    if not (atk[0] == "CreateCondition" and atk[1] == -17 and atk[2][0][0] == "ACAttackPoint"):
        raise KitError("skill block1 not self ACAttackPoint")
    ac = cmd(blk[2])
    if ac[0] != "AddCombo":
        raise KitError("skill block2 not AddCombo")
    ac[1] = slv(*P["combo"])
    fn = cmd(blk[4])
    if not (fn[0] == "FindNearSubjects" and fn[3] == 49):
        raise KitError("skill block4 not FindNearSubjects(49)")
    cha = cmd(fn[6][1][0])
    if not (cha[0] == "CreateHitArea" and cha[24] == 0):
        raise KitError("skill dash hit area unexpected")
    cna = find_cmd(cha[23], "CreateNormalAttack")
    if cna[6][0]["max"] not in (13.3, 20):
        raise KitError(f"skill dash multiplier unexpected {cna[6]}")
    cna[6] = slv(*P["slash"])
    cna_tpl = copy.deepcopy(cna)
    for ev in AS[11][1]:
        e = copy.deepcopy(ev)
        w = e[1]
        if w[0] != "Wait":
            raise KitError("assist block not Wait")
        f = cmd(w[3][1][0])
        if not (f[0] == "FindNearSubjects" and f[3] == 51 and f[1] == -17):
            raise KitError("assist FindNearSubjects unexpected")
        f[3] = 49
        bind = f[5]
        f[5] = bind + 100
        h = cmd(f[6][1][0])
        if not (h[0] == "CreateHitArea" and h[2] == bind and h[24] == 0):
            raise KitError("assist hit area unexpected")
        h[2] += 100
        h[19] += 100
        h[21] += 100
        h[22] += 100
        h[4] = 0
        h[5] = 0
        se = cmd(h[20][1][0])
        if not (se[0] == "ShowEffect" and se[3] == h[19] - 100):
            raise KitError("assist ShowEffect subject unexpected")
        se[3] = h[19]
        hit = h[23][1]
        ra = cmd(hit[0])
        if not (ra[0] == "CreateRatioAttack" and ra[1] == h[22] - 100):
            raise KitError("assist CreateRatioAttack unexpected")
        new = copy.deepcopy(cna_tpl)
        new[1] = h[22]
        new[5] = 0
        new[6] = slv(*P["orb"])
        new[13] = slv(2)
        new[14] = slv(2)
        hit[0] = ["Command", new]
        cmd(hit[1])[1] = 1
        blk.append(e)
    total = (P["slash"][0] + 5 * P["orb"][0], P["slash"][1] + 5 * P["orb"][1])
    return tree, {"multiplier_estimate": total}


# ---------------------------------------------------------------- PF DSL

def apk_pf_sources(root: Path) -> tuple[dict[str, bytes], str]:
    """APK assets/bundle.zip 内官方 knight/supporter lv1-3（按 wf_gerald_native_pf_dsl.SOURCE_HASHES 验指纹）。"""
    import wf_dsl
    import wf_gerald_native_pf_dsl as gpf
    import wf_mod_tool as core
    want = {}
    for level in (1, 2, 3):
        for kind in ("knight", "supporter"):
            d = core.sha1_path(wf_dsl.dsl_logical(f"battle/action/power_flip/action/{kind}${kind}_lv{level}"))
            want[f"{kind}_lv{level}"] = d[:2] + "/" + d[2:]
    apks = sorted((root / "弹国服").glob("*.apk"), key=lambda p: p.stat().st_mtime, reverse=True)
    for apk in apks:
        with zipfile.ZipFile(apk) as z:
            if "assets/bundle.zip" not in z.namelist():
                continue
            inner = zipfile.ZipFile(io.BytesIO(z.read("assets/bundle.zip")))
            names = [n for n in inner.namelist() if not n.endswith("/")]
            found = {}
            for label, tail in want.items():
                hits = [n for n in names if n.endswith(tail)]
                for hit in hits:
                    raw = inner.read(hit)
                    if sha256(raw) == gpf.SOURCE_HASHES[label]:
                        found[label] = raw
                        break
            if len(found) == len(want):
                return found, apk.name
    raise KitError("no APK bundle provides the fingerprinted official knight/supporter PF DSLs")


def compose_pf(level: int, sources: dict[str, bytes]) -> tuple[list, dict]:
    import wf_gerald_native_pf_dsl as gpf
    tree = gpf.compose(sources[f"knight_lv{level}"], sources[f"supporter_lv{level}"], level)
    sp, off = PF_LEVELS[level], PF_OFFICIAL[level]
    blk = tree[11][1]
    if not (tree[1] == 1 and tree[10] == 0):
        raise KitError("PF head unexpected")
    sup = cmd(blk[0])
    if sup[0] != "SetPowerFilpSuppress" or sup[1] != off["supp"]:
        raise KitError(f"PF lv{level} suppress {sup}")
    sup[1] = sp["supp"]
    h = cmd(blk[1])
    if not (h[0] == "CreateHitArea" and h[2] == -18 and h[24] == 0):
        raise KitError("PF knight hit area unexpected")
    if (h[13][1], h[14][1]) != (off["life"], off["hits"]):
        raise KitError(f"PF lv{level} life/hits {(h[13], h[14])}")
    h[13][1] = sp["life"]
    h[14][1] = sp["hits"]
    cna = cmd(h[23][1][0])
    if cna[0] != "CreateNormalAttack" or (cna[6][0]["max"], cna[13][0]["max"], cna[14][0]["max"]) != \
            (off["mult"], off["det"], off["fev"]):
        raise KitError(f"PF lv{level} knight attack unexpected {cna}")
    cna[6] = slv(PF_SEGMENT_MULTIPLIER[level])
    cna[13] = slv(sp["det"])
    cna[14] = slv(sp["fev"])
    w = blk[2][1]
    if not (w[0] == "Wait" and cmd(w[3][1][0])[0] == "NotifyPowerflipEnd" and w[1] == off["wait"]):
        raise KitError("PF Wait→NotifyPowerflipEnd unexpected")
    w[1] = sp["wait"]
    buffs = []
    for node in iter_commands(blk[3:], "CreateCondition"):
        acn = node[2][0]
        buffs.append((acn[0], acn[1][0]["max"]))
        if acn[0] == "ACAttackPoint":
            acn[1] = slv(sp["atk_dur"])
        elif acn[0] in ("ACPiercing", "ACFlying"):
            acn[1] = slv(sp["pf_dur"])
    return tree, {"official": off, "new": dict(sp, mult=PF_SEGMENT_MULTIPLIER[level]), "support_buffs_before": buffs}


def _slv_max(value) -> float:
    if not (isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict)):
        raise KitError(f"expected single-level value, got {str(value)[:60]}")
    return float(value[0]["max"])


def pf_attack_budget(tree) -> list[dict]:
    """树内每个 CreateHitArea 的 CreateNormalAttack 按满命中计：倍率/削韧(p13)/Fever 点(p14) × 最大命中数。
    判定区按出现顺序；PF 树第一个即剑士回旋斩（blk[1]，subject -18）。"""
    out: list[dict] = []

    def rec(node, area):
        if not isinstance(node, list):
            return
        if len(node) == 2 and node[0] == "Command" and isinstance(node[1], list) and node[1]:
            c = node[1]
            if c[0] == "CreateHitArea":
                hits = c[14]
                if not (isinstance(hits, list) and hits[0] == "CalculatedUsingMaxNumOfHits"):
                    raise KitError(f"hit area {c[1]!r} hit count form {hits}")
                entry = {"area": c[1], "subject": c[2], "hits": int(hits[1]), "attacks": []}
                out.append(entry)
                for child in c[1:]:
                    rec(child, entry)
                return
            if c[0] in ("CreateRatioAttack", "CreateFixedAttack"):
                raise KitError(f"PF budget does not model {c[0]}")
            if c[0] == "CreateNormalAttack":
                if area is None:
                    raise KitError("CreateNormalAttack outside a hit area")
                area["attacks"].append({"mult": _slv_max(c[6]), "break": _slv_max(c[13]),
                                        "fever": _slv_max(c[14])})
        for child in node:
            rec(child, area)

    rec(tree, None)
    for entry in out:
        n = entry["hits"]
        entry["damage"] = round(sum(a["mult"] for a in entry["attacks"]) * n, 6)
        entry["break"] = round(sum(a["break"] for a in entry["attacks"]) * n, 6)
        entry["fever"] = round(sum(a["fever"] for a in entry["attacks"]) * n, 6)
    return [e for e in out if e["attacks"]]


def pf_budget_report(level: int, tree, sources: dict[str, bytes]) -> dict:
    """包内 PF 与官方剑士 + 官方辅助（同档）满命中预算对比。剑士段总伤必须恰为官方 3 倍（主控覆盖）。"""
    import wf_dsl
    new = pf_attack_budget(tree)
    knight = pf_attack_budget(wf_dsl.parse_dsl(zlib.decompress(sources[f"knight_lv{level}"], -15))["tree"])
    support = pf_attack_budget(wf_dsl.parse_dsl(zlib.decompress(sources[f"supporter_lv{level}"], -15))["tree"])
    if len(knight) != 1 or not new or new[0]["subject"] != -18:
        raise KitError(f"PF lv{level} budget shape unexpected: new={new} knight={knight}")

    def total(entries, field):
        return round(sum(e[field] for e in entries), 6)

    official_all = knight + support
    rep = {
        "knight": {"new": {f: new[0][f] for f in ("hits", "damage", "break", "fever")},
                   "official": {f: knight[0][f] for f in ("hits", "damage", "break", "fever")}},
        "total": {"new": {f: total(new, f) for f in ("damage", "break", "fever")},
                  "official": {f: total(official_all, f) for f in ("damage", "break", "fever")}},
        "support_attacks": {"new": [e["damage"] for e in new[1:]], "official": [e["damage"] for e in support]},
    }
    rep["ratio"] = {
        "knight_damage": round(rep["knight"]["new"]["damage"] / rep["knight"]["official"]["damage"], 4),
        "total_damage": round(rep["total"]["new"]["damage"] / rep["total"]["official"]["damage"], 4),
        "total_break": round(rep["total"]["new"]["break"] / rep["total"]["official"]["break"], 4),
        "total_fever": round(rep["total"]["new"]["fever"] / rep["total"]["official"]["fever"], 4),
    }
    if abs(rep["knight"]["new"]["damage"] - 3 * rep["knight"]["official"]["damage"]) > 1e-6:
        raise KitError(f"PF lv{level} knight segment damage {rep['knight']} is not 3× official")
    return rep


def pf_budget_note(budgets: dict[int, dict]) -> str:
    def seq(fn):
        return "/".join(fn(budgets[lv]) for lv in (1, 2, 3))

    def num(x):
        return f"{x:g}"
    return ("PF 满命中预算（Lv1/2/3，对比官方剑士＋同档官方辅助）：剑士回旋斩总伤 "
            f"{seq(lambda b: num(b['knight']['new']['damage']))}×＝官方 {seq(lambda b: num(b['knight']['official']['damage']))}× 的 3 倍；"
            f"含辅助段合计 {seq(lambda b: num(b['total']['new']['damage']))}×（官方 {seq(lambda b: num(b['total']['official']['damage']))}×，"
            f"{seq(lambda b: format(b['ratio']['total_damage'], '.2f'))} 倍，Lv3 辅助全屏 4× 未乘 3）；"
            f"削韧 {seq(lambda b: num(b['total']['new']['break']))}（官方 {seq(lambda b: num(b['total']['official']['break']))}，"
            f"约 {seq(lambda b: format(b['ratio']['total_break'], '.2f'))} 倍）；"
            f"Fever 点 {seq(lambda b: num(b['total']['new']['fever']))}（官方 {seq(lambda b: num(b['total']['official']['fever']))}，"
            f"{seq(lambda b: format(b['ratio']['total_fever'], '.2f'))} 倍）。实战按命中率打折，不是恒定 3 倍")


def add_blaze_layer(tree: list, level: int, blaze_family: dict) -> list:
    """在 knight 判定区 onCreate 块里、spin 之前插入新演出层（同 subject / UntilTargetTerminates；
    坐标系改 AB：火焰朝屏幕上方，不随球向旋转；先插入的层画在 spin 之下）。"""
    blk = tree[11][1]
    h = cmd(blk[1])
    on_create = h[20][1]
    spins = [n for n in on_create if n[0] == "Command" and n[1][0] == "ShowEffect"]
    if len(spins) != 1:
        raise KitError("PF knight onCreate must hold exactly one spin ShowEffect")
    spin = spins[0][1]
    if spin[5] != ["UntilTargetTerminates"] or spin[3] != h[19]:
        raise KitError(f"spin ShowEffect not bound to hit area: {spin}")
    layer = blaze_node(spin, f"{blaze_family['src_dir']}/{PF_BLAZE_BASE}", level)
    on_create.insert(0, ["Command", layer])
    return tree


def blaze_node(spin: list, path: str, level: int) -> list:
    layer = copy.deepcopy(spin)
    layer[1] = PF_BLAZE_LABEL
    layer[2] = ["SpecifyEffectDirectly", path]
    layer[6] = ["AB"]
    layer[12] = ["Some", slv(PF_BLAZE_SCALE[level])]
    return layer


def expected_pf_tree(root: Path, level: int, blaze_dst: str) -> list:
    """设计定稿 PF 树 + 主控覆盖（倍率恢复官方、叠加 blaze 层）= 期望树。"""
    design = json.loads((root / DESIGN_TMP_REL / f"final_pf_lv{level}.json").read_text(encoding="utf-8"))
    h = cmd(design[11][1][1])
    cna = cmd(h[23][1][0])
    if cna[6] != slv(DESIGN_PF_SEGMENT_MULTIPLIER[level]):
        raise KitError(f"design PF lv{level} multiplier {cna[6]} != {DESIGN_PF_SEGMENT_MULTIPLIER[level]}")
    cna[6] = slv(PF_SEGMENT_MULTIPLIER[level])
    h[20][1].insert(0, ["Command", blaze_node(h[20][1][0][1], f"{blaze_dst}/{PF_BLAZE_BASE}", level)])
    return design


# ---------------------------------------------------------------- 校验（kit 内即时断言；完整门禁在 impl/zehr/gates.py）

# 移植自 research/_tmp/blueprint_build.py 的 check（问题文本逐字相同；单测对原模块做等价核对）。
# 不再运行时 import 研究目录、不换 sys.stdout、不改 cwd。
_BP_LOOKUP = {"StopBall": [1], "ShowEffect": [3], "AddSkillPoint": [1], "CreateCondition": [1], "CreateHitArea": [2],
              "CreateNormalAttack": [1], "CreateRatioAttack": [1], "CreateFixedAttack": [1], "CreateRatioHeal": [1],
              "FindNearSubjects": [1], "CreateReferencePoint": [1], "MoveHitArea": [1], "RotateHitArea": [1]}
_BP_BUILTIN = {-1, -2, -17, -18, -33}
_OFFICIAL_SIG_CACHE: dict[str, tuple[dict[str, list[str]], str]] = {}


def official_sig_problems(root: Path) -> list[str]:
    """两处候选都缺或 sha 都不等于 pin 时返回原因清单（空 = 可用）。"""
    probs = []
    for rel in OFFICIAL_SIG_CANDIDATES:
        path = root / rel
        if not path.is_file():
            probs.append(f"{rel}: missing")
            continue
        got = sha256(path.read_bytes())
        if got == OFFICIAL_SIG_PIN:
            return []
        probs.append(f"{rel}: sha256 {got} != pin {OFFICIAL_SIG_PIN}")
    return probs


def load_official_sig(root: Path) -> tuple[dict[str, list[str]], str]:
    """按 OFFICIAL_SIG_CANDIDATES 顺序取第一份 sha 等于 pin 的签名表；都不可用时 KitError（带清单与再生方法）。"""
    key = str(root)
    if key not in _OFFICIAL_SIG_CACHE:
        for rel in OFFICIAL_SIG_CANDIDATES:
            path = root / rel
            if path.is_file():
                raw = path.read_bytes()
                if sha256(raw) == OFFICIAL_SIG_PIN:
                    _OFFICIAL_SIG_CACHE[key] = (json.loads(raw.decode("utf-8")), rel)
                    break
        else:
            raise KitError("official DSL signature table unavailable: " + "; ".join(official_sig_problems(root))
                           + f"（work/ 被 gitignore；从 {OFFICIAL_SIG_CANDIDATES[1]} 复制到 {OFFICIAL_SIG_CANDIDATES[0]}，"
                             "或用 research/_tmp/official_sig.py 重新生成后核对差异并更新 OFFICIAL_SIG_PIN）")
    return _OFFICIAL_SIG_CACHE[key]


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


def blueprint_check_with_sig(tree, off: dict[str, list[str]]) -> tuple[list[str], int, bool]:
    """官方签名差分 / 参数个数 / 作用域 C16103 / GH / CD 挂 -17/-18 / Rectangle 三元组 / 绑定 id 重复 /
    AMF3 往返 / 我方方向。"""
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


def required_input_problems(root: Path) -> list[str]:
    """kit 依赖的未跟踪输入（work/ 被 gitignore）。fx manifest 与 gates.json 允许缺（只影响染色来源 / status）。"""
    probs = []
    for rel, use in ((DESIGN_REL, "设计定稿：行 / 文案 / 语音路由 / 字符串的唯一来源"),
                     *((f"{DESIGN_TMP_REL}/final_skill_{lv}.json", f"技能 {lv} 定稿树（逐节点比对）") for lv in (1, 2)),
                     *((f"{DESIGN_TMP_REL}/final_pf_lv{lv}.json", f"PF Lv{lv} 定稿树（逐节点比对）") for lv in (1, 2, 3))):
        if not (root / rel).is_file():
            probs.append(f"{rel} missing（{use}）")
    probs += [f"official_sig: {p}" for p in official_sig_problems(root)]
    return probs


def workspace_path_budget(workspace: Path, batch_dir: Path, key: str = KEY, *,
                          extra_rel: tuple[str, ...] = (), exclude_rel: tuple[str, ...] = ()) -> dict[str, Any]:
    """框架 --step inspect 把 workspace 复制到 <batch>/_inspect/<key>-<pid>/<ws 名>/ 下：
    按 7 位 PID 估副本全长，返回最长条目与余量（负数 = copytree 必然 MAX_PATH 失败）。
    ``extra_rel`` 计入即将写入的条目，``exclude_rel`` 排除即将删除的条目（相对 workspace 的 posix 路径）。"""
    ws = Path(os.path.normpath(workspace))
    copy_prefix = len(str(Path(os.path.normpath(batch_dir)) / "_inspect" / f"{key}-{'9' * INSPECT_PID_DIGITS}" / ws.name))
    rels = [p.relative_to(ws).as_posix() for p in ws.rglob("*")] if ws.is_dir() else []
    rels = [r for r in rels if r not in set(exclude_rel)] + list(extra_rel)
    longest = max(rels, key=len) if rels else ""
    copy_len = copy_prefix + 1 + len(longest) if longest else copy_prefix
    return {"copy_prefix": copy_prefix, "longest_rel": longest, "real_len": len(str(ws)) + 1 + len(longest),
            "copy_len": copy_len, "limit": WIN_MAX_PATH, "headroom": WIN_MAX_PATH - copy_len}


def typed_signature_problems(tree) -> list[str]:
    """wf_dsl_sig 类型表逐参数核对「Array 参必须是数组、表达式参必须是表达式、枚举构造名属于该枚举」（F1034/F1009）。"""
    import wf_dsl_sig as SIG
    probs: list[str] = []
    exprs = ("Block", "Command", "Event")

    def check_value(typ: str, value, where: str) -> None:
        # 官方 1052 棵技能树正向对照：null 只出现在对象型参数（枚举 HitCountCheckTargetKind 1452 处、
        # CreateSummonsMultiball 表达式 49 处），Array/数值/布尔参从不为 null。
        if value is None and typ not in ("Array", "int", "Number", "Boolean"):
            return
        if typ == "Array":
            if not isinstance(value, list):
                probs.append(f"{where}: Array param got {type(value).__name__}")
            elif value and isinstance(value[0], str) and value[0] in exprs:
                probs.append(f"{where}: Array param got expression")
        elif typ == "ActionDslExpression":
            if not (isinstance(value, list) and value and value[0] in exprs):
                probs.append(f"{where}: expression param got {str(value)[:40]}")
            else:
                walk_expr(value)
        elif typ in SIG.ENUMS:
            if not (isinstance(value, list) and value and isinstance(value[0], str)):
                probs.append(f"{where}: enum {typ} got {str(value)[:40]}")
                return
            ctors = SIG.ENUMS[typ]
            if value[0] not in ctors:
                probs.append(f"{where}: {value[0]} is not a {typ} constructor")
                return
            args = ctors[value[0]]
            if len(value) - 1 != len(args):
                probs.append(f"{where}: {typ}.{value[0]} arity {len(value) - 1} != {len(args)}")
            for j, (t2, v2) in enumerate(zip(args, value[1:]), 1):
                check_value(t2, v2, f"{where}>{value[0]}#{j}")
        elif typ in ("int", "Number"):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                probs.append(f"{where}: {typ} got {type(value).__name__}")
        elif typ == "Boolean":
            if not isinstance(value, bool):
                probs.append(f"{where}: Boolean got {type(value).__name__}")
        elif typ == "String":
            if not isinstance(value, str):
                probs.append(f"{where}: String got {type(value).__name__}")

    def walk_expr(node) -> None:
        if not (isinstance(node, list) and node):
            probs.append(f"bad expression {str(node)[:40]}")
            return
        if node[0] == "Block":
            for item in node[1]:
                walk_expr(item)
            return
        if node[0] in ("Command", "Event"):
            registry = SIG.COMMANDS if node[0] == "Command" else SIG.EVENTS
            c = node[1]
            if c[0] not in registry:
                probs.append(f"unknown {node[0]} {c[0]}")
                return
            sig = registry[c[0]]
            if len(c) - 1 != len(sig):
                probs.append(f"{c[0]} arity {len(c) - 1} != {len(sig)}")
            for i, (typ, value) in enumerate(zip(sig, c[1:]), 1):
                check_value(typ, value, f"{c[0]}#{i}")
            return
        probs.append(f"not an expression: {str(node)[:40]}")

    if not (isinstance(tree, list) and len(tree) == 12 and tree[0] == "ActionDsl"):
        return ["root is not a bare ActionDsl tree"]
    walk_expr(tree[11])
    return probs


def dsl_problems(root: Path, tree) -> dict[str, Any]:
    import wf_client_legality as L
    import wf_dsl
    off, _sig_source = load_official_sig(root)
    bp, size, rt = blueprint_check_with_sig(tree, off)
    enc = wf_dsl.encode_amf3(tree)
    rt2 = strict_equal(wf_dsl.parse_dsl(enc)["tree"], tree)
    donothing = [c[0] for c in iter_commands(tree) for p in c[1:]
                 if isinstance(p, list) and p and p[0] == "Block" and ["DoNothing"] in p[1]]
    probs = {
        "blueprint_check": list(bp),
        "typed_signature": typed_signature_problems(tree),
        "element": L.action_dsl_element_problems(tree, ELEMENT),
        "subject_binding": L.action_dsl_subject_binding_problems(tree),
        "hit_area_target": L.action_dsl_hit_area_target_problems(tree),
        "player_side_direction": wf_dsl.player_side_dsl_problems(tree),
        "donothing_in_block": donothing,
    }
    return {"problems": probs, "all_empty": not any(probs.values()), "amf3_bytes": size,
            "roundtrip": bool(rt and rt2)}


def effect_ref_problems(ctx, tree) -> list[str]:
    import wf_assets
    probs = []
    for c in iter_commands(tree):
        for p in c[1:]:
            refs = []
            if isinstance(p, list) and len(p) == 2 and p[0] == "SpecifyEffectDirectly":
                refs.append(p[1])
            elif isinstance(p, list) and p and p[0] == "SpecifyHitEffectDirectly":
                inner = p[1]
                if isinstance(inner, list) and len(inner) == 2 and inner[0] == "SpecifyEffectDirectly":
                    refs.append(inner[1])
            for path in refs:
                for kind in ("parts", "timeline"):
                    logical = f"{path}.{kind}.amf3.deflate"
                    if not (ctx.pack.pkg_has("common", logical) or wf_assets.locate(ctx.store, logical)):
                        probs.append(f"unresolved {c[0]} {logical}")
    return probs


def drop_stale_pf_programs(ctx) -> list[str]:
    """删掉旧 kit 按设计长路径写入的三档 PF DSL（已被 pf_program 短路径取代），并撤销其 kit 登记。
    只动登记为 kit（或未登记）的文件；manifest 重扫 roots 时自然不再声明它们。"""
    import wf_dsl
    import wf_seasonal7_common as C
    removed = []
    owned = ctx.pack._owned_raw()
    for level in (1, 2, 3):
        old = wf_dsl.dsl_logical(design_pf_program(level))
        if old == wf_dsl.dsl_logical(pf_program(level)):
            continue
        record = owned.get(f"common:{old}")
        if record is not None and record.get("owner") != "kit":
            raise KitError(f"stale PF program {old} is owned by {record.get('owner')}, not kit")
        path = ctx.pack.pkg_path("common", old)
        if path.is_file():
            path.unlink()
            removed.append(old)
        owned.pop(f"common:{old}", None)
    if removed or any(f"common:{wf_dsl.dsl_logical(design_pf_program(lv))}" in ctx.pack._owned_raw()
                      for lv in (1, 2, 3)):
        ctx.pack.write_evidence(C.OWNED_FILE, dict(sorted(owned.items())))
    return removed


# ---------------------------------------------------------------- 像素小人 / 语音（Integrate 阶段）

PIXEL_DIR_REL = f"{BATCH}/pixel/zehr"
PIXEL_VERIFY_REL = f"{BATCH}/pixel/_review/verify_all.json"
# sheet 基名 → 同组元数据（atlas / frame / timeline）；元数据保持母本，只有 character/<母本>/ 前缀由 assets 改写
PIXEL_SHEETS = {
    "sprite_sheet": ("sprite_sheet.atlas.amf3.deflate", "pixelart.frame.amf3.deflate",
                     "pixelart.timeline.amf3.deflate"),
    "special_sprite_sheet": ("special_sprite_sheet.atlas.amf3.deflate", "special.frame.amf3.deflate",
                             "special.timeline.amf3.deflate"),
}
SPEECH = "master/character/character_speech.orderedmap"


def pixel_inputs(root: Path) -> tuple[dict[str, Path], list[str]]:
    """像素染色产物是否可装包（与 philia / regis kit 同一判据）：``pixel/zehr/report.json`` 门禁全过、
    ``pixel/_review/verify_all.json`` 的 zehr 复核全过（REVIEW.md §5 修复轮），两者记录的 sha256 =
    ``out/<sheet>.png`` 当前字节。返回 ({sheet 基名: PNG 路径}, problems)；problems 非空 = pending（不装包）。"""
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


def pixel_problems(ctx, *, check_owner: bool = True) -> list[str]:
    """包内像素小人核对（不写盘）：sheet 为存储态（小写魔数）且解码字节 = 染色 PNG 原字节；尺寸 / alpha = 母本；
    染色所据母本 sha = 当前母本；atlas/frame/timeline = 母本树（仅 character/<母本>/ 前缀改写）；
    归属 owner=pixel 且登记 sha = 盘上字节。"""
    import wf_assets
    spec = ctx.spec
    pngs, probs = pixel_inputs(ctx.root)
    if probs:
        return [f"pixel inputs not ready: {p}" for p in probs]
    report = json.loads((ctx.root / PIXEL_DIR_REL / "report.json").read_text(encoding="utf-8"))
    sources = report.get("source_files") or {}
    prefix = {f"character/{spec.template_code}/": f"character/{spec.code}/"}
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
        if (sources.get(tpl_logical) or {}).get("sha256") != sha256(donor_raw):
            probs.append(f"{tpl_logical}: template bytes != pixel report source_files sha (recolor base drift)")
        pkg_img, donor = ctx.png_open(raw), ctx.png_open(donor_raw)
        if pkg_img.size != donor.size:
            probs.append(f"{logical} size {pkg_img.size} != donor {donor.size}")
        elif pkg_img.getchannel("A").tobytes() != donor.getchannel("A").tobytes():
            probs.append(f"{logical} alpha differs from donor {tpl_logical}")
        if check_owner:
            record = ctx.pack.owned_record("common", logical) or {}
            if record.get("owner") != "pixel" or record.get("sha256") != sha256(raw):
                probs.append(f"{logical} owner record {record} (expected pixel + current sha)")
        for meta in metas:
            pkg_meta = f"character/{CODE}/pixelart/{meta}"
            if not ctx.pack.pkg_has("common", pkg_meta):
                probs.append(f"package pixel metadata missing {pkg_meta}")
                continue
            _r, tpl_raw, _src = ctx.pack.template_asset(f"character/{spec.template_code}/pixelart/{meta}")
            if (sources.get(f"character/{spec.template_code}/pixelart/{meta}") or {}).get("sha256") not in (None, sha256(tpl_raw)):
                probs.append(f"{meta}: template bytes != pixel report source_files sha")
            want = ctx.replace_strings(ctx.amf_parse(tpl_raw), prefix)
            if ctx.amf_parse(ctx.pack.pkg_path("common", pkg_meta).read_bytes()) != want:
                probs.append(f"{pkg_meta} differs from donor metadata (only path prefix may change)")
    return probs


def install_pixel(ctx) -> dict[str, Any]:
    """把复核通过的像素染色 sheet 以存储态（``wf_assets.png_encode``：只换小写魔数，PNG 字节不重编码）写进包，
    owner=pixel。重跑幂等：字节相同不改盘，登记 sha 不变。产物未就绪时不写、返回 pending（包内保持母本原色）。"""
    import wf_assets
    pngs, probs = pixel_inputs(ctx.root)
    if probs:
        return {"status": "pending", "problems": probs}
    written = {}
    for name, png in pngs.items():
        logical = f"character/{CODE}/pixelart/{name}.png"
        raw = png.read_bytes()
        data = wf_assets.png_encode(raw)
        if data[:8] != wf_assets.PNG_FAKE or wf_assets.png_decode(data) != raw:
            raise KitError(f"pixel store-form roundtrip failed: {png}")
        ctx.write_asset("common", logical, data, owner="pixel")
        written[logical] = {"source": f"{PIXEL_DIR_REL}/out/{png.name}", "decoded_sha256": sha256(raw),
                            "store_sha256": sha256(data), "size": list(ctx.png_open(data).size)}
    after = pixel_problems(ctx)
    if after:
        raise KitError(f"pixel sheets did not land in the package: {after}")
    return {"status": "installed", "sheets": written, "problems": []}


def voice_state(ctx) -> dict[str, Any]:
    """只读：语音是否已由 ``wf_seasonal7_voice pack`` + ``impl/zehr/voice_merge.py`` 装包（22 槽文件在包内、
    归属 voice 且登记 sha = 盘上字节；speech 8 行引用新槽；无多余旧母本语音；character_text c11 = AI 合成配音）。"""
    import wf_seasonal7_voice as V
    missing = [s for s in V.SLOTS if not ctx.pack.pkg_has("common", f"character/{CODE}/voice/{s}.mp3")]
    not_voice_owned = []
    for s in V.SLOTS:
        logical = f"character/{CODE}/voice/{s}.mp3"
        if s in missing:
            continue
        record = ctx.pack.owned_record("common", logical) or {}
        if record.get("owner") != "voice" or record.get("sha256") != sha256(ctx.pack.pkg_path("common", logical).read_bytes()):
            not_voice_owned.append(s)
    speech_flat = ctx.pkg_flat(SPEECH) if ctx.pack.pkg_has("common", SPEECH) else {}
    speech = ctx.csv_split(speech_flat[CID]) if speech_flat.get(CID) else []
    refs = [cells[4] for cells in speech if len(cells) == 5]
    want_refs = [*V.HOME_SLOTS, "ally/join", "ally/evolution"]
    base = ctx.pack.package / "roots" / "common" / "character" / CODE / "voice"
    extra = sorted(p.relative_to(base).as_posix() for p in base.rglob("*")
                   if p.is_file() and p.relative_to(base).with_suffix("").as_posix() not in V.SLOTS) \
        if base.is_dir() else []
    cv = ctx.pack.pkg_character_text_row()[11]
    packed = not missing and not not_voice_owned and refs == want_refs and not extra and cv == V.VOICE_ACTOR
    return {"packed": packed, "missing_slots": missing, "not_voice_owned": not_voice_owned,
            "speech_refs": refs, "extra_voice_files": extra, "cv": cv}


def media_fingerprint_parts(ctx) -> dict[str, Any]:
    """像素 sheet 与语音（文件 / speech 行）字节摘要：媒体换了，门禁必须重跑才能回到 ready-for-review。"""
    pixel = {}
    for name in PIXEL_SHEETS:
        logical = f"character/{CODE}/pixelart/{name}.png"
        path = ctx.pack.pkg_path("common", logical)
        pixel[logical] = sha256(path.read_bytes()) if path.is_file() else None
    base_root = ctx.pack.package / "roots" / "common"
    voice_dir = base_root / "character" / CODE / "voice"
    voice = {p.relative_to(base_root).as_posix(): sha256(p.read_bytes())
             for p in sorted(voice_dir.rglob("*")) if p.is_file()} if voice_dir.is_dir() else {}
    speech_flat = ctx.pkg_flat(SPEECH) if ctx.pack.pkg_has("common", SPEECH) else {}
    return {"pixel": pixel, "voice_files": voice, "speech": speech_flat.get(CID)}


# ---------------------------------------------------------------- 指纹 / 门禁状态

def kit_fingerprint(ctx) -> tuple[str, dict]:
    """kit 自有产物指纹（表行、字符串、固有图标、5 棵 DSL、4 个特效族全部文件字节）。"""
    import wf_dsl
    parts: dict[str, Any] = {}
    parts["character_c9_18"] = ctx.pack.pkg_character_row()[9:19]
    parts["character_text"] = ctx.pack.pkg_character_text_row()
    ab = ctx.pkg_flat(ABILITY)
    parts["ability"] = {k: ab[k] for k in [f"{CID}{i}" for i in range(1, 7)]}
    parts["leader"] = ctx.pkg_flat(LEADER)[CID]
    cas = ctx.pkg_flat(CAS)
    parts["custom_ability_string"] = {k: cas[k] for k in CAS_KEYS}
    import wf_mod_tool as core
    caps_om = core.read_orderedmap_raw_rows_from_bytes(ctx.pack.pkg_path("common", CAPS).read_bytes(), CAPS)
    parts["custom_ability_power_up_string"] = sha256(dict(zip(caps_om.keys, caps_om.rows))[CHANGE_SKILL_KEY])
    parts["unique_condition"] = ctx.pkg_flat(UC)[UC_ID]
    parts["unique_icon"] = sha256(ctx.pack.pkg_path("common", UC_ICON).read_bytes())
    parts["power_flip_action"] = ctx.pkg_flat(PFA)[PF_KEY]
    parts["action_skill"] = ctx.pkg_nested(CODE)
    parts["switched_action_skill"] = ctx.pkg_nested(VOICE_KEY, SW)
    progs = {}
    for logical in program_logicals(ctx):
        progs[logical] = sha256(ctx.pack.pkg_path("common", logical).read_bytes())
    parts["dsl"] = progs
    fx = {}
    base_root = ctx.pack.package / "roots" / "common"
    for _src, sub, _bases in EFFECT_FAMILIES:
        base = base_root / "battle" / "effect" / "skill_unique" / CODE / sub
        for p in sorted(base.rglob("*")):
            if p.is_file():
                rel = p.relative_to(base_root).as_posix()
                fx[rel] = sha256(p.read_bytes())          # 含 PNG：换色后必须重跑门禁（alpha/区域检查）
    parts["effects"] = fx
    parts["media"] = media_fingerprint_parts(ctx)       # 像素 / 语音：Integrate 阶段装包后必须重跑门禁
    parts["required_capabilities"] = sorted(CAPABILITIES)
    parts["overrides"] = OVERRIDES
    parts["official_sig_pin"] = OFFICIAL_SIG_PIN          # 校验依据变了也要重跑门禁
    blob = json.dumps(parts, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return sha256(blob), parts


def program_logicals(ctx) -> list[str]:
    import wf_dsl
    out = [wf_dsl.dsl_logical(ctx.program_path(lv)) for lv in ("1", "2")]
    out += [wf_dsl.dsl_logical(pf_program(lv)) for lv in (1, 2, 3)]
    return out


def gates_status(root: Path, fingerprint: str) -> tuple[str, str]:
    path = root / GATES_REL
    if not path.is_file():
        return "draft", "impl/zehr/gates.json 不存在（门禁未跑）"
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
    missing_inputs = required_input_problems(ctx.root)
    if missing_inputs:
        raise KitError(f"kit inputs unavailable: {missing_inputs}")
    design = load_design(ctx.root)
    text_probs = check_texts_constant(design)
    if text_probs:
        raise KitError(f"TEXTS constant drifted from design: {text_probs}")
    notes: list[str] = []

    # ---- character 行：spec 列断言 + c9–c16 语音路由 + c18 队长名
    crow = ctx.pack.pkg_character_row()
    edits = design["character_row"]["edits"]
    route_cols = V.normalize_route(design["voice"]["route"], CODE)
    if route_cols != [edits[str(i)] for i in range(9, 17)]:
        raise KitError(f"voice route {route_cols} != design character c9-16")
    new_crow = list(crow)
    new_crow[9:17] = route_cols
    new_crow[18] = TEXTS["leader"]
    for col, val in edits.items():
        if new_crow[int(col)] != val:
            raise KitError(f"character c{col}={new_crow[int(col)]!r} != design {val!r} (rerun tables?)")
    V.route_character_row(new_crow, route_cols, CODE)
    ctx.write_flat(CHAR, {CID: [new_crow]})
    ctx.write_flat(TEXT, {CID: [design["text"]["character_text_row"]]})

    # ---- 词条 / 队长
    rows, row_evidence = build_rows(ctx, design)
    bad = {f"{e['table']}#{e['key']}#{e['record']}": {k: e[k] for k in
           ("client_legality_problems", "declared_block_field_problems", "ability_element_column_problems") if e[k]}
           for e in row_evidence if e["client_legality_problems"] or e["declared_block_field_problems"]
           or e["ability_element_column_problems"]}
    if bad:
        raise KitError(f"row legality problems: {bad}")
    ctx.write_flat(LEADER, {CID: rows["leader"]})
    ctx.write_flat(ABILITY, rows["ability"])

    # ---- 固有状态「灯火正旺」+ 图标
    uc = design["unique_conditions"][0]
    if uc["id"] != UC_ID or uc["table"] != UC or uc["row"][2] + ".png" != UC_ICON:
        raise KitError(f"unique condition design unexpected {uc['id']} {uc['row'][2]}")
    uc_row = list(uc["row"])
    if uc_row[4] in ("", "(None)"):
        raise KitError("unique_condition max stack must not be (None) (wf-unique-cap-none-trap)")
    ctx.write_flat(UC, {UC_ID: [uc_row]})
    icon_bytes = ctx.png_store_bytes(draw_lamp_icon())
    if icon_bytes[:8] != b"\x89png\r\n\x1a\n":
        raise KitError("unique icon lacks WF storage signature")
    ctx.write_asset("common", UC_ICON, icon_bytes)
    if not any(r[68] == UC_ID and r[47] == "461" for r in rows["ability"][f"{CID}6"]):
        raise KitError("slot6 has no 461 row granting unique 159997")

    # ---- 字符串
    strings = {(item["table"], item["key"]): item for item in design["custom_strings"]}
    if sorted(k for t, k in strings if t == CAS) != sorted(CAS_KEYS) or \
            [k for t, k in strings if t == CAPS] != [CHANGE_SKILL_KEY]:
        raise KitError(f"design custom_strings keys unexpected: {sorted(strings)}")
    cas_rows = {}
    for key in CAS_KEYS:
        item = strings[(CAS, key)]
        value = item["value"]
        if key in (PF_STRING_KEY, LEADER_OVERRIDE_KEY):
            value = apply_text_override(value, key)
        if key.startswith("desc_override_"):
            probs = panel_text_problems(value)
            if probs:
                raise KitError(f"{key}: {probs}")
            if L.panel_override_capability(key) != "panel-description-override-v2":
                raise KitError(f"{key} panel capability mismatch")
        cas_rows[key] = [[value]]
    if design["leader_desc_override"]["key"] != LEADER_OVERRIDE_KEY or \
            apply_text_override(design["leader_desc_override"]["value"], "leader_desc_override") != cas_rows[LEADER_OVERRIDE_KEY][0][0]:
        raise KitError("leader_desc_override block != custom_strings entry")
    if design["abilities"]["slot3"].get("desc_override_key") != SLOT3_OVERRIDE_KEY:
        raise KitError("slot3 desc_override key mismatch")
    string_ids = {rows["leader"][0][0]} | {lines[0][0] for lines in rows["ability"].values()}
    for key in (LEADER_OVERRIDE_KEY, SLOT3_OVERRIDE_KEY):
        if key[len("desc_override_"):] not in string_ids:
            raise KitError(f"{key} matches no row string id {sorted(string_ids)}")
    refs = {r[70] for lines in rows["ability"].values() for r in lines if len(r) > 70 and r[70]}
    refs |= {r[82] for r in rows["leader"] if r[82]}
    if not {PF_STRING_KEY, CHANGE_SKILL_KEY} <= refs:
        raise KitError(f"string keys not referenced by rows: {refs}")
    ctx.write_flat(CAS, cas_rows)
    import wf_seasonal7_tables as T
    caps_blob = ctx.pack.template_raw(CAPS)[f"change_skill_{TEMPLATE_CODE}"]     # 官方原行字节（5 档文本不含技能名）
    if T.decode_blob(caps_blob) != strings[(CAPS, CHANGE_SKILL_KEY)]["value"]:
        raise KitError("official power_up row != design value")
    ctx.write_raw_outer(CAPS, {CHANGE_SKILL_KEY: caps_blob})

    # ---- 撤销框架自动克隆但本 kit 不用的字符串键
    unclaimed = []
    for claim in ctx.pack.load_claims():
        if (claim["root"], claim["logical_path"]) == ("common", CAS):
            extra = sorted(set(claim["outer_keys"]) - set(CAS_KEYS))
            if extra:
                ctx.unclaim(CAS, extra)
                unclaimed.extend(extra)

    # ---- action_skill：名称 / 描述 / 能量 / DSL 路径
    inner = ctx.pkg_nested(CODE)
    if set(inner) != {"1", "2"}:
        raise KitError(f"package action_skill inner keys {sorted(inner)}")
    import wf_mod_tool as core
    official_action = core.load_nested_table_bytes(
        ctx.official_read(ACTION, "common"), ACTION).rows[TEMPLATE_CODE].text_rows()
    energy = design["skills"]["energy"]
    names = {"1": (TEXTS["skill1"], TEXTS["desc1"]), "2": (TEXTS["skill2"], TEXTS["desc2"])}
    new_inner = {}
    for level in ("1", "2"):
        off = ctx.csv_split(official_action[level])[0]
        cells = list(off)
        if len(cells) != 24:
            raise KitError("action_skill schema unexpected")
        cells[0], cells[1] = names[level]
        e = energy[level]
        cells[4], cells[5], cells[6] = str(e["c4"]), str(e["c5"]), str(e["c6"])
        cells[7] = ctx.program_path(level)
        if cells[7] != design["skills"]["action_skill_rows"]["edits"]["c7"][int(level) - 1]:
            raise KitError("action_skill program path != design")
        new_inner[level] = [cells]
    ctx.write_nested(ACTION, CODE, new_inner, replace_inner=True)

    # ---- 特效族（克隆 + 染色 / fx manifest）
    families, recolor_log, fx_info = clone_families(ctx)

    # ---- 技能 DSL
    sources, source_info = {}, {}
    for name in SKILL_SOURCES:
        sources[name], source_info[name] = load_program(ctx, name)
    skills_report = {}
    for level in (1, 2):
        tree, info = compose_skill(ctx, level, sources)
        tree, refinfo = ctx.rewrite_effect_refs(tree, families["skill"], strict=True)
        design_tree = json.loads((ctx.root / DESIGN_TMP_REL / f"final_skill_{level}.json").read_text(encoding="utf-8"))
        diff = first_difference(tree, design_tree)
        if diff:
            raise KitError(f"composed skill {level} differs from design final tree: {diff}")
        checks = dsl_problems(ctx.root, tree)
        if not checks["all_empty"] or not checks["roundtrip"]:
            raise KitError(f"skill {level} static checks failed: {checks}")
        ref_probs = effect_ref_problems(ctx, tree)
        if ref_probs:
            raise KitError(f"skill {level} effect refs unresolved: {ref_probs}")
        logical = ctx.write_dsl(ctx.program_path(str(level)), tree)
        info.update(checks=checks, effect_refs=refinfo, logical=logical, equals_design_tree=True,
                    sha256=sha256(ctx.pack.pkg_path("common", logical).read_bytes()))
        skills_report[str(level)] = info

    # ---- 722 双形态 PF
    pf_sources, apk_name = apk_pf_sources(ctx.root)
    design_pf_row = design["pf_override"]["power_flip_action_row"]
    if design["pf_override"]["power_flip_action_key"] != PF_KEY or \
            design_pf_row != [design_pf_program(lv) for lv in (1, 2, 3)]:
        raise KitError("power_flip_action design row unexpected")
    pf_row = [pf_program(lv) for lv in (1, 2, 3)]                  # 路径缩短（见 PF_PROGRAM_NAME 注释），键不变
    pre_budget = workspace_path_budget(
        ctx.workspace, ctx.pack.batch_dir,
        extra_rel=tuple(f"package/roots/common/{wf_dsl.dsl_logical(p)}" for p in pf_row),
        exclude_rel=tuple(f"package/roots/common/{wf_dsl.dsl_logical(p)}" for p in design_pf_row))
    if pre_budget["headroom"] < 0:
        raise KitError(f"workspace path too long for framework inspect copy: {pre_budget}")
    leader_pf = rows["leader"][design["pf_override"]["leader_row"]["target_record"]]
    if (leader_pf[45], leader_pf[80], leader_pf[81], leader_pf[82]) != ("722", PF_KEY, "1,2,3", PF_STRING_KEY):
        raise KitError(f"leader 722 row columns unexpected {leader_pf[45]} {leader_pf[80:83]}")
    pf_report, pf_budgets = {}, {}
    for level in (1, 2, 3):
        tree, info = compose_pf(level, pf_sources)
        tree = add_blaze_layer(tree, level, families["pf_blaze"])
        refinfo = {}
        for sub in ("pf_spin", "pf_support", "pf_blaze"):
            tree, refinfo[sub] = ctx.rewrite_effect_refs(tree, families[sub], strict=True)
        expect = expected_pf_tree(ctx.root, level, families["pf_blaze"]["dst_dir"])
        diff = first_difference(tree, expect)
        if diff:
            raise KitError(f"composed PF lv{level} differs from design+override tree: {diff}")
        checks = dsl_problems(ctx.root, tree)
        if not checks["all_empty"] or not checks["roundtrip"]:
            raise KitError(f"PF lv{level} static checks failed: {checks}")
        ref_probs = effect_ref_problems(ctx, tree)
        if ref_probs:
            raise KitError(f"PF lv{level} effect refs unresolved: {ref_probs}")
        pf_budgets[level] = pf_budget_report(level, tree, pf_sources)
        logical = ctx.write_dsl(pf_row[level - 1], tree)
        info.update(checks=checks, effect_refs=refinfo, logical=logical,
                    equals_design_plus_override=True, sha256=sha256(ctx.pack.pkg_path("common", logical).read_bytes()),
                    blaze_scale=PF_BLAZE_SCALE[level], budget=pf_budgets[level])
        pf_report[str(level)] = info
    ctx.write_flat(PFA, {PF_KEY: [pf_row]})
    removed_programs = drop_stale_pf_programs(ctx)
    budget = workspace_path_budget(ctx.workspace, ctx.pack.batch_dir)
    if budget["headroom"] < 0:
        raise KitError(f"workspace path too long for framework inspect copy: {budget}")

    # ---- switched_action_skill（语音 matched_skill_ready 路由的目标技能）
    switched = V.switched_rows({lv: list(c) for lv, c in ctx.pkg_nested(CODE).items()})
    ctx.write_nested(SW, VOICE_KEY, {lv: [cells] for lv, cells in switched.items()}, replace_inner=True)

    # ---- 三层镜像
    mirrors = ctx.sync_character_mirrors()

    # ---- 像素小人（复核通过才装，owner=pixel）；语音只读状态（由 wf_seasonal7_voice pack + impl/zehr/voice_merge.py 装）
    pixel = install_pixel(ctx)
    voice = voice_state(ctx)
    ctx.evidence_write("pixel-report.json", {       # manifest 读 summary/status 进 snapshot
        "summary": (f"像素小人染色 sheet 已装包（{PIXEL_DIR_REL}/out，存储态，owner=pixel）"
                    if pixel["status"] == "installed" else "像素小人 pending（母本原色占位）"),
        **pixel})

    # ---- 能力声明一致性
    row_caps = sorted({c for e in row_evidence for c in e["capabilities"]}
                      | {cap for k in CAS_KEYS for cap in [L.panel_override_capability(k)] if cap})
    if row_caps != sorted(CAPABILITIES) or sorted(spec.required_capabilities) != sorted(CAPABILITIES) \
            or sorted(design["required_capabilities"]) != sorted(CAPABILITIES):
        raise KitError(f"capabilities rows={row_caps} spec={spec.required_capabilities}")

    fingerprint, _parts = kit_fingerprint(ctx)
    status, status_reason = gates_status(ctx.root, fingerprint)
    programs = program_logicals(ctx)
    panel = [f"{e['table']} {e['key']}#{e['record']}: {e['describe']}" for e in row_evidence]
    if fx_info is None:
        notes.append("特效 sheet 为 kit 默认调色板染色（fx/zehr/out/manifest.json 未产出；Effects 阶段产出后重跑 kit 即替换）")
    else:
        notes.append(f"特效 sheet 按 fx manifest 替换 {sum(1 for r in recolor_log if r['mode'] == 'fx-manifest')} 张")
    notes += [
        "主控覆盖①：PF 每段倍率恢复官方 3.25/4.75/6.3（寿命/命中/Notify ×3、suppress 70/90/110 保持）；"
        "每段削韧 0.75/1.0/1.5、Fever 点 2/2/3 仍取设计值（覆盖未提及）",
        pf_budget_note(pf_budgets),
        (f"PF 程序路径缩短为 override/{PF_PROGRAM_NAME}$…_lv1/2/3（设计 override/{PF_KEY}$…；框架 inspect 副本路径超 "
         f"Windows MAX_PATH）；power_flip_action 键 / 队长行 c80 / 文案键仍按设计；副本最长 {budget['copy_len']}"
         f"（上限 {WIN_MAX_PATH}，余量 {budget['headroom']}）"),
        "主控覆盖②：PF 判定区 onCreate 在 spin 之前叠 master_knight_blaze 火光层（pf_blaze 族，Effects 阶段推荐族，"
        "暖金暗红，timeline sounds 清空，AB 坐标，scale 2.1/2.5/5.6≈spin 屏上半宽 0.9×）；blaze 无 end 段，判定区结束即消失；"
        "叠层观感/帧率需真机金丝雀",
        "覆盖文案与 722 文案删去「（每段伤害降低）」",
        ("spin 条纹 B 层（设计『仅 alpha×0.8』）：kit 兜底调色板在 sheet 条纹像素上做 alpha×0.8；"
         "fx manifest 替换 sheet 时以 Effects 产物为准（其 alpha 逐字节保留，即未做 B）；两种情况都不动 .parts c 字段"),
        ("词条行按设计逐格落地；同键 c1/c2 混写只作信息（live 多记录键 152 个混写，含已上线 1499993 / 1699991）："
         f"{mixed_c1_c2(rows['ability']) or '无'}"),
        "unique_condition「灯火正旺」图标为 kit 程序绘制（提灯+金芯火苗，暗红底白框），需作者目检",
        ("语音已装包（22 槽 AI 合成，speech 8 行引用新槽，旧母本语音已清，c11=AI 合成配音）；"
         "c9–c16 ConditionExist(28)+Unique 159997 路由与 switched_action_skill 已写" if voice["packed"]
         else f"语音未装齐：missing={voice['missing_slots'][:3]} not_voice_owned={voice['not_voice_owned'][:3]} "
              f"extra={voice['extra_voice_files'][:3]}；须跑 wf_seasonal7_voice pack + impl/zehr/voice_merge.py"),
        (f"像素小人已装包（{PIXEL_DIR_REL}/out 存储态，owner=pixel，report 门禁 + verify_all 修复轮复核通过）"
         if pixel["status"] == "installed" else f"像素小人 pending（母本原色）：{pixel['problems'][:3]}"),
        "skill_preview 沿用母本 905、upskill 沿用母本（common_attack/piercing/combo/condition_attack）；设计未要求改",
        "待作者拍板项取设计默认：c27=自身 cid、冲刺方案 A（斜下 45°）、语音参考 A（官方声纹）",
    ]
    if unclaimed:
        notes.append(f"已撤销框架自动克隆但未使用的字符串键 {unclaimed}")
    report = {
        "summary": "泽赫尔·灯火酒馆 kit：6 队长行 / 14 词条行 / 固有「灯火正旺」/ 4 字符串 + power_up / 两档技能 / "
                   "722 双形态 PF（官方每段倍率、剑士段寿命/命中×3 + 火光新层）/ 4 特效族 / 语音路由",
        "status": status,
        "status_reason": status_reason,
        "kit_fingerprint": fingerprint,
        "design": {"path": DESIGN_REL, "sha256": sha256((ctx.root / DESIGN_REL).read_bytes())},
        "overrides": OVERRIDES,
        "skills": {"programs": programs},
        "unique_condition": {UC_ID: {"icon": UC_ICON}},
        "required_capabilities": list(CAPABILITIES),
        "panel": panel,
        "notes": notes,
        "rows": row_evidence,
        "skill_sources": source_info,
        "skill_trees": skills_report,
        "pf": {"apk": apk_name, "power_flip_action": {PF_KEY: pf_row}, "design_programs": design_pf_row,
               "removed_stale_programs": removed_programs, "path_budget": budget, "levels": pf_report},
        "rows_mixed_c1_c2": mixed_c1_c2(rows["ability"]),
        "official_sig": {"source": load_official_sig(ctx.root)[1], "sha256": OFFICIAL_SIG_PIN},
        "effects": {"families": [{k: f[k] for k in ("src_dir", "dst_dir", "copied_bases", "missing_effects")}
                                 | {"files": len(f["files"]), "silenced_timelines": f.get("silenced_timelines")}
                                 for f in families.values()],
                    "fx_manifest": fx_info, "recolor": recolor_log},
        "switched_action_skill": {VOICE_KEY: switched},
        "pixel": pixel,
        "voice": voice,
        "character_route": route_cols,
        "unclaimed": unclaimed,
        "mirrors": {"server_character": mirrors["server_character"]},
    }
    ctx.report(report)
    return {"status": status, "status_reason": status_reason, "kit_fingerprint": fingerprint,
            "rows": {"leader": len(rows["leader"]), "ability_records": sum(len(v) for v in rows["ability"].values())},
            "skills": {lv: {"bytes": s["checks"]["amf3_bytes"], "estimate": s["multiplier_estimate"]}
                       for lv, s in skills_report.items()},
            "pf": {lv: {"bytes": p["checks"]["amf3_bytes"], "blaze_scale": p["blaze_scale"],
                        "ratio": p["budget"]["ratio"]} for lv, p in pf_report.items()},
            "removed_stale_programs": removed_programs, "path_budget": budget,
            "effects": [f["dst_dir"] for f in families.values()], "unclaimed": unclaimed,
            "pixel": pixel["status"], "voice_packed": voice["packed"]}
