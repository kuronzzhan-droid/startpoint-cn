"""从实际来源槽读角色 ID，并按战斗和来源缓存安全配置读取。"""
BATTLE = 'pinball.scene.battle.battle::Battle'


def red():
    return [('pushshort', 255), ('pushbyte', 16), ('lshift',),
            ('pushbyte', 64), ('pushbyte', 8), ('lshift',),
            ('bitor',), ('pushbyte', 64), ('bitor',)]


def install_source_id(e):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    # battle1, packed2, slot3, kind4, working array/option5.
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_1',), ('iffalse', 'NONE'),
            ('getlocal_2',), n(16), ('rshift',), ('setlocal_3',),
            ('getlocal_3',), n(0), ('iflt', 'NONE'),
            ('getlocal_2',), n(65535), ('bitand',), ('setlocal', 4),
            ('getlocal', 4), n(1), ('ifgt', 'NONE'),
            ('getlocal_1',), ('getproperty', q('initialData')), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'NONE'),
            ('getlocal', 5), ('getproperty', q('sources')), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'NONE'),
            ('getlocal', 5), ('getproperty', q('length')), ('iffalse', 'NONE'),
            ('getlocal', 5), n(0), ('getproperty', x), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'NONE'),
            ('getlocal', 5), ('getproperty', q('party')), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'NONE'),
            ('getlocal', 4), ('iftrue', 'UNISON'),
            ('getlocal', 5), ('getproperty', q('characters')), ('setlocal', 5),
            ('jump', 'ARRAY'), ('label', 'UNISON'),
            ('getlocal', 5), ('getproperty', q('unison_characters')), ('setlocal', 5),
            ('label', 'ARRAY'), ('getlocal', 5), ('iffalse', 'NONE'),
            ('getlocal_3',), ('getlocal', 5), ('getproperty', q('length')),
            ('ifge', 'NONE'),
            ('getlocal', 5), ('getlocal_3',), ('getproperty', x), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'NONE'),
            ('getlocal', 5), ('getproperty', q('index')), n(0), ('ifne', 'NONE'),
            ('getlocal', 5), ('getproperty', q('params')), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'NONE'),
            ('getlocal', 5), ('getproperty', q('length')), ('iffalse', 'NONE'),
            ('getlocal', 5), n(0), ('getproperty', x), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'NONE'),
            ('getlocal', 5), ('getproperty', q('id')), ('convert_i',), ('returnvalue',),
            ('label', 'NONE'), n(-1), ('returnvalue',)]
    return e.add_method(BATTLE, 'wfxPf4SourceId', 'int', ['Object', 'int'], code, 6, static=True)


def install_config(e, source_id):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    cache = e.add_slot(BATTLE, 'wfxPf4SourceCache', 'Object', static=True)
    # battle1, assets2, packed3, bucket4, value5, table6, parsed7, text/key8, id9.
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_1',), ('iffalse', 'FALLBACK'),
            ('getlocal_2',), ('iffalse', 'FALLBACK'),
            ('getlex', q(BATTLE)), ('getproperty', cache), ('iftrue', 'CACHE'),
            ('getlex', q(BATTLE)), ('findpropstrict', q('flash.utils::Dictionary')),
            ('pushtrue',), ('constructprop', q('flash.utils::Dictionary'), 1),
            ('setproperty', cache),
            ('label', 'CACHE'), ('getlex', q(BATTLE)), ('getproperty', cache),
            ('getlocal_1',), ('getproperty', x), ('setlocal', 4),
            ('getlocal', 4), ('iffalse', 'TABLE'),
            ('getlocal', 4), ('getlocal_3',), ('getproperty', x),
            ('dup',), ('iftrue', 'CACHED'), ('pop',),
            ('label', 'TABLE'), ('getlocal_2',),
            ('getlex', q('pinball.master.generated::CustomAbilityStringTable')),
            ('callproperty', q('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'), 1),
            ('astype', q('pinball.master.generated::CustomAbilityStringTable')),
            ('setlocal', 6), ('getlocal', 6), ('iffalse', 'FALLBACK'),
            ('getlocal', 6), ('callproperty', q('get_data'), 0), ('setlocal', 6),
            ('getlocal', 4), ('iftrue', 'BUCKET'),
            ('newobject', 0), ('setlocal', 4),
            ('getlex', q(BATTLE)), ('getproperty', cache), ('getlocal_1',),
            ('getlocal', 4), ('setproperty', x),
            ('label', 'BUCKET'), ('getlex', q(BATTLE)), ('getlocal_1',),
            ('getlocal_3',), ('callproperty', source_id, 2), ('setlocal', 9),
            ('getlocal', 9), n(0), ('iflt', 'CACHE_FALLBACK'),
            e.string('wfx_pf4_'), ('getlocal', 9), ('add',), ('setlocal', 8),
            ('getlocal', 6), ('getlocal', 8),
            ('callproperty', q('pinball.master.runtime:MasterMap::exists'), 1),
            ('iffalse', 'CACHE_FALLBACK'),
            n(100), *red(), ('newarray', 2), ('setlocal', 5),
            ('getlocal', 6), ('getlocal', 8),
            ('callproperty', q('pinball.master.runtime:MasterMap::get'), 1),
            ('getproperty', q('string')), ('coerce_s',), ('setlocal', 8),
            ('getlocal', 8), ('iffalse', 'SAVE'),
            ('getlocal', 8), e.string(':'),
            ('callproperty', q('http://adobe.com/AS3/2006/builtin::split'), 1),
            ('setlocal', 8), ('getlex', q(BATTLE)),
            ('getlocal', 8), n(0), ('getproperty', x), n(10), n(2147483647),
            ('callproperty', q('wfxPfParseUInt'), 3), ('setlocal', 7),
            ('getlocal', 7), n(0), ('iflt', 'COLOR'),
            ('getlocal', 5), n(0), ('getlocal', 7), ('setproperty', x),
            ('label', 'COLOR'), ('getlocal', 8), ('getproperty', q('length')),
            n(2), ('ifne', 'SAVE'),
            ('getlocal', 8), n(1), ('getproperty', x), ('setlocal', 8),
            ('getlocal', 8), ('getproperty', q('length')), n(6), ('ifne', 'SAVE'),
            ('getlex', q(BATTLE)), ('getlocal', 8), n(16), n(16777215),
            ('callproperty', q('wfxPfParseUInt'), 3), ('setlocal', 7),
            ('getlocal', 7), n(0), ('iflt', 'SAVE'),
            ('getlocal', 5), n(1), ('getlocal', 7), ('setproperty', x),
            ('jump', 'SAVE'),
            ('label', 'CACHE_FALLBACK'), ('getlex', q(BATTLE)),
            ('getlocal_1',), ('getlocal_2',), ('callproperty', q('wfxPf4Config'), 2),
            ('setlocal', 5),
            ('label', 'SAVE'), ('getlocal', 4), ('getlocal_3',), ('getlocal', 5),
            ('setproperty', x), ('getlocal', 5), ('returnvalue',),
            ('label', 'CACHED'), ('returnvalue',),
            ('label', 'FALLBACK'), ('getlex', q(BATTLE)),
            ('getlocal_1',), ('getlocal_2',), ('callproperty', q('wfxPf4Config'), 2),
            ('returnvalue',)]
    return e.add_method(BATTLE, 'wfxPf4SourceConfig', 'Array',
                        ['Object', 'Object', 'int'], code, 10, static=True)


def install_display(e):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    cache = e.add_slot(BATTLE, 'wfxPf4DisplayCache', 'Object', static=True)
    refresh = e.add_method(BATTLE, 'wfxPf4Display', 'Array', ['Object', 'Object'], [
        ('getlocal_0',), ('pushscope',), ('getlocal_1',), ('iffalse', 'NONE'),
        ('getlocal_1',), ('getproperty', q('squadManager')), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        ('getlocal_3',), ('getproperty', q('primary')), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        ('getlocal_3',), n(0), ('callproperty', q('getMemberAt'), 1), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        ('getlocal_3',), ('getproperty', q('index')), n(0), ('ifne', 'NONE'),
        ('getlocal_3',), ('getproperty', q('params')), n(0), ('getproperty', x),
        ('coerce_a',), ('callproperty', e.newq('wfxPf4State'), 0), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        ('getlocal_3',), n(2), ('getproperty', x),
        ('getlocal_3',), n(3), ('getproperty', x), ('newarray', 2), ('setlocal_3',),
        ('jump', 'SAVE'), ('label', 'NONE'), ('pushnull',), ('setlocal_3',),
        ('label', 'SAVE'), ('getlocal_1',), ('iffalse', 'RETURN'),
        ('getlex', q(BATTLE)), ('getproperty', cache), ('iftrue', 'CACHE'),
        ('getlex', q(BATTLE)), ('findpropstrict', q('flash.utils::Dictionary')),
        ('pushtrue',), ('constructprop', q('flash.utils::Dictionary'), 1),
        ('setproperty', cache),
        ('label', 'CACHE'), ('getlex', q(BATTLE)), ('getproperty', cache),
        ('getlocal_1',), ('getlocal_3',), ('setproperty', x),
        ('label', 'RETURN'), ('getlocal_3',), ('returnvalue',)], 4, static=True)
    # Called only at the original ten-frame activation gate above. Between those
    # gates, threshold and color must use that same snapshot, including null.
    cached = e.add_method(BATTLE, 'wfxPf4DisplayCached', 'Array', ['Object', 'Object'], [
        ('getlocal_0',), ('pushscope',),
        ('getlex', q(BATTLE)), ('getproperty', cache), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        ('getlocal_3',), ('getlocal_1',), ('getproperty', x), ('coerce', q('Array')),
        ('returnvalue',), ('label', 'NONE'), ('pushnull',), ('returnvalue',)], 4, static=True)
    return refresh, cached
