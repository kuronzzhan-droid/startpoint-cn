#!/usr/bin/env python3
"""Build + verify the P4 native-list client patch (stages S1 and S2).

Built **on top of the P2 APK**, not device_base.apk, so the five-in-one stack the
author runs (re-point / sdkDummy / render-scale / ... / P1 crown button / P2
scene hijack) stays intact.

    baseline   out/rank-scene-p2/WorldFlipper-rank-scene-p2.apk

    --variant s1   fake rows.  Isolates "can the device build
                   scene/rush/rush_event_ranking -> layout/list_cell at all"
                   and "does cell.config.height take" with the data path
                   completely out of the picture.
    --variant s2   real rows off POST tool/agreement.

Usage (PowerShell):
    python -X utf8 client-patch\\rank-p4-native\\build_rank_p4.py --variant s2

⚠ Both variants replace the rush "battle history & reset" page's rendering
unconditionally, because the RushBattle(-1) sentinel that splits the two is
stage S3.  Progress reset is therefore unavailable while an S1/S2 package is
installed; roll back to the P2 APK to get it back.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DUAL = REPO / "client-patch" / "dual-form-v1"
ABYSS = REPO / "client-patch" / "abyss-mode-equipment"

TARGET_SWF_MEMBER = "assets/worldflipper_android_release.swf"

# The P2 artifact this patch continues from.  Locked so a stale or foreign base
# fails the build instead of silently reverting P1/P2.
BASELINE = {
    "apk_sha256": "aab265cf7b73d5a33a80c312112c5790124333d64cb208fa23dd76c838e43409",
    "swf_size": 29070209,
    "swf_sha256": "ce317fc20903717e4047afa603c420e1dc8a09cba4f69d11a42f2e61b11614e1",
    "signer_cert_sha256": "729507c10a893879b14f46cf81d8e5052d4b66c2c081fa5b9f915a142a827a0b",
}

CONTENT_CLASS = ("pinball.scene.event.rush.ranking.party.list.cell."
                 "_RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView")
CONTENT_NS = ("pinball.scene.event.rush.ranking.party.list.cell."
              "_RushEventRankingPartyListCellView:RushEventRankingPartyListCellContentView")
LISTVIEW_CLASS = "pinball.scene.event.rush.ranking.party.list.RushEventRankingPartyListView"
LISTVIEW_NS = "pinball.scene.event.rush.ranking.party.list:RushEventRankingPartyListView"
SCENE_CLASS = "pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene"
SCENE_NS = "pinball.scene.event.rush.ranking.party:RushEventRankingPartyScene"
REMOTE_CLASS = "pinball.remote.tool.agreement.ToolAgreementRealRemote"
REMOTE_NS = "pinball.remote.tool.agreement:ToolAgreementRealRemote"
VIEW_CLASS = "pinball.scene.event.rush.ranking.party.RushEventRankingPartyView"
VIEW_NS = "pinball.scene.event.rush.ranking.party:RushEventRankingPartyView"
TOPSCENE_CLASS = "pinball.scene.event.rush.top.RushEventTopScene"
TOPSCENE_NS = "pinball.scene.event.rush.top:RushEventTopScene"

# Baseline bytecode of every method the patch may touch, measured on the P2 SWF.
# Any drift here means the base is not the package that was analysed.
METHOD_LOCKS = {
    (CONTENT_CLASS, "run"): dict(
        ns=CONTENT_NS, body=71545, code_len=64,
        sha="541966ab5d4583cfa03e6543a7b9b98d4995adfb26aa9e013fed382cdf1daec7"),
    (CONTENT_CLASS, "apply"): dict(
        ns=CONTENT_NS, body=71550, code_len=1507,
        sha="c5c52c173de3b13701bfce69b543878f1da9d05a646e6495390927754f7e0a0d"),
    (CONTENT_CLASS, "resizeWidth"): dict(
        ns=CONTENT_NS, body=71546, code_len=56,
        sha="64db9cc1c41fa9efac13bbc64872adeae179bc537aecb938c99951ac218230e3"),
    (LISTVIEW_CLASS, "createListCell"): dict(
        ns=LISTVIEW_NS, body=71526, code_len=14,
        sha="f80c6a6f2d3104e0038f96b5dab410695413dceb925a23f825030ac556e98ec3"),
    (SCENE_CLASS, "preparation"): dict(
        ns=SCENE_NS, body=71498, code_len=664,
        sha="3e83e46b72b55f05dda6ba746015e261ac417fe3293a767cd68775e0de400007"),
    (SCENE_CLASS, "afterTransition"): dict(
        ns=SCENE_NS, body=71506, code_len=53,
        sha="4722052502a56ab567733b4f0d0deb7af078c11aa02ae9197cde9f83164fd383"),
    (SCENE_CLASS, "copyPlayedParty"): dict(
        ns=SCENE_NS, body=71503, code_len=240,
        sha="60096e2d603bec4ea3168206aa6c3dd0020a2b8f4760ab4c11aab2b26b603070"),
    (REMOTE_CLASS, "successHandler"): dict(
        ns=REMOTE_NS, body=50330, code_len=591,
        sha="2c09e5be1bd1889f8176e03bbb0fe0d29df45849582358ac7f0e896981382c06"),
    # S3/S4 only
    (SCENE_CLASS, "run"): dict(
        ns=SCENE_NS, body=71496, code_len=303,
        sha="43f3e15f0ff5d1dc8175c7ec8c6c68b2306ae6be4af7f43bfd5bcb03d20ee034"),
    (SCENE_CLASS, "buttonClicked"): dict(
        ns=SCENE_NS, body=71505, code_len=894,
        sha="c4c69c1f38be4f4b96c9e97e864e862fd69c29f7f73664baabd238e9f322dcfb"),
    (VIEW_CLASS, "run"): dict(
        ns=VIEW_NS, body=71515, code_len=161,
        sha="5a95b1914d9c372f9b336f4fb4831acfd5bd560db79f406810d047481e508465"),
    # the P2 surgery already lives in this one, hence the non-stock hash
    (TOPSCENE_CLASS, "buttonClicked"): dict(
        ns=TOPSCENE_NS, body=71586, code_len=424,
        sha="e152cb81b9d61e34e0d32c4f0863cf94643326f15e60d35fadbaa177ae61fc8f"),
}

# Statements FFDec's decompiler must / must not produce once it re-reads the
# patched SWF.  This is the only end-to-end *semantic* check available offline.
AS3_MUST_APPEAR = {
    CONTENT_CLASS: [
        '"assetPath":"scene/rush/rush_event_ranking"',
        '"name":"layout/list_cell"',
        'getText("ranking_rank"',
        'getText("user_name"',
        'getImage("rank_label"',
        'getContainer("party_thumbnails"',
        'getContainer("thumbnail000"',
        'getContainer("thumbnail002"',
        'AssetGroupKind.CharacterFaceThumbnail',
    ],
    LISTVIEW_CLASS: ["config.height = 204"],
}
AS3_MUST_VANISH = {
    CONTENT_CLASS: [
        '"scene/rush/rush_event_ranking_party"',
        '"layout/party_list_cell"',
    ],
}
AS3_S2_MUST_APPEAR = {
    SCENE_CLASS: [
        "SectionCommand.ToolAgreementRemote",
        "remote.toolAgreement(",
        "copyPlayedParty",
        "partyList.abstractAdapter.appendAll(",
        "partyListView.reload()",
    ],
}

# S3 is where the two paths start living side by side, so the readback has to
# prove *both* halves are in the decompiled source: the sentinel test, and the
# stock party strings/behaviour it protects.
# The sentinel, as FFDec re-renders it.  Every gated body has to show both
# halves of the fork; the party half is the regression test.
SENTINEL_AS3 = ["mode.index == 0", "int(mode.params[0]) < 0"]
PEEK_SENTINEL_AS3 = ["scenePeek.mode.index == 0", "int(scenePeek.mode.params[0]) < 0"]

AS3_S3_MUST_APPEAR = {
    CONTENT_CLASS: PEEK_SENTINEL_AS3 + [
        # both layouts are reachable again
        '"scene/rush/rush_event_ranking"',
        '"scene/rush/rush_event_ranking_party"',
        '"layout/list_cell"',
        '"layout/party_list_cell"',
        # ... and the ranking renderer is still all there
        'getText("ranking_rank"',
        'getText("user_name"',
        'getImage("rank_label"',
        'getContainer("party_thumbnails"',
        'getContainer("thumbnail000"',
        'getContainer("thumbnail002"',
        "AssetGroupKind.CharacterFaceThumbnail",
        # the party path's own layout lookup, which A2b short-circuits only on
        # the ranking side
        'getContainer("right_align"',
    ],
    LISTVIEW_CLASS: [
        # FFDec renders the branching height as a stack fork; what matters is
        # that both values are there and that the discriminator is the row.
        "param2.rank != null",
        "§§push(204)",
        "§§push(329)",
        ".height = §§pop()",
    ],
    SCENE_CLASS: SENTINEL_AS3 + [
        # the reset/copy machinery the host page exists for
        "ConfirmResetProgressDialog",
        "EventRushResetKind",
        "RushEventRankingPartyListCellPresentationTools.fromQuestParties",
        "RushEventRankingPartyListCellPresentationTools.fromRoundParties",
        "RushEventRankingPartyListCellPresentationTools.createPlayedPartyData",
        "SceneKind.PartyGroupEdit",
        # ... and the ranking data pump
        "SectionCommand.ToolAgreementRemote",
        "remote.toolAgreement(",
        "partyList.abstractAdapter.appendAll(",
        "partyListView.reload()",
    ],
    TOPSCENE_CLASS: [
        "SceneKind.RushEventRankingParty(",
        "RushEventRankingPartyMode.RushBattle(-1)",
        "ChangeSceneBackKind.AddCurrent",
    ],
}
AS3_S3_MUST_VANISH = {
    # the crown button no longer goes to the rich-text page
    TOPSCENE_CLASS: ["LoadingTaskKind.TermsOfService"],
}

AS3_S4_MUST_APPEAR = {
    SCENE_CLASS: [
        "VerticalListPagerConfig.Set(100)",
        "partyList.changePage(",
        "LoadingTaskKind.TermsOfService",            # reward button -> P2 page
    ],
    VIEW_CLASS: [
        "VerticalListViewConfigPreset.rushRanking()",
        '"name":"container/button"',
        "ButtonConfigs.raidMyRanking",
        "ButtonConfigs.rushReward",
        "addWithConfig(",
        "passContentLayer.addChild(",
    ],
}


# S5: the three門面 pieces + row navigation, as FFDec re-renders them.
AS3_S5_MUST_APPEAR = {
    VIEW_CLASS: [
        # the list moves to the official ranking_layer rect (y=438) and shrinks
        # by the same amount, otherwise its bottom scrolls out of the mask
        "listLayer.y = safeArea.y + 438",
        "partyListView.resizeHeight(partyListView.listSize.height - 438)",
        # the top 「…更新」 black bar and the pinned self-rank card
        '"name":"container/time_range_layer"',
        '"name":"layout/list_cell"',
        "bg-assets/colorfafafa",
        'getContainer("party_thumbnails"',
    ],
    SCENE_CLASS: [
        # my-rank now scrolls to the row, not just the page
        "partyList.changePage(",
        "partyListView.scrollTo(",
        # tapping a row opens that player's profile
        "LoadingTaskKind.ProfileGetProfile(",
        # the response handler fills the bar and the card
        'getText("text"',
        'getText("ranking_rank"',
        'getImage("rank_label"',
    ],
    CONTENT_CLASS: [
        # every row is registered as a button so it can be tapped
        "registerDisplayObjectAsButton(",
        "ButtonAnimationBehaviorKind.Scale",
    ],
}


# s5b: S4 + the top black bar, and provably nothing else.  The must_vanish half
# is the load-bearing part - it is what makes "s5b is not P5" a structural fact
# rather than a claim.
AS3_S5B_MUST_APPEAR = {
    VIEW_CLASS: [
        '"name":"container/time_range_layer"',
        "partyListView.config.listPadding.top = 204",
        "passContentLayer.addChild(",
    ],
    SCENE_CLASS: [
        'getText("text"',
    ],
}
AS3_S5B_MUST_VANISH = {
    VIEW_CLASS: [
        # the two statements P5 used to move/resize the working list
        "listLayer.y = safeArea.y + 438",
        "resizeHeight(",
        # the pinned self-rank card and its backing plate
        '"name":"layout/list_cell"',
        "bg-assets/colorfafafa",
    ],
    SCENE_CLASS: [
        "partyListView.scrollTo(",
        "LoadingTaskKind.ProfileGetProfile(",
        'getText("ranking_rank"',
    ],
    # NB: CONTENT_CLASS deliberately has no entry - the stock party-mode
    # renderer calls `registerDisplayObjectAsButton(` four times of its own
    # (RushEventRankingPartyListCellContentView.as:218-251), so its absence
    # cannot be asserted by name.  The row-button插入 is instead excluded
    # structurally: `apply_block("s5b") == apply_block("s4")`, and the
    # verifier's per-body hunk lengths come straight off that list.
}


class BuildError(RuntimeError):
    pass


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(cmd, *, timeout: int = 1800, env=None) -> str:
    proc = subprocess.run(
        [str(part) for part in cmd], capture_output=True, text=True, errors="replace",
        timeout=timeout, check=False, env=env,
    )
    if proc.returncode != 0:
        raise BuildError("command failed (%d): %s ...\nstdout:\n%s\nstderr:\n%s"
                         % (proc.returncode, cmd[0], proc.stdout[-4000:], proc.stderr[-4000:]))
    return proc.stdout + proc.stderr


def _mnemonics(instructions: list[str]) -> list[str]:
    """Opcode names of a patch-module instruction list, labels dropped."""
    return [text.split(" ", 1)[0].rstrip(",")
            for text in instructions if not text.endswith(":")]


def expected_bodies(patcher, variant: str, body_of: dict) -> dict:
    """The exact hunk shape each changed body must produce.

    Written out longhand rather than derived from the generated P-code, so that
    a surgery that quietly did something extra (an operand nudged, a branch
    re-routed, an original instruction dropped) fails the build.

    Every S3/S4 edit is deliberately shaped as a **pure insert**: nothing of the
    stock listing is removed or rewritten, which is what makes "the party page
    still runs the code it always ran" a structural fact rather than a claim.
    The two exceptions are the two operand-level replaces P2/S2 already had
    (`successHandler`'s repack, `run`'s layout strings on s1/s2) and the crown
    button's destination.
    """
    expected: dict = {}
    gated = variant in ("s3", "s4", "s5", "s5b")

    apply_block = _mnemonics(patcher.apply_block(variant))
    expected[body_of["apply"]] = {
        "name": "RushEventRankingPartyListCellContentView/apply",
        "hunks": [("insert", [], len(apply_block))],
        "inserted_mnemonics": [apply_block],
        "maxstack": None, "localcount": None,
    }

    resize_block = _mnemonics(patcher.resize_width_block(variant))
    expected[body_of["resizeWidth"]] = {
        "name": "RushEventRankingPartyListCellContentView/resizeWidth",
        "hunks": [("insert", [], len(resize_block))],
        "inserted_mnemonics": [resize_block],
        "maxstack": None, "localcount": None,
    }

    if gated:
        # two independent string switches, each: 15-instruction guard +
        # pushstring + jump, with the stock pushstring kept as the party branch
        asset = _mnemonics(patcher.run_asset_replacement())[:-1]
        name = _mnemonics(patcher.run_name_replacement())[:-1]
        expected[body_of["run"]] = {
            "name": "RushEventRankingPartyListCellContentView/run",
            "hunks": [("insert", [], len(asset)), ("insert", [], len(name))],
            "inserted_mnemonics": [asset, name],
            "maxstack": 7, "localcount": None,
        }
    else:
        expected[body_of["run"]] = {
            "name": "RushEventRankingPartyListCellContentView/run",
            "hunks": [
                ("replace", ['pushstring "scene/rush/rush_event_ranking_party"'], 1),
                ("replace", ['pushstring "layout/party_list_cell"'], 1),
            ],
            "inserted_mnemonics": [],
            "maxstack": None, "localcount": None,
        }

    if gated:
        height = _mnemonics(patcher.CREATE_CELL_HEIGHT_BLOCK)
        expected[body_of["createListCell"]] = {
            "name": "RushEventRankingPartyListView/createListCell",
            "hunks": [("insert", [], len(height))],
            "inserted_mnemonics": [height],
            "maxstack": 4, "localcount": None,
        }
    else:
        expected[body_of["createListCell"]] = {
            "name": "RushEventRankingPartyListView/createListCell",
            # dup / getproperty config / pushint 204 / setproperty height
            "hunks": [("insert", [], 4)],
            "inserted_mnemonics": [["dup", "getproperty", "pushint", "setproperty"]],
            "maxstack": 3, "localcount": None,
        }

    prep = _mnemonics(patcher.preparation_replacement(variant))
    if gated:
        # findproperty / <guard + newarray0 + jump> / getlocal3 / initproperty:
        # the two stock instructions bracket the insert
        prep_hunks = [("insert", [], len(prep) - 3)]
        prep_inserted = [prep[1:-2]]
    else:
        # The anchor is findproperty / getlocal3 / initproperty; only the middle
        # instruction is replaced, so the hunk is exactly one line out, N in.
        prep_hunks = [("replace", ["getlocal3"], len(prep) - 2)]
        prep_inserted = []
    if variant in ("s4", "s5", "s5b"):
        ids = _mnemonics(patcher.preparation_ids_replacement(variant))
        prep_hunks.append(("insert", [], len(ids) - 3))
        prep_inserted.append(ids[:-3])
    expected[body_of["preparation"]] = {
        "name": "RushEventRankingPartyScene/preparation",
        "hunks": prep_hunks,
        "inserted_mnemonics": prep_inserted,
        "maxstack": 16 if variant == "s1" else None, "localcount": None,
    }

    if variant == "s1":
        return expected

    after_block = _mnemonics(patcher.after_transition_block(variant))
    expected[body_of["afterTransition"]] = {
        "name": "RushEventRankingPartyScene/afterTransition",
        "hunks": [("insert", [], len(after_block))],
        "inserted_mnemonics": [after_block],
        "maxstack": patcher.AFTER_TRANSITION_MAXSTACK,
        "localcount": patcher.AFTER_TRANSITION_LOCALCOUNT,
    }

    copy_block = _mnemonics(patcher.copy_played_party_block(variant))
    expected[body_of["copyPlayedParty"]] = {
        "name": "RushEventRankingPartyScene/copyPlayedParty",
        "hunks": [("insert", [], len(copy_block))],
        "inserted_mnemonics": [copy_block],
        "maxstack": None, "localcount": None,
    }

    expected[body_of["successHandler"]] = {
        "name": "ToolAgreementRealRemote/successHandler",
        "hunks": [("replace", [
            'pushstring "required_privacy_version"',
            "getlocal 4",
            'pushstring "required_terms_version"',
            "getlocal 6",
            'pushstring "terms_text"',
            "getlocal 7",
            "coerce ::String",
            'pushstring "terms_url"',
            "getlocal 9",
            "newobject 4",
        ], 1)],
        "inserted_mnemonics": [],
        "maxstack": None, "localcount": None,
    }

    if not gated:
        return expected

    # Two hunks, because the P2 block and its replacement share their first
    # instruction (kept on purpose: it is the lookupswitch's sixth target) and
    # their `ChangeSceneBackKind.AddCurrent` tail.  What is removed is spelled
    # out here line by line: the TermsOfService loading task, and nothing else.
    expected[body_of["crownClicked"]] = {
        "name": "RushEventTopScene/buttonClicked",
        "hunks": [
            ("replace", [
                "getlex pinball.common.data.scene::LoadingTaskKind",
                "getproperty ::TermsOfService",
            ], len(_mnemonics(patcher.CROWN_REPLACEMENT)) - 4),
            ("replace", ["callpropvoid ::changeSceneWithLoading, 2"], 1),
        ],
        "inserted_mnemonics": [],
        "maxstack": None, "localcount": None,
    }

    if variant not in ("s4", "s5", "s5b"):
        return expected

    scene_run = _mnemonics(patcher.scene_run_block())
    expected[body_of["sceneRun"]] = {
        "name": "RushEventRankingPartyScene/run",
        "hunks": [("insert", [], len(scene_run))],
        "inserted_mnemonics": [scene_run],
        "maxstack": None, "localcount": None,
    }

    scene_btn = _mnemonics(patcher.scene_button_clicked_block(variant))
    expected[body_of["sceneButtonClicked"]] = {
        "name": "RushEventRankingPartyScene/buttonClicked",
        "hunks": [("insert", [], len(scene_btn))],
        "inserted_mnemonics": [scene_btn],
        "maxstack": None, "localcount": None,
    }

    preset = _mnemonics(patcher.view_run_preset_block())
    buttons = _mnemonics(patcher.view_run_buttons_block())
    if variant == "s5":
        buttons = buttons + _mnemonics(patcher.view_run_s5_block())
    elif variant == "s5b":
        buttons = buttons + _mnemonics(patcher.view_run_s5b_block())
    expected[body_of["viewRun"]] = {
        "name": "RushEventRankingPartyView/run",
        "hunks": [("insert", [], len(preset)), ("insert", [], len(buttons))],
        "inserted_mnemonics": [preset, buttons],
        "maxstack": None,
        "localcount": (patcher.VIEW_RUN_LOCALCOUNT
                       if variant in ("s5", "s5b") else 3),
    }
    return expected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variant",
                        choices=("s1", "s2", "s3", "s4", "s5", "s5b"), required=True)
    parser.add_argument("--base-apk", type=Path,
                        default=REPO / "out" / "rank-scene-p2" / "WorldFlipper-rank-scene-p2.apk")
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--ffdec", type=Path, default=REPO / "ffdec_26.2.1" / "ffdec.jar")
    parser.add_argument("--java", type=Path,
                        default=Path(r"C:\Program Files\Java\jre1.8.0_491\bin\java.exe"))
    parser.add_argument("--zipalign", type=Path,
                        default=Path(r"C:\Program Files (x86)\Android\android-sdk\build-tools\35.0.0\zipalign.exe"))
    parser.add_argument("--apksigner", type=Path,
                        default=Path(r"C:\Program Files (x86)\Android\android-sdk\build-tools\35.0.0\apksigner.bat"))
    parser.add_argument("--signer-java-home", type=Path,
                        default=Path(r"C:\Program Files\Java\jre1.8.0_491"))
    parser.add_argument("--ks", type=Path,
                        default=REPO / "\u5f39\u56fd\u670d" / "instrument" / "wf_new.keystore")
    parser.add_argument("--ks-pass-env", default="WF_APK_KS_PASS")
    parser.add_argument("--ks-type", default="PKCS12")
    parser.add_argument("--skip-sign", action="store_true")
    args = parser.parse_args()

    variant = args.variant
    out_dir = (args.out_dir or (REPO / "out" / ("rank-p4-%s" % variant))).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    work = (out_dir / "work").resolve()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    report: dict = {"schema_version": 1, "patch_id": "rank-p4-%s" % variant,
                    "continues": "rank-scene-p2", "variant": variant, "steps": {}}

    patcher = _load(HERE / "patch_rank_native.py", "p4_patch")
    pcode_tools = _load(DUAL / "pcode_tools.py", "p4_pcode_tools")
    abc_methods = _load(DUAL / "abc_methods.py", "p4_abc_methods")

    # 1 -- baseline lock -----------------------------------------------------
    apk_hash = sha256_file(args.base_apk)
    if apk_hash != BASELINE["apk_sha256"]:
        raise BuildError("base APK is not the P2 artifact: sha256 %s" % apk_hash)
    with zipfile.ZipFile(args.base_apk) as archive:
        members = archive.infolist()
        swf_bytes = archive.read(TARGET_SWF_MEMBER)
    base_swf = work / "base.swf"
    base_swf.write_bytes(swf_bytes)
    swf_hash = hashlib.sha256(swf_bytes).hexdigest()
    if len(swf_bytes) != BASELINE["swf_size"] or swf_hash != BASELINE["swf_sha256"]:
        raise BuildError("P2 SWF drift: size=%d sha256=%s" % (len(swf_bytes), swf_hash))
    # the three pre-existing patches must still be in the SWF we inherit
    for marker in (b"192.168.0.130:8001", b"sdkDummy"):
        if swf_bytes.count(marker) < 1:
            raise BuildError("the P2 SWF has lost the %r patch" % marker)
    report["steps"]["baseline"] = {
        "apk": str(args.base_apk), "apk_sha256": apk_hash,
        "swf_size": len(swf_bytes), "swf_sha256": swf_hash,
        "apk_entries": len(members),
        "inherited_markers": {"repoint": swf_bytes.count(b"192.168.0.130:8001"),
                              "sdkDummy": swf_bytes.count(b"sdkDummy")},
    }

    # 2 -- resolve method bodies and lock their bytecode ---------------------
    methods = patcher.methods_for(variant)
    index = abc_methods.index_swf_methods(base_swf)
    resolved = []
    for class_name, trait in methods:
        lock = METHOD_LOCKS[(class_name, trait)]
        ref = index.require_ref("%s/%s" % (lock["ns"], trait))
        digest = hashlib.sha256(ref.code).hexdigest()
        if digest != lock["sha"] or len(ref.code) != lock["code_len"] or ref.body_index != lock["body"]:
            raise BuildError("method body drift for %s/%s: body=%d len=%d sha256=%s"
                             % (class_name, trait, ref.body_index, len(ref.code), digest))
        resolved.append({"class_name": class_name, "trait_name": trait,
                         "body_index": ref.body_index, "code_len": len(ref.code),
                         "code_sha256": digest})
    report["steps"]["method_resolution"] = resolved

    classes = ",".join(sorted({entry["class_name"] for entry in resolved}))
    env = dict(os.environ, JAVA_HOME=str(args.java.parent.parent))

    def ffdec_export(fmt: str, dest: Path, swf: Path):
        run([args.java, "-Xmx6g", "-jar", args.ffdec, "-air",
             "-format", "script:" + fmt, "-selectclass", classes,
             "-export", "script", dest, swf], env=env)

    # 3 -- baseline exports (evidence) --------------------------------------
    ffdec_export("pcode", work / "base-pcode", base_swf)
    ffdec_export("as", work / "base-as", base_swf)

    # 4 -- patch the method blocks ------------------------------------------
    generated = work / "generated"
    generated.mkdir()
    for seq, entry in enumerate(resolved):
        relative = Path(*entry["class_name"].split("."))
        source = work / "base-pcode" / "scripts" / relative.with_suffix(".pcode")
        block = pcode_tools.extract_method_block(
            source.read_text(encoding="utf-8"),
            trait_kind="method", trait_name=entry["trait_name"])
        patched = patcher.patch_block(entry["class_name"], entry["trait_name"], block, variant)
        destination = generated / ("%02d-%s-%s.pcode" % (
            seq, entry["class_name"].rsplit(".", 1)[-1], entry["trait_name"]))
        destination.write_text(patched, encoding="utf-8", newline="\n")
        entry["generated_pcode"] = str(destination)

    # 5 -- P-code replacement (FFDec assembler; no AS3 compiler involved) -----
    patched_swf = work / "patched.swf"
    command = [args.java, "-Xmx6g", "-jar", args.ffdec, "-air",
               "-replace", base_swf, patched_swf]
    for entry in resolved:
        command += [entry["class_name"], entry["generated_pcode"], str(entry["body_index"])]
    run(command, env=env)
    if not patched_swf.is_file():
        raise BuildError("FFDec produced no output SWF")

    # 6 -- independent structural verification -------------------------------
    verifier = _load(HERE / "verify_rank_p4.py", "p4_verify")
    # three different traits are called `run` and two `buttonClicked`, so the
    # key has to carry the class as well
    alias = {
        (CONTENT_CLASS, "run"): "run",
        (CONTENT_CLASS, "apply"): "apply",
        (CONTENT_CLASS, "resizeWidth"): "resizeWidth",
        (LISTVIEW_CLASS, "createListCell"): "createListCell",
        (SCENE_CLASS, "preparation"): "preparation",
        (SCENE_CLASS, "afterTransition"): "afterTransition",
        (SCENE_CLASS, "copyPlayedParty"): "copyPlayedParty",
        (SCENE_CLASS, "run"): "sceneRun",
        (SCENE_CLASS, "buttonClicked"): "sceneButtonClicked",
        (VIEW_CLASS, "run"): "viewRun",
        (REMOTE_CLASS, "successHandler"): "successHandler",
        (TOPSCENE_CLASS, "buttonClicked"): "crownClicked",
    }
    body_of = {alias[(entry["class_name"], entry["trait_name"])]: entry["body_index"]
               for entry in resolved}
    report["steps"]["independent_verification"] = verifier.verify(
        base_swf, patched_swf,
        expected_bodies=expected_bodies(patcher, variant, body_of),
        expected_new_strings=patcher.new_strings_for(variant),
    )
    report["steps"]["swf"] = {
        "baseline_size": base_swf.stat().st_size,
        "patched_size": patched_swf.stat().st_size,
        "delta_bytes": patched_swf.stat().st_size - base_swf.stat().st_size,
        "patched_sha256": sha256_file(patched_swf),
    }

    # 7 -- independent re-decompile of the patched SWF ------------------------
    ffdec_export("pcode", work / "final-pcode", patched_swf)
    ffdec_export("as", work / "final-as", patched_swf)
    as_diff = []
    must_appear: dict = {}
    must_vanish: dict = {}

    def merge(target: dict, extra: dict) -> None:
        for key, value in extra.items():
            target[key] = target.get(key, []) + value

    if variant in ("s1", "s2"):
        merge(must_appear, AS3_MUST_APPEAR)
        merge(must_vanish, AS3_MUST_VANISH)
    if variant == "s2":
        merge(must_appear, AS3_S2_MUST_APPEAR)
    if variant in ("s3", "s4", "s5", "s5b"):
        # S3 keeps both layouts, so AS3_MUST_VANISH (which asserts the party
        # strings are gone) is deliberately NOT applied here.
        merge(must_appear, AS3_S2_MUST_APPEAR)
        merge(must_appear, AS3_S3_MUST_APPEAR)
        merge(must_vanish, AS3_S3_MUST_VANISH)
    if variant in ("s4", "s5", "s5b"):
        merge(must_appear, AS3_S4_MUST_APPEAR)
    if variant == "s5b":
        merge(must_appear, AS3_S5B_MUST_APPEAR)
        merge(must_vanish, AS3_S5B_MUST_VANISH)
    if variant == "s5":
        merge(must_appear, AS3_S5_MUST_APPEAR)
        # the reward button re-uses TermsOfService, so it is legal again
        must_vanish.pop(TOPSCENE_CLASS, None)
    for class_name in sorted({entry["class_name"] for entry in resolved}):
        relative = Path(*class_name.split("."))
        before = (work / "base-as" / "scripts" / relative.with_suffix(".as")).read_text(encoding="utf-8")
        after = (work / "final-as" / "scripts" / relative.with_suffix(".as")).read_text(encoding="utf-8")
        flat_after = after.replace(" ", "")
        for needle in must_appear.get(class_name, []):
            if needle.replace(" ", "") not in flat_after:
                raise BuildError("%s: patched AS3 is missing %r" % (class_name, needle))
        for needle in must_vanish.get(class_name, []):
            if needle.replace(" ", "") in flat_after:
                raise BuildError("%s: patched AS3 still contains %r" % (class_name, needle))
        before_lines, after_lines = before.splitlines(), after.splitlines()
        as_diff.append({
            "class": class_name,
            "added": [line.strip() for line in after_lines if line not in before_lines][:80],
            "removed": [line.strip() for line in before_lines if line not in after_lines][:80],
        })
    report["steps"]["as3_readback"] = as_diff

    # 8 -- rebuild the APK around the patched SWF -----------------------------
    build_apk = _load(ABYSS / "build_apk.py", "p4_build_apk")
    unsigned = work / "unsigned.apk"
    build_apk.rewrite_apk(args.base_apk, unsigned, patched_swf)
    aligned = work / "aligned.apk"
    run([args.zipalign, "-p", "-f", "4", unsigned, aligned])
    run([args.zipalign, "-c", "-p", "4", aligned])

    # S5 ships as the P5 package (the门面 stage the author asked for), so its
    # artifact carries the p5 tag; s1..s4 keep the p4-sN names they shipped under.
    tag = {"s5": "p5", "s5b": "p5b"}.get(variant, "p4-%s" % variant)
    final_apk = out_dir / ("WorldFlipper-rank-%s.apk" % tag)
    if args.skip_sign:
        shutil.copy2(aligned, out_dir / ("WorldFlipper-rank-%s-UNSIGNED.apk" % tag))
        report["steps"]["signing"] = {"status": "skipped"}
    else:
        password = os.environ.get(args.ks_pass_env)
        source = "environment"
        if not password:
            script = REPO / "\u5f39\u56fd\u670d" / "instrument" / "build_instrumented_apk.py"
            match = re.search(r'--ks-pass"\s*,\s*default="([^"]+)"', script.read_text(encoding="utf-8"))
            if not match:
                raise BuildError("set %s before running; no local credential source found"
                                 % args.ks_pass_env)
            password = match.group(1)
            source = "project-local build_instrumented_apk.py default"
        sign_env = dict(os.environ)
        sign_env[args.ks_pass_env] = password
        sign_env["JAVA_HOME"] = str(args.signer_java_home)
        sign_env["PATH"] = str(args.signer_java_home / "bin") + os.pathsep + sign_env.get("PATH", "")
        signed = work / "signed.apk"
        run([args.apksigner, "sign", "--ks", args.ks, "--ks-type", args.ks_type,
             "--ks-pass", "env:" + args.ks_pass_env, "--out", signed, aligned], env=sign_env)
        verify_out = run([args.apksigner, "verify", "--verbose", "--print-certs", signed],
                         env=sign_env)
        cert = re.search(r"Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})", verify_out)
        if not cert:
            raise BuildError("could not read signer certificate from apksigner output")
        if cert.group(1) != BASELINE["signer_cert_sha256"]:
            raise BuildError("signer certificate mismatch: %s != %s"
                             % (cert.group(1), BASELINE["signer_cert_sha256"]))
        shutil.copy2(signed, final_apk)
        report["steps"]["signing"] = {
            "status": "verified", "keystore": str(args.ks), "password_source": source,
            "signer_cert_sha256": cert.group(1),
            "p2_cert_sha256": BASELINE["signer_cert_sha256"],
            "matches_p2": True,
            "apksigner_verify": [line for line in verify_out.splitlines()
                                 if line.startswith(("Verifies", "Verified using",
                                                     "Number of signers", "Signer #1 certificate"))],
        }

    # 9 -- APK entry-level diff vs the P2 package -----------------------------
    if final_apk.is_file():
        def entries(path: Path):
            with zipfile.ZipFile(path) as archive:
                return {m.filename: (m.file_size, m.CRC) for m in archive.infolist()}

        patched_entries = entries(final_apk)
        base_entries = entries(args.base_apk)
        report["steps"]["apk_diff"] = {
            "vs_p2": {
                "base_entries": len(base_entries),
                "patched_entries": len(patched_entries),
                "only_in_base": sorted(set(base_entries) - set(patched_entries)),
                "only_in_patched": sorted(set(patched_entries) - set(base_entries)),
                "content_changed": sorted(k for k in set(base_entries) & set(patched_entries)
                                          if base_entries[k] != patched_entries[k]),
            },
            "patched_size": final_apk.stat().st_size,
        }
        report["artifacts"] = {
            "apk": str(final_apk),
            "apk_sha256": sha256_file(final_apk),
            "patched_swf_sha256": report["steps"]["swf"]["patched_sha256"],
        }

    (out_dir / "build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8", newline="\n")
    shutil.copy2(patched_swf, out_dir / ("worldflipper_android_release.%s.swf" % tag))
    for entry in resolved:
        shutil.copy2(entry["generated_pcode"], out_dir / Path(entry["generated_pcode"]).name)
    print(json.dumps({k: v for k, v in report["steps"].items() if k != "as3_readback"},
                     ensure_ascii=False, indent=1)[:12000])
    print("[OK] build report ->", out_dir / "build-report.json")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildError as exc:
        print("[FAIL] %s" % exc, file=sys.stderr)
        raise SystemExit(1)
