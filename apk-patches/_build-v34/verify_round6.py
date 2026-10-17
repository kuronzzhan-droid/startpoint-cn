"""Whole-file proof and independent code SHA pins for the O9-O12 r2 guards."""
import json
from pathlib import Path

from build_common import ROOT, PATCH, JAVA, FFDEC, load, run, write_json
from swf_patch_guard import verify_patch
from verify_round5 import TARGETS

PREVIOUS_SHA = '4b6d4916a72b79363b1db138391b74167bf239f19f872e6205b8bbd16ee12018'
AFTER = {
    'O8': (87354, '10eb1e21f915782bcd5715a3fb58670cb18737ae8a5f0f569781f774b1a48f0d'),
    'O9': (73067, 'ae683cc1f5574ac7b415c43cf779ea642535cd6a66531aa1ee51a150d1492068'),
    'O10': (73055, 'b96160fc0f1046a50cf78065ed8d907861a2a65fb13c4f365abad60cbd4b2a7e'),
    'O11': (73065, 'c64d19bbf7957fd9490406d4d251abb9d1e16eeb3062e1b49148f56afbd29aa4'),
    'O12': (33543, 'a0468818a62ad753f0d18a755b29af19c61ebf5c3cd4a145c7a5a8cfc8a8be55'),
}


def verify_release_swf(candidate, work):
    expected = json.loads((PATCH / 'client-comprehensive/r4-expected.json').read_text('utf-8'))
    original, baseline = ROOT / 'inputs/v33.swf', ROOT / 'inputs/v34-r4-verified.swf'
    previous = ROOT / 'inputs/v34-o8-o12-r1-verified.swf'
    support = load('round6_proof_support', PATCH / 'startup-cache/build_swf.py')
    assert support.sha(previous.read_bytes()) == PREVIOUS_SHA
    changed = expected['changed_methods'] + TARGETS
    proof = {'v33_to_final': verify_patch(original, candidate, changed, expected['helpers']),
             'r4_to_final': verify_patch(baseline, candidate, TARGETS, []),
             'round5_r1_to_final_r2': verify_patch(previous, candidate, TARGETS[1:], [])}
    _version, _header, tags = support.parts(candidate)
    abc = next(t[3] for t in tags if t[0] == 82 and t[2][4:-1] == b'boot_ffc6')
    pins = {}
    for label, (index, expected_sha) in AFTER.items():
        body = abc.bodies[index]
        actual = support.sha(body[5])
        assert actual == expected_sha, (label, actual)
        pins[label] = {'body': index, 'code_sha256': actual, 'header': body[1:5],
                       'pcode_check': support.m.check_body(body, abc), 'passed': True}
    classes = ROOT / 'verification/independent-ffdec/classes'
    assert (classes / 'CompareNamedBodies.class').is_file()
    output = run('round6-ffdec', [JAVA, '-Xmx2g', '-cp', str(classes) + ';' + str(FFDEC),
                                'CompareNamedBodies', original, candidate]).stdout.decode()
    fields = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
    assert int(fields['method_bodies']) == 96733
    assert set(fields['changed'].split(',')) == set(changed)
    assert set(fields['helpers'].split(',')) == set(expected['helpers'])
    assert int(fields['added_bodies']) == 102
    result = {'passed': True, 'revision': 'r2',
              'input_v33_sha256': support.sha(original.read_bytes()),
              'r4_base_sha256': support.sha(baseline.read_bytes()),
              'previous_round5_r1_sha256': support.sha(previous.read_bytes()),
              'swf_sha256': support.sha(Path(candidate).read_bytes()),
              'original_method_bodies': 96733, 'changed_original_methods': len(changed),
              'unchanged_original_methods': 96733 - len(changed),
              'r4_47_targets_and_5_helpers_byte_preserved': True, 'O8_unchanged_from_r1': True,
              'only_O9_to_O12_differ_from_round5': True, 'r1_O9_to_O12_obsolete': True,
              'archive_101_retained': True, 'after_code_sha_pins': pins,
              'whole_swf_checks': proof, 'independent_ffdec': fields,
              'scope': 'fresh raw method/class/pool/tag and independent FFDec/code SHA comparisons; no device execution'}
    write_json(work / 'swf-verification.json', result)
    return result
