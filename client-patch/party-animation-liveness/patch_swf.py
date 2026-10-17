"""Advance pending offscreen party animations only while the original waiter is active.

Only PartyCarousel.update changes. No game class is recompiled, no container is
initialized by this insertion, and the original completion/callback logic stays.
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
spec = importlib.util.spec_from_file_location("party_liveness_swf", HERE.parent / "startup-cache/build_swf.py")
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
LAN_SHA = "9418137820c007b52a11ad0d7955c102795d8dd903213670577bf3407ed709f7"
LABEL = "pinball.scene.character.partyCarousel::PartyCarousel/update|1"
UPDATE_CODE_SHA = "335ad9078b65f3819cd64ee926e9f5a52bb89561d2ad5c2723ef9d2f9fc2a20f"
PROTECTED_LABELS = (
    "pinball.scene.character.partyCarousel::PartyCarousel/changeIndex|1",
    "pinball.scene.character.cell.button::CharacterCellButtonProcessor/beginTouch|1",
)


def view(abc):
    return s.m.View(SimpleNamespace(abc=abc), s.m.asm)


def public_name(abc, name):
    v = view(abc)
    hits = [i for i in range(1, len(abc.multinames)) if v.mn(i) == (7, (22, ""), name)]
    assert hits, "missing existing public name: " + name
    return hits[0]


def waiting_animation_rows(q):
    """One shared symbolic insertion used in both the game and AIR fixture."""
    return [
        ("getlocal_0",), ("getproperty", q("joinAndRemoveAnimationWaitState")),
        ("getproperty", q("index")), ("pushbyte", 1), ("ifne", "END"),
        ("pushbyte", 0), ("setlocal", 10), ("jump", "container_check"),
        ("label", "container_body"),
        ("getlocal", 10), ("getlocal_0",), ("getproperty", q("currentIndex")), ("ifeq", "container_next"),
        ("getlocal_0",), ("getproperty", q("characterContainers")), ("getlocal", 10),
        ("getproperty", q("arrayIndex")), ("setlocal", 11),
        ("getlocal", 11), ("getproperty", q("initialized")), ("iffalse", "container_next"),
        ("getlocal", 11), ("getproperty", q("allCells")), ("setlocal", 13),
        ("pushbyte", 0), ("setlocal", 12), ("jump", "cell_check"),
        ("label", "cell_body"),
        ("getlocal", 13), ("getlocal", 12), ("getproperty", q("arrayIndex")),
        ("callproperty", q("isJoinOrRemoving"), 0), ("iffalse", "cell_next"),
        ("getlocal", 11), ("callpropvoid", q("update"), 0), ("jump", "container_next"),
        ("label", "cell_next"), ("inclocal_i", 12),
        ("label", "cell_check"),
        ("getlocal", 12), ("getlocal", 13), ("getproperty", q("length")), ("iflt", "cell_body"),
        ("label", "container_next"), ("inclocal_i", 10),
        ("label", "container_check"),
        ("getlocal", 10), ("getlocal_0",), ("getproperty", q("characterContainers")),
        ("getproperty", q("length")), ("iflt", "container_body"),
    ]


def array_index_name(abc, v, original_body=None):
    # Runtime-name namespace set, as already used by the original method.
    if original_body is not None:
        for ins in s.m.asm.decode(original_body[5]):
            if ins.op == 0x66 and v.mn(ins.args[0])[0] == 27:
                return ins.args[0]
    hits = [i for i in range(1, len(abc.multinames)) if v.mn(i)[0] == 27]
    assert hits, "missing existing runtime array-index name"
    return hits[0]


def assemble_for(abc, original_body=None):
    v = view(abc)
    index = array_index_name(abc, v, original_body)
    q = lambda name: index if name == "arrayIndex" else public_name(abc, name)
    return assemble_waiting(q)


def assemble_waiting(q):
    block = s.m.asm.assemble(waiting_animation_rows(q))
    # AIR requires a real AVM2 label instruction at backward branch targets;
    # the assembler's (label, name) directives only name offsets.
    targets = {ins.target for i, ins in enumerate(block) if ins.target is not None and ins.target <= i}
    remapped = {}
    result = []
    for i, ins in enumerate(block):
        remapped[i] = len(result)
        if i in targets:
            result.append(s.m.asm.Instruction(0x09))
        result.append(copy.deepcopy(ins))
    remapped[len(block)] = len(result)
    for ins in result:
        if ins.target is not None:
            ins.target = remapped[ins.target]
    return result


def patch(source, target, expected_input_sha256=LAN_SHA):
    source, target = Path(source), Path(target)
    assert source.resolve() != target.resolve()
    assert not target.exists(), "output must be a fresh path"
    assert ".cdn" not in [p.lower() for p in target.parts]
    source_sha = s.sha(source.read_bytes())
    assert source_sha == expected_input_sha256, "input SWF identity mismatch"
    version, header, tags = s.parts(source)
    hits = [t for t in tags if t[0] == 82 and LABEL in view(t[3]).by_label]
    assert len(hits) == 1
    main = hits[0]
    abc = main[3]
    before = copy.deepcopy(abc)
    v = view(abc)
    body_index, = v.by_label[LABEL]
    body = abc.bodies[body_index]
    original = bytes(body[5])
    assert s.sha(original) == UPDATE_CODE_SHA, "unexpected current update instructions"
    rows = s.m.asm.decode(original)
    anchor = [i for i, ins in enumerate(rows) if ins.op == 0x60 and v.mn(ins.args[0]) == (7, (22, ""), "joinAndRemoveAnimationWaitState")]
    assert len(anchor) == 1, "unexpected waiter layout or already patched input"
    assert body[2] == 10, "unexpected local layout or already patched input"
    assert rows[anchor[0] + 1].op == 0x80, "expected original wait-state coercion"
    block = assemble_for(abc, body)
    body[5], body[6], _, placed = s.m.asm.splice_many(body, [(anchor[0], block, s.m.asm.ENTER)])
    assert s.m.asm.unsplice_many(body[5], placed) == original
    body[2] = 14
    check = s.m.check_body(body, abc)
    body[1] = max(body[1], check["max_stack"])
    assert check["max_scope"] <= body[4]
    changed = [i for i, b in enumerate(abc.bodies) if s.m.freeze(b) != s.m.freeze(before.bodies[i])]
    assert changed == [body_index]
    for field in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames", "methods", "metadata", "instances", "classes", "scripts"):
        assert s.m.freeze(getattr(abc, field)) == s.m.freeze(getattr(before, field)), field
    payload = main[2] + s.serialize(abc, main[4])
    main[1] = struct.pack("<HI", (82 << 6) | 63, len(payload)) + payload
    raw = header + b"".join(t[1] for t in tags)
    target.write_bytes(b"CWS" + bytes([version]) + struct.pack("<I", len(raw) + 8) + zlib.compress(raw))
    final = s.parts(target)[2]
    original_tags = s.parts(source)[2]
    assert len(final) == len(original_tags)
    changed_tags = [i for i, (a, b) in enumerate(zip(original_tags, final)) if a[1] != b[1]]
    assert len(changed_tags) == 1
    final_abc = final[changed_tags[0]][3]
    for field in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames", "methods", "metadata", "instances", "classes", "scripts", "bodies"):
        assert s.m.freeze(getattr(final_abc, field)) == s.m.freeze(getattr(abc, field)), "readback " + field
    report = {
        "input_swf_sha256": source_sha, "swf_sha256": s.sha(target.read_bytes()),
        "main_abc_index": sum(t[0] == 82 for t in tags[:tags.index(main) + 1]) - 1,
        "method_bodies_checked": sum(len(t[3].bodies) for t in tags if t[0] == 82),
        "changed_methods": [body_index], "method": LABEL,
        "changed_tag_indices": changed_tags, "added_instructions": len(block),
        "original_update_code_sha256": s.sha(original), "insertion_reversible": True,
        "all_other_method_bodies_preserved": True, "pools_and_class_layouts_preserved": True,
        "protected_methods_byte_identical": {label: v.by_label[label] for label in PROTECTED_LABELS},
        "steady_current_only_policy_preserved": True, "check": check,
        "verification_scope": "static SWF readback; AIR fixture and device results recorded separately",
    }
    target.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--expected-input-sha256", default=LAN_SHA)
    args = parser.parse_args()
    print(json.dumps(patch(args.source, args.target, args.expected_input_sha256), indent=2))
