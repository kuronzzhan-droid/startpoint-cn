import bootstrap, hashlib
from swfabc import SwfAbc
import bodies
a=SwfAbc(bootstrap.ROOT/'input/p8-wt.swf').abc; b=SwfAbc(bootstrap.ROOT/'input/p10-wt.swf').abc
la=bodies.label_map(a); lb=bodies.label_map(b)
ia={v:i for i,v in la.items()}; ib={v:i for i,v in lb.items()}
ch=[l for l in ia if l in ib and a.bodies[ia[l]][5]!=b.bodies[ib[l]][5]]
print('changed',len(ch)); [print(' ',l) for l in sorted(ch)]
print('only p8',[l for l in ia if l not in ib][:30]); print('only p10',[l for l in ib if l not in ia][:40])
