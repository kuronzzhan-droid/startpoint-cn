"""仅构造本分组候选；正式产物由 run3/build.py 整合。"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap
from framework import Editor, sha
from multiabc import compose
from equipment.patches import build


def main():
    assert sha(bootstrap.BASE.read_bytes()) == bootstrap.BASE_SHA
    editor = Editor(bootstrap.BASE)
    build(editor)
    editor.apply()
    root = Path(__file__).resolve().parent
    raw = compose(editor)
    (root/'candidate.swf').write_bytes(raw)
    (root/'build-report.json').write_text(json.dumps({'sha256':sha(raw),
        'changed':editor.report,'added':editor.new_methods},ensure_ascii=False,indent=2),encoding='utf8')
    print(sha(raw))


if __name__ == '__main__':
    main()
