import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap
from framework import Editor
from heal_fever.patches import build
from swfabc import SwfAbc
from multiabc import compose
from common import listing
from bootstrap import BASE, BASE_SHA
from framework import sha
import bodies
root=Path(__file__).resolve().parent
assert sha(BASE.read_bytes()) == BASE_SHA, '固定输入SHA不符，停止'
e=Editor(BASE)
print(build(e))
e.apply()
raw=compose(e)
(root/'test.swf').write_bytes(raw)
b=e.body('MemberImpl/wfxHealFever')
(root/'MemberImpl__wfxHealFever.txt').write_text('\n'.join(listing(e.abc,b[5]))+'\n',encoding='utf-8')
print('built',sha(raw),len(raw))
