"""Refresh the existing Awake scene after its mission response, without another request."""
import copy
import importlib.util
import json
import struct
import sys
import zlib
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("awake_swf_tools", HERE.parent / "startup-cache/build_swf.py")
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

INPUT_HASHES = {
    "c5fcc853a10db415fc898d24ac940dc59a2ee1c886e7cff9544fd6a0ba661559",
    "0bbe58fab5f51b16220b11f9ffefece899854749ce3287a9c264ba67d4941eae",
}
SCENE = "pinball.scene.characterAwake::CharacterAwakeScene/"


def patch(source: Path, target: Path):
    assert s.sha(source.read_bytes()) in INPUT_HASHES, "Input must be the accepted record-holder SWF"
    assert not target.exists() and ".cdn" not in target.resolve().parts
    version, header, tags = s.parts(source)
    abcs = [tag for tag in tags if tag[0] == 82]
    assert len(abcs) == 291 and sum(len(tag[3].bodies) for tag in abcs) == 96535
    main = abcs[290]
    abc = main[3]
    view = s.m.View(SimpleNamespace(abc=abc), s.m.asm)
    assert abc.serialize() == main[4]
    assert view.by_label[SCENE + "applyMissionProgress|1"] == [67327]
    assert view.by_label[SCENE + "preparation|1"] == [67310]
    before = copy.deepcopy(abc)

    def q(name):
        indices = [i for i in range(1, len(abc.multinames)) if view.mn(i) == (7, (22, ""), name)]
        assert indices, name
        return indices[0]

    preparation = s.m.asm.decode(abc.bodies[67310][5])
    assert len(preparation) == 20 and preparation[1].op == 0x30 and preparation[-1].op == 0x47
    # Reuse the pinned scene's two assignments, including the actual runtime
    # casts. Its old OwnedCharacterLogic holds a stale map, so reacquire it.
    refresh = copy.deepcopy(preparation[2:-1])
    assert all(ins.target is None for ins in refresh)
    refresh.extend(s.m.asm.assemble([
        ("getlocal_0",), ("getproperty", q("boardAwakeLevel")), ("pushbyte", 0), ("ifle", "END"),
        ("getlocal_0",), ("getproperty", q("tabGroup")), ("getproperty", q("disabledTabButtons")),
        ("pushbyte", 2), ("callproperty", q("indexOf"), 1), ("convert_i",), ("setlocal_2",),
        ("getlocal_2",), ("pushbyte", 0), ("iflt", "enable"),
        ("getlocal_0",), ("getproperty", q("tabGroup")), ("getproperty", q("disabledTabButtons")),
        ("getlocal_2",), ("pushbyte", 1), ("callpropvoid", q("splice"), 2),
        ("label", "enable"),
        ("getlocal_0",), ("getproperty", q("tabGroup")),
        ("getlocal_0",), ("getproperty", q("currentTabKind")),
        ("callpropvoid", q("enableOnlyActiveTab"), 1),
    ]))
    # Shift branch instruction indices from the appended block to the combined
    # insertion. END is the position immediately before the original reload.
    prefix_length = len(preparation) - 3
    for ins in refresh[prefix_length:]:
        if ins.target is not None:
            ins.target += prefix_length
    body = abc.bodies[67327]
    original = s.m.asm.decode(body[5])
    assert len(original) == 11 and original[7].op == 0x68
    body[5], body[6], _, placed = s.m.asm.splice_many(body, [(8, refresh, s.m.asm.ENTER)])
    body[1] = max(body[1], 3)
    body[2] = max(body[2], 3)
    assert s.m.asm.unsplice_many(body[5], placed) == before.bodies[67327][5]
    check = s.m.check_body(body, abc)
    for index, original_body in enumerate(before.bodies):
        if index != 67327:
            assert s.m.freeze(abc.bodies[index]) == s.m.freeze(original_body), index
    for field in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames",
                  "methods", "metadata", "instances", "classes", "scripts"):
        assert s.m.freeze(getattr(abc, field)) == s.m.freeze(getattr(before, field)), field
    payload = main[2] + abc.serialize()
    main[1] = struct.pack("<HI", (82 << 6) | 63, len(payload)) + payload
    raw = header + b"".join(tag[1] for tag in tags)
    target.write_bytes(b"CWS" + bytes([version]) + struct.pack("<I", len(raw) + 8) + zlib.compress(raw))
    final = s.parts(target)[2]
    original_tags = s.parts(source)[2]
    assert len(final) == len(original_tags)
    assert sum(a[1] != b[1] for a, b in zip(final, original_tags)) == 1
    readback_abc = [tag for tag in final if tag[0] == 82][290][3]
    assert readback_abc.bodies[67327] == abc.bodies[67327]
    report = {
        "input_swf_sha256": s.sha(source.read_bytes()), "swf_sha256": s.sha(target.read_bytes()),
        "changed_method": "290:67327", "method": SCENE + "applyMissionProgress|1",
        "method_bodies": 96535, "all_other_bodies_unchanged": True,
        "pools_and_class_layouts_unchanged": True, "reversible_insertion": True,
        "additional_network_requests": 0, "check": check, "device_tested": False,
    }
    target.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(patch(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
