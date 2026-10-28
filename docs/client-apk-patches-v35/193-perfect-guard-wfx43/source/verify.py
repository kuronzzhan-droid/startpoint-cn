"""Offline AVM2 bytecode verification, wfxSpec parity, structural & stacking checks."""
from __future__ import annotations

import copy
import hashlib
import inspect
import itertools
import json
import math
import tempfile
import types
from pathlib import Path
from types import SimpleNamespace

import bootstrap
from bootstrap import INPUT_SHA256, INPUT_SWF, OUTPUT_SWF, ROOT, output_path, sha, verify_input
import asm
import avm_interp as base_interp
import bodies
from swfabc import SwfAbc
from audit_support import ALLOWED_TARGETS, FORBIDDEN_CLASSES, audit, body_bytes, require
from build_swf import build_sources, build_swf
from static_check import check_body


def _build_vm():
    source = inspect.getsource(base_interp)
    needle = "            elif op == 'not':\n"
    require(source.count(needle) == 1, "unexpected avm_interp.py structure (not)")
    source = source.replace(
        needle,
        "            elif op == 'in':\n"
        "                obj, key = stack.pop(), stack.pop()\n"
        "                stack.append(key in obj)\n" + needle,
    )
    needle2 = "stack.append(float('nan') if value is None else float(value))"
    require(source.count(needle2) == 1, "unexpected avm_interp.py structure (convert_d)")
    source = source.replace(needle2, "stack.append(_to_number(value))")
    mod = types.ModuleType("guard_avm_vm")
    exec(compile(source, "<avm_interp + in/AS3 conversion>", "exec"), mod.__dict__)
    fallback = mod._lookup

    def lookup(obj, key):
        if isinstance(key, str):
            short = key.split("::")[-1]
            if isinstance(obj, str):
                if short == "split":
                    return obj.split
                if short == "length":
                    return len(obj)
            if isinstance(obj, list) and short == "push":
                return obj.append
        if isinstance(obj, dict) and key in obj:
            return obj[key]
        return fallback(obj, key)

    def truthy(v):
        if isinstance(v, (dict, list, mod.Cls)):
            return True
        return False if v is None or (isinstance(v, float) and math.isnan(v)) else bool(v)

    def number(v):
        try:
            return 0.0 if v is None or v == "" else float(v)
        except (TypeError, ValueError):
            return math.nan

    mod._lookup, mod._truthy, mod._to_number = lookup, truthy, number
    return mod


VM = _load_vm = _build_vm()


class GuardWorld:
    """Executes real serialized AVM2 bytecode from the target ABC."""

    def __init__(self, abc, table=None, loaded=True):
        self.abc = abc
        self.table = dict(table or {})
        self.loaded = loaded
        self.calls = {"table": 0, "exists": 0, "get": 0, "hasAura": 0, "wfxRows": 0}
        self.executed = set()
        self.labels = {v: k for k, v in bodies.label_map(abc).items()}
        self.decoded = {}
        self.lex = {
            "ConditionSlot": {"wfxSpecCache": None, "wfxSpecAsset": None},
            "UniqueConditionTable": object(),
            "Option": {"None": {"index": 1}, "Some": lambda a: {"index": 0, "params": [a]}},
            "StringMap": {"reserved": {}},
            "Math": {"NaN": math.nan},
        }
        self.asset = {"getMasterTableMaybe": self._table}
        self.lex["ConditionSlot"]["wfxSpec"] = lambda uid, asset: self.run(
            "ConditionSlot$/wfxSpec", self.lex["ConditionSlot"], uid, asset
        )

    def _table(self, _cls):
        self.calls["table"] += 1
        if not self.loaded:
            return None
        return {"get_data": lambda: {"exists": self._exists, "get": self._get}}

    def _exists(self, uid):
        self.calls["exists"] += 1
        return uid in self.table

    def _get(self, uid):
        self.calls["get"] += 1
        entry = self.table[uid]
        if isinstance(entry, dict):
            return entry
        return {"string_id": entry}

    def run(self, label, this, *args):
        self.executed.add(label)
        if label not in self.decoded:
            self.decoded[label] = asm.decode(self.abc.bodies[self.labels[label]][5])
        return VM.Interp(self.abc, self.lex).run(self.decoded[label], [this, *args])

    def bind(self, obj, cls, names):
        for name in names:
            obj[name] = lambda *args, n=name: self.run(f"{cls}/{n}", obj, *args)

    def condition(
        self,
        uid,
        layers=1,
        stackable=True,
        content_index=31,
        origin_member_index=0,
        primary_layers=None,
        other_layers=None,
    ):
        p_layers = layers if primary_layers is None else primary_layers
        o_layers = layers if other_layers is None else other_layers
        cond = {
            "_type": "Condition",
            "content": {"index": content_index, "params": [uid]},
            "maxAccumulation": 99 if stackable else 1,
            "magnificationFromPrimary": p_layers,
            "magnificationFromOther": o_layers,
            "originMemberIndex": origin_member_index,
            "isFromHostile": False,
            "isQuestInitial": False,
        }
        self.bind(cond, "Condition", ["get_currentAccumulation", "get_accumulatable", "get_magnification"])
        return cond

    def slot(self, conditions=(), invisible_conditions=(), squad=None, invisible=False, asset="default"):
        vals = {str(i): v for i, v in enumerate(conditions)}
        slot_asset = self.asset if asset == "default" else asset
        result = {
            "_type": "ConditionSlot",
            "conditions": {"_keys": list(vals), "map": {"get": vals.get, "h": vals}},
            "asset": slot_asset,
            "invisibleSlot": None,
            "squadSlot": {"index": 1} if squad is None else {"index": 0, "params": [squad]},
            "get_isInvisibleSlot": lambda: invisible,
        }
        if not invisible:
            result["invisibleSlot"] = self.slot(
                conditions=invisible_conditions, invisible=True, asset=asset
            )

        def wfx_rows(code, include_squad):
            self.calls["wfxRows"] += 1
            return self.run("ConditionSlot/wfxRows", result, code, include_squad)

        result["wfxCollect"] = lambda code, out: self.run("ConditionSlot/wfxCollect", result, code, out)
        result["wfxRows"] = wfx_rows
        return result

    def ball(self, aura=False):
        b = {"_type": "BallImpl", "aura": aura}

        def has_aura():
            self.calls["hasAura"] += 1
            return self.run("BallImpl/hasAura", b)

        b["hasAura"] = has_aura
        return b

    def member(
        self,
        conditions=(),
        invisible_conditions=(),
        squad_conditions=(),
        squad_invisible_conditions=(),
        aura=False,
        slot="default",
        asset="default",
    ):
        if slot == "default":
            has_squad = bool(squad_conditions or squad_invisible_conditions)
            squad_slot = (
                self.slot(
                    conditions=squad_conditions,
                    invisible_conditions=squad_invisible_conditions,
                    asset=asset,
                )
                if has_squad
                else None
            )
            member_slot = self.slot(
                conditions=conditions,
                invisible_conditions=invisible_conditions,
                squad=squad_slot,
                asset=asset,
            )
        else:
            member_slot = slot
        m = {
            "_type": "MemberImpl",
            "ball": self.ball(aura=aura),
            "conditionSlot": member_slot,
        }
        self.bind(m, "MemberImpl", ["hasGuarded"])
        return m


def run_behavior_cases(before_abc, after_abc):
    cases = []

    def record(name, **evidence):
        cases.append({"name": name, "pass": True, **evidence})

    w_old = GuardWorld(before_abc)
    w = GuardWorld(after_abc)

    # 1. 无码43状态、球无光环 -> false
    m_empty = w.member(aura=False)
    res_empty = m_empty["hasGuarded"]()
    old_empty = w_old.member(aura=False)["hasGuarded"]()
    require(res_empty is False and old_empty is False, f"expected False, got {res_empty}")
    require(w.calls["hasAura"] == 1 and w.calls["wfxRows"] == 1, "unexpected call counts on empty member")
    record("no_code43_no_aura_returns_false", result=res_empty, baseline=old_empty)

    # 2. 球有光环 -> true (两种状态都测: 无码43状态、有码43状态，且验证先判短路)
    w.table[430001] = "wfx:43:0:0:0:hidden_gerald_guard"
    calls_before = dict(w.calls)
    m_aura_no_c43 = w.member(aura=True)
    res_aura_no_c43 = m_aura_no_c43["hasGuarded"]()
    require(res_aura_no_c43 is True, "aura=True without code43 must return True")
    require(
        w.calls["hasAura"] == calls_before["hasAura"] + 1 and w.calls["wfxRows"] == calls_before["wfxRows"],
        "ball.hasAura() == true must short-circuit before calling wfxRows",
    )

    m_aura_with_c43 = w.member(conditions=[w.condition(430001)], aura=True)
    res_aura_with_c43 = m_aura_with_c43["hasGuarded"]()
    require(res_aura_with_c43 is True, "aura=True with code43 must return True")
    require(
        w.calls["wfxRows"] == calls_before["wfxRows"],
        "ball.hasAura() == true with code43 must also short-circuit before calling wfxRows",
    )

    m_aura_null_slot = w.member(aura=True, slot=None)
    require(m_aura_null_slot["hasGuarded"]() is True, "aura=True with null conditionSlot must return True")
    record(
        "ball_aura_true_both_states_and_short_circuit",
        without_code43=res_aura_no_c43,
        with_code43=res_aura_with_c43,
        short_circuited_wfxRows=True,
    )

    # 3. 有码43状态(球无光环) -> true (覆盖可见槽、隐形槽、队伍共享可见槽、队伍共享隐形槽)
    m_vis = w.member(conditions=[w.condition(430001)], aura=False)
    m_invis = w.member(invisible_conditions=[w.condition(430001)], aura=False)
    m_squad_vis = w.member(squad_conditions=[w.condition(430001)], aura=False)
    m_squad_invis = w.member(squad_invisible_conditions=[w.condition(430001)], aura=False)
    for tag, m_obj in (
        ("visible", m_vis),
        ("invisible", m_invis),
        ("squad_visible", m_squad_vis),
        ("squad_invisible", m_squad_invis),
    ):
        val = m_obj["hasGuarded"]()
        require(val is True, f"code43 in {tag} slot must return True, got {val}")
    record(
        "code43_present_in_member_or_squad_slots_returns_true",
        slots_verified=["member_visible", "member_invisible", "squad_visible", "squad_invisible"],
    )

    # 4. 主位与合击来源共用同一个 MemberImpl，以及层数/arg/value/flags 全忽略
    param_variants = [
        (430010, "wfx:43:0:0:0:guard_default", 1, False, 0),
        (430011, "wfx:43:1:5000:2:hidden_gerald_guard", 1, True, 0),
        (430012, "wfx:43:99:20000:7:unison_guard", 5, True, 1),
        (430013, "wfx:43:-1:-10000:-2:signed_future_ext", 3, True, 1),
        (430014, "wfx:43:2147483647:-2147483648:2147483647:", 99, True, 0),
    ]
    for uid, spec_str, layers, stackable, origin_idx in param_variants:
        w.table[uid] = spec_str
        cond = w.condition(uid, layers=layers, stackable=stackable, origin_member_index=origin_idx)
        res = w.member(conditions=[cond], aura=False)["hasGuarded"]()
        require(res is True, f"variant {spec_str} (layers={layers}, origin={origin_idx}) failed")
    record(
        "code43_ignores_layers_arg_value_flags_and_covers_main_and_unison",
        variants_tested=len(param_variants),
    )

    # 5. 码43状态以外的 wfx 码(30/36/41 及全部已占用码) -> false
    other_codes = [0, *range(24, 37), 41, 42, 59, 60, 61, 62, 71, 999]
    other_conds = []
    for code in other_codes:
        uid = 500000 + code
        w.table[uid] = f"wfx:{code}:0:10000:0:hidden_other_{code}"
        cond = w.condition(uid, layers=2)
        other_conds.append(cond)
        single_res = w.member(conditions=[cond], aura=False)["hasGuarded"]()
        require(single_res is False, f"non-43 wfx code {code} returned True")
    combined_other_res = w.member(
        conditions=other_conds[:10],
        invisible_conditions=other_conds[10:18],
        squad_conditions=other_conds[18:],
        aura=False,
    )["hasGuarded"]()
    require(combined_other_res is False, "combined non-43 wfx codes returned True")
    record(
        "other_wfx_codes_return_false",
        explicitly_checked=[30, 36, 41],
        all_checked_codes=other_codes,
    )

    # 6. 非 wfx 普通固有状态 -> false
    w.table[600001] = "unique_atk_up_normal"
    w.table[600002] = "hidden_passive_unique"
    w.table[600003] = "gerald_guard_43"
    ordinary_conds = [
        w.condition(0, content_index=0),   # AttackPoint
        w.condition(0, content_index=21),  # Flying
        w.condition(0, content_index=30),  # Guts
        w.condition(0, content_index=37),  # ComboLimit
        w.condition(600001, content_index=31),
        w.condition(600002, content_index=31),
        w.condition(600003, content_index=31),
    ]
    for cond in ordinary_conds:
        require(w.member(conditions=[cond], aura=False)["hasGuarded"]() is False, "ordinary condition returned True")
    require(
        w.member(conditions=ordinary_conds, aura=False)["hasGuarded"]() is False,
        "combined ordinary conditions returned True",
    )
    record("non_wfx_ordinary_and_unique_conditions_return_false", count=len(ordinary_conds))

    # 7. 解析失败的串 / 缺表 / 空指针边界 -> false 且不抛
    malformed_strings = [
        "",
        "wfx",
        "wfx:",
        "wfx:43",
        "wfx:43:0",
        "wfx:43:0:0",
        "wfx:43:0:0:0",
        "WFX:43:0:0:0:guard",
        " wfx:43:0:0:0:guard",
        "wfx::0:0:0:guard",
        "wfx:43::0:0:guard",
        "wfx:43:0::0:guard",
        "wfx:43:0:0::guard",
        "wfx:abc:0:0:0:guard",
        "wfx:43:abc:0:0:guard",
        "wfx:43:0:abc:0:guard",
        "wfx:43:0:0:abc:guard",
        "wfx:43.5:0:0:0:guard",
        "wfx:43:1.5:0:0:guard",
        "wfx:43:0:1.5:0:guard",
        "wfx:43:0:0:1.5:guard",
        "wfx:43:NaN:0:0:guard",
        "wfx:43:0:NaN:0:guard",
        "wfx:43:0:0:NaN:guard",
        "wfx:43:Infinity:0:0:guard",
        "wfx:43:-Infinity:0:0:guard",
        "wfx:43:2147483648:0:0:guard",
        "wfx:43:-2147483649:0:0:guard",
        "wfx:43:0:2147483648:0:guard",
        "wfx:43:0:0:2147483648:guard",
        "wfx:-1:0:0:0:guard",
        "wfx:-43:0:0:0:guard",
        None,
    ]
    malformed_conds = []
    for idx, text in enumerate(malformed_strings, 700000):
        w.table[idx] = text
        c = w.condition(idx)
        malformed_conds.append(c)
        require(
            w.member(conditions=[c], aura=False)["hasGuarded"]() is False,
            f"malformed string {text!r} did not return False",
        )
    # Missing table key, null row, unloaded table, null asset, null conditionSlot
    w.table[709998] = None
    unregistered_cond = w.condition(709999)
    null_row_cond = w.condition(709998)
    require(
        w.member(conditions=[unregistered_cond, null_row_cond], aura=False)["hasGuarded"]() is False,
        "missing/null table row did not return False",
    )
    w_unloaded = GuardWorld(after_abc, table={430001: "wfx:43:0:0:0:guard"}, loaded=False)
    require(
        w_unloaded.member(conditions=[w_unloaded.condition(430001)], aura=False)["hasGuarded"]() is False,
        "unloaded UniqueConditionTable did not return False",
    )
    require(
        w.member(conditions=[w.condition(430001)], aura=False, asset=None)["hasGuarded"]() is False,
        "null asset did not return False",
    )
    require(
        w.member(aura=False, slot=None)["hasGuarded"]() is False,
        "null conditionSlot with aura=False did not return False",
    )
    record(
        "malformed_strings_and_missing_assets_return_false_without_throwing",
        malformed_count=len(malformed_strings),
        boundary_guards=["missing_uid", "null_row", "unloaded_table", "null_asset", "null_conditionSlot"],
    )

    # 8. 纯函数与三端 lockstep 一致性验证
    def run_peer():
        peer = GuardWorld(after_abc, table={430001: "wfx:43:0:0:0:hidden_guard", 360001: "wfx:36:0:20000:10000:pf"})
        c43 = peer.condition(430001, layers=2)
        c36 = peer.condition(360001, layers=1)
        m = peer.member(conditions=[c36], invisible_conditions=[c43], aura=False)
        snap_before = (
            m["ball"]["aura"],
            list(m["conditionSlot"]["conditions"]["_keys"]),
            list(m["conditionSlot"]["invisibleSlot"]["conditions"]["_keys"]),
            c43["magnificationFromPrimary"],
            c36["magnificationFromPrimary"],
        )
        r1 = m["hasGuarded"]()
        r2 = m["hasGuarded"]()
        snap_after = (
            m["ball"]["aura"],
            list(m["conditionSlot"]["conditions"]["_keys"]),
            list(m["conditionSlot"]["invisibleSlot"]["conditions"]["_keys"]),
            c43["magnificationFromPrimary"],
            c36["magnificationFromPrimary"],
        )
        require(snap_before == snap_after, "hasGuarded mutated member or condition state")
        return [r1, r2, snap_after]

    p1, p2, p3 = run_peer(), run_peer(), run_peer()
    require(p1 == p2 == p3 and p1[0] is True and p1[1] is True, "lockstep peers disagreed")
    record("pure_function_and_three_peer_lockstep_consistency", results=p1[:2])

    required_executed = {
        "MemberImpl/hasGuarded",
        "BallImpl/hasAura",
        "ConditionSlot/wfxRows",
        "ConditionSlot/wfxCollect",
        "ConditionSlot$/wfxSpec",
        "Condition/get_currentAccumulation",
        "Condition/get_accumulatable",
        "Condition/get_magnification",
    }
    require(required_executed <= w.executed, f"missing executed methods: {required_executed - w.executed}")
    return cases, sorted(w.executed)


def verify_wfx_spec_parity(before_abc, after_abc):
    """Verify old codes (including 36) have identical wfxSpec results, and code 43 accepts signed int32."""
    old_codes = [*range(37), 37, 41, 42, 44, 59, 60, 61, 62, 71, 999, 9999, 2147483647]
    tokens = [
        "0",
        "1",
        "-1",
        "2147483647",
        "-2147483648",
        "2147483648",
        "-2147483649",
        "4294967296",
        "1.5",
        "-0.5",
        "",
        "NaN",
        "Infinity",
        "abc",
        "1.0",
        "1e1",
        "+1",
        "-0",
    ]

    def invoke(world, uid, text):
        world.table[uid] = text
        prior = dict(world.calls)
        result = world.run("ConditionSlot$/wfxSpec", world.lex["ConditionSlot"], uid, world.asset)
        reads = {k: world.calls[k] - prior[k] for k in ("table", "exists", "get")}
        cached_before = dict(world.calls)
        cached = world.run("ConditionSlot$/wfxSpec", world.lex["ConditionSlot"], uid, world.asset)
        require(cached is result, f"cache reference mismatch for {text}")
        require(world.calls == cached_before, f"cache miss re-read master table for {text}")
        return result, reads

    old_w, new_w = GuardWorld(before_abc), GuardWorld(after_abc)
    records = []
    uid = 910000
    for code in old_codes:
        for field, token in itertools.product((2, 3, 4), tokens):
            parts = ["wfx", str(code), "0", "0", "0", "hidden_parser"]
            parts[field] = token
            text = ":".join(parts)
            uid += 1
            left, old_reads = invoke(old_w, uid, text)
            right, new_reads = invoke(new_w, uid, text)
            require(left == right and old_reads == new_reads, f"wfxSpec drift on {text}: {left} vs {right}")
            records.append([code, field, token, left])
        for tail in (
            "-1:0:-1:hidden_parser",
            "-2147483648:-2147483648:-2147483648:hidden_parser",
            "2147483647:2147483647:2147483647:hidden_parser",
            "0:20000:10000:hidden_wg_aqua_unison_pf",
            "0:0:0",
            "0:0",
            "0",
            "0:0:0:",
            "0:0:0:hidden_parser:extra",
        ):
            text = f"wfx:{code}:{tail}"
            uid += 1
            left, old_reads = invoke(old_w, uid, text)
            right, new_reads = invoke(new_w, uid, text)
            require(left == right and old_reads == new_reads, f"wfxSpec drift on {text}: {left} vs {right}")
            records.append([code, tail, left])

    # Explicit oracle checks for code 36, 33, 28, 29, 35
    for code, arg, flags, accepted in (
        (36, -1, -1, True),
        (36, 0, 10000, True),
        (33, -1, -1, True),
        (28, 0, -1, True),
        (29, 0, -1, True),
        (35, -1, 0, False),
        (35, 0, -1, False),
        (41, 0, 0, True),
        (42, 0, 0, True),
    ):
        uid += 1
        res, _ = invoke(new_w, uid, f"wfx:{code}:{arg}:-1:{flags}:")
        expected = [code, arg, -1, flags] if accepted else None
        require(res == expected, f"oracle mismatch for code {code}: {res} != {expected}")

    # Code 43 signed int32 boundary checks
    bounds = [-2147483648, -1, 0, 1, 2147483647]
    code43_accepted = 0
    for idx, values in enumerate(itertools.product(bounds, repeat=3), 950000):
        text = "wfx:43:%d:%d:%d:hidden_guard" % values
        res, _ = invoke(new_w, idx, text)
        require(res == [43, *values], f"code 43 rejected valid signed int32 {text}: {res}")
        code43_accepted += 1

    digest = hashlib.sha256(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "pass": True,
        "legacy_parity_cases": len(records),
        "legacy_codes_checked": old_codes,
        "code36_and_legacy_identical_to_input": True,
        "code43_signed_int32_accepted_cases": code43_accepted,
        "parity_digest_sha256": digest,
    }


def verify_structure_and_stacking(before_swf, after_swf, audit_report):
    """Run negative fault-injection checks and verify independent patch stacking on a modified SWF."""
    editor = SimpleNamespace(
        report=audit_report["changed_methods"],
        new_methods=audit_report["new_methods"],
        traits=[tuple(v) for v in audit_report["structural_audit"]["appended_traits"]],
    )
    positive = audit(before_swf, after_swf, editor, ALLOWED_TARGETS)

    negative_checks = []

    def reject(name, mutate, restore):
        mutate()
        try:
            audit(before_swf, after_swf, editor, ALLOWED_TARGETS)
        except (ValueError, RuntimeError, asm.AsmError) as error:
            negative_checks.append({"case": name, "pass": True, "rejection": str(error)})
        else:
            raise ValueError(f"negative structural case was accepted: {name}")
        finally:
            restore()

    # 1. Forbidden class method mutation
    for cls in FORBIDDEN_CLASSES:
        idx = next(
            i for i, lbl in bodies.label_map(after_swf.abc).items() if lbl.startswith(f"{cls}/")
        )
        b = after_swf.abc.bodies[idx]
        old_code = b[5]
        reject(
            f"forbidden class {cls} modified",
            lambda b=b, old_code=old_code: b.__setitem__(5, old_code + b"\x02"),
            lambda b=b, old_code=old_code: b.__setitem__(5, old_code),
        )

    # 2. Unrelated MemberImpl method mutation
    other_member_idx = next(
        i
        for i, lbl in bodies.label_map(after_swf.abc).items()
        if lbl.startswith("MemberImpl/") and lbl != "MemberImpl/hasGuarded"
    )
    mb = after_swf.abc.bodies[other_member_idx]
    old_mb = mb[5]
    reject(
        "other MemberImpl method modified",
        lambda: mb.__setitem__(5, old_mb + b"\x02"),
        lambda: mb.__setitem__(5, old_mb),
    )

    # 3. Non-reversible instruction edit in MemberImpl/hasGuarded
    hg_idx = bodies.resolve(after_swf.abc, "MemberImpl/hasGuarded")
    hg_b = after_swf.abc.bodies[hg_idx]
    old_hg = hg_b[5]
    reject(
        "non-reversible MemberImpl/hasGuarded edit",
        lambda: hg_b.__setitem__(5, old_hg + b"\x02"),
        lambda: hg_b.__setitem__(5, old_hg),
    )

    # 4. Existing constant pool entry mutated
    old_s = after_swf.abc.strings[1]
    reject(
        "existing constant pool mutated",
        lambda: after_swf.abc.strings.__setitem__(1, old_s + b"x"),
        lambda: after_swf.abc.strings.__setitem__(1, old_s),
    )

    # 5. Added class
    reject(
        "added class",
        lambda: after_swf.abc.instances.append(after_swf.abc.instances[0]),
        lambda: after_swf.abc.instances.pop(),
    )

    # 6. Independent stacking test: modify an unrelated method in a temporary SWF inside build/,
    # then run build_swf(--input, --output) and verify both patches coexist and revert cleanly.
    tmp_dir = output_path(ROOT / "build" / ".stacking-test" / "dummy").parent
    other_swf_path = tmp_dir / "other-thread-patched.swf"
    stacked_swf_path = tmp_dir / "stacked-guard.swf"
    try:
        other_swf = SwfAbc(INPUT_SWF)
        unrelated_label = "BattleContinuationData/bothbossNext"
        u_idx = bodies.resolve(other_swf.abc, unrelated_label)
        u_body = other_swf.abc.bodies[u_idx]
        u_before = u_body[5]
        # Insert a harmless nop at index 2 of an unrelated method to simulate another thread's patch
        u_spliced, u_exc, _, u_rec = asm.splice_many(
            u_body, [(2, asm.assemble([("nop",)]), asm.ENTER)]
        )
        u_body[5], u_body[6] = u_spliced, u_exc
        other_swf.abc.strings.append(b"other_thread_marker")
        other_raw = other_swf.serialize()
        other_swf_path.write_bytes(other_raw)
        require(sha(other_raw) != INPUT_SHA256, "simulated other-thread SWF must have different whole-SWF SHA")

        stacked_report = build_swf(other_swf_path, stacked_swf_path)
        stacked_swf = SwfAbc(stacked_swf_path)
        require(
            stacked_swf.abc.bodies[u_idx][5] == u_spliced,
            "stacking overwrote the other thread's unrelated method change",
        )
        require(
            stacked_swf.abc.bodies[bodies.resolve(stacked_swf.abc, "MemberImpl/hasGuarded")][5]
            == after_swf.abc.bodies[hg_idx][5],
            "stacked MemberImpl/hasGuarded bytecode differs",
        )
        stacking_result = {
            "pass": True,
            "simulated_other_method": unrelated_label,
            "other_swf_sha256": sha(other_raw),
            "stacked_swf_sha256": stacked_report["output_sha256"],
        }
    finally:
        for p in tmp_dir.glob("*"):
            if p.is_file():
                p.unlink()
        if (tmp_dir / "pcode").exists():
            for p in (tmp_dir / "pcode").glob("*"):
                p.unlink()
            (tmp_dir / "pcode").rmdir()
        if tmp_dir.exists():
            tmp_dir.rmdir()

    return {
        "pass": True,
        "positive_audit": positive,
        "negative_cases": negative_checks,
        "independent_stacking": stacking_result,
    }


def source_hashes():
    files = [
        path
        for path in ROOT.rglob("*.py")
        if "__pycache__" not in path.parts and "vendor-ref" not in path.parts
    ]
    return {
        path.relative_to(ROOT).as_posix(): sha(path.read_bytes())
        for path in sorted(files)
    }


def main():
    before_sources = source_hashes()
    verify_input(INPUT_SWF)
    require(OUTPUT_SWF.exists(), f"missing output SWF: {OUTPUT_SWF}; run build_swf.py first")
    audit_report = json.loads((ROOT / "build" / "audit.json").read_text(encoding="utf-8"))
    output_digest = sha(OUTPUT_SWF.read_bytes())
    require(output_digest == audit_report["output_sha256"], "audit.json / output SWF SHA256 mismatch")

    before_swf = SwfAbc(INPUT_SWF)
    after_swf = SwfAbc(OUTPUT_SWF)

    cases, executed = run_behavior_cases(before_swf.abc, after_swf.abc)
    parser_parity = verify_wfx_spec_parity(before_swf.abc, after_swf.abc)
    structure = verify_structure_and_stacking(before_swf, after_swf, audit_report)

    after_sources = source_hashes()
    require(before_sources == after_sources, "source files changed during verification")
    require(sha(OUTPUT_SWF.read_bytes()) == output_digest, "verification mutated output SWF")

    method_summary = {}
    for label, info in audit_report["changed_methods"].items():
        method_summary[label] = {
            "body_index": info["body"],
            "before_sha256": info["before"],
            "after_sha256": info["after"],
            "before_header": info["before_header"],
            "after_header": info["after_header"],
        }

    report = {
        "pass": True,
        "input_swf": "input/riven-wt-1008092.swf",
        "input_sha256": INPUT_SHA256,
        "output_swf": "build/guard-wt-1008092.swf",
        "output_sha256": output_digest,
        "patched_methods": method_summary,
        "added_methods": audit_report["new_methods"],
        "behavior_cases_passed": len(cases),
        "behavior_cases": cases,
        "executed_methods": executed,
        "wfx_spec_parity": parser_parity,
        "structure_and_stacking": structure,
        "source_sha256": before_sources,
        "test_source_unchanged_during_run": True,
        "scope": "Real serialized AVM2 bytecode execution on MemberImpl/hasGuarded, BallImpl/hasAura, ConditionSlot/wfxRows, ConditionSlot/wfxCollect, ConditionSlot$/wfxSpec, and Condition accumulation methods",
        "not_verified": [
            "Real Android device / emulator execution",
            "Adobe AIR native runtime verifier",
            "Live three-device network lockstep battle session",
        ],
    }
    report_path = output_path(ROOT / "verify-report.json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "pass": True,
                "output_swf": report["output_swf"],
                "output_sha256": output_digest,
                "behavior_cases_passed": len(cases),
                "wfx_spec_parity_cases": parser_parity["legacy_parity_cases"],
                "negative_structural_cases": len(structure["negative_cases"]),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
