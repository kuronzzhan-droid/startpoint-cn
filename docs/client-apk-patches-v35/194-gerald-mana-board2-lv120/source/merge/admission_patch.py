"""Step 7: Replace admission build ID for 1008093 merge.

Provenance:
  Minimal self-contained adaptation of `patch_tag`, `replace_literal`, `tags`, and `locate`
  from:
    - `<WORKDIR>/outputs/work/weapon-riven-20261025/port175/source/c4_admission.py`
    - `<WORKDIR>/outputs/work/weapon-riven-20261025/port175/source/port_admission.py`
  Copied into this merge workspace without importing `port175/source/bootstrap.py`
  (avoiding side effects outside the merge directory).

Replaces `<ADMISSION_ID>` (39 bytes) with
`<ADMISSION_ID>` (39 bytes) in all three places:
  1. `cn/admission/ClientAdmission` transport declaration
  2. `cn/admission/ClientAdmission` proof prefix (`SP-ADMISSION-1\\n<id>\\n`)
  3. `cn/admission/BuildConfig` static slot `ID`

Proves:
  - Byte-level reverse substitution on both patched DoABC tags recovers the exact input tags;
  - Raw ABC literal reversal recovers the exact input ABC bytes;
  - Admission secret key bytes (and all other string pool entries) are byte-for-byte unchanged;
  - All other SWF tags (including main `boot_ffc6` DoABC) are byte-for-byte unchanged;
  - Key material is never printed or written to any report/log.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENDOR = HERE.parent / "vendor"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

import asm  # noqa: E402
import bodies  # noqa: E402
from swfabc import abcfmt, swftags  # noqa: E402

TAG = b"cn/admission/ClientAdmission"
CONFIG_TAG = b"cn/admission/BuildConfig"

OLD_BUILD = "<ADMISSION_ID>"
NEW_BUILD = "<ADMISSION_ID>"
assert len(OLD_BUILD) == len(NEW_BUILD) == 39

def make_replacements(new_build: str = NEW_BUILD):
    if len(new_build.encode("utf-8")) != len(OLD_BUILD.encode("utf-8")) or len(new_build) != len(OLD_BUILD):
        raise ValueError(
            f"Build ID length mismatch: new build ID {new_build!r} ({len(new_build.encode('utf-8'))} bytes) "
            f"must match old build ID {OLD_BUILD!r} ({len(OLD_BUILD.encode('utf-8'))} bytes)"
        )
    return (
        (
            TAG,
            (
                ("declaration", OLD_BUILD, new_build),
                (
                    "proof_prefix",
                    "SP-ADMISSION-1\n" + OLD_BUILD + "\n",
                    "SP-ADMISSION-1\n" + new_build + "\n",
                ),
            ),
        ),
        (
            CONFIG_TAG,
            (("config_id", OLD_BUILD, new_build),),
        ),
    )


REPLACEMENTS = make_replacements(NEW_BUILD)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def unpack(raw: bytes) -> bytes:
    assert raw[:3] == b"CWS", "Expected CWS compressed SWF"
    body = zlib.decompress(raw[8:])
    assert len(body) + 8 == int.from_bytes(raw[4:8], "little"), "SWF uncompressed length mismatch"
    return body


def tags(raw: bytes) -> list[tuple[int, bytes | None, bytes]]:
    body = unpack(raw)
    rows = []
    for code, offset, header, length in swftags.iter_tags(body):
        content = body[offset + header : offset + header + length]
        name = content[4 : content.index(b"\0", 4)] if code == 82 else None
        rows.append((code, name, body[offset : offset + header + length]))
    return rows


def locate(raw: bytes, tag: bytes = TAG):
    body = unpack(raw)
    matches = []
    for code, offset, header, length in swftags.iter_tags(body):
        if code != 82:
            continue
        content = body[offset + header : offset + header + length]
        nul = content.index(b"\0", 4)
        if content[4:nul] == tag:
            matches.append((offset, header + length, content[: nul + 1], content[nul + 1 :]))
    assert len(matches) == 1, f"Expected exactly 1 DoABC tag for {tag!r}, got {len(matches)}"
    offset, length, prefix, abc_raw = matches[0]
    abc = abcfmt.ABC(abc_raw)
    return body, offset, length, prefix, abc, abc_raw


def replace_literal(raw: bytes, sid: int, expected: bytes, value: bytes) -> bytes:
    """Preserve noncanonical zero-count pool encodings and all other raw bytes."""
    reader = abcfmt.R(raw)
    reader.raw(4)
    for _ in range(2):
        count = reader.u30()
        for _ in range(max(0, count - 1)):
            reader.u30()
    count = reader.u30()
    reader.raw(max(0, count - 1) * 8)
    count = reader.u30()
    for index in range(1, count):
        begin = reader.p
        text = reader.raw(reader.u30())
        if index == sid:
            assert text == expected, f"String #{sid} mismatch"
            writer = abcfmt.W()
            writer.u30(len(value))
            writer.raw(value)
            return raw[:begin] + writer.out() + raw[reader.p :]
    raise AssertionError("Literal index missing")


def references(abc, sid: int) -> list[dict]:
    labels = bodies.label_map(abc)
    found = []
    for index, record in enumerate(abc.bodies):
        for number, ins in enumerate(asm.decode(record[5])):
            if ins.name == "pushstring" and ins.args == [sid]:
                found.append({"body": index, "label": labels.get(index), "instruction": number})
    return found


def _non_edited_strings_digest(abc, edited_indices: set[int]) -> tuple[int, str]:
    """Hash all non-edited strings (including key bytes) without exposing their values."""
    h = hashlib.sha256()
    count = 0
    for idx, val in enumerate(abc.strings):
        if idx in edited_indices:
            continue
        count += 1
        h.update(struct.pack("<II", idx, len(val)))
        h.update(val)
    return count, h.hexdigest()


def patch_tag(raw: bytes, tag: bytes, replacements) -> tuple[bytes, dict]:
    body, offset, length, prefix, abc, original_abc = locate(raw, tag)
    before = copy.deepcopy(abc)
    patched_abc, edits = original_abc, []
    edited_sids: set[int] = set()

    for role, old, new in replacements:
        ids = [i for i, value in enumerate(abc.strings) if value == old.encode("utf-8")]
        assert len(ids) == 1 and new.encode("utf-8") not in abc.strings, (
            f"Expected unique literal for {role} in {tag.decode()}"
        )
        sid = ids[0]
        edited_sids.add(sid)
        refs = references(abc, sid)
        if role == "declaration":
            assert len(refs) == 1 and refs[0]["label"].endswith("/transport"), refs
        elif role == "proof_prefix":
            assert len(refs) == 1 and refs[0]["label"] is None, refs
        elif role == "config_id":
            traits = [
                t
                for _, members in abc.classes
                for t in members
                if t.data[0] == "slot" and t.data[3:] == [sid, 1]
            ]
            assert len(traits) == 1 and abc.mn_name(traits[0].name) == "ID"
        patched_abc = replace_literal(patched_abc, sid, old.encode("utf-8"), new.encode("utf-8"))
        edits.append({"role": role, "string_index": sid, "byte_length": len(new.encode("utf-8")), "references": refs})

    # Prove raw literal reversal restores original ABC byte-for-byte
    restored = patched_abc
    for (role, old, new), edit in zip(reversed(replacements), reversed(edits)):
        restored = replace_literal(restored, edit["string_index"], new.encode("utf-8"), old.encode("utf-8"))
    assert restored == original_abc, f"Raw literal reversal failed for {tag.decode()}"

    # Prove all non-edited strings (including HMAC key material) are byte-for-byte identical
    before_non_edit_count, before_non_edit_sha = _non_edited_strings_digest(before, edited_sids)

    content = prefix + patched_abc
    replacement = struct.pack("<HI", (82 << 6) | 63, len(content)) + content
    assert len(replacement) == length, f"Tag length changed for {tag.decode()}: {len(replacement)} != {length}"
    patched = body[:offset] + replacement + body[offset + length :]
    result = raw[:4] + struct.pack("<I", len(patched) + 8) + zlib.compress(patched)

    after = locate(result, tag)[4]
    after_non_edit_count, after_non_edit_sha = _non_edited_strings_digest(after, edited_sids)
    assert (before_non_edit_count, before_non_edit_sha) == (after_non_edit_count, after_non_edit_sha), (
        f"Non-edited strings (or key bytes) changed in {tag.decode()}"
    )

    # Also verify every single non-edited string entry directly by index
    for idx in range(len(before.strings)):
        if idx not in edited_sids:
            assert before.strings[idx] == after.strings[idx], f"String #{idx} changed in {tag.decode()}"

    for (role, old, new), edit in zip(replacements, edits):
        assert after.s(edit["string_index"]) == new
        after.strings[edit["string_index"]] = old.encode("utf-8")
    assert after.serialize() == before.serialize(), f"Parsed ABC reversal mismatch for {tag.decode()}"

    return result, {
        "abc": tag.decode(),
        "edits": edits,
        "all_method_bodies_identical": True,
        "raw_literal_reversal_recovers_original_abc": True,
        "non_edited_strings_count": after_non_edit_count,
        "non_edited_strings_sha256": after_non_edit_sha,
        "non_edited_strings_byte_identical": True,
        "before_abc_sha256": sha(original_abc),
        "after_abc_sha256": sha(patched_abc),
    }


def patch_admission(
    src: Path | str,
    out: Path | str,
    report_path: Path | str | None = None,
    build_id: str = NEW_BUILD,
) -> dict:
    src_path = Path(src).resolve()
    out_path = Path(out).resolve()
    assert src_path != out_path, "Input and output SWF paths must differ"
    replacements_spec = make_replacements(build_id)

    raw = src_path.read_bytes()
    original = raw
    edits = []
    for tag, replacements in replacements_spec:
        raw, evidence = patch_tag(raw, tag, replacements)
        edits.append(evidence)

    before_tags = tags(original)
    after_tags = tags(raw)
    assert len(before_tags) == len(after_tags), "SWF tag count changed"
    assert [r[:2] for r in before_tags] == [r[:2] for r in after_tags], "SWF tag sequence/names changed"

    changed = [a[1] for a, b in zip(before_tags, after_tags) if a[2] != b[2]]
    assert changed == [TAG, CONFIG_TAG], f"Unexpected changed SWF tags: {changed}"

    tag_reversal_proofs = {}
    unchanged_tag_count = 0
    unchanged_tags_hasher = hashlib.sha256()

    for idx, (a, b) in enumerate(zip(before_tags, after_tags)):
        if a[2] != b[2]:
            tag_name = a[1].decode("utf-8")
            assert len(a[2]) == len(b[2]), f"Tag length changed for {tag_name}"
            reversed_tag = b[2].replace(build_id.encode("utf-8"), OLD_BUILD.encode("utf-8"))
            assert reversed_tag == a[2], f"Byte-level reverse substitution failed for {tag_name}"
            assert build_id.encode("utf-8") in b[2] and OLD_BUILD.encode("utf-8") not in b[2]
            tag_reversal_proofs[tag_name] = {
                "tag_index": idx,
                "byte_length": len(b[2]),
                "before_tag_sha256": sha(a[2]),
                "after_tag_sha256": sha(b[2]),
                "reverse_substitution_sha256": sha(reversed_tag),
                "reverse_substitution_matches_input_exact": True,
            }
        else:
            unchanged_tag_count += 1
            unchanged_tags_hasher.update(struct.pack("<II", idx, len(a[2])))
            unchanged_tags_hasher.update(a[2])

    unpacked_out = unpack(raw)
    old_count = unpacked_out.count(OLD_BUILD.encode("utf-8"))
    new_count = unpacked_out.count(build_id.encode("utf-8"))
    assert old_count == 0, f"OLD_BUILD still present in unpacked SWF ({old_count} occurrences)"
    assert new_count == 3, f"Expected exactly 3 occurrences of {build_id!r} in unpacked SWF, got {new_count}"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(raw)

    result = {
        "status": "passed",
        "input": str(src_path),
        "input_sha256": sha(original),
        "output": str(out_path),
        "output_sha256": sha(raw),
        "previous_build": OLD_BUILD,
        "build": build_id,
        "build_id_byte_length": len(build_id.encode("utf-8")),
        "unpacked_new_build_id_occurrences": new_count,
        "unpacked_old_build_id_occurrences": old_count,
        "changed_tags": [t.decode("utf-8") for t in changed],
        "literal_occurrences": {
            "cn/admission/ClientAdmission": 2,
            "cn/admission/BuildConfig": 1,
        },
        "tag_reversal_proofs": tag_reversal_proofs,
        "byte_reverse_substitution_recovers_input_admission_tags": True,
        "tag_lengths_unchanged": True,
        "all_method_bodies_identical": True,
        "admission_key_bytes_unchanged": True,
        "all_other_swf_tags_byte_identical": True,
        "unchanged_swf_tag_count": unchanged_tag_count,
        "unchanged_swf_tags_sha256": unchanged_tags_hasher.hexdigest(),
        "key_material_printed": False,
        "abc_tags": edits,
    }

    if report_path is not None:
        rp = Path(report_path).resolve()
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", "--input", dest="src", required=True, help="Input SWF path")
    ap.add_argument("--out", "--output", dest="out", required=True, help="Output SWF path")
    ap.add_argument("--build-id", default=NEW_BUILD, help=f"Target admission build ID (default: {NEW_BUILD})")
    ap.add_argument("--report", help="Optional JSON report path")
    args = ap.parse_args(argv)
    res = patch_admission(args.src, args.out, args.report, build_id=args.build_id)
    print(
        json.dumps(
            {
                "status": res["status"],
                "previous_build": res["previous_build"],
                "build": res["build"],
                "unpacked_new_build_id_occurrences": res["unpacked_new_build_id_occurrences"],
                "unpacked_old_build_id_occurrences": res["unpacked_old_build_id_occurrences"],
                "input_sha256": res["input_sha256"],
                "output_sha256": res["output_sha256"],
                "byte_reverse_substitution_recovers_input_admission_tags": res[
                    "byte_reverse_substitution_recovers_input_admission_tags"
                ],
                "admission_key_bytes_unchanged": res["admission_key_bytes_unchanged"],
                "all_other_swf_tags_byte_identical": res["all_other_swf_tags_byte_identical"],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return res


if __name__ == "__main__":
    main()
