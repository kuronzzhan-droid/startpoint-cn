"""Prove stage-tested production bytes survive into the final artifact."""
import json
from build_common import ROOT, PATCH, load, write_json

s = load('stage_verification_support', PATCH / 'startup-cache/build_swf.py')


def parse(path):
    tags = s.parts(path)[2]
    main, = [t for t in tags if t[0] == 82 and t[2][4:-1] == b'boot_ffc6']
    helpers = {t[2][4:-1].decode(): t[1] for t in tags if t[0] == 82}
    return main[3], helpers


final, final_tags = parse(ROOT / 'v34.swf')
rows = []
for name in ('liveness', 'network', 'data', 'resource'):
    source = ROOT / 'work' / f'after-{name}.swf'
    stage, stage_tags = parse(source)
    report = json.loads(source.with_suffix('.json').read_text('utf-8'))
    indices = report['changed_methods'] if name == 'liveness' else [row['body'] for row in report['changes']]
    for index in indices:
        assert s.m.freeze(stage.bodies[index]) == s.m.freeze(final.bodies[index]), (name, index)
    helper_names = [n for n in stage_tags if n.startswith(('cn.optimize.', 'cn/optimize/'))]
    for helper in helper_names:
        assert stage_tags[helper] == final_tags[helper], (name, helper)
    rows.append({'stage': name, 'tested_swf_sha256': s.sha(source.read_bytes()),
                 'final_method_bodies_identical': indices,
                 'helpers_byte_identical': helper_names})
write_json(ROOT / 'verification/stage-final-equivalence.json', {
    'passed': True, 'final_swf_sha256': s.sha((ROOT / 'v34.swf').read_bytes()), 'stages': rows,
    'refresh': 'PartyTranslator/translate is intentionally composed by the following data stage. '
               'The final data AIR fixture tests the resulting production translation segments and cleanup.',
    'ui_and_data_final': 'Both fixtures directly import final v34.swf production bytes.'})
print('stage/final production byte equality passed')
