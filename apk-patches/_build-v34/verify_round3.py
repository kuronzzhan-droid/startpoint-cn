"""Fresh whole-file and FFDec checks for R4 + O8 with optional O9."""
import json
from pathlib import Path

from build_common import ROOT, PATCH, JAVA, FFDEC, load, run, write_json
from swf_patch_guard import verify_patch

O8 = 'boot_ffc6:87354'
O9 = 'boot_ffc6:73067'


def verify_release_swf(with_o9, without_o9, work):
    expected = json.loads((PATCH / 'client-comprehensive/r4-expected.json').read_text('utf-8'))
    original = ROOT / 'inputs/v33.swf'
    baseline = ROOT / 'inputs/v34-r4-verified.swf'
    r4 = expected['changed_methods']
    proof = {'with_O9': verify_patch(original, with_o9, r4 + [O8, O9], expected['helpers']),
             'without_O9': verify_patch(original, without_o9, r4 + [O8], expected['helpers']),
             'only_O8_O9_change_from_R4': verify_patch(baseline, with_o9, [O8, O9], []),
             'only_O9_diff_between_variants': verify_patch(without_o9, with_o9, [O9], [])}
    # The existing comparator is unchanged and was already compiled against this
    # exact FFDec/JDK. Reuse its classes, rerun it on both new final SWFs.
    classes = ROOT / 'verification/independent-ffdec/classes'
    assert (classes / 'CompareNamedBodies.class').is_file()
    ffdec = {}
    for variant, path, changed in [('with_O9', with_o9, r4 + [O8, O9]),
                                   ('without_O9', without_o9, r4 + [O8])]:
        output = run('round3-ffdec-' + variant,
                     [JAVA, '-Xmx2g', '-cp', str(classes) + ';' + str(FFDEC),
                      'CompareNamedBodies', original, path]).stdout.decode()
        fields = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
        assert int(fields['method_bodies']) == 96733
        assert set(fields['changed'].split(',')) == set(changed)
        assert set(fields['helpers'].split(',')) == set(expected['helpers'])
        assert int(fields['added_bodies']) == 102
        ffdec[variant] = fields
    support = load('round3_proof_support', PATCH / 'startup-cache/build_swf.py')
    result = {'passed': True, 'input_v33_sha256': support.sha(original.read_bytes()),
              'r4_base_sha256': support.sha(baseline.read_bytes()),
              'with_O9_sha256': support.sha(Path(with_o9).read_bytes()),
              'without_O9_sha256': support.sha(Path(without_o9).read_bytes()),
              'original_method_bodies': 96733, 'with_O9_changed_original_methods': 49,
              'without_O9_changed_original_methods': 48,
              'r4_47_methods_and_5_helpers_byte_preserved': True,
              'party_carousel_update_preserved_from_r4': True,
              'archive_101_not_removed_by_without_O9': True,
              'whole_swf_checks': proof, 'independent_ffdec': ffdec,
              'scope': 'fresh raw body/class/pool/tag checks and independent bytecode parser; no device execution'}
    write_json(work / 'swf-verification.json', result)
    return result
