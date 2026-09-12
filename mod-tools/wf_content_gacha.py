"""本轮自制角色卡池的整数权重：实际概率与客户端显示共用结果。"""
from copy import deepcopy
from fractions import Fraction

MINIBOSSES = frozenset((119993, 119994, 119995, 129993, 129994, 129995, 129996, 129998,
                       139996, 149991, 149992, 149993, 149994, 159999, 169993))
NEW_ABYSS_ZERO = frozenset((119989, 149989, 169989, 149988))
EARLY_CANARIES = frozenset((119998, 119999))
# 用户指定保持0%的完整系列：六荒龙、六精灵兽、七蒸汽机兵、六肃清者。
BIG_BOSS_ZERO = frozenset((119950, 129950, 139950, 149950, 159950, 169950,
    119951, 129951, 139951, 149951, 159951, 169951,
    119970, 129970, 139970, 149970, 159970, 169970, 179970,
    179981, 179982, 179983, 179984, 179985, 179986))


def allocate(weights, total):
    """最大余数法保留相对权重；整数总和严格等于目标，0权重始终为0。"""
    if total < 0 or any(v < 0 for v in weights.values()) or sum(weights.values()) <= 0:
        raise ValueError("invalid remaining probability allocation")
    exact = {k: Fraction(v * total, sum(weights.values())) for k, v in weights.items()}
    result = {k: int(v) for k, v in exact.items()}
    order = sorted(exact, key=lambda k: (-(exact[k] - result[k]), k))
    for key in order[:total - sum(result.values())]:
        result[key] += 1
    if sum(result.values()) != total:
        raise AssertionError("integer allocation failed")
    return result


def probability(pool, cid):
    entries = pool["pool"]["1"]
    matches = [e for e in entries if int(e["id"]) == int(cid)]
    if len(matches) != 1:
        raise ValueError(f"missing/duplicate gacha character {cid}")
    return Fraction(pool["rankRates"]["normal"][0], 1000) * Fraction(
        int(matches[0]["odds"]), sum(int(e["odds"]) for e in entries))


def update_entries(pool, fixed, total):
    entries = pool["pool"]["1"]
    old = {int(e["id"]): deepcopy(e) for e in entries}
    if len(old) != len(entries):
        raise ValueError("duplicate input pool entry")
    flexible = {cid: int(e["odds"]) for cid, e in old.items() if cid not in fixed}
    weights = allocate(flexible, total - sum(fixed.values()))
    weights.update(fixed)
    order = list(old) + sorted(set(fixed) - set(old))
    result = []
    for cid in order:
        entry = old.get(cid, dict(id=cid, rank=5, isRateUp=False, isLimited=False,
                                 isExchangeable=True, trialReadingForced=False))
        entry["odds"] = weights[cid]
        entry["rarity"] = round(weights[cid] * 100 / total, 6)
        if cid in NEW_ABYSS_ZERO and fixed.get(cid) == 0:
            entry["isExchangeable"] = False
        result.append(entry)
    pool["pool"]["1"] = result


def build(gacha, custom_ids):
    custom_ids = frozenset(map(int, custom_ids))
    if not MINIBOSSES <= custom_ids or not NEW_ABYSS_ZERO <= custom_ids:
        raise ValueError("custom roster omits requested characters")
    drawable = custom_ids - BIG_BOSS_ZERO
    if len(drawable) >= 95:
        raise ValueError("custom 1% allocation exhausts racing five-star probability")
    result = deepcopy(gacha)
    abyss = result["990001"]
    # 15小Boss占30%，旧卡池剩余分布按原比例缩至70%。
    if abyss["rankRates"]["normal"] != [150, 350, 500]:
        raise ValueError("unreviewed Abyss rank-rate baseline")
    abyss["rankRates"]["normal"] = [405, 245, 350]
    abyss["rankRates"]["multiGuarantee"] = [405, 595]
    fixed = {cid: 20000 for cid in MINIBOSSES}
    fixed.update({cid: 0 for cid in NEW_ABYSS_ZERO | {149990}})
    fixed.update({int(e['id']): 0 for e in abyss['pool']['1'] if int(e['id']) in BIG_BOSS_ZERO})
    update_entries(abyss, fixed, 405000)
    racing = result["990002"]
    if racing["rankRates"]["normal"] != [950, 20, 30]:
        raise ValueError("unreviewed racing rank-rate baseline")
    update_entries(racing, {cid: 10000 if cid in drawable else 0 for cid in custom_ids}, 950000)
    for cid in MINIBOSSES:
        if probability(abyss, cid) != Fraction(2, 100):
            raise AssertionError("Abyss miniboss rate is not 2%")
    for cid in NEW_ABYSS_ZERO | {149990}:
        if probability(abyss, cid):
            raise AssertionError("zero-rate character became drawable")
    for cid in custom_ids:
        if probability(racing, cid) != (Fraction(1, 100) if cid in drawable else 0):
            raise AssertionError("racing custom rate does not match requested exception")
    for entry in abyss['pool']['1']:
        if int(entry['id']) in BIG_BOSS_ZERO and entry['odds']:
            raise AssertionError("excluded Abyss boss became drawable")
    if any(result[k] != v for k, v in gacha.items() if k not in ("990001", "990002")):
        raise AssertionError("unrelated gacha changed")
    return result
