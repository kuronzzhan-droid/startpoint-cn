"""对指定最终SWF运行继承自run16的源代码夹具。"""
import json
import subprocess
import sys
import bootstrap
from bootstrap import ROOT, sha
from build import json_write

PROGRAM = '''
import sys,json
from pathlib import Path
import bootstrap
from swfabc import SwfAbc
kind,path,out=sys.argv[1:]
s=SwfAbc(path)
if kind=='fields':
 from fp_fields_test import run
 r=run(s)
elif kind=='core':
 from test_fp_core import run
 r=run(s)
elif kind=='inputs':
 from test_fp_inputs import run_tests
 r=run_tests(s.abc)
elif kind=='transport':
 from test_fp_transport import verify_swf
 r=verify_swf(path)
elif kind=='integration':
 from test_fp_integration import verify_swf
 r=verify_swf(path)
else:
 from test_fp_transport_mutations import run_mutations
 from framework import Editor
 r={'status':'pass','mutations':run_mutations(Editor(s,{}))}
r['source_swf_sha256']=bootstrap.sha(Path(path).read_bytes())
from build import json_write
json_write(Path(out),r)
print(json.dumps({'kind':kind,'status':r['status']}))
'''


def run(path, directory, profile):
    reports = {}
    for kind in ('fields','core','inputs','transport','transport_mutations','integration'):
        output = directory / ('inherited-' + kind + '-' + profile + '.json')
        p = subprocess.run([sys.executable,'-B','-c',PROGRAM,kind,str(path),str(output)],
                           cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
        if p.returncode:
            raise RuntimeError(kind+'/'+profile+'\n'+p.stdout+p.stderr)
        result=json.loads(output.read_text(encoding='utf-8'))
        assert result['status']=='pass' and result['source_swf_sha256']==sha(path.read_bytes())
        reports[kind]={'status':'pass','evidence':output.name}
        print(p.stdout.strip(),flush=True)
    return reports
