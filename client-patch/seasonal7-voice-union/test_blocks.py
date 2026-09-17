"""Execute inserted instruction lists with controlled voice assets and RNG."""
import unittest
import blocks


class Pool:
    def __init__(self):
        self.strings={};self.ints={}
    def string(self,s):
        self.strings[s]=s;return s
    def integer(self,i):
        self.ints[i]=i;return i


NAMES={7439:'characterId',9733:'character',15727:'mainCharacterStringId',9604:'logic',
       7746:'logicAssets',46:'index',80:'params',7494:'master',5119:'kind',9682:'evolution_level',35:'length'}


def run(code,locals_,random_value=0.75):
    labels={r[1]:i for i,r in enumerate(code) if r[0]=='label'}
    stack=[];pc=0;steps=0
    while pc<len(code):
        steps+=1
        if steps>10000:raise AssertionError('infinite loop')
        ins=code[pc];pc+=1;op=ins[0];args=ins[1:]
        if op=='label':continue
        if op.startswith('getlocal'):
            stack.append(locals_[int(op[-1]) if op.startswith('getlocal_') else args[0]])
        elif op=='setlocal':locals_[args[0]]=stack.pop()
        elif op in ('pushint','pushstring','pushbyte'):stack.append(args[0])
        elif op in ('getlex','findpropstrict'):stack.append(args[0])
        elif op=='getproperty':
            key=stack.pop() if args[0]==14 else NAMES[args[0]]
            obj=stack.pop();stack.append(len(obj) if key=='length' else obj[key])
        elif op=='newarray':stack.append([])
        elif op=='inclocal_i':locals_[args[0]]+=1
        elif op=='convert_i':stack.append(int(stack.pop()))
        elif op=='coerce':pass
        elif op in ('multiply','add'):
            b=stack.pop();a=stack.pop();stack.append(a*b if op=='multiply' else a+b)
        elif op in ('callproperty','callpropvoid','constructprop'):
            name,n=args;values=[stack.pop() for _ in range(n)][::-1];obj=stack.pop()
            if name==8215:result=values[0] in obj
            elif name==277:result=random_value
            elif name==241:result={'index':0,'params':values}
            elif name in (65,7784):obj.append(values[0]);result=None
            elif name==16839:result={'character':values[0],'values':values[1]}
            else:raise AssertionError(name)
            if op!='callpropvoid':stack.append(result)
        elif op=='jump':pc=labels[args[0]]
        elif op in ('ifeq','ifne','iflt'):
            b=stack.pop();a=stack.pop()
            yes={'ifeq':lambda:a==b,'ifne':lambda:a!=b,'iflt':lambda:a<b}[op]()
            if yes:pc=labels[args[0]]
        elif op=='iffalse':
            if not stack.pop():pc=labels[args[0]]
        elif op=='returnvalue':return stack.pop()
        else:raise AssertionError(op)
    if stack:raise AssertionError('fallthrough stack not empty')
    return None


class VoiceBlocksTest(unittest.TestCase):
    def test_ready_both_versions_each_role_and_route(self):
        for code in blocks.ROSTER.values():
            for slot in ('skill_ready','matched_skill_ready'):
                base=f'character/{code}/voice/battle/{slot}'
                for rng,suffix in [(0.1,''),(0.9,'_alt')]:
                    loc={0:{'character':{'mainCharacterStringId':code,'logic':{'logicAssets':{base,base+'_alt'}}}},
                         4:{'index':0,'params':[base]}}
                    run(blocks.ready(Pool()),loc,rng)
                    self.assertEqual(loc[4]['params'],[base+suffix])

    def test_missing_alternate_and_foreign_character_keep_original(self):
        for code in [next(iter(blocks.ROSTER.values())),'unicorn_lancer_rose','official']:
            opt={'index':0,'params':['native']}
            loc={0:{'character':{'mainCharacterStringId':code,'logic':{'logicAssets':set()}}},4:opt}
            run(blocks.ready(Pool()),loc)
            self.assertIs(loc[4],opt)

    def test_none_ready_stays_none(self):
        opt={'index':1};loc={0:{'character':{'mainCharacterStringId':next(iter(blocks.ROSTER.values()))}},4:opt}
        run(blocks.ready(Pool()),loc);self.assertIs(loc[4],opt)

    def test_join_and_evolution_match_subtitle_to_audio(self):
        for evolution in [False,True]:
            kind=1 if evolution else 2
            first={'kind':{'index':kind,'params':[{'evolution_level':1}]},'voice':'a','text':'字幕A'}
            second={'kind':{'index':kind,'params':[{'evolution_level':1}]},'voice':'b','text':'字幕B'}
            other={'kind':{'index':0,'params':[{}]},'voice':'home'}
            for cid in blocks.ROSTER:
                for rng,want in [(0.01,first),(0.999,second)]:
                    data={'characterId':cid,'character':'self','master':[other,first,second]}
                    result=run(blocks.speech(Pool(),evolution=evolution),{0:data,1:1},rng)
                    self.assertIs(result['values'],want)
                    self.assertEqual(data['master'],[other,first,second])

    def test_single_speech_or_other_evolution_uses_native_fallback(self):
        row={'kind':{'index':1,'params':[{'evolution_level':2}]}}
        data={'characterId':129991,'character':'self','master':[row,row]}
        self.assertIsNone(run(blocks.speech(Pool(),evolution=True),{0:data,1:1}))
        data['master']=[row]
        self.assertIsNone(run(blocks.speech(Pool(),evolution=True),{0:data,1:2}))

    def test_foreign_speech_is_not_read(self):
        self.assertIsNone(run(blocks.speech(Pool()),{0:{'characterId':100}}))

    def test_preload_only_matching_available_alternates(self):
        for cid,code in blocks.ROSTER.items():
            paths={f'character/{code}/voice/battle/{s}_alt' for s in ['skill_ready','matched_skill_ready']}
            loc={5:{'characterId':cid,'logicAssets':paths},1:[]}
            run(blocks.preload(Pool()),loc);self.assertEqual(set(loc[1]),paths)
            loc={5:{'characterId':cid,'logicAssets':set()},1:[]}
            run(blocks.preload(Pool()),loc);self.assertEqual(loc[1],[])


if __name__=='__main__':unittest.main()
