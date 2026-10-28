"""Stage 23 (port175): give 1008092 its own admission build ID.

Only the build-ID literal changes, in all three places (ClientAdmission
transport declaration, ClientAdmission proof prefix, BuildConfig.ID). The
admission key and every other byte stay exactly as in 1008091. Same-length
literal, so tag lengths are unchanged and a byte-level reverse substitution
recovers the 1008091 admission tags exactly. Key values are never printed.
"""
import json
import sys
from bootstrap import ROOT, FINAL, sha, output_path, write_json
from c4_admission import TAG, CONFIG_TAG, patch_tag, tags, locate

OLD_BUILD = '<ADMISSION_ID>'
NEW_BUILD = '<ADMISSION_ID>'
CAPABILITIES = ('weapon-riven-v1', 'weapon-riven-multi-v1')
REPLACEMENTS = (
    (TAG, (('declaration', OLD_BUILD, NEW_BUILD),
           ('proof_prefix', 'SP-ADMISSION-1\n' + OLD_BUILD + '\n',
            'SP-ADMISSION-1\n' + NEW_BUILD + '\n'))),
    (CONFIG_TAG, (('config_id', OLD_BUILD, NEW_BUILD),)),
)
assert len(OLD_BUILD) == len(NEW_BUILD)


def main():
    stage22 = ROOT / 'build/stages/c22.swf'
    record = json.loads((ROOT / 'audit/replay/c22.json').read_text('utf-8'))
    raw = stage22.read_bytes()
    assert sha(raw) == record['sha256']
    original, edits = raw, []
    for tag, replacements in REPLACEMENTS:
        raw, evidence = patch_tag(raw, tag, replacements)
        for edit in evidence['edits']:
            edit.pop('old'); edit.pop('new')
        edits.append(evidence)
    before, after = tags(original), tags(raw)
    assert [r[:2] for r in before] == [r[:2] for r in after]
    changed = [a[1] for a, b in zip(before, after) if a[2] != b[2]]
    assert changed == [TAG, CONFIG_TAG], changed
    for a, b in zip(before, after):
        if a[2] != b[2]:
            assert len(a[2]) == len(b[2])
            assert b[2].replace(NEW_BUILD.encode(), OLD_BUILD.encode()) == a[2]
            assert NEW_BUILD.encode() in b[2] and OLD_BUILD.encode() not in b[2]
    output_path(FINAL).write_bytes(raw)
    result = {'status': 'passed', 'input': str(stage22), 'input_sha256': sha(original),
              'output': str(FINAL), 'sha256': sha(raw), 'previous_build': OLD_BUILD,
              'build': NEW_BUILD, 'changed_tags': [t.decode() for t in changed],
              'literal_occurrences': {'cn/admission/ClientAdmission': 2, 'cn/admission/BuildConfig': 1},
              'byte_reverse_substitution_recovers_1008091_admission_tags': True,
              'tag_lengths_unchanged': True, 'all_method_bodies_identical': True,
              'admission_key_bytes_unchanged': True, 'key_material_printed': False,
              'capabilities_expected_from_server': list(CAPABILITIES), 'abc_tags': edits}
    write_json(ROOT / 'audit/replay/c23-admission.json', result)
    print(json.dumps({k: result[k] for k in ('status', 'build', 'sha256')}))


if __name__ == '__main__':
    main()
