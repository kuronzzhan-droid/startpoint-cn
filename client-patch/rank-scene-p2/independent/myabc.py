import struct, hashlib, sys

class R:
    def __init__(self, d, o=0): self.d=d; self.o=o
    def u8(self):
        v=self.d[self.o]; self.o+=1; return v
    def u16(self):
        v=struct.unpack_from('<H',self.d,self.o)[0]; self.o+=2; return v
    def s24(self):
        b=self.d[self.o:self.o+3]; self.o+=3
        v=b[0]|(b[1]<<8)|(b[2]<<16)
        return v-0x1000000 if v & 0x800000 else v
    def u30(self):
        r=0
        for i in range(5):
            b=self.d[self.o]; self.o+=1
            r |= (b & 0x7f) << (7*i)
            if not (b & 0x80): break
        return r & 0xFFFFFFFF
    def s32(self):
        return self.u30()
    def d64(self):
        v=struct.unpack_from('<d',self.d,self.o)[0]; self.o+=8; return v
    def strn(self):
        n=self.u30(); s=self.d[self.o:self.o+n]; self.o+=n; return s

def parse_abc(d):
    r=R(d)
    minor=r.u16(); major=r.u16()
    out={'minor':minor,'major':major}
    ints=[0]; n=r.u30()
    for _ in range(max(0,n-1)): ints.append(r.s32())
    uints=[0]; n=r.u30()
    for _ in range(max(0,n-1)): uints.append(r.u30())
    dbls=[0.0]; n=r.u30()
    for _ in range(max(0,n-1)): dbls.append(r.d64())
    strs=[b'']; n=r.u30()
    for _ in range(max(0,n-1)): strs.append(r.strn())
    nss=[(0,0)]; n=r.u30()
    for _ in range(max(0,n-1)): nss.append((r.u8(), r.u30()))
    nsets=[()]; n=r.u30()
    for _ in range(max(0,n-1)):
        c=r.u30(); nsets.append(tuple(r.u30() for _ in range(c)))
    mns=[None]; n=r.u30()
    for _ in range(max(0,n-1)):
        k=r.u8()
        if k in (0x07,0x0D): mns.append((k,r.u30(),r.u30()))
        elif k in (0x0F,0x10): mns.append((k,r.u30()))
        elif k in (0x11,0x12): mns.append((k,))
        elif k in (0x09,0x0E): mns.append((k,r.u30(),r.u30()))
        elif k in (0x1B,0x1C): mns.append((k,r.u30()))
        elif k == 0x1D:
            nm=r.u30(); c=r.u30(); mns.append((k,nm)+tuple(r.u30() for _ in range(c)))
        else: raise ValueError('bad multiname kind 0x%02x at %d'%(k,r.o))
    out['pools']={'ints':ints,'uints':uints,'dbls':dbls,'strs':strs,'nss':nss,'nsets':nsets,'mns':mns}
    out['pool_end']=r.o

    def traits(rr):
        t=[]
        c=rr.u30()
        for _ in range(c):
            name=rr.u30(); kind=rr.u8(); k=kind&0x0f
            if k in (0,6): data=(rr.u30(),rr.u30(),rr.u30() if True else 0)
            elif k in (1,2,3): data=(rr.u30(),rr.u30())
            elif k==4: data=(rr.u30(),rr.u30())
            elif k==5: data=(rr.u30(),rr.u30())
            else: raise ValueError('trait kind %d'%k)
            # slot/const have value_index then value_kind if value_index!=0
            if k in (0,6):
                pass
            md=()
            if kind & 0x40:
                mc=rr.u30(); md=tuple(rr.u30() for _ in range(mc))
            t.append((name,kind,data,md))
        return t
    # re-do traits properly
    def traits2(rr):
        t=[]; c=rr.u30()
        for _ in range(c):
            name=rr.u30(); kind=rr.u8(); k=kind&0x0f
            if k in (0,6):
                slot=rr.u30(); tp=rr.u30(); vi=rr.u30(); vk=rr.u8() if vi!=0 else 0
                data=(slot,tp,vi,vk)
            elif k in (1,2,3):
                data=(rr.u30(),rr.u30())
            elif k==4:
                data=(rr.u30(),rr.u30())
            elif k==5:
                data=(rr.u30(),rr.u30())
            else: raise ValueError('trait kind %d'%k)
            md=()
            if kind & 0x40:
                mc=rr.u30(); md=tuple(rr.u30() for _ in range(mc))
            t.append((name,kind,data,md))
        return t

    r2=R(d, out['pool_end'])
    n=r2.u30(); methods=[]
    for _ in range(n):
        pc=r2.u30(); rt=r2.u30()
        pt=[r2.u30() for _ in range(pc)]
        nm=r2.u30(); fl=r2.u8()
        opt=None
        if fl & 0x08:
            oc=r2.u30(); opt=[(r2.u30(),r2.u8()) for _ in range(oc)]
        pn=None
        if fl & 0x80:
            pn=[r2.u30() for _ in range(pc)]
        methods.append((pc,rt,tuple(pt),nm,fl,tuple(opt) if opt else None,tuple(pn) if pn else None))
    out['methods']=methods
    n=r2.u30(); meta=[]
    for _ in range(n):
        nm=r2.u30(); ic=r2.u30()
        items=[(r2.u30(),r2.u30()) for _ in range(ic)]
        meta.append((nm,tuple(items)))
    out['metadata']=meta
    ci=r2.u30(); insts=[]
    for _ in range(ci):
        nm=r2.u30(); sn=r2.u30(); fl=r2.u8()
        pns=r2.u30() if fl & 0x08 else 0
        ic2=r2.u30(); ifs=tuple(r2.u30() for _ in range(ic2))
        iinit=r2.u30(); tr=traits2(r2)
        insts.append((nm,sn,fl,pns,ifs,iinit,tuple(tr)))
    out['instances']=insts
    classes=[]
    for _ in range(ci):
        cinit=r2.u30(); tr=traits2(r2); classes.append((cinit,tuple(tr)))
    out['classes']=classes
    n=r2.u30(); scripts=[]
    for _ in range(n):
        sinit=r2.u30(); tr=traits2(r2); scripts.append((sinit,tuple(tr)))
    out['scripts']=scripts
    n=r2.u30(); bodies=[]
    for _ in range(n):
        mi=r2.u30(); ms=r2.u30(); lc=r2.u30(); isd=r2.u30(); msd=r2.u30()
        cl=r2.u30(); code=d[r2.o:r2.o+cl]; r2.o+=cl
        ec=r2.u30(); exs=[]
        for _ in range(ec):
            exs.append((r2.u30(),r2.u30(),r2.u30(),r2.u30(),r2.u30()))
        tr=traits2(r2)
        bodies.append({'method':mi,'maxstack':ms,'localcount':lc,'initscope':isd,'maxscope':msd,
                       'code':code,'ex':tuple(exs),'traits':tuple(tr)})
    out['bodies']=bodies
    out['end']=r2.o
    return out
