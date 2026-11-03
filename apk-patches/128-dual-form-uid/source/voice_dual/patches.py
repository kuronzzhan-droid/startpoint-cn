"""在 v35b 的原 06/21 方法中替换门控指令；保留其余所有旧路径。"""
import asm

CALC = 'pinball.common.data.character::CalculatedBattleCharacterLogic'
VIEW = 'pinball.scene.battle.battle.squad.member::MemberView'
BATTLE = 'pinball.scene.battle.battle::Battle'


def build(e):
    q = e.q
    idx = next(i for i in range(1, len(e.abc.multinames)) if e.abc.multinames[i][0] == 0x1b)
    voice = e.add_method(CALC, 'wfxUsesFeverVoice', 'Boolean', [], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_0',), ('getproperty', q('mainCharacterStringId')),
        e.string('white_tiger_summer'), ('ifeq', 'YES'),
        ('getlex', q(BATTLE)), ('getlocal_0',), ('getproperty', q('logic')),
        ('getproperty', q('logicAssets')), e.string('wfx_fever_voice_'),
        ('getlocal_0',), ('getproperty', q('mainCharacterStringId')), ('add',),
        ('callproperty', q('wfxPfReadString'), 2), e.string('1'), ('equals',), ('returnvalue',),
        ('label', 'YES'), ('pushtrue',), ('returnvalue',),
    ], 1)
    dual = e.add_method(VIEW, 'wfxDualFormUid', 'int', ['Array'], [
        ('getlocal_0',), ('pushscope',), ('pushbyte', 0), ('setlocal_2',),
        ('getlocal_1',), ('iffalse', 'DONE'), ('pushbyte', 0), ('setlocal_3',),
        ('label', 'LOOP'), ('avm_label',),
        ('getlocal_3',), ('getlocal_1',), ('getproperty', q('length')), ('ifge', 'DONE'),
        ('getlocal_1',), ('getlocal_3',), ('getproperty', idx), ('setlocal', 4),
        ('getlocal', 4), e.string('ModDualForm'), ('ifne', 'PARAM'),
        ('pushbyte', 22), ('setlocal_2',), ('jump', 'NEXT'),
        ('label', 'PARAM'), ('getlocal', 4), ('iffalse', 'NEXT'),
        ('getlocal', 4), e.string(':'),
        ('callproperty', q('http://adobe.com/AS3/2006/builtin::split'), 1), ('setlocal', 4),
        ('getlocal', 4), ('getproperty', q('length')), ('pushbyte', 2), ('ifne', 'NEXT'),
        ('getlocal', 4), ('pushbyte', 0), ('getproperty', idx), e.string('ModDualForm'), ('ifne', 'NEXT'),
        ('getlex', q(BATTLE)), ('getlocal', 4), ('pushbyte', 1), ('getproperty', idx),
        ('pushbyte', 10), e.number(2147483647), ('callproperty', q('wfxPfParseUInt'), 3), ('setlocal', 5),
        ('getlocal', 5), ('pushbyte', 0), ('ifle', 'NEXT'), ('getlocal', 5), ('returnvalue',),
        ('label', 'NEXT'), ('inclocal_i', 3), ('jump', 'LOOP'),
        ('label', 'DONE'), ('getlocal_2',), ('returnvalue',),
    ], 6)
    # 保持原门控的指令数及所有分支落点，仅替换 code_name 判断为 helper 判断。
    for label, offset in [('SquadManagerImpl/invokeActionSkill', 112), ('HudMemberStatus/update', 66)]:
        body = e.body(label)
        code = asm.decode(body[5])
        assert code[offset].name == 'getproperty' and e.abc.mn_name(code[offset].args[0]) == 'mainCharacterStringId'
        assert e.abc.s(code[offset+1].args[0]) == 'white_tiger_summer'
        target = code[offset+2].target
        code[offset:offset+2] = asm.assemble([('callproperty', voice, 0), ('pushfalse',)])
        code[offset+2] = asm.Instruction(asm.MNEMONICS['ifeq'])
        code[offset+2].target = target
        assert not body[6], 'exception remap required'
        raw = asm.encode(code)[0]
        if label == 'HudMemberStatus/update':
            # 149999 在真实资产链中仅 base + alt1..3，与通用轮换输出逐项一致。
            # 先删通用跳过项，再删旧角色专用轮换；从后往前避免改变锚点。
            assert e.abc.s(code[491].args[0]) == 'white_wolf_gerald'
            raw = asm.unsplice(raw, 490, 3)
            raw = asm.unsplice(raw, 397, 72)
        e.replace(label, raw)
    for label, at, skip in [('BattleCharacterLogic/resolveFollowingPathCollection', 208, 305),
                            ('CharacterVoiceLogic/createVoicePathMap', 341, 382)]:
        body = e.body(label)
        assert not body[6], 'exception remap required'
        code = asm.decode(body[5])
        assert e.abc.ints[code[skip+1].args[0]] == 149999
        raw = asm.unsplice(body[5], skip, 3)
        raw = asm.unsplice(raw, at, 28)
        e.replace(label, raw)
    label = 'MemberView/draw'
    body = e.body(label)
    code = asm.decode(body[5])
    assert e.abc.s(code[42].args[0]) == 'ModDualForm' and list(code[50].args) == [22]
    local = body[2]
    gate = asm.assemble([
        ('getlocal_0',), ('getlocal_0',), ('getproperty', q('member')),
        ('callproperty', q('pinball.scene.battle.battle.squad.member:MemberPeek::getCharacter'), 0),
        ('getproperty', q('characterTags')), ('callproperty', dual, 1),
        ('dup',), ('setlocal', local), ('iffalse', 'END'),
    ])
    gate[-1].target = code[46].target
    code[38:47] = gate
    code[50] = asm.assemble([('getlocal', local)])[0]
    assert not body[6], 'exception remap required'
    e.replace(label, asm.encode(code)[0])
    return {'capabilities': ['fever-voice-v1', 'dual-form-uid-v1'],
            'ready_voices': {'removed': [149999], 'retained': [129992, 139993, 159998]},
            'pf_silent': 'documentation only, unchanged'}
