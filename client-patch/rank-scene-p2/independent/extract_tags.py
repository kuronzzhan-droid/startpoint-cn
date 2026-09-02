import struct, zlib, sys, hashlib
def read_swf(p):
    d=open(p,'rb').read()
    sig=d[:3]
    ver=d[3]; flen=struct.unpack_from('<I',d,4)[0]
    body=d[8:]
    if sig==b'CWS': body=zlib.decompress(body)
    elif sig==b'ZWS': import lzma; raise SystemExit('lzma')
    return sig,ver,flen,body
def tags(body):
    # skip rect
    nb=body[0]>>3
    total=5+nb*4
    o=(total+7)//8
    o+=4  # framerate + framecount
    out=[]
    while o < len(body):
        if o+2>len(body): break
        th=struct.unpack_from('<H',body,o)[0]; o+=2
        code=th>>6; ln=th&0x3f
        if ln==0x3f:
            ln=struct.unpack_from('<I',body,o)[0]; o+=4
        payload=body[o:o+ln]; o+=ln
        out.append((code,payload))
        if code==0: break
    return out
if __name__=='__main__':
    for p in ('base.swf','patched.swf'):
        sig,ver,flen,body=read_swf(p)
        t=tags(body)
        print(p, sig, 'ver',ver,'declared_len',flen,'tags',len(t))
        import pickle; pickle.dump(t, open(p+'.tags.pkl','wb'))
