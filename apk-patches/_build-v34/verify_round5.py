"""Whole-file proof for R4 plus five method-level overlimit fixes."""
import json
from pathlib import Path

from build_common import ROOT, PATCH, JAVA, FFDEC, load, run, write_json
from swf_patch_guard import verify_patch
from verify_round4 import TARGETS as PREVIOUS_TARGETS

O12_TARGET = 'boot_ffc6:33543'
TARGETS = PREVIOUS_TARGETS + [O12_TARGET]
PREVIOUS_SHA = 'e46582b4b4ac07f57b129501ea4c6e2966ce0ca3eadcf4d65c9e2d1ce0a77060'


def verify_release_swf(candidate, work):
    expected = json.loads((PATCH / 'client-comprehensive/r4-expected.json').read_text('utf-8'))
    original = ROOT / 'inputs/v33.swf'
    baseline = ROOT / 'inputs/v34-r4-verified.swf'
    previous = ROOT / 'inputs/v34-o8-o11-verified.swf'
    support = load('round5_proof_support', PATCH / 'startup-cache/build_swf.py')
    assert support.sha(previous.read_bytes()) == PREVIOUS_SHA
    changed = expected['changed_methods'] + TARGETS
    proof = {'v33_to_final': verify_patch(original, candidate, changed, expected['helpers']),
             'r4_to_final': verify_patch(baseline, candidate, TARGETS, []),
             'round4_to_final': verify_patch(previous, candidate, [O12_TARGET], [])}
    classes = ROOT / 'verification/independent-ffdec/classes'
    assert (classes / 'CompareNamedBodies.class').is_file()
    output = run('round5-ffdec',
                 [JAVA, '-Xmx2g', '-cp', str(classes) + ';' + str(FFDEC),
                  'CompareNamedBodies', original, candidate]).stdout.decode()
    fields = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
    assert int(fields['method_bodies']) == 96733
    assert set(fields['changed'].split(',')) == set(changed)
    assert set(fields['helpers'].split(',')) == set(expected['helpers'])
    assert int(fields['added_bodies']) == 102
    result = {'passed': True, 'input_v33_sha256': support.sha(original.read_bytes()),
              'r4_base_sha256': support.sha(baseline.read_bytes()),
              'previous_round4_sha256': support.sha(previous.read_bytes()),
              'swf_sha256': support.sha(Path(candidate).read_bytes()),
              'original_method_bodies': 96733, 'changed_original_methods': len(changed),
              'unchanged_original_methods': 96733 - len(changed),
              'r4_47_targets_and_5_helpers_byte_preserved': True,
              'o8_to_o11_bodies_byte_identical_to_round4': True,
              'only_O12_differs_from_round4': True, 'archive_101_retained': True,
              'whole_swf_checks': proof, 'independent_ffdec': fields,
              'scope': 'fresh raw method/class/pool/tag and independent FFDec comparisons; no device execution'}
    write_json(work / 'swf-verification.json', result)
    return result
