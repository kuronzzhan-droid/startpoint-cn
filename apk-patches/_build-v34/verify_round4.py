"""Whole-file checks for R4 plus four method-level overlimit fixes."""
import json
from pathlib import Path

from build_common import ROOT, PATCH, JAVA, FFDEC, load, run, write_json
from swf_patch_guard import verify_patch

TARGETS = ['boot_ffc6:87354', 'boot_ffc6:73067', 'boot_ffc6:73055', 'boot_ffc6:73065']
TWO_COST_TARGETS = TARGETS[2:]


def verify_release_swf(candidate, work):
    expected = json.loads((PATCH / 'client-comprehensive/r4-expected.json').read_text('utf-8'))
    original = ROOT / 'inputs/v33.swf'
    baseline = ROOT / 'inputs/v34-r4-verified.swf'
    previous = ROOT / 'inputs/v34-o8-o9-verified.swf'
    support = load('round4_proof_support', PATCH / 'startup-cache/build_swf.py')
    assert support.sha(previous.read_bytes()) == 'f1fe146d29a4e4d72e9776bf285aeb7501e0c1fa78601ea9a8f7e978e09231f0'
    changed = expected['changed_methods'] + TARGETS
    proof = {'v33_to_final': verify_patch(original, candidate, changed, expected['helpers']),
             'r4_to_final': verify_patch(baseline, candidate, TARGETS, []),
             'round3_to_final': verify_patch(previous, candidate, TWO_COST_TARGETS, [])}
    classes = ROOT / 'verification/independent-ffdec/classes'
    assert (classes / 'CompareNamedBodies.class').is_file()
    output = run('round4-ffdec',
                 [JAVA, '-Xmx2g', '-cp', str(classes) + ';' + str(FFDEC),
                  'CompareNamedBodies', original, candidate]).stdout.decode()
    fields = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
    assert int(fields['method_bodies']) == 96733
    assert set(fields['changed'].split(',')) == set(changed)
    assert set(fields['helpers'].split(',')) == set(expected['helpers'])
    assert int(fields['added_bodies']) == 102
    result = {'passed': True, 'input_v33_sha256': support.sha(original.read_bytes()),
              'r4_base_sha256': support.sha(baseline.read_bytes()),
              'previous_round3_sha256': support.sha(previous.read_bytes()),
              'swf_sha256': support.sha(Path(candidate).read_bytes()),
              'original_method_bodies': 96733, 'changed_original_methods': len(changed),
              'unchanged_original_methods': 96733 - len(changed),
              'r4_47_targets_and_5_helpers_byte_preserved': True,
              'o8_o9_bodies_byte_identical_to_round3': True,
              'only_O10_O11_differ_from_round3': True,
              'archive_101_retained': True, 'whole_swf_checks': proof,
              'independent_ffdec': fields,
              'scope': 'fresh raw method/class/pool/tag and independent FFDec comparisons; no device execution'}
    write_json(work / 'swf-verification.json', result)
    return result
