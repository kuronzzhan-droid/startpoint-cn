import json, sys, bootstrap
from bootstrap import ROOT, sha
from swfabc import SwfAbc
import asm, bodies
from common import describe
abc = SwfAbc(ROOT/'input/p10-wt.swf').abc; ref = SwfAbc(ROOT/'build/p8-leaderkinds.swf').abc
for L in ['LeaderAbilityValues$/parseAt45','LeaderAbilityValues$/parseAt107','MemberImpl/wfxDirectFactor']:
    a=[describe(abc,x) for x in asm.decode(abc.bodies[bodies.resolve(abc,L)][5])]
    r=[describe(ref,x) for x in asm.decode(ref.bodies[bodies.resolve(ref,L)][5])]
    print(L, 'same-as-my-build' if a==r else 'DIFF', len(a), len(r), any("'422'" in t or "'724'" in t for t in a), any('13999014' in t for t in a))
