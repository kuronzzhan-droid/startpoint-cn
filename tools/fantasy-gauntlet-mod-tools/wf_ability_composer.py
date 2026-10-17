"""Shared offline ability composer. No GUI, profiles, store or release imports."""
from __future__ import annotations
import wf_describe
from wf_client_legality import (INSTANT_CONTENT_BOOL_KINDS,
                                INSTANT_CONTENT_MAX_ACCUMULATION_KINDS,
                                INSTANT_CONTENT_MULTIPLY_KINDS,
                                INSTANT_CONTENT_LIMIT_KINDS)
from decimal import Decimal, InvalidOperation

def _encode_numeric(value, factor):
    try:
        if isinstance(value, bool): raise ValueError()
        number = Decimal(str(value)) * factor
        if not number.is_finite() or number != number.to_integral_value() or abs(number) > 2147483647:
            raise ValueError()
        return str(int(number))
    except (InvalidOperation, ValueError):
        raise ValueError('能力数值超出范围或精度')

_FXGEN_TRIGGERS = [
    # (id, 中文, 模式, 触发枚举, 阈值单位 None|pct|count, 说明)
    ("battle_start", "开幕(战斗开始,常驻)", "instant", "0", None, "最常见的常驻被动(全库×2631)"),
    ("skill", "技能发动时", "instant", "23", None, "每次发动技能触发"),
    ("pf", "强化弹射时", "instant", "2", "count", "阈值=第N次强化弹射(空=每次)"),
    ("dash", "冲刺时", "instant", "4", "count", "阈值=第N次冲刺(空=每次;可配前置条件如Fever中)"),
    ("flip", "弹射时", "instant", "6", "count", "阈值=第N次弹射(空=每次;高频,建议配冷却/前置)"),
    ("pf3", "强化弹射Lv3时", "instant", "65", None, ""),
    ("fever_in", "Fever发动时", "instant", "8", None, ""),
    ("member", "编成含指定角色组", "instant", "57", "count", "阈值=编成N名以上;配合目标角色组"),
    ("combo", "连击数达标时", "instant", "12", "count", "阈值=连击数"),
    ("heal_cnt", "治疗计数达标", "instant", "19", "count", "阈值=治疗N次"),
    ("dmg_cnt", "伤害计数达标", "instant", "21", "count", "阈值=造成伤害N次"),
    ("hp_high", "HP≥X%期间(持续)", "during", "0", "pct", "阈值=HP百分比"),
    ("hp_low", "HP≤X%期间(持续)", "during", "1", "pct", "阈值=HP百分比"),
    ("pierce", "贯通状态期间(持续)", "during", "30", None, "全库×123,配合贯通授予行"),
    ("fever_during", "Fever期间(持续)", "during", "4", None, ""),
    ("atkup_during", "攻击力↑状态期间(持续)", "during", "9", None, ""),
]

_FXGEN_EFFECTS = [
    # (id, 中文, 模式, 效果枚举, 数值单位 pct|count, 说明)
    ("atk", "攻击力 +X%", "instant", "32", "pct", "全库×1441 的标准数值行"),
    ("skill_dmg", "技能伤害 +X%", "instant", "34", "pct", ""),
    ("pf_dmg", "强化弹射伤害 +X%", "instant", "55", "pct", ""),
    ("direct_dmg", "Direct伤害 +X%", "instant", "33", "pct", ""),
    ("hp", "HP +X%", "instant", "205", "pct", ""),
    ("gauge", "技能槽 +X%(立即)", "instant", "211", "pct", "发动型:立即充能"),
    ("charge", "技能槽充能速度 +X%", "instant", "35", "pct", ""),
    ("heal", "比例治疗 X%", "instant", "206", "pct", "按最大HP比例回复"),
    ("combo_add", "追加连击 +N", "instant", "226", "count", ""),
    ("fever_add", "追加Fever点 +X%", "instant", "213", "pct", ""),
    ("fever_ext", "Fever时间延长 +X%", "instant", "56", "pct", ""),
    ("d_atk", "攻击力 +X%(持续)", "during", "0", "pct", "持续触发期间生效"),
    ("d_skill", "技能伤害 +X%(持续)", "during", "2", "pct", ""),
    ("d_pf", "强化弹射伤害 +X%(持续)", "during", "23", "pct", ""),
    ("d_direct", "Direct伤害 +X%(持续)", "during", "1", "pct", ""),
    ("d_charge", "技能槽充能 +X%(持续)", "during", "3", "pct", ""),
    ("d_ability", "能力伤害 +X%(持续)", "during", "154", "pct", ""),
    ("d_ind_direct", "独立乘区Direct +X%(持续)", "during", "410", "pct", "后期五星标志乘区"),
    ("d_ind_pf", "独立乘区强化弹射 +X%(持续)", "during", "413", "pct", ""),
    # 对敌伤害(能力伤害,DMG: 伪 kind 在 generate 按角色元素解析成真实枚举 251/316/352+elem)
    ("dmg_all", "对全体敌人 能力伤害(依自身攻击,X倍)", "instant", "DMG:all", "x",
     "元素自动跟角色;「段数」填N=改为最近顺序N段"),
    ("dmg_near", "对最近的敌人 能力伤害(依自身攻击,X倍)", "instant", "DMG:near", "x",
     "「段数」=多段连击(空=1段)"),
    ("dmg_trig", "对触发源敌人 能力伤害(依自身攻击,X倍)", "instant", "DMG:trig", "x",
     "配合受击/敌方行动类触发"),
    ("invoke", "发动技能动作 InvokeSkill(伤害计为技能伤害)", "instant", "629", "raw",
     "填「技能键/动作路径」;范本=队长技 L:111183 行5(火龙弹射追击)"),
]

_FXGEN_GROUPS = [("", "(不限)"), ("Red", "火属性"), ("Blue", "水属性"), ("Yellow", "雷属性"),
                 ("Green", "风属性"), ("White", "光属性"), ("Black", "暗属性")]

_DMG_FAMILY_BASE = {"all": 251, "near": 352, "trig": 316}

_GROUP_TOKEN_ELEM = {"Red": 0, "Blue": 1, "Yellow": 2, "Green": 3, "White": 4, "Black": 5}

def composer_meta() -> dict:
    m = wf_describe.enum_map()
    kinds = {}
    for kind, lay in m["layouts"].items():
        kinds[kind] = {"ncols": lay["ncols"], "blocks": lay["blocks"],
                       "head": lay.get("head", []),
                       "trigger_col": lay["blocks"]["precondition1"] - 1}
    ucs = []
    small = {
        "target": {str(k): v for k, v in wf_describe.TARGET_CN.items()},
        "puller": {str(k): v for k, v in wf_describe.PULLER_CN.items()},
        "instant_puller": {str(k): v for k, v in wf_describe.INSTANT_PULLER_CN.items()},
        "during_puller": {str(k): v for k, v in wf_describe.DURING_PULLER_CN.items()},
        "element": {str(k): v for k, v in wf_describe.ELEMENT_CN.items()},
        "precontent": {str(k): v for k, v in wf_describe.PRECONTENT_CN.items()},
        "multiply": {str(k): v for k, v in wf_describe.MULTIPLY_CN.items()},
        "opening": {str(k): v for k, v in wf_describe.OPENING_CN.items()},
    }
    return {"kinds": kinds, "block_fields": m["block_fields"],
            "enums": wf_describe.enum_options(), "small": small,
            "groups": {tok: wf_describe.GROUP_CN.get(tok, tok)
                       for tok in m["character_groups_seen"]},
            "categories": list(m["category_strings"].keys()),
            "usage": m["usage_counts"], "unique_conditions": ucs,
            "note": "数值单位:强度类1000=1%;阈值100000=1次/层;内容frame为100000=1帧;cooltime为原始帧;instant_delay为原始秒"}

def _enum_menu(cat: str, table: str = "ability") -> list:
    """某枚举类别的全量选项,按全库使用频次降序(0 次的沉底);供自由构建器下拉。
    返回 [{kind, cn, en, n}]。cat ∈ enums 键;table ∈ usage 的表名(ability/leader…)。"""
    m = composer_meta()
    usage_key = {"trigger": "instant_trigger", "during_trigger": "during_trigger",
                 "instant_content": "instant_content", "during_content": "during_content"}.get(cat, cat)
    use = (m["usage"].get(usage_key) or {}).get(table, {}) or {}
    out = []
    for k, v in m["enums"].get(cat, {}).items():
        out.append({"kind": k, "cn": v.get("cn") or v.get("en"), "en": v.get("en", ""),
                    "n": int(use.get(k, 0))})
    out.sort(key=lambda x: (-x["n"], int(x["kind"]) if x["kind"].isdigit() else 1 << 30))
    return out

def composer_catalog() -> dict:
    """效果构建器目录:`common` = 精选常用(带默认单位/阈值提示);`all` = 全量枚举
    (触发/效果各按 瞬发/持续 分组,中文名+使用频次,可搜),让人**自由组合**任意效果
    而不是面对空白块。目标/角色组/来源/属性附带。"""
    tg = {str(k): v for k, v in wf_describe.TARGET_CN.items()}
    pl = {str(k): v for k, v in wf_describe.PULLER_CN.items()}
    return {"triggers": [{"id": t[0], "name": t[1], "mode": t[2], "kind": t[3],
                          "threshold": t[4], "note": t[5]} for t in _FXGEN_TRIGGERS],
            "effects": [{"id": e[0], "name": e[1], "mode": e[2], "kind": e[3],
                         "unit": e[4], "note": e[5]} for e in _FXGEN_EFFECTS],
            "all": {
                "trigger": {"instant": _enum_menu("trigger"),
                            "during": _enum_menu("during_trigger")},
                "effect": {"instant": _enum_menu("instant_content"),
                           "during": _enum_menu("during_content")},
                "precondition": _enum_menu("precondition"),
            },
            "pullers": pl,
            "targets": tg, "groups": [{"id": g[0], "name": g[1]} for g in _FXGEN_GROUPS],
            "preconditions_common": [
                {"kind": "", "name": "(无前置条件)", "threshold": None},
                {"kind": "12", "name": "Fever中", "threshold": None},
                {"kind": "186", "name": "非Fever", "threshold": None},
                {"kind": "8", "name": "HP≥X%", "threshold": "pct"},
                {"kind": "9", "name": "HP≤X%", "threshold": "pct"},
                {"kind": "119", "name": "技能槽≥X%", "threshold": "pct"},
            ],
            "note": "触发与效果须同模式(瞬发/持续);数值单位自动换算(%×1000,次×100000,倍×100000)"}

def _unit_mul(unit: str) -> int:
    return {"pct": 1000, "count": 100000, "raw": 1, "x": 100000}.get(unit, 1000)

def _blank_template(kind: str, parsed: dict, width: int, tcol: int) -> list[str]:
    """客户端合法空白行模板:每列取官方行众数(按块所属触发模式分组统计)。
    **C7050 铁律(2026-07-13 实锤)**:AbilityValues.parseAt* 的枚举列(前置条件1-3/
    瞬发触发/瞬发内容等)没有空串分支,空串直接 throw ClientError 7050——官方哨兵是
    前置='0'、instant_precontent='(None)'、delay='0';Option 列(time/threshold)的
    None 哨兵是字面量 "(None)" 不是空串。全空白行 = 必崩客户端,模板必须取官方惯例值。"""
    from collections import Counter
    blocks = wf_describe.layout(kind)["blocks"]
    # 每列归属触发模式:precondition* 全模式读;instant_*=0;during_*/even_if=1;opening=2
    order = sorted(blocks.items(), key=lambda kv: kv[1])
    col_mode = {}
    for (bname, base), (nname, nbase) in zip(order, order[1:] + [("", width)]):
        mode = None
        if bname.startswith("instant"):
            mode = "0"
        elif bname.startswith("during") or bname == "even_if_owner_dead":
            mode = "1"
        elif bname == "opening":
            mode = "2"
        for c in range(int(base), int(nbase)):
            col_mode[c] = mode
    cnts = [Counter() for _ in range(width)]
    for rows in parsed.values():
        for r in rows:
            rmode = r[tcol] if tcol < len(r) else ""
            for c in range(width):
                m = col_mode.get(c)
                if m is not None and m != rmode:
                    continue          # 该块只统计对应触发模式的官方行
                cnts[c][r[c] if c < len(r) else ""] += 1
    tpl = [(cnts[c].most_common(1)[0][0] if cnts[c] else "") for c in range(width)]
    return tpl

def generate(dst_key: str, trigger_id: str = "", effect_id: str = "",
                      value: float = 0, value_max=None, threshold=None,
                      target: str = "0", groups: str = "",
                      mode: str = "", trigger_kind: str = "", effect_kind: str = "",
                      effect_unit: str = "pct", threshold_unit: str = "count",
                      puller: str = "0", trigger_groups: str = "",
                      precondition_kind: str = "", precondition_threshold=None,
                      precondition_unit: str = "pct", hits=None,
                      string_id: str = "", action_path: str = "", *, blank_factory, metadata=None, element_index=None) -> dict:
    """生成整行(不写盘;预览后 /composer/apply 写入)。两种调用:
    ① 精选:传 trigger_id/effect_id(取自 catalog.triggers/effects,带默认单位);
    ② 自由:传 mode('instant'|'during') + trigger_kind + effect_kind(枚举 ID,取自 catalog.all)
       + effect_unit('pct'|'count'|'raw'|'x'倍)。自由模式支持全量枚举任意组合。
    通用扩展:precondition_kind=前置条件枚举(如 12=Fever中,阈值单位 pct/count);
    hits=对敌伤害段数(EnemyDamage族 time 列:空=全体/N=最近顺序N段);
    string_id/action_path=InvokeSkill(629) 的技能键与 DSL 路径;
    effect_kind='DMG:all|near|trig'=对敌能力伤害伪 kind,按角色元素解析(元素取
    「角色组/属性」选择,否则自动查 dst_key 所属角色 c3)。"""
    tr = next((t for t in _FXGEN_TRIGGERS if t[0] == trigger_id), None)
    fx = next((e for e in _FXGEN_EFFECTS if e[0] == effect_id), None)
    # 归一化:精选 → 通用参数
    if tr and fx:
        if tr[2] != fx[2]:
            raise ValueError(f"触发({tr[1]})与效果({fx[1]})模式不一致:瞬发配瞬发,持续配持续")
        mode = tr[2]
        trigger_kind = tr[3]
        effect_kind = fx[3]
        effect_unit = fx[4] or "pct"
        threshold_unit = tr[4] or "count"
        if tr[0] == "member":       # 编成:阈值判编成人数、组进触发角色组
            trigger_groups = groups
        tr_name, fx_name = tr[1], fx[1]
    else:
        if mode not in ("instant", "during"):
            raise ValueError("自由模式需 mode='instant'|'during'")
        if not effect_kind:
            raise ValueError("需选择效果(effect_kind)")
        m = (metadata or composer_meta)()
        trcat = "trigger" if mode == "instant" else "during_trigger"
        fxcat = "instant_content" if mode == "instant" else "during_content"
        tr_name = (m["enums"][trcat].get(trigger_kind, {}) or {}).get("cn") \
            or (trigger_kind and f"触发{trigger_kind}") or "常驻"
        fx_name = (m["enums"][fxcat].get(effect_kind, {}) or {}).get("cn") or f"效果{effect_kind}"
    # DMG: 伪 kind → 真实对敌伤害枚举(族基址+元素)。元素:属性下拉 token > 角色 c3 自动
    is_dmg = str(effect_kind).startswith("DMG:")
    if is_dmg:
        if mode != "instant":
            raise ValueError("对敌伤害为瞬发效果,模式须为 instant")
        fam = str(effect_kind)[4:]
        base_k = _DMG_FAMILY_BASE.get(fam)
        if base_k is None:
            raise ValueError(f"未知伤害族: {effect_kind}")
        el = _GROUP_TOKEN_ELEM.get(groups)
        if el is None:
            el = (element_index(dst_key) if element_index else None)
        if el is None:
            raise ValueError("无法确定伤害元素:请在「角色组/属性」下拉选一个属性")
        effect_kind = str(base_k + el)
        groups = ""      # 属性已消费为伤害元素,不写入目标角色组
        fx_name = f"{fx_name}[{['火','水','雷','风','光','暗'][el]}]"

    b = blank_factory(dst_key)
    kind, row = b["kind"], b["row"]
    blocks = wf_describe.layout(kind)["blocks"]
    tcol = blocks["precondition1"] - 1
    vmax = value_max if value_max not in (None, "") else value
    umul = _unit_mul(effect_unit)
    if mode == "instant":
        row[tcol] = "0"
        base = blocks["instant_trigger"]
        row[base] = trigger_kind or "0"          # 空=Initial(常驻/开局)
        row[base + 1] = "0"                       # 来源=自身
        if threshold not in (None, "", 0):
            tmul = _unit_mul(threshold_unit)
            row[base + 3] = row[base + 4] = _encode_numeric(threshold, tmul)
        elif (trigger_kind or "0") not in ("0", "1"):
            # 计数型触发(冲刺/弹射/强化弹射等)官方全库阈值最小=100000(1次),0/0 全库
            # 零先例——写 0 客户端渲染成「0次冲刺时」且触发行为未定义(2026-07-13 实锤)。
            # 空阈值默认=每次(1次=100000)。
            row[base + 3] = row[base + 4] = "100000"
        if (trigger_kind or "0") not in ("0", "1"):
            if not str(row[base + 7]).strip():
                row[base + 7] = "(None)"          # trigger_limit
            if not str(row[base + 8]).strip():
                row[base + 8] = "0"               # cooltime
        if trigger_groups:
            row[base + 9] = trigger_groups        # instant_trigger.character_groups
        cbase = blocks["instant_content"]
    else:
        row[tcol] = "1"
        base = blocks["during_trigger"]
        row[base] = trigger_kind or "0"
        row[base + 1] = str(puller or "0")        # puller 必填(7050:需 puller 的 case 空=崩)
        if threshold not in (None, "", 0):
            tmul = _unit_mul(threshold_unit)
            row[base + 3] = row[base + 4] = _encode_numeric(threshold, tmul)
        if trigger_groups:
            row[base + 6] = trigger_groups        # during_trigger.character_groups
        cbase = blocks["during_content"]
    row[cbase] = effect_kind
    row[cbase + 1] = str(target or "0")
    if mode == "instant" and str(effect_kind) in INSTANT_CONTENT_BOOL_KINDS:
        # parseAt47/parseAt45 -> parseAt72/parseAt70:`by_each_trigger_puller`
        # 是这些条件类瞬发效果的必填 Bool,空串会抛 ClientError 7101(打开角色
        # 详情即崩)。官方数据绝大多数为 false(按触发者分别计数是显式增强);
        # 需要逐触发者计数的调用方可在返回行上手改该列。
        row[cbase + 25] = "false"
    if mode == "instant" and str(effect_kind) in INSTANT_CONTENT_MULTIPLY_KINDS:
        # parseAt75/parseAt73:`multiply_trigger` 也是必填枚举,空串抛
        # C7050("不存在的构造函数");官方默认 0(=None)。
        row[cbase + 28] = "0"
    if mode == "instant" and str(effect_kind) in INSTANT_CONTENT_LIMIT_KINDS:
        # parseAt47/parseAt45 分支里的 Option 列(flip_limit/power_flip_limit/
        # end_power_flip_limit/end_power_flip_accepted_levels = +15..+18):
        # 空串会解析成 Some(null)/Some(0),描述生成器对
        # resolveEndPowerFlipLevels(Some(0)) 的 undefined 结果取 .length,
        # 打开角色详情即 F1009(2026-10-06 凉月实锤)。默认写官方 None 哨兵。
        for offset in (15, 16, 17, 18):
            if not str(row[cbase + offset]).strip():
                row[cbase + offset] = "(None)"
    if mode == "instant" and str(effect_kind) in INSTANT_CONTENT_MAX_ACCUMULATION_KINDS:
        # max_accumulation(+14)同属 Option:空串 = Some(null) = 0 层,
        # 官方只用 '(None)'(=1 层)或数字。
        if not str(row[cbase + 14]).strip():
            row[cbase + 14] = "(None)"
    if groups:
        row[cbase + 2] = groups                   # 目标·角色组(如 全队(火))
    if effect_kind == "629" and float(value or 0) == 0:
        row[cbase + 4] = row[cbase + 5] = ""      # InvokeSkill 不读强度,官方行留空
    else:
        row[cbase + 4] = _encode_numeric(value, umul)
        row[cbase + 5] = _encode_numeric(vmax, umul)
    # 前置条件(precondition1 块:kind / 阈值)
    if precondition_kind not in ("", None):
        pbase = blocks["precondition1"]
        row[pbase] = str(precondition_kind)
        if precondition_threshold not in (None, "", 0):
            pmul = _unit_mul(precondition_unit)
            row[pbase + 3] = row[pbase + 4] = _encode_numeric(precondition_threshold, pmul)
    if mode == "instant":
        if is_dmg:
            # time 列:读 time 的 kind 空串非法(Some(parseInt(''))),None 哨兵=字面量 (None)
            row[cbase + 22] = str(int(hits)) if hits not in (None, "", 0) else "(None)"
        elif hits not in (None, "", 0):           # 其他 kind:仅显式给段数时写
            row[cbase + 22] = str(int(hits))
        if string_id:
            row[cbase + 23] = string_id           # InvokeSkill 技能键
        if action_path:
            row[cbase + 24] = action_path         # InvokeSkill DSL 路径
    desc = wf_describe.describe_line(row, kind)
    return {"key": dst_key, "kind": kind, "ncols": len(row), "row": row, "desc": desc,
            "trigger": tr_name, "effect": fx_name,
            "note": "预览无误后用「追加到词条」写入(走 /composer/apply,自动 dry-run→确认)"}
