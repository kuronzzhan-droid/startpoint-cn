"""Compile a hidden AIR fixture, then graft the exact symbolic AVM2 insertion.

This fixture checks the added bytecode against synthetic animation containers;
it does not instantiate the game scene or load the game's texture resources.
"""
import argparse
import os
import json
import struct
import subprocess
import zlib
from pathlib import Path

from patch_swf import assemble_waiting, s, view, array_index_name

HERE = Path(__file__).resolve().parent
SDK = Path(os.environ.get("STARPOINT_AIR_SDK", "AIRSDK_51.2.1.5"))
JAVA = Path(os.environ.get("STARPOINT_JAVA", "java"))


def run(work, game_source):
    work = Path(work)
    work.mkdir(parents=True, exist_ok=False)
    source_swf = work / "fixture-original.swf"
    command = [str(JAVA), "-Dflexlib=" + str(SDK / "frameworks"), "-Xmx512m", "-jar", str(SDK / "lib/mxmlc-cli.jar"),
               "+configname=air", "-swf-version=44", "-target-player=32.0", "-debug=false", "-compress=false", "-compiler.float=false",
               "-compiler.source-path=" + str(HERE / "tests"), "-output=" + str(source_swf), str(HERE / "tests/RuntimeHarness.as")]
    compiled = subprocess.run(command, capture_output=True, timeout=120)
    (work / "compile.log").write_bytes(compiled.stdout + compiled.stderr)
    assert compiled.returncode == 0, "AIR fixture compilation failed; see compile.log"
    version, header, tags = s.parts(source_swf)
    matches = []
    for tag in tags:
        if tag[0] == 82:
            v = view(tag[3])
            matches += [(tag, indices[0]) for label, indices in v.by_label.items() if label.endswith("RuntimeHarness/pumpOffscreen|1")]
    assert len(matches) == 1, "expected unique fixture insertion entry"
    tag, bi = matches[0]
    abc = tag[3]
    body = abc.bodies[bi]
    old = bytes(body[5])
    decoded = s.m.asm.decode(old)
    assert [ins.op for ins in decoded] == [0x47]
    index_name = array_index_name(abc, view(abc))
    pool = s.PoolEditor(abc)
    def fixture_name(name):
        if name == "arrayIndex":
            return index_name
        wanted = (7, (22, ""), name)
        hits = [i for i in range(1, len(abc.multinames)) if view(abc).mn(i) == wanted]
        if hits:
            return hits[0]
        public_ns = [i for i, ns in enumerate(abc.namespaces) if i and ns[0] == 22 and abc.s(ns[1]) == ""]
        assert public_ns
        abc.multinames.append((7, public_ns[0], pool.string(name)))
        return len(abc.multinames) - 1
    block = assemble_waiting(fixture_name)
    body[5], body[6], _, placed = s.m.asm.splice_many(body, [(0, block, s.m.asm.ENTER)])
    body[2] = 14
    body[1] = max(body[1], 3)
    check = s.m.check_body(body, abc)
    body[1] = max(body[1], check["max_stack"])
    assert s.m.asm.unsplice_many(body[5], placed) == old
    fixture = view(abc)
    game_tags = s.parts(game_source)[2]
    donor_tag, = [t for t in game_tags if t[0] == 82 and "pinball.scene.character.partyCarousel::PartyCarousel/haveAllCellsJoinOrRemoveAnimationFinished|1" in view(t[3]).by_label]
    donor = view(donor_tag[3])
    importer = s.m.Importer(fixture, donor)
    for original_type, fixture_type in (
        ((7, (22, "pinball.scene.character.partyCarousel.characterContainer"), "PartyCharacterCellContainer"), "TestContainer"),
        ((7, (22, "pinball.scene.character.cell"), "CharacterCell"), "TestCell"),
    ):
        for source_index in range(1, len(donor.a.multinames)):
            if donor.mn(source_index) == original_type:
                target_index, = [row[0] for row in abc.instances if fixture.mn(row[0])[-1] == fixture_type]
                importer.cache[("multinames", source_index)] = target_index
    grafts = []
    for source_label, target_suffix in (
        ("pinball.scene.character.partyCarousel::PartyCarousel/haveAllCellsJoinOrRemoveAnimationFinished|1", "RuntimeHarness/allFinished|1"),
        ("pinball.scene.character.cell::CharacterCell/isJoinOrRemoving|1", "TestCell/isJoinOrRemoving|1"),
        ("pinball.scene.character.cell::CharacterCell/isFalling|1", "TestCell/isFalling|1"),
        ("pinball.scene.character.cell::CharacterCellCharacterPlayhead/get_isPlayingKachidokiOnce|1", "TestCharacterHead/get_isPlayingKachidokiOnce|1"),
        ("pinball.scene.character.partyCarousel.characterContainer::PartyCharacterCellContainer/update|1", "TestContainer/realUpdate|1"),
    ):
        source_bi, = donor.by_label[source_label]
        target_bi, = [indices[0] for label, indices in fixture.by_label.items()
                       if label.endswith(target_suffix) or label.endswith("::" + target_suffix.split("/")[-1])]
        target_body = abc.bodies[target_bi]
        abc.bodies[target_bi] = importer.body(source_bi, target_body[0], scope=target_body[3])
        actual_check = s.m.check_body(abc.bodies[target_bi], abc)
        grafts.append({"source": source_label, "source_body": source_bi, "fixture": target_suffix,
                       "source_code_sha256": s.sha(donor.a.bodies[source_bi][5]), "check": actual_check})
    payload = tag[2] + s.serialize(abc, tag[4])
    tag[1] = struct.pack("<HI", (82 << 6) | 63, len(payload)) + payload
    raw = header + b"".join(t[1] for t in tags)
    (work / "RuntimeHarness.swf").write_bytes(b"CWS" + bytes([version]) + struct.pack("<I", len(raw) + 8) + zlib.compress(raw))
    result = subprocess.run([str(SDK / "bin/adl.exe"), str(HERE / "tests/harness-app.xml"), str(work)], capture_output=True, timeout=60)
    (work / "adl.log").write_bytes(result.stdout + result.stderr)
    report = json.loads((work / "runtime-tests.json").read_text("utf-8"))
    report.update({"adl_exit_code": result.returncode, "inserted_block_check": check,
                   "shared_symbolic_insertion": True, "fixture_insertion_reversible": True,
                   "current_game_methods_grafted": grafts,
                   "scope": "production insertion + current completion predicate/container update/cell predicates on AIR; controlled animation lifecycle, not full game/device"})
    (work / "runtime-tests.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    assert result.returncode == 0 and report["passed"], report
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("work", type=Path)
    parser.add_argument("--game-source", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.work, args.game_source), indent=2))
