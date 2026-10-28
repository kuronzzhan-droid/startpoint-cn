"""Run AVM2 bytecode verification and structural checks, binding all evidence in verify-report.json."""
from __future__ import annotations

import json

import bootstrap
from bootstrap import (
    DEFAULT_INPUT,
    DEFAULT_INPUT_SHA256,
    DEFAULT_OUTPUT,
    ROOT,
    sha,
    verify_default_input,
)
import asm
import bodies
from swfabc import SwfAbc
from matefx.patch import (
    P1_LABEL,
    P2_LABEL,
    P3_LABEL,
    P4_LABEL,
    P5_LABEL,
    P6_CREATE_DIGIT_LABEL,
    P6_CREATE_SPRITE_LABEL,
    P6_RESOLVE_PATH_LABEL,
    P6_UNIT_PREFIX_LABEL,
    P6_UPDATE_DIGITS_LABEL,
    P7_LABEL,
    P8_FIND_ENEMY_LABEL,
    P8_TRY_REPLACEMENT_LABEL,
    TARGETS,
)
from verification.cases import (
    run_all_cases,
    verify_p1,
    verify_p2,
    verify_p3,
    verify_p4,
    verify_p5,
    verify_p6,
    verify_p7,
    verify_p8,
)
import verify_structure


def source_hashes() -> dict[str, str]:
    files = [path for path in ROOT.rglob("*.py") if "__pycache__" not in path.parts]
    return {
        path.relative_to(ROOT).as_posix(): sha(path.read_bytes())
        for path in sorted(files)
    }


def _behavioral_mutation_controls(before_abc, after_abc) -> list[dict]:
    """Prove that the AVM verification suite rejects defective P1-P8 mutations across all 13 target methods."""
    controls = []

    def expect_failure(name: str, label: str, mutate_ins_fn, check_fn):
        idx = bodies.resolve(after_abc, label)
        old_code = after_abc.bodies[idx][5]
        try:
            ins = asm.decode(old_code)
            mutate_ins_fn(ins)
            after_abc.bodies[idx][5] = asm.encode(ins)[0]
            try:
                check_fn(before_abc, after_abc)
            except AssertionError:
                controls.append({"mutation": name, "target": label, "caught": True})
            else:
                raise AssertionError(f"behavioral mutation was not caught: {name}")
        finally:
            after_abc.bodies[idx][5] = old_code

    expect_failure(
        "P1 returns true instead of false",
        P1_LABEL,
        lambda ins: ins.__setitem__(2, asm.Instruction(asm.MNEMONICS["pushtrue"])),
        verify_p1,
    )
    expect_failure(
        "P2 sets showOthersMultiball=true instead of false",
        P2_LABEL,
        lambda ins: ins.__setitem__(154, asm.Instruction(asm.MNEMONICS["pushtrue"])),
        verify_p2,
    )
    expect_failure(
        "P2 accidentally alters enableEscapeMarker",
        P2_LABEL,
        lambda ins: ins.__setitem__(126, asm.Instruction(asm.MNEMONICS["pushfalse"])),
        verify_p2,
    )
    expect_failure(
        "P2b inverts BallPeek.isPrimary() check on case 43",
        P3_LABEL,
        lambda ins: ins.__setitem__(2880, asm.Instruction(asm.MNEMONICS["not"])),
        verify_p3,
    )
    expect_failure(
        "P3 returns wrong removeKey on case 55",
        P3_LABEL,
        lambda ins: ins.__setitem__(4356, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p3,
    )
    expect_failure(
        "P4 returns true for primary=false",
        P4_LABEL,
        lambda ins: ins.__setitem__(6, asm.Instruction(asm.MNEMONICS["pushtrue"])),
        verify_p4,
    )
    expect_failure(
        "P4 returns false for primary=true",
        P4_LABEL,
        lambda ins: ins.__setitem__(4, asm.Instruction(asm.MNEMONICS["pushfalse"])),
        verify_p4,
    )
    expect_failure(
        "P5 checks lightweightModeLevel >= 2 instead of >= 1",
        P5_LABEL,
        lambda ins: ins.__setitem__(1869, asm.Instruction(asm.MNEMONICS["pushbyte"], [2])),
        verify_p5,
    )
    expect_failure(
        "P5 inverts randomRotation check (wrong getRandomRotation count)",
        P5_LABEL,
        lambda ins: ins.__setitem__(1875, asm.Instruction(asm.MNEMONICS["not"])),
        verify_p5,
    )
    expect_failure(
        "P6 unitPrefix divides by 100 instead of 1e11 in T branch",
        P6_UNIT_PREFIX_LABEL,
        lambda ins: ins.__setitem__(17, asm.Instruction(asm.MNEMONICS["pushbyte"], [100])),
        verify_p6,
    )
    expect_failure(
        "P6 unitPrefix appends @0k instead of @0t on integer T values",
        P6_UNIT_PREFIX_LABEL,
        lambda ins: ins.__setitem__(46, asm.Instruction(asm.MNEMONICS["pushstring"], [64676])),
        verify_p6,
    )
    expect_failure(
        "P6 unitPrefix divides by 100 instead of 1e8 in B branch",
        P6_UNIT_PREFIX_LABEL,
        lambda ins: ins.__setitem__(86, asm.Instruction(asm.MNEMONICS["pushbyte"], [100])),
        verify_p6,
    )
    expect_failure(
        "P6 unitPrefix appends @0k instead of @0b on integer B values",
        P6_UNIT_PREFIX_LABEL,
        lambda ins: ins.__setitem__(115, asm.Instruction(asm.MNEMONICS["pushstring"], [64676])),
        verify_p6,
    )
    expect_failure(
        "P6 unitPrefix divides by 100 instead of 100000 in M branch",
        P6_UNIT_PREFIX_LABEL,
        lambda ins: ins.__setitem__(155, asm.Instruction(asm.MNEMONICS["pushbyte"], [100])),
        verify_p6,
    )
    expect_failure(
        "P6 unitPrefix appends @0k instead of @0m on integer M values",
        P6_UNIT_PREFIX_LABEL,
        lambda ins: ins.__setitem__(184, asm.Instruction(asm.MNEMONICS["pushstring"], [64676])),
        verify_p6,
    )
    expect_failure(
        "P6 resolvePath returns wrong path for 'm'",
        P6_RESOLVE_PATH_LABEL,
        lambda ins: ins.__setitem__(78, asm.Instruction(asm.MNEMONICS["pushstring"], [1])),
        verify_p6,
    )
    expect_failure(
        "P6 resolvePath returns wrong path for 'b'",
        P6_RESOLVE_PATH_LABEL,
        lambda ins: ins.__setitem__(83, asm.Instruction(asm.MNEMONICS["pushstring"], [1])),
        verify_p6,
    )
    expect_failure(
        "P6 resolvePath returns wrong path for 't'",
        P6_RESOLVE_PATH_LABEL,
        lambda ins: ins.__setitem__(88, asm.Instruction(asm.MNEMONICS["pushstring"], [1])),
        verify_p6,
    )
    expect_failure(
        "P6 createSprite sets 'm' tier digit color to 0 instead of 0x40D8FF",
        P6_CREATE_SPRITE_LABEL,
        lambda ins: ins.__setitem__(104, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P6 createSprite sets 'b' tier digit color to 0 instead of 0xFF4FB4",
        P6_CREATE_SPRITE_LABEL,
        lambda ins: ins.__setitem__(111, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P6 createSprite inverts 't' check (overwrites k/integer digit colors with tier color)",
        P6_CREATE_SPRITE_LABEL,
        lambda ins: ins.__setitem__(114, asm.Instruction(asm.MNEMONICS["ifeq"], target=ins[114].target)),
        verify_p6,
    )
    expect_failure(
        "P6 createSprite sets 't' tier digit color to 0 instead of 0xA070FF",
        P6_CREATE_SPRITE_LABEL,
        lambda ins: ins.__setitem__(116, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P6 createSprite sets unit glyph color to 0 instead of 0xFFFFFF",
        P6_CREATE_SPRITE_LABEL,
        lambda ins: ins.__setitem__(121, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P6 createDigit appends wrong 13th ('m') texture",
        P6_CREATE_DIGIT_LABEL,
        lambda ins: ins.__setitem__(68, asm.Instruction(asm.MNEMONICS["pushstring"], [1])),
        verify_p6,
    )
    expect_failure(
        "P6 createDigit appends wrong 14th ('b') texture",
        P6_CREATE_DIGIT_LABEL,
        lambda ins: ins.__setitem__(75, asm.Instruction(asm.MNEMONICS["pushstring"], [1])),
        verify_p6,
    )
    expect_failure(
        "P6 createDigit appends wrong 15th ('t') texture",
        P6_CREATE_DIGIT_LABEL,
        lambda ins: ins.__setitem__(82, asm.Instruction(asm.MNEMONICS["pushstring"], [1])),
        verify_p6,
    )
    expect_failure(
        "P6 updateDigits sets 'm' tier digit color to 0 instead of 0x40D8FF",
        P6_UPDATE_DIGITS_LABEL,
        lambda ins: ins.__setitem__(69, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P6 updateDigits sets 'b' tier digit color to 0 instead of 0xFF4FB4",
        P6_UPDATE_DIGITS_LABEL,
        lambda ins: ins.__setitem__(75, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P6 updateDigits sets 't' tier digit color to 0 instead of 0xA070FF",
        P6_UPDATE_DIGITS_LABEL,
        lambda ins: ins.__setitem__(79, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P6 updateDigits resets non-m/b/t digit color to 0 instead of 16768318",
        P6_UPDATE_DIGITS_LABEL,
        lambda ins: ins.__setitem__(81, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P6 updateDigits maps 'm' to currentFrame 11 instead of 12",
        P6_UPDATE_DIGITS_LABEL,
        lambda ins: ins.__setitem__(184, asm.Instruction(asm.MNEMONICS["pushbyte"], [11])),
        verify_p6,
    )
    expect_failure(
        "P6 updateDigits maps 'b' to currentFrame 12 instead of 13",
        P6_UPDATE_DIGITS_LABEL,
        lambda ins: ins.__setitem__(191, asm.Instruction(asm.MNEMONICS["pushbyte"], [12])),
        verify_p6,
    )
    expect_failure(
        "P6 updateDigits maps 't' to currentFrame 13 instead of 14",
        P6_UPDATE_DIGITS_LABEL,
        lambda ins: ins.__setitem__(198, asm.Instruction(asm.MNEMONICS["pushbyte"], [13])),
        verify_p6,
    )
    expect_failure(
        "P6 updateDigits sets m/b/t unit glyph color to 0 instead of 0xFFFFFF",
        P6_UPDATE_DIGITS_LABEL,
        lambda ins: ins.__setitem__(203, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p6,
    )
    expect_failure(
        "P7 checks lightweightModeLevel >= 2 instead of >= 1",
        P7_LABEL,
        lambda ins: ins.__setitem__(93, asm.Instruction(asm.MNEMONICS["pushbyte"], [2])),
        verify_p7,
    )
    expect_failure(
        "P7 inverts lightweightModeLevel < 1 branch (merges direct attacks at lw=0)",
        P7_LABEL,
        lambda ins: ins.__setitem__(94, asm.Instruction(asm.MNEMONICS["ifge"], target=ins[94].target)),
        verify_p7,
    )
    expect_failure(
        "P7 inverts createdByDirectAttack check (merges non-direct attacks instead of direct attacks)",
        P7_LABEL,
        lambda ins: ins.__setitem__(97, asm.Instruction(asm.MNEMONICS["iftrue"], target=ins[97].target)),
        verify_p7,
    )
    expect_failure(
        "P7 sets per-target cap to 1 instead of 0 for direct attacks in lightweight mode",
        P7_LABEL,
        lambda ins: ins.__setitem__(99, asm.Instruction(asm.MNEMONICS["pushbyte"], [1])),
        verify_p7,
    )
    expect_failure(
        "P8 findEnemy inverts zone.bounds.contains check (rejects in-bounds, accepts out-of-bounds)",
        P8_FIND_ENEMY_LABEL,
        lambda ins: ins.__setitem__(71, asm.Instruction(asm.MNEMONICS["iffalse"], target=ins[71].target)),
        verify_p8,
    )
    expect_failure(
        "P8 findEnemy sets out-of-bounds distance squared to 0 instead of NaN",
        P8_FIND_ENEMY_LABEL,
        lambda ins: ins.__setitem__(72, asm.Instruction(asm.MNEMONICS["pushbyte"], [0])),
        verify_p8,
    )
    expect_failure(
        "P8 tryReplacement reads local5[1] instead of local5[0] for tag kind",
        P8_TRY_REPLACEMENT_LABEL,
        lambda ins: ins.__setitem__(44, asm.Instruction(asm.MNEMONICS["pushbyte"], [1])),
        verify_p8,
    )
    expect_failure(
        "P8 tryReplacement inverts wfx_dash_v2 tag check (applies v2 empty-field block to v1)",
        P8_TRY_REPLACEMENT_LABEL,
        lambda ins: ins.__setitem__(47, asm.Instruction(asm.MNEMONICS["ifeq"], target=ins[47].target)),
        verify_p8,
    )
    expect_failure(
        "P8 tryReplacement inverts wfxFindDashEnemy null check (blocks dash when in-bounds enemy exists)",
        P8_TRY_REPLACEMENT_LABEL,
        lambda ins: ins.__setitem__(50, asm.Instruction(asm.MNEMONICS["iffalse"], target=ins[50].target)),
        verify_p8,
    )
    expect_failure(
        "P8 tryReplacement returns false instead of true when no in-bounds enemy (falls back to native escape)",
        P8_TRY_REPLACEMENT_LABEL,
        lambda ins: ins.__setitem__(51, asm.Instruction(asm.MNEMONICS["pushfalse"])),
        verify_p8,
    )

    return controls


def main():
    before_sources = source_hashes()
    verify_default_input()

    audit_path = ROOT / "build" / "audit-wt-1008092.json"
    sums_path = ROOT / "build" / "SHA256SUMS"
    structure_path = ROOT / "build" / "verify-structure.json"

    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    output_digest = sha(DEFAULT_OUTPUT.read_bytes())
    assert output_digest == audit["output_sha256"]
    assert sums_path.read_text(encoding="ascii").strip() == f"{output_digest}  {DEFAULT_OUTPUT.name}"

    if not structure_path.exists():
        verify_structure.main()
    structure = json.loads(structure_path.read_text(encoding="utf-8"))
    if (
        structure.get("swf_sha256") != output_digest
        or structure.get("build_source_sha256") != audit["build_source_sha256"]
    ):
        verify_structure.main()
        structure = json.loads(structure_path.read_text(encoding="utf-8"))

    before_swf = SwfAbc(DEFAULT_INPUT)
    after_swf = SwfAbc(DEFAULT_OUTPUT)
    before_abc, after_abc = before_swf.abc, after_swf.abc

    method_hashes = {}
    for label in TARGETS:
        b_idx = bodies.resolve(before_abc, label)
        a_idx = bodies.resolve(after_abc, label)
        assert b_idx == a_idx
        method_hashes[label] = {
            "body_index": a_idx,
            "before_sha256": sha(before_abc.bodies[b_idx][5]),
            "after_sha256": sha(after_abc.bodies[a_idx][5]),
            "before_header": before_abc.bodies[b_idx][1:5],
            "after_header": after_abc.bodies[a_idx][1:5],
        }

    cases, executed = run_all_cases(before_abc, after_abc)
    mutations = _behavioral_mutation_controls(before_abc, after_abc)

    after_sources = source_hashes()
    assert before_sources == after_sources, "source files changed during verification"

    report = {
        "pass": True,
        "input_swf": DEFAULT_INPUT.relative_to(ROOT).as_posix(),
        "input_sha256": DEFAULT_INPUT_SHA256,
        "output_swf": DEFAULT_OUTPUT.relative_to(ROOT).as_posix(),
        "output_sha256": output_digest,
        "output_bytes": DEFAULT_OUTPUT.stat().st_size,
        "patched_methods": method_hashes,
        "pool_additions": audit["pool_additions"],
        "avm_verification": {
            "pass": True,
            "executed_methods": executed,
            "cases": cases,
            "mutation_controls": mutations,
        },
        "structure_verification": {
            "path": structure_path.relative_to(ROOT).as_posix(),
            "sha256": sha(structure_path.read_bytes()),
            "result": structure,
        },
        "pcode_exports": audit["pcode_exports"],
        "source_sha256": before_sources,
        "test_source_unchanged_during_run": True,
        "scope": "Offline AVM2 bytecode execution on real input/output SWF method bodies + byte-level structural and reversibility audit",
        "device_validation": False,
        "real_three_device_lockstep": False,
    }
    report_path = ROOT / "verify-report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "pass": True,
                "output_swf": report["output_swf"],
                "output_sha256": output_digest,
                "executed_methods": len(executed),
                "mutation_controls": len(mutations),
                "report": report_path.relative_to(ROOT).as_posix(),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
