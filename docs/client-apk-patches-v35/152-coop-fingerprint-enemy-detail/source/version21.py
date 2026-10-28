"""保留原指令，只将传输外壳的运行时 build 值替换为 v35t。"""
import asm

TARGETS = ['Battle$/wfxFpEnvelope']


def build(editor):
    label = TARGETS[0]
    ins = asm.decode(editor.body(label)[5])
    hits = [i for i, op in enumerate(ins) if op.name == 'pushstring'
            and editor.abc.strings[op.args[0]] == b'v35s']
    assert len(hits) == 1, 'unknown active build marker'
    editor.insert(label, hits[0] + 1, [('pop',), editor.string('v35t')])
    return {'build': 'v35t', 'schema': 'coop-state-fingerprint-compact-v2'}
