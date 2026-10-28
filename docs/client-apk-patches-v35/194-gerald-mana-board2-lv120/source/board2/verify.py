"""Offline AVM2 bytecode verification, dual-SWF parity, structural & stacking checks."""
from __future__ import annotations

import inspect
import json
import math
import types
from pathlib import Path
from types import SimpleNamespace

import bootstrap
from bootstrap import (
    INPUT_SHA256,
    INPUT_SWF,
    OUTPUT_SWF,
    RIVEN_OUTPUT_SWF,
    RIVEN_SHA256,
    RIVEN_SWF,
    ROOT,
    output_path,
    sha,
    verify_input,
)
import asm
import avm_interp as base_interp
import bodies
from swfabc import SwfAbc
from audit_support import ALLOWED_TARGETS, FORBIDDEN_CLASSES, audit, require
from build_swf import build_swf
import patch


def _build_vm():
    source = inspect.getsource(base_interp)
    needle = "            elif op == 'getlex':\n                stack.append(self._lex(self.name(a[0])))"
    require(source.count(needle) == 1, "unexpected avm_interp.py structure (getlex)")
    source = source.replace(
        needle,
        "            elif op == 'getlex':\n                stack.append(self._lex(self.name(a[0]), scopes))",
    )
    needle_dbg = "if op in ('nop', 'avm_label', 'label', 'debug', 'debugline', 'debugfile', 'bkpt'):"
    require(source.count(needle_dbg) == 1, "unexpected avm_interp.py structure (debug)")
    source = source.replace(
        needle_dbg,
        "if op in ('nop', 'avm_label', 'label', 'debug', 'debugline', 'debugfile', 'bkpt', 'op_ef', 'op_f0', 'op_f1', 'op_f2'):",
    )
    mod = types.ModuleType("board2_avm_vm")
    exec(compile(source, "<avm_interp + scope getlex>", "exec"), mod.__dict__)
    fallback = mod._lookup

    def lookup(obj, key):
        if isinstance(key, str):
            short = key.split("::")[-1]
            if isinstance(obj, list):
                if short == "push":
                    return obj.append
                if short == "indexOf":
                    return lambda v: obj.index(v) if v in obj else -1
                if short == "length":
                    return len(obj)
        if isinstance(obj, dict) and key in obj:
            return obj[key]
        return fallback(obj, key)

    orig_lex = mod.Interp._lex

    def lex_with_scope(self, name, scopes=()):
        s = mod.short(name)
        for scope in reversed(scopes):
            if isinstance(scope, dict):
                if name in scope:
                    return scope[name]
                if s in scope:
                    return scope[s]
        return orig_lex(self, name)

    mod._lookup = lookup
    mod.Interp._lex = lex_with_scope
    return mod


VM = _build_vm()

BASE_LEVEL_CAPS = {1: 40, 2: 50, 3: 60, 4: 70, 5: 80}
REQUIRED_OVER_LIMIT_STEPS = {
    1: {2: 10},
    2: {2: 8},
    3: {2: 6},
    4: {2: 4},
    5: {2: 2},
}


class Board2World:
    """Executes real serialized AVM2 bytecode from the target ABC."""

    def __init__(self, abc):
        self.abc = abc
        self.labels = {v: k for k, v in bodies.label_map(abc).items()}
        self.decoded = {}
        self.executed = set()

        def make_cond_ctor(tag, index, params):
            inst = {"_type": "ManaBoardOpenRequiredCondition"}
            self.run("ManaBoardOpenRequiredCondition/<ctor>", inst, tag, index, params)
            return inst

        cond_cls = VM.Cls(
            "ManaBoardOpenRequiredCondition",
            ctor=make_cond_ctor,
            Level=lambda lv: self.run("ManaBoardOpenRequiredCondition$/Level", cond_cls, lv),
            LearnAllNodes=lambda bd: self.run(
                "ManaBoardOpenRequiredCondition$/LearnAllNodes", cond_cls, bd
            ),
            OverLimit=lambda step: self.run("ManaBoardOpenRequiredCondition$/OverLimit", cond_cls, step),
        )
        self.lex = {
            "BoardOpenConditionValues": VM.Cls("BoardOpenConditionValues"),
            "BoardOpenConditionTable": VM.Cls("BoardOpenConditionTable"),
            "ManaBoardOpenRequiredCondition": cond_cls,
            "DialogContent": {
                "CustomText": lambda text, *_rest: {"kind": "CustomText", "text": text},
            },
            "DialogTextViewTextColor": {"Normal": 0, "Notice": 1},
            "DialogTextViewTextAlign": {"Head": 0},
            "DialogContentIndentKind": {"None": 0},
            "DialogTextViewBackgroundColor": {"None": 0},
            "Option": {"None": {"index": 1}},
            "FunctionTools": {"emptyFunction1": lambda *_a: None},
            "OkDialog": VM.Cls("OkDialog", ctor=lambda contents, cb: {"contents": contents, "cb": cb}),
        }
        self.logic_assets = {
            "getMasterTable": lambda _cls: {"get_data": self._board_open_table},
        }

    def _board_open_table(self):
        def get_rarity_map(rarity):
            sub = REQUIRED_OVER_LIMIT_STEPS[rarity]
            return {
                "exists": lambda board_idx: board_idx in sub,
                "get": lambda board_idx: {
                    "_type": "BoardOpenConditionValues",
                    "required_over_limit_step": sub[board_idx],
                },
            }

        return {
            "exists": lambda rarity: rarity in REQUIRED_OVER_LIMIT_STEPS,
            "get": get_rarity_map,
        }

    def run(self, label, this, *args):
        self.executed.add(label)
        if label not in self.decoded:
            self.decoded[label] = asm.decode(self.abc.bodies[self.labels[label]][5])
        return VM.Interp(self.abc, self.lex).run(self.decoded[label], [this, *args])

    def character(
        self,
        char_id: int,
        rarity: int = 5,
        level: int = 80,
        over_limit_step: int = 2,
        learned_boards: tuple[int, ...] = (1,),
        board_indexes: tuple[int, ...] = (1, 2),
        opened_board_index: int = 1,
        gettable_nodes_boards: tuple[int, ...] = (),
        awake_mission_opened: bool = False,
    ):
        base_cap = BASE_LEVEL_CAPS[rarity]
        learned_set = set(learned_boards)
        gettable_set = set(gettable_nodes_boards)
        ch = {
            "_type": "OwnedCharacterLogic",
            "id": char_id,
            "overLimitStep": over_limit_step,
            "logicAssets": self.logic_assets,
            "characterSaveData": {"mana_board_index": opened_board_index, "bond_token_list": []},
            "get_rarity": lambda: rarity,
            "get_level": lambda: level,
            "get_baseLevelCap": lambda: base_cap,
            "hasLearnedAllManaNodeOfManaBoard": lambda b: b in learned_set,
            "getManaBoardIndexes": lambda: list(board_indexes),
            "get_openedManaBoardIndex": lambda: opened_board_index,
            "hasGettableManaNodeForManaBoard": lambda b: b in gettable_set,
            "isAwakeMissionOpened": lambda _t: awake_mission_opened,
        }
        ch["getRequiredConditionsToOpenManaBoard"] = lambda b: self.run(
            "BattleCharacterLogic/getRequiredConditionsToOpenManaBoard", ch, b
        )
        ch["getMaxOpenableManaBoard"] = lambda: self.run(
            "BattleCharacterLogic/getMaxOpenableManaBoard", ch
        )
        ch["existsOpenableManaBoard"] = lambda: self.run(
            "OwnedCharacterLogic/existsOpenableManaBoard", ch
        )
        return ch

    def scene(self, target_char, active_board_index: int = 1):
        visual_enabled = {}
        dialogs = []

        def ui_str_ctx(key, ctx):
            if key == "mana_board_change_board_disabled_not_released_message":
                return f"解锁玛纳板{ctx['board']}需要满足以下条件"
            if key == "mana_board_change_board_disabled_not_released_reason_level":
                return f"需要等级{ctx['level']}"
            if key == "mana_board_change_board_disabled_not_released_reason_learn_all_nodes":
                return f"需要学习玛纳板{ctx['board']}全部节点"
            if key == "mana_board_change_board_disabled_not_released_reason_overlimit":
                return f"需要突破{ctx['count']}次"
            return f"{key}:{ctx}"

        sc = {
            "_type": "ManaBoardScene",
            "targetCharacter": target_char,
            "allBoardIndexes": target_char["getManaBoardIndexes"](),
            "activeBoardIndex": active_board_index,
            "buttonGroup": {
                "setVisualEnabled": lambda btn, enabled: visual_enabled.__setitem__(btn, enabled)
            },
            "globalLogic": {"getTime": lambda: 0.0},
            "logic": {"asset": {"getUiStringWithContext": ui_str_ctx}},
            "openDialog": lambda dlg: dialogs.append(dlg),
            "_visualEnabled": visual_enabled,
            "_dialogs": dialogs,
        }
        sc["updateButtonState"] = lambda: self.run("ManaBoardScene/updateButtonState", sc)
        sc["showManaBoardOpenRequiredCondition"] = lambda: self.run(
            "ManaBoardScene/showManaBoardOpenRequiredCondition", sc
        )
        return sc


def _format_conds(conds):
    return [(c["tag"], c["index"], list(c["params"])) for c in conds]


def run_behavior_cases(before_abc, after_abc):
    cases = []

    def record(name, **evidence):
        cases.append({"name": name, "pass": True, **evidence})

    w_old = Board2World(before_abc)
    w = Board2World(after_abc)

    # 1. 129989 Lv100 / Lv119 (以及 Lv1 / Lv80) -> 含 Level(120)，不能开板 2，弹窗显示「需要等级120」
    for lv in (1, 80, 100, 119):
        ch = w.character(129989, rarity=5, level=lv, over_limit_step=4, learned_boards=(1,))
        conds = _format_conds(ch["getRequiredConditionsToOpenManaBoard"](2))
        max_board = ch["getMaxOpenableManaBoard"]()
        openable = ch["existsOpenableManaBoard"]()
        require(
            conds == [("Level", 0, [120])],
            f"129989 Lv{lv} expected [('Level', 0, [120])], got {conds}",
        )
        require(max_board == 1 and openable is False, f"129989 Lv{lv} must not be openable: {max_board}")

        sc = w.scene(ch, active_board_index=1)
        sc["updateButtonState"]()
        sc["showManaBoardOpenRequiredCondition"]()
        require(sc["_visualEnabled"][1] is False, f"129989 Lv{lv} board switch button must be disabled")
        dlg_texts = [item["text"] for item in sc["_dialogs"][-1]["contents"]]
        require(
            dlg_texts == ["解锁玛纳板2需要满足以下条件", "需要等级120"],
            f"129989 Lv{lv} unexpected dialog texts: {dlg_texts}",
        )
    record(
        "char_129989_lv_below_120_requires_level_120_and_cannot_open_board2",
        levels_tested=[1, 80, 100, 119],
        conditions_at_lv100_and_119=[("Level", 0, [120])],
        max_openable_board=1,
        exists_openable_board=False,
        button1_visual_enabled=False,
        dialog_texts=["解锁玛纳板2需要满足以下条件", "需要等级120"],
    )

    # 2. 129989 Lv120 (及 Lv125) -> 不含 Level，满足板1全学+突破时可开板 2
    for lv in (120, 125):
        ch_ok = w.character(129989, rarity=5, level=lv, over_limit_step=4, learned_boards=(1,))
        conds_ok = _format_conds(ch_ok["getRequiredConditionsToOpenManaBoard"](2))
        max_ok = ch_ok["getMaxOpenableManaBoard"]()
        openable_ok = ch_ok["existsOpenableManaBoard"]()
        require(conds_ok == [], f"129989 Lv{lv} expected [], got {conds_ok}")
        require(max_ok == 2 and openable_ok is True, f"129989 Lv{lv} expected openable board 2, got {max_ok}")
    record(
        "char_129989_lv_120_and_above_omits_level_and_allows_opening_board2",
        levels_tested=[120, 125],
        conditions=[],
        max_openable_board=2,
        exists_openable_board=True,
    )

    # 3. 129989 多条件组合（缺板1全学 / 缺突破次数）在 Lv100/119 与 Lv120 下的完整验证
    ch_119_all_missing = w.character(129989, rarity=5, level=119, over_limit_step=1, learned_boards=())
    conds_119_all = _format_conds(ch_119_all_missing["getRequiredConditionsToOpenManaBoard"](2))
    require(
        conds_119_all == [("Level", 0, [120]), ("LearnAllNodes", 1, [1]), ("OverLimit", 2, [2])],
        f"unexpected 129989 Lv119 all-missing conditions: {conds_119_all}",
    )
    require(ch_119_all_missing["getMaxOpenableManaBoard"]() == 1, "129989 Lv119 all-missing maxOpenable != 1")

    ch_120_missing_nodes_ol = w.character(129989, rarity=5, level=120, over_limit_step=1, learned_boards=())
    conds_120_missing = _format_conds(ch_120_missing_nodes_ol["getRequiredConditionsToOpenManaBoard"](2))
    require(
        conds_120_missing == [("LearnAllNodes", 1, [1]), ("OverLimit", 2, [2])],
        f"unexpected 129989 Lv120 missing-nodes/ol conditions: {conds_120_missing}",
    )
    require(
        ch_120_missing_nodes_ol["getMaxOpenableManaBoard"]() == 1,
        "129989 Lv120 missing nodes/ol maxOpenable != 1",
    )
    record(
        "char_129989_combined_conditions_with_nodes_and_overlimit",
        lv119_all_missing=conds_119_all,
        lv120_missing_nodes_and_overlimit=conds_120_missing,
    )

    # 4. 其它 ★5 角色 (如 129992, 129988, 129990, 111001): Lv80 -> 不含 Level; Lv79 -> Level(80)，与原版逐值一致
    other_star5_ids = (129992, 129988, 129990, 111001)
    for cid in other_star5_ids:
        for lv in (1, 79, 80, 100, 119, 120):
            for ol in (0, 1, 2, 4):
                for learned in ((), (1,)):
                    c_new = w.character(cid, rarity=5, level=lv, over_limit_step=ol, learned_boards=learned)
                    c_old = w_old.character(cid, rarity=5, level=lv, over_limit_step=ol, learned_boards=learned)
                    res_new = _format_conds(c_new["getRequiredConditionsToOpenManaBoard"](2))
                    res_old = _format_conds(c_old["getRequiredConditionsToOpenManaBoard"](2))
                    max_new = c_new["getMaxOpenableManaBoard"]()
                    max_old = c_old["getMaxOpenableManaBoard"]()
                    require(res_new == res_old, f"star5 {cid} Lv{lv} conds drift: {res_new} vs {res_old}")
                    require(max_new == max_old, f"star5 {cid} Lv{lv} maxOpenable drift: {max_new} vs {max_old}")

    c_129992_lv80 = w.character(129992, rarity=5, level=80, over_limit_step=2, learned_boards=(1,))
    c_129992_lv79 = w.character(129992, rarity=5, level=79, over_limit_step=2, learned_boards=(1,))
    require(
        _format_conds(c_129992_lv80["getRequiredConditionsToOpenManaBoard"](2)) == []
        and c_129992_lv80["getMaxOpenableManaBoard"]() == 2,
        "129992 Lv80 must have no Level condition and maxOpenable == 2",
    )
    require(
        _format_conds(c_129992_lv79["getRequiredConditionsToOpenManaBoard"](2)) == [("Level", 0, [80])]
        and c_129992_lv79["getMaxOpenableManaBoard"]() == 1,
        "129992 Lv79 must require Level(80) and maxOpenable == 1",
    )
    record(
        "other_star5_characters_identical_to_baseline",
        characters_checked=list(other_star5_ids),
        char_129992_lv80_conditions=[],
        char_129992_lv79_conditions=[("Level", 0, [80])],
    )

    # 5. 其它星级角色 (★1..★4, baseLevelCap=40/50/60/70) 与原版 100% 一致
    for rarity, cap in BASE_LEVEL_CAPS.items():
        req_ol = REQUIRED_OVER_LIMIT_STEPS[rarity][2]
        for lv in (cap - 1, cap, 100, 119, 120):
            c_new = w.character(100000 + rarity, rarity=rarity, level=lv, over_limit_step=req_ol, learned_boards=(1,))
            c_old = w_old.character(
                100000 + rarity, rarity=rarity, level=lv, over_limit_step=req_ol, learned_boards=(1,)
            )
            res_new = _format_conds(c_new["getRequiredConditionsToOpenManaBoard"](2))
            res_old = _format_conds(c_old["getRequiredConditionsToOpenManaBoard"](2))
            require(
                res_new == res_old and c_new["getMaxOpenableManaBoard"]() == c_old["getMaxOpenableManaBoard"](),
                f"rarity {rarity} Lv{lv} drifted from baseline",
            )
    record("all_rarities_1_to_5_non_129989_identical_to_baseline", base_level_caps=BASE_LEVEL_CAPS)

    # 6. param1 == 1 / 3 (及 0, -1, 99) -> 129989 与其它角色均与原版一致 (返回空数组 [])
    for cid in (129989, 129992):
        for lv in (1, 79, 80, 100, 119, 120):
            c_new = w.character(cid, rarity=5, level=lv, over_limit_step=0, learned_boards=())
            c_old = w_old.character(cid, rarity=5, level=lv, over_limit_step=0, learned_boards=())
            for param1 in (1, 3, 0, -1, 99):
                r_new = _format_conds(c_new["getRequiredConditionsToOpenManaBoard"](param1))
                r_old = _format_conds(c_old["getRequiredConditionsToOpenManaBoard"](param1))
                require(r_new == r_old == [], f"cid={cid} lv={lv} param1={param1} expected [], got {r_new}")
    record(
        "param1_1_and_3_and_other_non_2_values_identical_to_baseline",
        param1_values_tested=[1, 3, 0, -1, 99],
        characters_tested=[129989, 129992],
    )

    required_executed = {
        "BattleCharacterLogic/getRequiredConditionsToOpenManaBoard",
        "BattleCharacterLogic/getMaxOpenableManaBoard",
        "OwnedCharacterLogic/existsOpenableManaBoard",
        "ManaBoardOpenRequiredCondition$/Level",
        "ManaBoardOpenRequiredCondition$/LearnAllNodes",
        "ManaBoardOpenRequiredCondition$/OverLimit",
        "ManaBoardOpenRequiredCondition/<ctor>",
        "ManaBoardScene/updateButtonState",
        "ManaBoardScene/showManaBoardOpenRequiredCondition",
    }
    require(required_executed <= w.executed, f"missing executed methods: {required_executed - w.executed}")
    return cases, sorted(w.executed)


def verify_structure_and_stacking(before_swf, after_swf, audit_report):
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

    # 1. Forbidden class method mutation (including MemberImpl)
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

    # 2. Unrelated BattleCharacterLogic method mutation
    other_bcl_idx = next(
        i
        for i, lbl in bodies.label_map(after_swf.abc).items()
        if lbl.startswith("BattleCharacterLogic/") and lbl not in ALLOWED_TARGETS
    )
    mb = after_swf.abc.bodies[other_bcl_idx]
    old_mb = mb[5]
    reject(
        "other BattleCharacterLogic method modified",
        lambda: mb.__setitem__(5, old_mb + b"\x02"),
        lambda: mb.__setitem__(5, old_mb),
    )

    # 3. Non-reversible edit in target method
    req_idx = bodies.resolve(after_swf.abc, patch.REQ_COND)
    req_b = after_swf.abc.bodies[req_idx]
    old_req = req_b[5]
    reject(
        f"non-reversible {patch.REQ_COND} edit",
        lambda: req_b.__setitem__(5, old_req + b"\x02"),
        lambda: req_b.__setitem__(5, old_req),
    )

    # 4. Constant pool addition or mutation
    reject(
        "unexpected int pool addition",
        lambda: after_swf.abc.ints.append(129989),
        lambda: after_swf.abc.ints.pop(),
    )

    # 5. Added class
    reject(
        "added class",
        lambda: after_swf.abc.instances.append(after_swf.abc.instances[0]),
        lambda: after_swf.abc.instances.pop(),
    )

    # 6. Independent stacking test on a modified SWF inside board2/build/
    tmp_dir = output_path(ROOT / "build" / ".stacking-test" / "dummy").parent
    other_swf_path = tmp_dir / "other-thread-patched.swf"
    stacked_swf_path = tmp_dir / "stacked-board2.swf"
    try:
        other_swf = SwfAbc(INPUT_SWF)
        unrelated_label = "BattleContinuationData/bothbossNext"
        u_idx = bodies.resolve(other_swf.abc, unrelated_label)
        u_body = other_swf.abc.bodies[u_idx]
        u_spliced, u_exc, _, _ = asm.splice_many(
            u_body, [(2, asm.assemble([("nop",)]), asm.ENTER)]
        )
        u_body[5], u_body[6] = u_spliced, u_exc
        other_swf.abc.strings.append(b"other_thread_marker")
        other_raw = other_swf.serialize()
        other_swf_path.write_bytes(other_raw)
        require(sha(other_raw) != INPUT_SHA256, "simulated other-thread SWF must have different SHA")

        stacked_report = build_swf(other_swf_path, stacked_swf_path)
        stacked_swf = SwfAbc(stacked_swf_path)
        require(
            stacked_swf.abc.bodies[u_idx][5] == u_spliced,
            "stacking overwrote the other thread's unrelated method change",
        )
        for target_lbl in patch.TARGETS:
            t_idx = bodies.resolve(stacked_swf.abc, target_lbl)
            a_idx = bodies.resolve(after_swf.abc, target_lbl)
            require(
                stacked_swf.abc.bodies[t_idx][5] == after_swf.abc.bodies[a_idx][5],
                f"stacked {target_lbl} bytecode differs",
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
    files = [path for path in ROOT.rglob("*.py") if "__pycache__" not in path.parts]
    return {path.relative_to(ROOT).as_posix(): sha(path.read_bytes()) for path in sorted(files)}


def _summarize_methods(changed_methods):
    summary = {}
    for label, info in changed_methods.items():
        summary[label] = {
            "body_index": info["body"],
            "before_sha256": info["before"],
            "after_sha256": info["after"],
            "before_header": info["before_header"],
            "after_header": info["after_header"],
            "insertions": info["insertions"],
        }
    return summary


def main():
    before_sources = source_hashes()
    verify_input(INPUT_SWF)
    verify_input(RIVEN_SWF)

    merge_report = build_swf(INPUT_SWF, OUTPUT_SWF)
    riven_report = build_swf(RIVEN_SWF, RIVEN_OUTPUT_SWF)

    audit_report = json.loads((ROOT / "build" / "audit.json").read_text(encoding="utf-8"))
    output_digest = sha(OUTPUT_SWF.read_bytes())
    riven_output_digest = sha(RIVEN_OUTPUT_SWF.read_bytes())
    require(output_digest == audit_report["output_sha256"], "audit.json / output SWF SHA256 mismatch")

    merge_methods = _summarize_methods(merge_report["changed_methods"])
    riven_methods = _summarize_methods(riven_report["changed_methods"])
    require(
        merge_methods == riven_methods,
        f"method body hashes/headers differ between merge-wt-1008093 and riven-wt-1008092: {merge_methods} vs {riven_methods}",
    )

    sums_path = output_path(ROOT / "build" / "SHA256SUMS")
    sums_path.write_text(
        f"{output_digest}  {OUTPUT_SWF.name}\n{riven_output_digest}  {RIVEN_OUTPUT_SWF.name}\n",
        encoding="ascii",
    )

    before_merge_swf = SwfAbc(INPUT_SWF)
    after_merge_swf = SwfAbc(OUTPUT_SWF)
    before_riven_swf = SwfAbc(RIVEN_SWF)
    after_riven_swf = SwfAbc(RIVEN_OUTPUT_SWF)

    cases_merge, executed_merge = run_behavior_cases(before_merge_swf.abc, after_merge_swf.abc)
    cases_riven, executed_riven = run_behavior_cases(before_riven_swf.abc, after_riven_swf.abc)
    require(cases_merge == cases_riven and executed_merge == executed_riven, "VM behavior differed across SWFs")

    structure = verify_structure_and_stacking(before_merge_swf, after_merge_swf, audit_report)

    after_sources = source_hashes()
    require(before_sources == after_sources, "source files changed during verification")
    require(sha(OUTPUT_SWF.read_bytes()) == output_digest, "verification mutated merge output SWF")
    require(sha(RIVEN_OUTPUT_SWF.read_bytes()) == riven_output_digest, "verification mutated riven output SWF")

    report = {
        "pass": True,
        "primary_input_swf": INPUT_SWF.as_posix(),
        "primary_input_sha256": INPUT_SHA256,
        "primary_output_swf": OUTPUT_SWF.relative_to(ROOT).as_posix(),
        "primary_output_sha256": output_digest,
        "secondary_input_swf": RIVEN_SWF.as_posix(),
        "secondary_input_sha256": RIVEN_SHA256,
        "secondary_output_swf": RIVEN_OUTPUT_SWF.relative_to(ROOT).as_posix(),
        "secondary_output_sha256": riven_output_digest,
        "method_bodies_identical_across_both_swfs": True,
        "patched_methods": merge_methods,
        "added_methods": [],
        "pool_additions": merge_report["pool_additions"],
        "behavior_cases_passed": len(cases_merge),
        "behavior_cases": cases_merge,
        "executed_methods": executed_merge,
        "structure_and_stacking": structure,
        "source_sha256": before_sources,
        "test_source_unchanged_during_run": True,
        "scope": (
            "Real serialized AVM2 bytecode execution on BattleCharacterLogic/getRequiredConditionsToOpenManaBoard, "
            "BattleCharacterLogic/getMaxOpenableManaBoard, OwnedCharacterLogic/existsOpenableManaBoard, "
            "ManaBoardOpenRequiredCondition constructors, ManaBoardScene/updateButtonState, and "
            "ManaBoardScene/showManaBoardOpenRequiredCondition across both merge-wt-1008093.swf and riven-wt-1008092.swf"
        ),
        "not_verified": [
            "Real Android device / emulator execution",
            "Adobe AIR native runtime verifier",
        ],
    }
    report_path = output_path(ROOT / "verify-report.json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "pass": True,
                "primary_output_swf": report["primary_output_swf"],
                "primary_output_sha256": output_digest,
                "secondary_output_swf": report["secondary_output_swf"],
                "secondary_output_sha256": riven_output_digest,
                "behavior_cases_passed": len(cases_merge),
                "negative_structural_cases": len(structure["negative_cases"]),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
