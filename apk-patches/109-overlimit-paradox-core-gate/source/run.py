import sys,json
sys.path.insert(0, r"D:/WF/perf-v30-20261015/tools"); sys.path.insert(0,'.')
from common import ABC, abc_tags, bodies, sha, listing
from perf2_core import MAIN, apply_patches
import v34_patches as V
raw=open('v33.swf','rb').read()
abc=ABC({n:r for n,*_x,r in abc_tags(raw)}[MAIN])
for p in V.PATCHES:
    if p["before"] is None: p["before"]=sha(abc.bodies[bodies.resolve(abc,p["label"])][5])
out,rep=apply_patches(raw,V.PATCHES)
for r in rep["patches"]: print(r["id"],r["status"],r["before"],r["after"],r.get("max_stack"),r.get("header"),r.get("unreachable"))
open('v34-sim.swf','wb').write(out)
abc2=ABC({n:r for n,*_x,r in abc_tags(out)}[MAIN])
for p in V.PATCHES:
    b=abc2.bodies[bodies.resolve(abc2,p["label"])]
    open(f'{p["id"]}.after.pcode.txt','w',encoding='utf8').write("\n".join([f"# {p['label']} header={b[1:5]}"]+listing(abc2,b[5]))+"\n")
    b0=abc.bodies[bodies.resolve(abc,p["label"])]
    open(f'{p["id"]}.before.pcode.txt','w',encoding='utf8').write("\n".join([f"# {p['label']} header={b0[1:5]}"]+listing(abc,b0[5]))+"\n")
