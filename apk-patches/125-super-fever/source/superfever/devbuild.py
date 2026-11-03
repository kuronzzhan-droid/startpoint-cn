"""本组开发候选，只写本目录。"""
import sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
import bootstrap
from framework import Editor,sha
from superfever.patches import build
from multiabc import compose
e=Editor(HERE.parent.parent/'run2/v35b.swf');build(e);e.apply()
raw=compose(e);(HERE/'test.swf').write_bytes(raw)
(HERE/'build-report.json').write_text(json.dumps({'sha256':sha(raw),'methods':e.report,'new':e.new_methods},ensure_ascii=False,indent=2),encoding='utf-8')
print(sha(raw))
