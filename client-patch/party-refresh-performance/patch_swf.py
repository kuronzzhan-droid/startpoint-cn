"""Skip only the provably equal second PartyTranslator ability summary.

No class recompilation, new traits, pools, or persistent cache. Other patches may
change other methods, while the target and its readers must match the pinned LAN.
"""
import argparse
import copy
import importlib.util
import json
import struct
import zlib
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("party_perf_support", HERE.parent / "startup-cache/build_swf.py")
s = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s)
LABEL = "pinball.scene.character.translator::PartyTranslator/translate|1"
CODE_SHA = "bab1bb17179ebac5c563c3a50d781b7d61aa034066c5e394ab6c5a6df28ee33d"
START, AFTER = 177, 228


def view(abc):
    return s.m.View(SimpleNamespace(abc=abc), s.m.asm)


def q(v, ns, name):
    matches = [i for i in range(1, len(v.a.multinames)) if v.mn(i) == (7, (22, ns), name)]
    assert len(matches) == 1, (ns, name, matches)
    return matches[0]


def guard(v):
    bi, = v.by_label[LABEL]
    rows = s.m.asm.decode(v.a.bodies[bi][5])
    runtime = rows[187].args[0]
    one = rows[164].args[0]
    assert v.mn(runtime) == (27, ((22, ""),)) and v.a.doubles[one] == 1.0
    return s.m.asm.assemble([
        ("getlocal", 9), ("pushbyte", 0), ("ifne", "fallback"),
        ("getlocal", 10), ("getproperty", q(v, "", "hpForThreshold")),
        ("getproperty", q(v, "", "params")), ("pushbyte", 0), ("getproperty", runtime),
        ("getlex", q(v, "pinball.common.math._Decimal", "Decimal_Impl_")),
        ("pushdouble", one), ("callproperty", q(v, "", "fromFloat"), 1), ("convert_d",),
        ("ifne", "fallback"), ("getlocal", 16), ("setlocal", 18),
        ("jump", "fallback"), ("label", "fallback"),
    ])


def patch_body(abc):
    v = view(abc)
    bi, = v.by_label[LABEL]
    body = abc.bodies[bi]
    assert s.sha(body[5]) == CODE_SHA, "unsupported PartyTranslator.translate method"
    assert body[:5] == [72961, 24, 42, 1, 2] and not body[6]
    rows = v.normalized(bi)[0]
    assert rows[176][:2] == (0x63, [16]) and rows[227][:2] == (0x63, [18])
    assert rows[173][:2] == (0x46, [(7, (22, ""), "summaryAbilities"), 4])
    assert rows[224][:2] == rows[173][:2]
    assert rows[158][1] == rows[219][1] and rows[159] == rows[220]
    assert rows[160][:2] == (0x62, [11]) and rows[221][:2] == (0x62, [17])
    original = bytes(body[5])
    block = guard(v)
    code, exceptions, merged, placed = s.m.asm.splice_many(body, [(START, block, s.m.asm.ENTER)])
    jump = START + 15
    assert merged[jump].op == 0x10
    merged[jump].target = AFTER + len(block)
    body[5] = s.m.asm.encode(merged)[0]
    body[6] = exceptions
    assert s.m.asm.unsplice_many(body[5], placed) == original
    check = s.m.check_body(body, abc)
    assert check["max_stack"] <= body[1] and check["max_scope"] <= body[4]
    return bi, {"method": LABEL, "input_code_sha256": CODE_SHA, "inserted_instructions": len(block),
                "reversible_insertion": True, "check": check}


def patch(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    assert not output.exists() and source != output and ".cdn" not in [p.lower() for p in output.parts]
    version, header, tags = s.parts(source)
    originals = copy.deepcopy(tags)
    main, = [t for t in tags if t[0] == 82 and t[2][4:-1] == b"boot_ffc6"]
    old = copy.deepcopy(main[3])
    bi, change = patch_body(main[3])
    # The target is unchanged by the independently composed carousel repair.
    # Pin read-only consumers to the same source semantics before enabling reuse.
    pins = json.loads((HERE / "reader-fingerprints.json").read_text(encoding="utf-8"))
    v = view(main[3])
    for label, digest in pins.items():
        index, = v.by_label[label]
        assert s.sha(main[3].bodies[index][5]) == digest, "reader/source changed: " + label
    for field in ("methods", "metadata", "instances", "classes", "scripts", "ints", "uints", "doubles",
                  "strings", "namespaces", "ns_sets", "multinames"):
        assert s.m.freeze(getattr(old, field)) == s.m.freeze(getattr(main[3], field)), field
    changed = [i for i, body in enumerate(main[3].bodies) if s.m.freeze(body) != s.m.freeze(old.bodies[i])]
    assert changed == [bi]
    payload = main[2] + s.serialize(main[3], main[4])
    main[1] = struct.pack("<HI", (82 << 6) | 63, len(payload)) + payload
    raw = header + b"".join(t[1] for t in tags)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(b"CWS" + bytes([version]) + struct.pack("<I", len(raw) + 8) + zlib.compress(raw))
    final_version, final_header, final = s.parts(output)
    assert final_version == version and final_header == header and len(final) == len(tags)
    for intended, actual, prior in zip(tags, final, originals):
        assert actual[1] == intended[1], "serialized readback mismatch"
        if intended is not main:
            assert actual[1] == prior[1], "unrelated SWF tag changed"
    report = {"input_swf_sha256": s.sha(source.read_bytes()), "output_swf_sha256": s.sha(output.read_bytes()),
              "changes": [change], "changed_method_body": bi,
              "unrelated_tags_and_methods_preserved": True, "all_pools_and_class_layouts_preserved": True,
              "no_persistent_cache": True, "save_or_persistence_change": False,
              "scope": "one summary call instead of two only at resolved HP=100% and mode=normal"}
    output.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument("output", type=Path)
    a = p.parse_args()
    print(json.dumps(patch(a.source, a.output), ensure_ascii=False))
