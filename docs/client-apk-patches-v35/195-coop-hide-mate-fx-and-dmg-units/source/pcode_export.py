"""Export readable AVM2 P-code (before and after) with exact byte offsets and pool identities."""
from __future__ import annotations

import json
import re

import bootstrap
from bootstrap import output_path, sha
import asm
import bodies

EXTRA_MNEMONICS = {
    0x08: "kill",
    0xEF: "debug",
    0xF0: "debugline",
    0xF1: "debugfile",
    0xF2: "bkptline",
}


def _operand(abc, instruction, position, value):
    kind = asm.opwalk.KIND.get((instruction.op, position))
    if kind == "multiname":
        meaning = abc.mn_name(value)
    elif kind == "string":
        meaning = json.dumps(abc.s(value), ensure_ascii=False)
    elif kind in ("int", "uint", "double"):
        meaning = str(getattr(abc, kind + "s")[value])
    elif kind == "namespace":
        meaning = abc.ns_name(value)
    else:
        return str(value)
    return f"{value} [{meaning}]"


def format_method_pcode(abc, label: str, stage: str | None = None) -> tuple[str, int, str]:
    index = bodies.resolve(abc, label)
    body = abc.bodies[index]
    instructions = asm.decode(body[5])
    encoded, offsets = asm.encode(instructions)
    if encoded != body[5]:
        raise ValueError(f"P-code roundtrip failed: {label}")
    offsets.append(len(encoded))
    header_tag = f" ({stage})" if stage else ""
    lines = [
        f"; {label}{header_tag}",
        f"; body_index={index} method_index={body[0]}",
        f"; sha256={sha(body[5])}",
        f"; maxstack={body[1]} localcount={body[2]} init_scope_depth={body[3]} max_scope_depth={body[4]}",
    ]
    for number, instruction in enumerate(instructions):
        args = [_operand(abc, instruction, i, value) for i, value in enumerate(instruction.args)]
        if instruction.target is not None:
            args.append(f"L{offsets[instruction.target]:06x} (# {instruction.target})")
        if instruction.cases is not None:
            cases_str = ", ".join(f"L{offsets[target]:06x}" for target in instruction.cases)
            args.append(f"default=L{offsets[instruction.default]:06x} cases=[{cases_str}]")
        mnemonic = EXTRA_MNEMONICS.get(instruction.op, instruction.name)
        lines.append(f"L{offsets[number]:06x} (#{number:04d}): {mnemonic:<18} " + ", ".join(args))
    lines.append(f"L{offsets[-1]:06x} (#{len(instructions):04d}): ; end")
    lines.append("; exception_table=" + json.dumps(body[6]))
    return "\n".join(lines) + "\n", index, sha(body[5])


def export_pcode_pair(before_abc, after_abc, labels, directory):
    """Export both before and after P-code for each target method into build/pcode/."""
    exported = []
    for label in sorted(labels):
        safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", label)
        before_text, body_index, before_code_sha = format_method_pcode(before_abc, label, stage="before")
        after_text, after_index, after_code_sha = format_method_pcode(after_abc, label, stage="after")
        if body_index != after_index:
            raise ValueError(f"body index changed for {label}: {body_index} != {after_index}")

        before_sub = output_path(directory / "before" / f"{safe_name}.pcode.txt")
        after_sub = output_path(directory / "after" / f"{safe_name}.pcode.txt")
        before_flat = output_path(directory / f"{safe_name}.before.pcode.txt")
        after_flat = output_path(directory / f"{safe_name}.after.pcode.txt")
        canonical_after = output_path(directory / f"{safe_name}.pcode.txt")

        before_sub.write_text(before_text, encoding="utf-8")
        before_flat.write_text(before_text, encoding="utf-8")
        after_sub.write_text(after_text, encoding="utf-8")
        after_flat.write_text(after_text, encoding="utf-8")
        canonical_after.write_text(after_text, encoding="utf-8")

        exported.append(
            {
                "label": label,
                "body_index": body_index,
                "before_method_code_sha256": before_code_sha,
                "after_method_code_sha256": after_code_sha,
                "before_file": before_sub.relative_to(bootstrap.ROOT).as_posix(),
                "after_file": after_sub.relative_to(bootstrap.ROOT).as_posix(),
                "before_flat_file": before_flat.relative_to(bootstrap.ROOT).as_posix(),
                "after_flat_file": after_flat.relative_to(bootstrap.ROOT).as_posix(),
                "file": canonical_after.relative_to(bootstrap.ROOT).as_posix(),
                "before_pcode_sha256": sha(before_sub.read_bytes()),
                "after_pcode_sha256": sha(after_sub.read_bytes()),
            }
        )
    return exported
