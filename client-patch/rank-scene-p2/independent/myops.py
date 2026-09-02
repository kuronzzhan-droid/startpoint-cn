# AVM2 opcode table
OPS = {
0x01:('bkpt',[],0,0),0x02:('nop',[],0,0),0x03:('throw',[],1,0),
0x04:('getsuper',['u30'],1,1),0x05:('setsuper',['u30'],2,0),
0x06:('dxns',['u30'],0,0),0x07:('dxnslate',[],1,0),
0x08:('kill',['u30'],0,0),0x09:('label',[],0,0),
0x0c:('ifnlt',['s24'],2,0),0x0d:('ifnle',['s24'],2,0),0x0e:('ifngt',['s24'],2,0),0x0f:('ifnge',['s24'],2,0),
0x10:('jump',['s24'],0,0),0x11:('iftrue',['s24'],1,0),0x12:('iffalse',['s24'],1,0),
0x13:('ifeq',['s24'],2,0),0x14:('ifne',['s24'],2,0),0x15:('iflt',['s24'],2,0),0x16:('ifle',['s24'],2,0),
0x17:('ifgt',['s24'],2,0),0x18:('ifge',['s24'],2,0),0x19:('ifstricteq',['s24'],2,0),0x1a:('ifstrictne',['s24'],2,0),
0x1b:('lookupswitch',['SWITCH'],1,0),
0x1c:('pushwith',[],1,0),0x1d:('popscope',[],0,0),
0x1e:('nextname',[],2,1),0x1f:('hasnext',[],2,1),
0x20:('pushnull',[],0,1),0x21:('pushundefined',[],0,1),0x23:('nextvalue',[],2,1),
0x24:('pushbyte',['u8'],0,1),0x25:('pushshort',['u30'],0,1),
0x26:('pushtrue',[],0,1),0x27:('pushfalse',[],0,1),0x28:('pushnan',[],0,1),
0x29:('pop',[],1,0),0x2a:('dup',[],1,2),0x2b:('swap',[],2,2),
0x2c:('pushstring',['u30'],0,1),0x2d:('pushint',['u30'],0,1),0x2e:('pushuint',['u30'],0,1),
0x2f:('pushdouble',['u30'],0,1),0x30:('pushscope',[],1,0),0x31:('pushnamespace',['u30'],0,1),
0x32:('hasnext2',['u30','u30'],0,1),
0x40:('newfunction',['u30'],0,1),0x41:('call',['u30'],None,1),
0x42:('construct',['u30'],None,1),0x43:('callmethod',['u30','u30'],None,1),
0x44:('callstatic',['u30','u30'],None,1),0x45:('callsuper',['u30','u30'],None,1),
0x46:('callproperty',['u30','u30'],None,1),0x47:('returnvoid',[],0,0),0x48:('returnvalue',[],1,0),
0x49:('constructsuper',['u30'],None,0),0x4a:('constructprop',['u30','u30'],None,1),
0x4c:('callproplex',['u30','u30'],None,1),0x4e:('callsupervoid',['u30','u30'],None,0),
0x4f:('callpropvoid',['u30','u30'],None,0),
0x53:('applytype',['u30'],None,1),
0x55:('newobject',['u30'],None,1),0x56:('newarray',['u30'],None,1),
0x57:('newactivation',[],0,1),0x58:('newclass',['u30'],1,1),
0x59:('getdescendants',['u30'],1,1),0x5a:('newcatch',['u30'],0,1),
0x5d:('findpropstrict',['u30'],None,1),0x5e:('findproperty',['u30'],None,1),
0x5f:('finddef',['u30'],0,1),
0x60:('getlex',['u30'],0,1),0x61:('setproperty',['u30'],None,0),
0x62:('getlocal',['u30'],0,1),0x63:('setlocal',['u30'],1,0),
0x64:('getglobalscope',[],0,1),0x65:('getscopeobject',['u8'],0,1),
0x66:('getproperty',['u30'],None,1),0x68:('initproperty',['u30'],None,0),
0x6a:('deleteproperty',['u30'],None,1),
0x6c:('getslot',['u30'],1,1),0x6d:('setslot',['u30'],2,0),
0x6e:('getglobalslot',['u30'],0,1),0x6f:('setglobalslot',['u30'],1,0),
0x70:('convert_s',[],1,1),0x71:('esc_xelem',[],1,1),0x72:('esc_xattr',[],1,1),
0x73:('convert_i',[],1,1),0x74:('convert_u',[],1,1),0x75:('convert_d',[],1,1),
0x76:('convert_b',[],1,1),0x77:('convert_o',[],1,1),0x78:('checkfilter',[],1,1),
0x80:('coerce',['u30'],1,1),0x82:('coerce_a',[],1,1),0x85:('coerce_s',[],1,1),
0x86:('astype',['u30'],1,1),0x87:('astypelate',[],2,1),
0x90:('negate',[],1,1),0x91:('increment',[],1,1),0x92:('inclocal',['u30'],0,0),
0x93:('decrement',[],1,1),0x94:('declocal',['u30'],0,0),
0x95:('typeof',[],1,1),0x96:('not',[],1,1),0x97:('bitnot',[],1,1),
0xa0:('add',[],2,1),0xa1:('subtract',[],2,1),0xa2:('multiply',[],2,1),0xa3:('divide',[],2,1),
0xa4:('modulo',[],2,1),0xa5:('lshift',[],2,1),0xa6:('rshift',[],2,1),0xa7:('urshift',[],2,1),
0xa8:('bitand',[],2,1),0xa9:('bitor',[],2,1),0xaa:('bitxor',[],2,1),
0xab:('equals',[],2,1),0xac:('strictequals',[],2,1),0xad:('lessthan',[],2,1),0xae:('lessequals',[],2,1),
0xaf:('greaterthan',[],2,1),0xb0:('greaterequals',[],2,1),
0xb1:('instanceof',[],2,1),0xb2:('istype',['u30'],1,1),0xb3:('istypelate',[],2,1),
0xb4:('in',[],2,1),
0xc0:('increment_i',[],1,1),0xc1:('decrement_i',[],1,1),0xc2:('inclocal_i',['u30'],0,0),
0xc3:('declocal_i',['u30'],0,0),0xc4:('negate_i',[],1,1),0xc5:('add_i',[],2,1),
0xc6:('subtract_i',[],2,1),0xc7:('multiply_i',[],2,1),
0xd0:('getlocal0',[],0,1),0xd1:('getlocal1',[],0,1),0xd2:('getlocal2',[],0,1),0xd3:('getlocal3',[],0,1),
0xd4:('setlocal0',[],1,0),0xd5:('setlocal1',[],1,0),0xd6:('setlocal2',[],1,0),0xd7:('setlocal3',[],1,0),
0xef:('debug',['u8','u30','u8','u30'],0,0),
0xf0:('debugline',['u30'],0,0),0xf1:('debugfile',['u30'],0,0),
0xf2:('bkptline',['u30'],0,0),0xf3:('timestamp',[],0,0),
}


def u30(d, o):
    r = 0
    for i in range(5):
        b = d[o]
        o += 1
        r |= (b & 0x7f) << (7 * i)
        if not (b & 0x80):
            break
    return r & 0xFFFFFFFF, o


def s24(d, o):
    v = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)
    o += 3
    return (v - 0x1000000 if v & 0x800000 else v), o


def disasm(code):
    ins = []
    o = 0
    while o < len(code):
        a = o
        op = code[o]
        o += 1
        if op not in OPS:
            raise ValueError('unknown opcode 0x%02x at %d' % (op, a))
        name, kinds, pop, push = OPS[op]
        ops = []
        for k in kinds:
            if k == 'u30':
                v, o = u30(code, o)
                ops.append(v)
            elif k == 'u8':
                ops.append(code[o])
                o += 1
            elif k == 's24':
                v, o = s24(code, o)
                ops.append(v)
            elif k == 'SWITCH':
                dflt, o = s24(code, o)
                cnt, o = u30(code, o)
                cases = []
                for _ in range(cnt + 1):
                    c, o = s24(code, o)
                    cases.append(c)
                ops = [dflt, cnt, cases]
        ins.append({'addr': a, 'op': op, 'name': name, 'ops': ops, 'size': o - a})
    return ins


def effect(i):
    name = i['name']
    ops = i['ops']
    t = OPS[i['op']]
    pop, push = t[2], t[3]
    if pop is not None:
        return pop, push
    if name == 'call':
        return ops[0] + 2, 1
    if name == 'construct':
        return ops[0] + 1, 1
    if name == 'constructsuper':
        return ops[0] + 1, 0
    if name in ('callmethod', 'callstatic'):
        return ops[1] + 1, 1
    if name in ('callsuper', 'callproperty', 'callproplex'):
        return ops[1] + 1, 1
    if name in ('callsupervoid', 'callpropvoid'):
        return ops[1] + 1, 0
    if name == 'constructprop':
        return ops[1] + 1, 1
    if name == 'newarray':
        return ops[0], 1
    if name == 'newobject':
        return ops[0] * 2, 1
    if name == 'applytype':
        return ops[0] + 1, 1
    if name in ('getproperty', 'deleteproperty'):
        return 1, 1
    if name in ('setproperty', 'initproperty'):
        return 2, 0
    if name in ('findpropstrict', 'findproperty'):
        return 0, 1
    raise ValueError('unresolved ' + name)


def targets(i):
    """branch target addresses (absolute)"""
    name = i['name']
    nxt = i['addr'] + i['size']
    if name == 'lookupswitch':
        base = i['addr']
        return [base + i['ops'][0]] + [base + c for c in i['ops'][2]]
    if name in ('jump', 'iftrue', 'iffalse', 'ifeq', 'ifne', 'iflt', 'ifle', 'ifgt', 'ifge',
                'ifnlt', 'ifnle', 'ifngt', 'ifnge', 'ifstricteq', 'ifstrictne'):
        return [nxt + i['ops'][0]]
    return []


def falls_through(i):
    return i['name'] not in ('jump', 'throw', 'returnvoid', 'returnvalue', 'lookupswitch')
