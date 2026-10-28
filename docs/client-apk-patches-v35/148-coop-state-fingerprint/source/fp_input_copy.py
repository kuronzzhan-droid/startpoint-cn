"""Typed command copies: schemas are frozen from actual ABC factory signatures.

This is build-time metadata inspection. Runtime code reads only declared slots,
enum params, and explicitly named anonymous-record fields; it never dumps objects.
"""
import json
import asm

BATTLE = 'pinball.scene.battle.battle::Battle'
ROOT_TYPES = ['pinball.online::BattleUserCommand', 'pinball.online::BattleCoopCommand',
              'pinball.online.battle.message::BattleSocketCommand']
PRIMITIVES = {'int', 'uint', 'Boolean', 'String', 'Number'}

# Type-erased Haxe records require an explicit signature, never runtime guessing.
OVERRIDES = {
    ('pinball.online::BattleUserCommand', 3, 0): 'record:BallPosition',
    ('pinball.online::BattleCoopCommand', 8, 1): 'option:String',
}
RECORDS = {'record:BallPosition': {'vx': 'Number', 'vy': 'Number', 'x': 'Number', 'y': 'Number'}}


def build_schemas(e):
    schemas, evidence = {}, {}
    todo = list(ROOT_TYPES)
    # Optional reviewed additions live beside this module and are deliverable source.
    from pathlib import Path
    extra = {'records': {}, 'overrides': [], 'slots': {}, 'unions': {}}
    for extra_path in sorted(Path(__file__).parent.glob('input-structs*.json')):
        part = json.loads(extra_path.read_text(encoding='utf-8'))
        for key in ('records', 'slots', 'unions'):
            for name, value in part.get(key, {}).items():
                if name in extra[key] and extra[key][name] != value:
                    raise ValueError('conflicting command schema: ' + name)
                extra[key][name] = value
        extra['overrides'].extend(part.get('overrides', []))
    records = {**RECORDS, **extra.get('records', {})}
    overrides = {**OVERRIDES, **{(r['owner'], r['variant'], r['param']): r['type']
                              for r in extra.get('overrides', [])}}
    slots = extra.get('slots', {})
    while todo:
        typ = todo.pop(0)
        if typ in schemas:
            continue
        if typ in PRIMITIVES:
            schemas[typ] = {'kind': 'primitive'}
            continue
        if typ in extra['unions']:
            schemas[typ] = {'kind': 'union', 'choices': extra['unions'][typ]}
            todo.extend(row['type'] for row in extra['unions'][typ])
            continue
        if typ.startswith('option:'):
            sub = typ[7:]
            schemas[typ] = {'kind': 'enum', 'variants': {0: [sub], 1: []}}
            todo.append(sub)
            continue
        if typ.startswith('array:'):
            sub = typ[6:]
            schemas[typ] = {'kind': 'array', 'type': sub}
            todo.append(sub)
            continue
        if typ.startswith(('intmap:', 'stringmap:')):
            sub = typ.split(':', 1)[1]
            schemas[typ] = {'kind': 'map', 'type': sub, 'string': typ.startswith('stringmap:')}
            todo.append(sub)
            continue
        if typ in records:
            schemas[typ] = {'kind': 'record', 'fields': records[typ]}
            todo.extend(records[typ].values())
            continue
        if typ in ('Object', '*', 'Array', 'haxe.IMap', 'haxe::IMap', 'haxe.ds::Option'):
            schemas[typ] = {'kind': 'unsupported'}
            continue
        try:
            ci, instance = e.instance(typ)
        except asm.AsmError:
            schemas[typ] = {'kind': 'unsupported'}
            continue
        static = e.abc.classes[ci][1]
        is_enum = any(e.abc.mn_name(t.name).split('::')[-1] == '__isenum' for t in static)
        if not is_enum:
            fields = {}
            for t in instance[6]:
                if t.data[0] == 'slot':
                    key = e.abc.mn_name(t.name).split('::')[-1]
                    field_type = e.abc.mn_name(t.data[2]) if t.data[2] else '*'
                    fields[key] = slots.get(typ + '/' + key, field_type)
            schemas[typ] = {'kind': 'record', 'fields': fields} if fields else {'kind': 'unsupported'}
            todo.extend(fields.values())
            continue
        variants, proof = {}, []
        # Factories have exact typed argument signatures; static no-arg values are
        # constructed in cinit with the same (tag,index,null) tuple.
        methods = [(e.abc.classes[ci][0], None)]
        methods += [(script[0], None) for script in e.abc.scripts
                    if any(t.name == instance[0] for t in script[1])]
        methods += [(t.data[2], t) for t in static if t.data[0] == 'method']
        for mi, trait in methods:
            body = next((b for b in e.abc.bodies if b[0] == mi), None)
            if body is None:
                continue
            ins = asm.decode(body[5])
            for i in range(len(ins) - 2):
                if ins[i].name != 'pushstring' or ins[i+1].name not in ('pushbyte', 'pushshort', 'pushint'):
                    continue
                num = ins[i+1].args[0]
                if ins[i+1].name == 'pushint': num = e.abc.ints[num]
                if ins[i+1].name == 'pushbyte' and num > 127: num -= 256
                if not 0 <= num < 1000:
                    continue
                if trait is None:
                    if ins[i+2].name != 'pushnull': continue
                    args = []
                else:
                    if e.abc.methods[mi][0] != instance[0]: continue
                    args = [e.abc.mn_name(a) if a else '*' for a in e.abc.methods[mi][1]]
                args = [overrides.get((typ, num, j), t) for j, t in enumerate(args)]
                variants[num] = args
                proof.append({'method': mi, 'index': num, 'types': args})
                todo.extend(args)
        schemas[typ] = {'kind': 'enum', 'variants': variants} if variants else {'kind': 'unsupported'}
        evidence[typ] = proof
    return schemas, evidence


def build(e):
    q, n, s = e.q, e.number, e.string
    rt = next(i for i, mn in enumerate(e.abc.multinames) if mn[0] == 0x1B)
    schemas, evidence = build_schemas(e)
    helpers = {typ: e.newq('wfxFpCommandType' + str(i)) for i, typ in enumerate(schemas)}
    bad = e.newq('wfxFpInputUnsupported')
    e.add_method(BATTLE, 'wfxFpInputUnsupported', '*', ['Array', 'String'], [
        ('getlocal_0',), ('pushscope',), ('getlocal_1',),
        s('path'), ('getlocal_2',), s('reason'), s('field_shape'), ('newobject', 2),
        ('callpropvoid', q('push'), 1), ('pushnull',), ('returnvalue',)], 3, static=True)

    def copy(typ, value):
        return [('getlex', q(BATTLE)), *value, ('getlocal_2',), ('getlocal_3',),
                ('getlocal', 4), n(1), ('add_i',), ('callproperty', helpers[typ], 4)]

    for typ, schema in schemas.items():
        name = e.abc.mn_name(helpers[typ]).split('::')[-1]
        code = [('getlocal_0',), ('pushscope',), ('getlocal', 4), n(64), ('ifge', 'BAD'),
                ('getlocal_1',), ('pushnull',), ('ifeq', 'NULL')]
        kind = schema['kind']
        if kind == 'primitive':
            code += [('getlocal_1',), ('istype', q(typ)), ('iffalse', 'BAD')]
            if typ in ('Number', 'uint'):
                code += [('getlex', q(BATTLE)), ('getlocal_1',),
                         ('callproperty', e.newq('wfxFpF64'), 1), ('returnvalue',)]
            else:
                code += [('getlocal_1',), ('returnvalue',)]
        elif kind == 'union':
            choices = sorted(schema['choices'], key=lambda row: bool(row.get('field')))
            for i, choice in enumerate(choices):
                if choice.get('field'):
                    code += [s(choice['field']), ('getlocal_1',), ('in',), ('iffalse', 'UNION' + str(i)),
                             ('getlocal_1',), ('getproperty', e.newq(choice['field']))]
                else:
                    code += [('getlocal_1',)]
                # Distinct runtime enum classes can share the same index/params.
                # Preserve the whitelisted discriminator instead of merging them.
                code += [('istype', q(choice['class'])), ('iffalse', 'UNION' + str(i)),
                         s('type'), s(choice['class']), s('value'),
                         *copy(choice['type'], [('getlocal_1',)]), ('newobject', 2),
                         ('returnvalue',), ('label', 'UNION' + str(i))]
            code += [('jump', 'BAD')]
        elif kind == 'enum':
            code += [('getlocal_1',), ('getproperty', q('index')), ('setlocal', 5),
                     ('getlocal_1',), ('getproperty', q('params')), ('setlocal', 6)]
            for idx, args in sorted(schema['variants'].items()):
                code += [('getlocal', 5), n(idx), ('ifne', 'NEXT' + str(idx))]
                if args:
                    code += [('getlocal', 6), ('iffalse', 'BAD'), ('getlocal', 6),
                             ('getproperty', q('length')), n(len(args)), ('ifne', 'BAD')]
                else:
                    code += [('getlocal', 6), ('iffalse', 'EMPTY' + str(idx)), ('getlocal', 6),
                             ('getproperty', q('length')), n(0), ('ifne', 'BAD'), ('label', 'EMPTY' + str(idx))]
                code += [n(idx)]
                for j, at in enumerate(args):
                    code += copy(at, [('getlocal', 6), n(j), ('getproperty', rt)])
                code += [('newarray', len(args)+1), ('returnvalue',), ('label', 'NEXT' + str(idx))]
            code += [('jump', 'BAD')]
        elif kind == 'record':
            for key, at in schema['fields'].items():
                code += [s(key), *copy(at, [('getlocal_1',), ('getproperty', e.newq(key))])]
            code += [('newobject', len(schema['fields'])), ('returnvalue',)]
        elif kind == 'array':
            code += [('newarray', 0), ('setlocal', 5), n(0), ('setlocal', 6),
                     ('label', 'LOOP'), ('avm_label',), ('getlocal', 6), ('getlocal_1',),
                     ('getproperty', q('length')), ('ifge', 'ARRAYDONE'), ('getlocal', 5)]
            code += copy(schema['type'], [('getlocal_1',), ('getlocal', 6), ('getproperty', rt)])
            code += [('callpropvoid', q('push'), 1), ('inclocal_i', 6), ('jump', 'LOOP'),
                     ('label', 'ARRAYDONE'), ('getlocal', 5), ('returnvalue',)]
        elif kind == 'map':
            code += [('newarray', 0), ('setlocal', 5)]
            for field in (('h', 'rh') if schema['string'] else ('h',)):
                loop, done = 'MAPLOOP' + field, 'MAPDONE' + field
                code += [('getlocal_1',), ('getproperty', e.newq(field)), ('setlocal', 7),
                         ('getlocal', 7), ('iffalse', done), n(0), ('setlocal', 8),
                         ('label', loop), ('avm_label',), ('hasnext2', 7, 8), ('iffalse', done),
                         ('getlocal', 7), ('getlocal', 8), ('nextname',), ('setlocal', 9),
                         ('getlocal', 5), s('key'), ('getlocal', 9), ('convert_s',)]
                if field == 'rh':
                    code += [n(1), ('callproperty', e.newq('substr'), 1)]
                code += [s('value'), *copy(schema['type'], [('getlocal', 7), ('getlocal', 9), ('getproperty', rt)]),
                         ('newobject', 2), ('callpropvoid', q('push'), 1), ('jump', loop), ('label', done)]
            code += [('getlocal', 5), s('key'), ('callpropvoid', e.newq('sortOn'), 1),
                     ('getlocal', 5), ('returnvalue',)]
        else:
            code += [('jump', 'BAD')]
        code += [('label', 'NULL'), ('pushnull',), ('returnvalue',), ('label', 'BAD'),
                 ('getlex', q(BATTLE)), ('getlocal_2',), ('getlocal_3',),
                 ('callproperty', bad, 2), ('returnvalue',)]
        e.add_method(BATTLE, name, '*', ['*', 'Array', 'String', 'int'], code, 10, static=True)

    # Entire command is null when any leaf could not be copied. A diagnostic read
    # failure cannot escape into Battle.proceed or original socket exception paths.
    code = [('getlocal_0',), ('pushscope',), ('getlocal_3',), ('getproperty', q('length')),
            ('setlocal', 5), ('label', 'TRY')]
    for i, typ in enumerate(ROOT_TYPES):
        code += [('getlocal_2',), s(typ), ('ifne', 'NEXT' + str(i)), ('getlex', q(BATTLE)),
                 ('getlocal_1',), ('getlocal_3',), ('getlocal', 4), n(0),
                 ('callproperty', helpers[typ], 4), ('setlocal', 6), ('jump', 'TRYEND'),
                 ('label', 'NEXT' + str(i))]
    code += [('jump', 'FAIL'), ('label', 'TRYEND'), ('getlocal_3',), ('getproperty', q('length')),
             ('getlocal', 5), ('ifne', 'NULL'), ('getlocal', 6), ('returnvalue',),
             ('label', 'CATCH'), ('pop',), ('getlocal_0',), ('pushscope',),
             ('label', 'FAIL'), ('getlex', q(BATTLE)), ('getlocal_3',), ('getlocal', 4),
             ('callproperty', bad, 2), ('pop',), ('label', 'NULL'), ('pushnull',), ('returnvalue',)]
    e.add_method(BATTLE, 'wfxFpCommand', '*', ['*', 'String', 'Array', 'String'], code, 7,
                 static=True, exceptions=[('TRY', 'TRYEND', 'CATCH', 0, 0)])
    return {'schemas': schemas, 'abc_factory_evidence': evidence,
            'uint_encoding': 'exact original unsigned value encoded as f64; never int32 truncation',
            'map_encoding': 'sorted immutable [{key:String,value:typed}] from h and reserved rh'}
