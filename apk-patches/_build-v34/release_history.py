"""Keep completed deliveries inside this workspace before replacing them."""
import hashlib
import json
import os
from pathlib import Path
import shutil

from build_common import ROOT
from release_package import VARIANTS

ROUND3_SHA = 'f1fe146d29a4e4d72e9776bf285aeb7501e0c1fa78601ea9a8f7e978e09231f0'
ROUND4_SHA = 'e46582b4b4ac07f57b129501ea4c6e2966ce0ca3eadcf4d65c9e2d1ce0a77060'
ROUND5_SHA = '4b6d4916a72b79363b1db138391b74167bf239f19f872e6205b8bbd16ee12018'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ensure_round3_input():
    target = ROOT / 'inputs/v34-o8-o9-verified.swf'
    if not target.exists():
        source = ROOT / 'v34.swf'
        assert digest(source) == ROUND3_SHA
        shutil.copyfile(source, target)
    assert digest(target) == ROUND3_SHA


def preserve_round3():
    target = ROOT / 'previous-build/round3-o8-o9-versionCode1008002'
    if (target / 'build-report.json').exists():
        return
    old = json.loads((ROOT / 'build-report.json').read_text('utf-8'))
    assert old['swf']['sha256'] == ROUND3_SHA
    target.mkdir(parents=True, exist_ok=True)
    for name in ('build-report.json', 'README.md', 'v34.swf'):
        shutil.copyfile(ROOT / name, target / name)
    for variant, spec in VARIANTS.items():
        source = ROOT / spec['output']
        assert digest(source) == old['variants'][variant]['output']['sha256']
        destination = target / source.name
        assert destination.resolve().is_relative_to(ROOT.resolve()) and not destination.exists()
        os.replace(source, destination)
    diagnostic = ROOT / 'v34-without-O9.swf'
    if diagnostic.exists():
        assert digest(diagnostic) == old['swf_variants']['without_O9']['artifact']['sha256']
        destination = target / diagnostic.name
        assert destination.resolve().is_relative_to(ROOT.resolve()) and not destination.exists()
        os.replace(diagnostic, destination)


def ensure_round4_input():
    target = ROOT / 'inputs/v34-o8-o11-verified.swf'
    if not target.exists():
        source = ROOT / 'v34.swf'
        assert digest(source) == ROUND4_SHA
        shutil.copyfile(source, target)
    assert digest(target) == ROUND4_SHA


def preserve_verified_delivery(relative_target, expected_sha):
    target = ROOT / relative_target
    assert target.resolve().is_relative_to(ROOT.resolve())
    saved_report = target / 'build-report.json'
    old = json.loads((saved_report if saved_report.exists() else ROOT / 'build-report.json').read_text('utf-8'))
    assert old['swf']['sha256'] == expected_sha
    diagnostic = ROOT / old['o9_policy']['diagnostic_output']
    assert diagnostic.resolve().is_relative_to(ROOT.resolve())
    target.mkdir(parents=True, exist_ok=True)
    for name in ('build-report.json', 'README.md', 'v34.swf'):
        if not (target / name).exists():
            shutil.copyfile(ROOT / name, target / name)
    assert digest(target / 'v34.swf') == expected_sha
    for variant, spec in VARIANTS.items():
        source = ROOT / spec['output']
        destination = target / source.name
        assert source.resolve().is_relative_to(ROOT.resolve())
        assert destination.resolve().is_relative_to(ROOT.resolve())
        if not destination.exists():
            assert digest(source) == old['variants'][variant]['output']['sha256']
            os.replace(source, destination)
        assert digest(destination) == old['variants'][variant]['output']['sha256']
    destination = target / 'diagnostics' / diagnostic.name
    if diagnostic.exists() or destination.exists():
        assert destination.resolve().is_relative_to(ROOT.resolve())
        destination.parent.mkdir(exist_ok=True)
        if not destination.exists():
            assert digest(diagnostic) == old['o9_policy']['diagnostic_expected_sha256']
            os.replace(diagnostic, destination)
        assert digest(destination) == old['o9_policy']['diagnostic_expected_sha256']


def preserve_round4():
    preserve_verified_delivery('previous-build/round4-o8-o11-versionCode1008002', ROUND4_SHA)


def ensure_round5_input():
    target = ROOT / 'inputs/v34-o8-o12-r1-verified.swf'
    if not target.exists():
        source = ROOT / 'v34.swf'
        assert digest(source) == ROUND5_SHA
        shutil.copyfile(source, target)
    assert digest(target) == ROUND5_SHA


def preserve_round5():
    preserve_verified_delivery('previous-build/round5-o8-o12-r1-versionCode1008002', ROUND5_SHA)
