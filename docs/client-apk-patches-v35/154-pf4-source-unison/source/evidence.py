"""最终字节码证据：真实方法前后 P-code、统一 diff 和方法锁。"""
import difflib
import json
from pathlib import Path
import bootstrap
from bootstrap import sha, output_path
import bodies
from common import listing


def json_write(path, value):
    output_path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def method_record(editor):
    labels = list(editor.report) + [row['label'] for row in editor.new_methods]
    return {label: {'sha256': sha(editor.body(label)[5]), 'header': editor.body(label)[1:5]}
            for label in sorted(labels)}


def write_pcode(editor, outdir):
    outdir = output_path(Path(outdir) / 'manifest.json').parent
    manifest = []
    for label in method_record(editor):
        index = bodies.resolve(editor.abc, label)
        after = editor.abc.bodies[index]
        before = editor.original_bodies[index] if index < editor.original_count else None
        name = label.replace('/', '__').replace('$', '_static')
        render = lambda b: [f'# {label} header={b[1:5]} sha={sha(b[5])}', *listing(editor.abc, b[5])]
        right, left = render(after), [] if before is None else render(before)
        diff = list(difflib.unified_diff(left, right, fromfile=label + ':v35o', tofile=label + ':pf4', lineterm=''))
        for suffix, lines in [('after.pcode.txt', right), ('before.pcode.txt', left), ('diff.txt', diff)]:
            output_path(outdir / f'{name}.{suffix}').write_text('\n'.join(lines) + '\n', encoding='utf-8')
        manifest.append({'label': label, 'body': index, 'before_sha256': None if before is None else sha(before[5]),
                         'after_sha256': sha(after[5]), 'header': after[1:5], 'path_prefix': f'pcode/{name}'})
    json_write(outdir / 'manifest.json', manifest)
