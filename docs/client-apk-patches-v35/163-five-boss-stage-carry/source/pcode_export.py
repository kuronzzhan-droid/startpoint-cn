"""Readable final AVM2 instructions with exact byte offsets and pool identities."""
from __future__ import annotations

import json
import re

import bootstrap
from bootstrap import output_path, sha
import asm
import bodies

EXTRA_MNEMONICS = {0x08: "kill", 0xEF: "debug", 0xF0: "debugline", 0xF1: "debugfile", 0xF2: "bkptline"}


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


def export_pcode(abc, labels, directory):
    exported = []
    for label in sorted(labels):
        index = bodies.resolve(abc, label)
        body = abc.bodies[index]
        instructions = asm.decode(body[5])
        encoded, offsets = asm.encode(instructions)
        if encoded != body[5]:
            raise ValueError(f"P-code roundtrip failed: {label}")
        offsets.append(len(encoded))
        lines = [f"; {label}", f"; body_index={index} method_index={body[0]}",
                 f"; sha256={sha(body[5])}",
                 f"; maxstack={body[1]} localcount={body[2]} init_scope_depth={body[3]} max_scope_depth={body[4]}"]
        for number, instruction in enumerate(instructions):
            args = [_operand(abc, instruction, i, value) for i, value in enumerate(instruction.args)]
            if instruction.target is not None:
                args.append(f"L{offsets[instruction.target]:06x} (# {instruction.target})")
            if instruction.cases is not None:
                args.append("default=L%06x cases=[%s]" % (
                    offsets[instruction.default], ", ".join(f"L{offsets[target]:06x}" for target in instruction.cases)))
            mnemonic = EXTRA_MNEMONICS.get(instruction.op, instruction.name)
            lines.append(f"L{offsets[number]:06x}: {mnemonic:<18} " + ", ".join(args))
        lines.append(f"L{offsets[-1]:06x}: ; end")
        lines.append("; exception_table=" + json.dumps(body[6]))
        safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", label)
        path = output_path(directory / (safe_name + ".pcode.txt"))
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        exported.append({"label": label, "file": path.relative_to(bootstrap.ROOT).as_posix(),
                         "method_code_sha256": sha(body[5]), "pcode_sha256": sha(path.read_bytes())})
    return exported
