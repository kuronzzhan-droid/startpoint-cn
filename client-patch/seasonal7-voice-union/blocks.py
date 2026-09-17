"""Voice-only insertions. Existing skill-switch conditions remain authoritative."""
ROSTER = {
    139994: 'rec_android_seaside', 139993: 'super_robot_tailcoat',
    159998: 'samurai_robot_plum', 159997: 'guildknight_leader_tavern',
    159996: 'wind_oracle_yukata', 169992: 'blackflower_wiz_yukata',
    129991: 'psychic_yuki_swim',
}


def guard_ids(pool):
    out=[]
    for cid in ROSTER:
        out += [('getlocal_0',), ('getproperty',7439), ('pushint',pool.integer(cid)), ('ifeq','ENABLED')]
    return out+[('jump','END'),('label','ENABLED')]


def ready(pool):
    out=[]
    for code in ROSTER.values():
        out += [('getlocal_0',),('getproperty',9733),('getproperty',15727),
                ('pushstring',pool.string(code)),('ifeq','ENABLED')]
    out += [('jump','END'),('label','ENABLED'),('getlocal',4),('getproperty',46),
            ('pushbyte',0),('ifne','END')]
    # Use the native-selected path. Appending _alt cannot change normal/matched routing.
    path=[('getlocal',4),('getproperty',80),('pushbyte',0),('getproperty',14),
          ('pushstring',pool.string('_alt')),('add',),('coerce',11)]
    out += [('getlocal_0',),('getproperty',9733),('getproperty',9604),('getproperty',7746)]
    out += path+[('callproperty',8215,1),('iffalse','END')]
    # random()*2 -> 0 or 1, giving each recording equal probability.
    out += [('getlex',83),('callproperty',277,0),('pushbyte',2),('multiply',),
            ('convert_i',),('iffalse','END'),('getlex',79)]
    out += path+[('callproperty',241,1),('coerce',79),('setlocal',4),('label','END')]
    return out


def preload(pool):
    out=[]
    for i,(cid,code) in enumerate(ROSTER.items()):
        out += [('getlocal',5),('getproperty',7439),('pushint',pool.integer(cid)),('ifne',f'ROLE{i}')]
        for j,slot in enumerate(['skill_ready_alt','matched_skill_ready_alt']):
            string=pool.string(f'character/{code}/voice/battle/{slot}')
            out += [('getlocal',5),('getproperty',7746),('pushstring',string),
                    ('callproperty',8215,1),('iffalse',f'PATH{i}_{j}'),('getlocal_1',),
                    ('pushstring',string),('callpropvoid',7784,1),('label',f'PATH{i}_{j}')]
        out += [('label',f'ROLE{i}')]
    return out


def speech(pool, *, evolution=False, first_local=4):
    """Collect matching native rows, choose one, construct Speech once for subtitle/audio parity."""
    arr,idx,row=first_local,first_local+1,first_local+2
    out=guard_ids(pool)+[('newarray',0),('setlocal',arr),('pushbyte',0),('setlocal',idx),
        ('jump','CHECK'),('label','LOOP'),('getlocal_0',),('getproperty',7494),
        ('getlocal',idx),('getproperty',14),('coerce',16832),('setlocal',row),('inclocal_i',idx),
        ('getlocal',row),('getproperty',5119),('getproperty',46),('pushbyte',1 if evolution else 2),
        ('ifne','CHECK')]
    if evolution:
        out += [('getlocal',row),('getproperty',5119),('getproperty',80),('pushbyte',0),
                ('getproperty',14),('getproperty',9682),('convert_i',),('getlocal_1',),('ifne','CHECK')]
    out += [('getlocal',arr),('getlocal',row),('callpropvoid',65,1),
        ('label','CHECK'),('getlocal',idx),('getlocal_0',),('getproperty',7494),
        ('getproperty',35),('convert_i',),('iflt','LOOP'),
        ('getlocal',arr),('getproperty',35),('pushbyte',2),('iflt','END'),
        ('findpropstrict',16839),('getlocal_0',),('getproperty',9733),('getlocal',arr),
        ('getlex',83),('callproperty',277,0),('getlocal',arr),('getproperty',35),
        ('multiply',),('convert_i',),('getproperty',14),('coerce',16832),
        ('constructprop',16839,2),('returnvalue',),('label','END')]
    return out
