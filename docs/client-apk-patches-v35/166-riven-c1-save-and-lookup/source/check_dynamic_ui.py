import sys
sys.path.insert(0,'build/source')
import bootstrap
from framework import Editor
from c1_dynamic import queue_dynamic_splices
from common import listing
import json
editor=Editor(bootstrap.BASE,{})
info=queue_dynamic_splices(editor)
editor.apply()
assert not editor.new_methods and not editor.traits
for label in info['queued']:
 bootstrap.output_path(bootstrap.ROOT/'audit/ui'/f'{label.replace("/","__")}.txt').write_text('\n'.join(listing(editor.abc,editor.body(label)[5]))+'\n',encoding='utf-8')
bootstrap.write_json(bootstrap.ROOT/'audit/ui/dynamic-build-check.json',{'metadata':info,'changed':editor.report})
print(json.dumps(info,ensure_ascii=False))
