"""Patch C8601 when opening SET edit for Abyss/Fantasy party categories."""
import copy, json, struct, sys, zipfile, zlib
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent / "generic-damage"))
from common import s, sha  # noqa: E402

SOURCE_APK = (
    Path(r"F:\codex\outputs\independent-formations-public-20260923")
    / "StarPoint-CN-1.8.1-independent-formations-public-c9ddb01e.apk"
)
SOURCE_APK_SHA = "dc397a3a7d3ad5d5b26f8461865ed2eb01362e14c45604f0117c18fadcb4efad"
SOURCE_SWF_SHA = "ea5d5486618e8873ff652c8c395f86e68575059e7d0e5ff04c75c1bf974e0307"
WORK = Path(r"F:\codex\work\set-edit-c8601-20260924")
SWF_MEMBER = "assets/worldflipper_android_release.swf"
LABEL = "pinball.scene.partyGroupEdit::PartyGroupEditSceneView/refreshPartyCategory|1"
METHOD_SHA = "54859e428a47a505b2ed6b48d65ec8f9a07c0edb2257572d942ced4957aff2fe"


def serialize(abc, original):
    """Serialize while keeping empty-pool counts byte-identical."""
    def counts(data):
        r = s.m.abcfmt.R(data)
        r.p = 4
        rows = []
        for reader in (r.s32, r.u32, r.d64):
            at = r.p
            n = r.u30()
            rows.append((at, n))
            for _ in range(max(0, n - 1)):
                reader()
        return rows

    out = bytearray(abc.serialize())
    for (_, old), (at, new) in zip(counts(original), counts(out)):
        if old == 0 and new == 1:
            out[at] = 0
    return bytes(out)


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    assert sha(SOURCE_APK.read_bytes()) == SOURCE_APK_SHA
    with zipfile.ZipFile(SOURCE_APK) as z:
        source = z.read(SWF_MEMBER)
    assert sha(source) == SOURCE_SWF_SHA
    input_swf = WORK / "input.swf"
    input_swf.write_bytes(source)

    version, header, tags = s.parts(input_swf)
    main_tag = next(t for t in tags if t[0] == 82 and t[2][4:-1] == b"boot_ffc6")
    abc = main_tag[3]
    before = copy.deepcopy(abc)
    view = s.m.View(SimpleNamespace(abc=abc), s.m.asm)
    pool = s.PoolEditor(abc)
    body_index, = view.by_label[LABEL]
    body = abc.bodies[body_index]
    original_code = bytes(body[5])
    assert sha(original_code) == METHOD_SHA
    rows = view.normalized(body_index)[0]
    switch_at = next(i for i, row in enumerate(rows) if row[0] == 0x1B)

    # Categories 5/6/7 remain intact for save and request routing. The title
    # switch also has to tolerate null and other out-of-range values from
    # older event data; only the UI-local value is normalized to category 4.
    block = s.m.asm.assemble([
        ("getlocal_1",), ("pushnull",), ("ifstricteq", "special"),
        ("getlocal_1",), ("pushbyte", 1), ("iflt", "special"),
        ("getlocal_1",), ("pushbyte", 4), ("ifgt", "special"),
        ("jump", "done"),
        ("label", "special"),
        ("pushbyte", 4), ("setlocal_1",), ("label", "done"),
    ])
    body[5], body[6], _, placed = s.m.asm.splice_many(
        body, [(switch_at, block, s.m.asm.ENTER)]
    )
    s.m.check_body(body, abc)

    edit_rows_after = view.normalized(body_index)[0]
    switch_after = next(i for i, row in enumerate(edit_rows_after) if row[0] == 0x1B)
    default_at = edit_rows_after[switch_after][3]
    assert edit_rows_after[default_at][0] == 0x10
    string_type = next(
        i for i in range(1, len(abc.multinames))
        if view.mn(i) == (7, (22, ""), "String")
    )
    fallback = s.m.asm.assemble([
        ("pushstring", pool.string("party_group_edit_title_rush_event")),
        ("astype", string_type),
        ("setlocal_2",),
    ])
    body[5], body[6], _, default_placed = s.m.asm.splice_many(
        body, [(default_at, fallback, s.m.asm.ENTER)]
    )
    s.m.check_body(body, abc)

    for i, other in enumerate(abc.bodies):
        if i != body_index:
            assert s.m.freeze(other) == s.m.freeze(before.bodies[i]), i
    for field in ("methods", "instances", "classes", "scripts", "metadata"):
        assert s.m.freeze(getattr(abc, field)) == s.m.freeze(getattr(before, field)), field
    for field in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames"):
        prefix = getattr(before, field)
        assert s.m.freeze(getattr(abc, field)[:len(prefix)]) == s.m.freeze(prefix), field

    payload = main_tag[2] + serialize(abc, main_tag[4])
    main_tag[1] = struct.pack("<HI", (82 << 6) | 63, len(payload)) + payload
    raw = header + b"".join(t[1] for t in tags)
    output = WORK / "set-edit-fixed.swf"
    output.write_bytes(b"CWS" + bytes([version]) + struct.pack("<I", len(raw) + 8) + zlib.compress(raw))
    final_version, _, final_tags = s.parts(output)
    final_main = next(t for t in final_tags if t[0] == 82 and t[2][4:-1] == b"boot_ffc6")
    final_view = s.m.View(SimpleNamespace(abc=final_main[3]), s.m.asm)
    final_body, = final_view.by_label[LABEL]
    final_rows = final_view.normalized(final_body)[0]
    assert any(row[0] == 0x24 and row[1] == [5] for row in final_rows)
    assert any(row[0] == 0x24 and row[1] == [7] for row in final_rows)
    assert sha(output.read_bytes()) != SOURCE_SWF_SHA
    report = {
        "status": "offline_client_hotfix",
        "source_apk": str(SOURCE_APK),
        "source_apk_sha256": SOURCE_APK_SHA,
        "source_swf_sha256": SOURCE_SWF_SHA,
        "output_swf": str(output),
        "output_swf_sha256": sha(output.read_bytes()),
        "method_label": LABEL,
        "method_body": body_index,
        "original_method_sha256": METHOD_SHA,
        "patched_method_sha256": sha(body[5]),
        "insertion_at": switch_at,
        "mapped_categories": ["null", "out_of_range"],
        "preserved_categories": [1, 2, 3, 4],
        "ui_category": 4,
        "default_title_key": "party_group_edit_title_rush_event",
        "default_insertion_at": default_at,
        "default_placed": default_placed,
        "unchanged_other_methods": True,
        "scope": "C8601 SET edit title fallback for Abyss normal, Abyss EX, and Fantasy",
        "device_tested": False,
    }
    (WORK / "patch-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
