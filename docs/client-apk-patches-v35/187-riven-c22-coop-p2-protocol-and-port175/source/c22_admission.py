"""P2 authenticated build identity; server grants remain a separate handoff."""
from c4_admission import TAG, CONFIG_TAG, patch_tag, locate, replace_literal, tags
from bootstrap import sha

OLD_BUILD = '<ADMISSION_ID>'
ADMISSION_BUILD = '<ADMISSION_ID>'
CAPABILITIES = ('weapon-riven-v1', 'weapon-riven-multi-v1')
REPLACEMENTS = (
    (TAG, (('declaration', OLD_BUILD, ADMISSION_BUILD),
           ('proof_prefix', 'SP-ADMISSION-1\n' + OLD_BUILD + '\n',
            'SP-ADMISSION-1\n' + ADMISSION_BUILD + '\n'))),
    (CONFIG_TAG, (('config_id', OLD_BUILD, ADMISSION_BUILD),)),
)


def patch(raw):
    original, edits = raw, []
    for tag, replacements in REPLACEMENTS:
        raw, evidence = patch_tag(raw, tag, replacements)
        edits.append(evidence)
    assert {a[1] for a, b in zip(tags(original), tags(raw)) if a[2] != b[2]} == {TAG, CONFIG_TAG}
    return raw, {'status': 'passed', 'previous_build': OLD_BUILD, 'build': ADMISSION_BUILD,
                 'abc_tags': edits, 'before_sha256': sha(original), 'after_sha256': sha(raw),
                 'capabilities_expected_from_server': list(CAPABILITIES),
                 'admission_declaration_and_proof_and_config_agree': True,
                 'all_method_bodies_identical': True, 'server_configuration_changed': False,
                 'server_capability_verified': False}


def reverse(raw):
    for tag, replacements in reversed(REPLACEMENTS):
        # patch_tag verifies the same declaration/proof/config references in
        # reverse; it also proves literal reversal recovers the raw ABC.
        raw, _ = patch_tag(raw, tag, [(role, new, old) for role, old, new in replacements])
    return raw


def verify(raw):
    for tag, replacements in REPLACEMENTS:
        abc = locate(raw, tag)[4]
        for _, old, new in replacements:
            assert new.encode() in abc.strings and old.encode() not in abc.strings
    return {'build': ADMISSION_BUILD, 'capabilities_expected_from_server': list(CAPABILITIES)}
