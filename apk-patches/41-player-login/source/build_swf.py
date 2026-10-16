"""Build the account-login candidate from the exact accepted Android registry.

The new UI is a separate ABC. Existing pools, traits and unrelated methods stay intact.
"""
import argparse, copy, importlib.util, json, struct, sys, zipfile, zlib
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(HERE.parent/'lens0907-0908'))
import build_swf as model
from swfabc import PoolEditor, swftags

EXPECTED={'lan':'7e3f40fc17ac6fbbec52a0775c6a6357edd258874ed62d13d4ceb287d56d97d3',
          'public':'11c06fd77a0e3811164d196208ecce28cba5ec3a602e3d798f3c67d5d5b17e04'}

def main(args):
    w=args.work.resolve();w.mkdir(parents=True,exist_ok=True)
    spec=importlib.util.spec_from_file_location('login_baseline',HERE.parent/'verify_android_baseline.py')
    checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
    identity=checker.verify(args.variant)
    assert identity['swf_sha256']==EXPECTED[args.variant], 'baseline advanced: review before rebuilding'
    with zipfile.ZipFile(identity['apk']) as z:raw=z.read('assets/worldflipper_android_release.swf')
    source=w/'accepted.swf';source.write_bytes(raw)
    v=model.View(model.SwfAbc(source),model.asm);a=v.a;old=copy.deepcopy(a);pool=PoolEditor(a)
    # Reviewed 2026-09-10: cumulative LAN has the element and details helpers.
    # Read their containers without altering them; never assume the old index 284.
    _,_,_,raw_source=swftags.load_swf(str(source))
    original_game_bodies=0;abc_count=0;main_abc_index=None
    for code,off,hdr,size in swftags.iter_tags(raw_source):
        if code==82:
            data=raw_source[off+hdr:off+hdr+size]
            parsed_abc=model.abcfmt.ABC(data[data.index(b'\0',4)+1:])
            original_game_bodies+=len(parsed_abc.bodies)
            if off==v.swf._offset:main_abc_index=abc_count
            abc_count+=1
    assert main_abc_index==identity['main_abc_index']
    assert original_game_bodies==identity['method_bodies_checked']
    def qname(ns,name):
        want=(7,(22,ns),name)
        matches=[i for i in range(1,len(a.multinames)) if v.mn(i)==want and a.namespaces[a.multinames[i][1]][1]!=0]
        if matches:return matches[0]
        spaces=[i for i,n in enumerate(a.namespaces) if i and n[0]==22 and n[1] and a.strings[n[1]]==ns.encode()]
        if spaces:space=spaces[0]
        else:
            text=pool.string(ns)
            if text==0:a.strings.append(b'');text=len(a.strings)-1
            a.namespaces.append((22,text));space=len(a.namespaces)-1
        a.multinames.append((7,space,pool.string(name)));return len(a.multinames)-1
    helper=qname('cn.account','PlayerLogin')
    def call(method,args=()):return model.asm.assemble([('getlex',helper),*args,('callpropvoid',qname('',method),len(args))])
    changes=[]
    def insert(index,at,block,description):
        body=a.bodies[index];before=v.normalized(index)
        body[5],body[6],instructions,placed=model.asm.splice_many(body,[(at,block,model.asm.ENTER)])
        assert model.asm.unsplice_many(body[5],placed)==old.bodies[index][5]
        body[1]=max(body[1],4)
        model.insertion_proof(before,v.normalized(index),[{'at':at,'instructions':len(block)}])
        changes.append({'body':index,'kind':'insertion','description':description,'original_code_reconstructed':True})
    insert(82502,0,call('title',[('getlocal_0',)]),'open login after title transition')
    insert(82500,2,call('dispose'),'remove login panel on title exit')
    insert(29697,2,call('attach',[('getlocal_1',)]),'attach session to game HTTP requests')
    insert(31405,2,call('socket',[('getlocal_0',)]),'authenticate each lobby/battle TCP handshake')
    # Player-login candidates retire the two old takeover entries (user request, r15).
    # Restore the original title download-setting slot, keeping the native four-button layout.
    body=a.bodies[37085]
    assert v.labels[body[0]]=='pinball.dialog.titleMenu::TitleMenuDialogContentView/setupContents|1' and not body[6]
    instructions=model.asm.decode(body[5]);original_title=copy.deepcopy(instructions)
    assert [(x.op,x.args) for x in instructions[32:37]]==[(0x24,[11]),(0x24,[12]),(0x24,[4]),(0x24,[0]),(0x56,[4])]
    instructions[35].args[0]=6;body[5],_=model.asm.encode(instructions)
    recovered=copy.deepcopy(instructions);recovered[35].args[0]=0
    assert model.asm.encode(recovered)[0]==old.bodies[37085][5]
    changes.append({'body':37085,'kind':'menu_entry','description':'replace old title takeover slot with original download settings','title_items':[11,12,4,6]})
    # Remove exactly one full menu item and reduce the array size. Other enum values/click handlers stay unchanged.
    body=a.bodies[77176]
    assert v.labels[body[0]]=='pinball.scene.menuTop::MenuTopScene/createMenuListData|1' and not body[6]
    original_menu=model.asm.decode(body[5]);rows,_=v.normalized(77176)
    assert [(x.op) for x in original_menu[97:106]]==[0x2c,0x60,0x66,0x2c,0x60,0x2c,0x2c,0x46,0x55]
    assert rows[99][1]==[(7,(22,''),'TakeOver')]
    assert rows[103][1]==[('string','title_menu_take_over')]
    assert original_menu[124].op==0x56 and original_menu[124].args==[11]
    def shift_menu_target(target):
        if target is None:return None
        assert not 97<=target<106, 'branch into removed menu item'
        return target-9 if target>=106 else target
    instructions=[]
    for index,item in enumerate(original_menu):
        if 97<=index<106:continue
        item=copy.deepcopy(item)
        item.target=shift_menu_target(item.target);item.default=shift_menu_target(item.default)
        if item.cases is not None:item.cases=[shift_menu_target(x) for x in item.cases]
        if index==124:item.args[0]=10
        instructions.append(item)
    body[5],_=model.asm.encode(instructions)
    # Reinsert the removed item to prove exact recovery, including all old branch destinations.
    recovered=copy.deepcopy(instructions)
    for item in recovered:
        if item.target is not None and item.target>=97:item.target+=9
        if item.default is not None and item.default>=97:item.default+=9
        if item.cases is not None:item.cases=[x+9 if x>=97 else x for x in item.cases]
    recovered[97:97]=copy.deepcopy(original_menu[97:106]);recovered[124].args[0]=11
    assert model.asm.encode(recovered)[0]==old.bodies[77176][5]
    assert not any('TakeOver' in str(row) or 'title_menu_take_over' in str(row) for row in v.normalized(77176)[0])
    changes.append({'body':77176,'kind':'menu_entry','description':'remove old in-game takeover row; remaining rows close the gap','original_code_reconstructed':True})
    body=a.bodies[7174]
    assert not body[6] and len(model.asm.decode(body[5]))==7
    instructions=call('start',[('getlocal_0',),('getlocal_1',)])+model.asm.assemble([('returnvoid',)])
    body[5],_=model.asm.encode(instructions);body[1]=max(body[1],3)
    changes.append({'body':7174,'kind':'replacement','description':'wait for player authentication before game load'})
    if args.host:
        assert '://' not in args.host and '/' not in args.host
        body=a.bodies[92013];instructions=model.asm.decode(body[5]);assert instructions[11].op==0x2c
        previous=a.strings[instructions[11].args[0]].decode()
        assert previous==identity['endpoint'].split('://',1)[1]
        instructions[11].args[0]=pool.string(args.host);body[5],_=model.asm.encode(instructions)
        changes.append({'body':92013,'kind':'endpoint','description':'isolated local test server'})
    if args.isolate_storage:
        body=a.bodies[91935]
        assert v.labels[body[0]]=='pinball.config.core::DevConfig/getSaveDataKey|1' and not body[6]
        instructions=model.asm.assemble([('pushstring',pool.string('player_login_trial_v1')),('returnvalue',)])
        body[5],_=model.asm.encode(instructions)
        changes.append({'body':91935,'kind':'test_storage','description':'separate local account/options from installed client'})
    changed={r['body'] for r in changes}
    for i,(left,right) in enumerate(zip(old.bodies,a.bodies)):
        if i not in changed:assert model.freeze(left)==model.freeze(right),i
        assert left[0]==right[0] and left[2:5]==right[2:5],('ABI',i)
    for attr in ['methods','metadata','instances','classes','scripts']:
        assert model.freeze(getattr(old,attr))==model.freeze(getattr(a,attr)),attr
    for attr in ['ints','uints','doubles','strings','namespaces','ns_sets','multinames']:
        left=getattr(old,attr);right=getattr(a,attr)[:len(left)]
        assert ([struct.pack('<d',x) for x in left]==[struct.pack('<d',x) for x in right] if attr=='doubles' else model.freeze(left)==model.freeze(right)),attr
    assert not any(n[0]==22 and n[1]==0 for n in a.namespaces[len(old.namespaces):])
    hooks=w/'hooks.swf';v.swf.save(hooks)
    parsed=model.View(model.SwfAbc(hooks),model.asm)
    for i in changed:assert parsed.normalized(i)==v.normalized(i)
    with zipfile.ZipFile(args.helper) as z:library=z.read('library.swf')
    lib=w/'helper-library.swf';lib.write_bytes(library)
    _,_,_,rawlib=swftags.load_swf(str(lib));abcs=[]
    for code,off,hdr,size in swftags.iter_tags(rawlib):
        if code==82:
            data=rawlib[off+hdr:off+hdr+size];abcs.append(data[data.index(b'\0',4)+1:])
    assert len(abcs)==1
    helper_abc=model.abcfmt.ABC(abcs[0])
    assert len(helper_abc.instances)==1 and helper_abc.mn_name(helper_abc.instances[0][0])=='cn.account::PlayerLogin'
    content=struct.pack('<I',1)+b'cn.account.PlayerLogin\0'+abcs[0]
    tag=struct.pack('<HI',(82<<6)|63,len(content))+content
    swf=parsed.swf;pos=swf._offset;final=swf.body[:pos]+tag+swf.body[pos:]
    out=w/'player-login.swf'
    out.write_bytes(swf.signature+bytes([swf.version])+struct.pack('<I',len(final)+8)+(zlib.compress(final) if swf.signature==b'CWS' else final))
    check=model.SwfAbc(out)
    assert model.freeze(check.abc.bodies)==model.freeze(a.bodies)
    def tags(path):
        _,_,_,r=swftags.load_swf(str(path));return [r[o:o+h+n] for c,o,h,n in swftags.iter_tags(r)]
    left=tags(source);right=tags(out);assert right.count(tag)==1;right.remove(tag)
    assert len(left)==len(right) and sum(x!=y for x,y in zip(left,right))==1
    for i in [24599,39060,79085,79222,71120,82510]:assert model.freeze(old.bodies[i])==model.freeze(a.bodies[i])
    report={'status':'static_candidate','baseline':identity,'endpoint':'http://'+args.host if args.host else identity['endpoint'],
        'swf_sha256':model.sha(out.read_bytes()),'helper_sha256':model.sha(args.helper.read_bytes()),
        'helper_source_sha256':model.sha((HERE/'src/cn/account/PlayerLogin.as').read_bytes()),
        'helper_bodies':len(helper_abc.bodies),'changes':sorted(changes,key=lambda x:x['body']),
        'original_game_bodies':original_game_bodies,'main_abc_index':main_abc_index,
        'original_pools_and_metadata_preserved':True,'unrelated_game_bodies_preserved':True,
        'non_main_tags_preserved':True,'android_device_tested':False}
    (w/'swf-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'changes':sorted(changed),'helper_bodies':len(helper_abc.bodies),'swf':str(out)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--work',type=Path,required=True);p.add_argument('--helper',type=Path,required=True)
    p.add_argument('--variant',choices=['lan','public'],default='lan');p.add_argument('--host');p.add_argument('--isolate-storage',action='store_true');main(p.parse_args())
