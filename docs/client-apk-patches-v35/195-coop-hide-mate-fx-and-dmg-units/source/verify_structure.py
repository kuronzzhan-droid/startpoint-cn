"""Recheck produced SWF, full ABC reversibility, stacking compatibility, and negative preservation controls."""
from __future__ import annotations

import json
from types import SimpleNamespace

import bootstrap
from bootstrap import DEFAULT_INPUT, DEFAULT_OUTPUT, ROOT, output_path, sha, verify_default_input
import asm
import bodies
from swfabc import SwfAbc
from audit_support import ALLOWED_TARGETS, FORBIDDEN_CLASSES, audit, require
from build_swf import PatchEditor, build_sources
from matefx import patch


def _negative_cases(before, after, editor):
    checks = []

    def reject(name, mutate, restore):
        mutate()
        try:
            audit(before, after, editor, ALLOWED_TARGETS)
        except (ValueError, RuntimeError) as error:
            checks.append({"case": name, "pass": True, "rejection": str(error)})
        else:
            raise ValueError(f"negative structural case was accepted: {name}")
        finally:
            restore()

    body0 = after.abc.bodies[0]
    old_h = body0[1]
    reject("unrelated method header", lambda: body0.__setitem__(1, old_h + 1), lambda: body0.__setitem__(1, old_h))

    old_c = body0[5]
    reject("unrelated method instructions", lambda: body0.__setitem__(5, old_c + b"\x02"), lambda: body0.__setitem__(5, old_c))

    old_s = after.abc.strings[1]
    reject(
        "existing constant pool entry",
        lambda: after.abc.strings.__setitem__(1, old_s + b"x"),
        lambda: after.abc.strings.__setitem__(1, old_s),
    )

    method0 = after.abc.methods[0]
    old_m = method0[0]
    reject("existing method signature", lambda: method0.__setitem__(0, old_m + 1), lambda: method0.__setitem__(0, old_m))

    trait = next(row[6][0] for row in after.abc.instances if row[6])
    old_t = trait.name
    reject("original class trait", lambda: setattr(trait, "name", old_t + 1), lambda: setattr(trait, "name", old_t))

    reject("added class", lambda: after.abc.instances.append(after.abc.instances[0]), lambda: after.abc.instances.pop())
    reject("added method", lambda: after.abc.methods.append(after.abc.methods[0]), lambda: after.abc.methods.pop())

    old_body_bytes = after.body
    reject("bytes outside main ABC", lambda: setattr(after, "body", old_body_bytes + b"\0"), lambda: setattr(after, "body", old_body_bytes))

    target = after.abc.bodies[bodies.resolve(after.abc, "BattleViewInputSettings/isOtherBattleActionVisible")]
    old_tc = target[5]
    reject(
        "non-reversible target instruction change",
        lambda: target.__setitem__(5, old_tc + b"\x02"),
        lambda: target.__setitem__(5, old_tc),
    )

    label_map = bodies.label_map(after.abc)
    for cls in FORBIDDEN_CLASSES:
        f_index = next(
            idx
            for idx, lbl in label_map.items()
            if lbl.startswith((f"{cls}/", f"{cls}$/")) and lbl not in ALLOWED_TARGETS
        )
        f_body = after.abc.bodies[f_index]
        old_fc = f_body[5]
        reject(
            f"forbidden class {cls} method modified",
            lambda b=f_body, c=old_fc: b.__setitem__(5, c + b"\x02"),
            lambda b=f_body, c=old_fc: b.__setitem__(5, c),
        )

    non_exempt_ball = "BallImpl/physicalMove"
    reject(
        "non-exempt BallImpl method declared as target",
        lambda: (ALLOWED_TARGETS.add(non_exempt_ball), editor.report.__setitem__(non_exempt_ball, {"insertions": []})),
        lambda: (ALLOWED_TARGETS.discard(non_exempt_ball), editor.report.pop(non_exempt_ball, None)),
    )

    removed_v2_landing = "BallImpl/wfxDashV2Landing"
    reject(
        "BallImpl/wfxDashV2Landing declared as target",
        lambda: (ALLOWED_TARGETS.add(removed_v2_landing), editor.report.__setitem__(removed_v2_landing, {"insertions": []})),
        lambda: (ALLOWED_TARGETS.discard(removed_v2_landing), editor.report.pop(removed_v2_landing, None)),
    )

    return checks


def _check_full_reversibility(before, after, recorded):
    """Prove that unsplicing the 13 target bodies and removing appended pool constants reproduces the exact input ABC and SWF bytes."""
    saved = {}
    saved_strings = list(after.abc.strings)
    saved_ints = list(after.abc.ints)
    saved_doubles = list(after.abc.doubles)
    saved_multinames = list(after.abc.multinames)
    pool_info = recorded["pool_additions"]
    try:
        for label, info in recorded["changed_methods"].items():
            idx = bodies.resolve(after.abc, label)
            body = after.abc.bodies[idx]
            saved[idx] = body[5]
            body[5] = asm.unsplice_many(body[5], info["insertions"])
        del after.abc.strings[pool_info["base_string_count"] :]
        del after.abc.ints[pool_info["base_int_count"] :]
        del after.abc.doubles[pool_info["base_double_count"] :]
        del after.abc.multinames[pool_info["base_multiname_count"] :]
        require(after.abc.serialize() == before.abc.serialize(), "unspliced ABC bytes do not match input ABC byte-for-byte")
        require(after.serialize() == DEFAULT_INPUT.read_bytes(), "unspliced SWF bytes do not match input SWF byte-for-byte")
    finally:
        for idx, code in saved.items():
            after.abc.bodies[idx][5] = code
        after.abc.strings[:] = saved_strings
        after.abc.ints[:] = saved_ints
        after.abc.doubles[:] = saved_doubles
        after.abc.multinames[:] = saved_multinames
    return True


def _check_stacking_compatibility(before, recorded):
    """Prove P2b/P3/P5 anchors work without v35n splices and P1-P8 stack cleanly after MemberImpl/hasGuarded changes."""
    target_indices = {label: bodies.resolve(before.abc, label) for label in ALLOWED_TARGETS}
    saved_targets = {idx: list(before.abc.bodies[idx]) for idx in target_indices.values()}
    saved_strings = list(before.abc.strings)
    saved_ints = list(before.abc.ints)
    saved_doubles = list(before.abc.doubles)
    saved_multinames = list(before.abc.multinames)

    # 1. Vanilla BattleView/show (without v35n case 47 splice at #2959) and vanilla EffectManagerImpl/show (without v35n hitbudget splice at #1866)
    bv_idx = target_indices["BattleView/show"]
    bv_body = before.abc.bodies[bv_idx]
    vanilla_bv_code = asm.unsplice(bv_body[5], 2959, 5)

    emi_idx = target_indices["EffectManagerImpl/show"]
    emi_body = before.abc.bodies[emi_idx]
    vanilla_emi_code = asm.unsplice(emi_body[5], 1866, 13)
    try:
        bv_body[5] = vanilla_bv_code
        emi_body[5] = vanilla_emi_code
        locks_a = patch.lock_for_abc(before.abc)
        editor_a = PatchEditor(before, locks_a)
        detail_a = patch.build(editor_a)
        editor_a.apply()
        require(
            detail_a["anchors"]["BattleView/show"]["case43_insert_at"] == 2874,
            "expected vanilla BattleView/show case 43 at #2874",
        )
        require(
            detail_a["anchors"]["BattleView/show"]["insert_at"] == 4341,
            "expected vanilla BattleView/show case 55 at #4341",
        )
        require(
            detail_a["anchors"]["EffectManagerImpl/show"]["has_v35n_hitbudget"] is False
            and detail_a["anchors"]["EffectManagerImpl/show"]["insert_at"] == 1866,
            "expected vanilla EffectManagerImpl/show case 63 at #1866 without hitbudget",
        )
        require(
            asm.unsplice_many(before.abc.bodies[bv_idx][5], editor_a.report["BattleView/show"]["insertions"]) == vanilla_bv_code,
            "vanilla BattleView/show did not unsplice cleanly",
        )
        require(
            asm.unsplice_many(before.abc.bodies[emi_idx][5], editor_a.report["EffectManagerImpl/show"]["insertions"]) == vanilla_emi_code,
            "vanilla EffectManagerImpl/show did not unsplice cleanly",
        )
    finally:
        for idx, old_row in saved_targets.items():
            before.abc.bodies[idx][:] = old_row
        before.abc.strings[:] = saved_strings
        before.abc.ints[:] = saved_ints
        before.abc.doubles[:] = saved_doubles
        before.abc.multinames[:] = saved_multinames

    # 2. Stacking after MemberImpl/hasGuarded patch (simulating gerald-guard applied first)
    hg_idx = bodies.resolve(before.abc, "MemberImpl/hasGuarded")
    hg_saved = list(before.abc.bodies[hg_idx])
    try:
        hg_patched_code, hg_exc, _, _ = asm.splice_many(
            before.abc.bodies[hg_idx], [(2, asm.assemble([("pushtrue",), ("returnvalue",)]), asm.FORBID)]
        )
        before.abc.bodies[hg_idx][5] = hg_patched_code
        before.abc.bodies[hg_idx][6] = hg_exc

        locks_b = patch.lock_for_abc(before.abc)
        editor_b = PatchEditor(before, locks_b)
        patch.build(editor_b)
        editor_b.apply()
        for label in ALLOWED_TARGETS:
            require(
                editor_b.report[label]["after"] == recorded["changed_methods"][label]["after"],
                f"stacked method hash differed for {label}",
            )
        require(
            before.abc.bodies[hg_idx][5] == hg_patched_code,
            "stacking matefx altered MemberImpl/hasGuarded",
        )
    finally:
        before.abc.bodies[hg_idx][:] = hg_saved
        for idx, old_row in saved_targets.items():
            before.abc.bodies[idx][:] = old_row
        before.abc.strings[:] = saved_strings
        before.abc.ints[:] = saved_ints
        before.abc.doubles[:] = saved_doubles
        before.abc.multinames[:] = saved_multinames

    return {
        "vanilla_without_v35n_splices": {
            "pass": True,
            "case43_insert_at": detail_a["anchors"]["BattleView/show"]["case43_insert_at"],
            "case55_insert_at": detail_a["anchors"]["BattleView/show"]["insert_at"],
            "case63_insert_at": detail_a["anchors"]["EffectManagerImpl/show"]["insert_at"],
            "case63_has_v35n_hitbudget": detail_a["anchors"]["EffectManagerImpl/show"]["has_v35n_hitbudget"],
            "reversible_byte_exact": True,
        },
        "stacked_after_memberimpl_hasguarded": {
            "pass": True,
            "matefx_method_hashes_identical": True,
            "memberimpl_hasguarded_preserved_byte_exact": True,
        },
    }


def main():
    before = SwfAbc(verify_default_input())
    after = SwfAbc(DEFAULT_OUTPUT)
    recorded = json.loads((ROOT / "build" / "audit-wt-1008092.json").read_text(encoding="utf-8"))
    require(recorded["output_sha256"] == sha(DEFAULT_OUTPUT.read_bytes()), "build report/output hash mismatch")
    source_digest, source_files = build_sources()
    require(
        recorded["build_source_sha256"] == source_digest and recorded["build_source_files"] == source_files,
        "current build sources differ from the artifact's bound sources",
    )
    editor = SimpleNamespace(
        report=recorded["changed_methods"],
        new_methods=recorded["new_methods"],
        traits=[],
    )
    positive = audit(before, after, editor, ALLOWED_TARGETS)
    full_reversible = _check_full_reversibility(before, after, recorded)
    stacking = _check_stacking_compatibility(before, recorded)
    negative = _negative_cases(before, after, editor)
    require(sha(DEFAULT_OUTPUT.read_bytes()) == recorded["output_sha256"], "negative cases modified on-disk artifact")

    report = {
        "pass": True,
        "swf_sha256": recorded["output_sha256"],
        "build_source_sha256": source_digest,
        "positive_audit": positive,
        "full_abc_and_swf_reversible_byte_exact": full_reversible,
        "stacking_compatibility": stacking,
        "negative_cases": negative,
        "negative_mutations": "in-memory only; the SWF files remain unchanged",
    }
    path = output_path(ROOT / "build" / "verify-structure.json")
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "pass": True,
                "report": path.relative_to(ROOT).as_posix(),
                "negative_cases": len(negative),
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
