"""本组开发构建，仅写direct_count；正式构建由run11/build.py负责。"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(HERE.parent))
import bootstrap
from framework import Editor, sha
from common import listing
from direct_count.patches import build, LOCKS
from multiabc import compose
import bodies


if __name__ == '__main__':
    assert sha(bootstrap.BASE.read_bytes()) == bootstrap.BASE_SHA
    editor = Editor(bootstrap.BASE, locks=LOCKS)
    build(editor)
    editor.apply()
    raw = compose(editor)
    (HERE / 'candidate.swf').write_bytes(raw)
    report = {'sha256': sha(raw), 'changed': editor.report, 'added': editor.new_methods}
    (HERE / 'build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    for label in list(editor.report) + [x['label'] for x in editor.new_methods]:
        body = editor.abc.bodies[bodies.resolve(editor.abc, label)]
        (HERE / (label.replace('/', '__') + '.pcode.txt')).write_text('\n'.join(listing(editor.abc, body[5]))+'\n', encoding='utf-8')
    print(json.dumps({'status': 'built', 'sha256': sha(raw)}))
