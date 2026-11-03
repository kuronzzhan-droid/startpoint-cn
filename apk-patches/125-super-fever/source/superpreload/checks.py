"""逐条比较旧路由，并覆盖五处入口、六色资源、派生图标和安全缺表。"""
from .runtime import World
from .patches import TOTAL

E,S,MARK,OLD = 910060,910061,910063,180000


def rows():
    return {E:{'string_id':f'wfx:60:{S}:10000:10:E','icon_image':'existing/E'},
            S:{'string_id':f'wfx:61:0:2000:{MARK}:S','icon_image':'existing/S'},
            MARK:{'string_id':'existing_marker','icon_image':'existing/MARK'},
            OLD:{'string_id':'unique_rolf_wt26_super_fever','icon_image':'battle/common/unique_condition/unique_fire_dragon_zenith'}}


def behavior(old,new,overrides=None):
    checks=[];executed=set()
    def check(name,actual,expected):
        assert actual==expected,(name,actual,expected)
        checks.append(name)
    def world(abc,data=None):
        h=World(abc,rows() if data is None else data,overrides=overrides if abc is new else None)
        return h
    def finish(h):executed.update(h.executed)
    # 预期动画由输入SWF原生EnemyDamage分支直接生成，逐色、逐项比较。
    native=[]
    for color in range(6):
        a,b=world(old),world(new)
        a.native_damage(color);b.native_damage(color)
        check(f'legacy.EnemyDamage.color{color}',b.paths,a.paths)
        native.extend(a.paths);finish(b)
    expected_animation=set(native)
    check('native.animation_count',len(expected_animation),19)
    routes=[('instant0',lambda h,u:h.instant(0,u)),('instant1',lambda h,u:h.instant(1,u)),
            ('instant6',lambda h,u:h.instant(6,u)),('instant7',lambda h,u:h.instant(7,u)),
            ('instant8',lambda h,u:h.instant(8,u)),('condition',lambda h,u:h.condition(u)),
            ('dsl',lambda h,u:h.dsl(u))]
    for route,call in routes:
        for text in ['unique_rolf_wt26_super_fever','ordinary_marker','wfx:62:0:500:0:bonus','wfx:59:0:1:0:other','wfx:60:bad','']:
            data=rows();data[OLD]['string_id']=text
            a,b=world(old,data),world(new,data)
            call(a,OLD);call(b,OLD)
            check(f'legacy.{route}.{text}',b.paths,a.paths);finish(b)
        for uid in [E,S]:
            h=world(new);call(h,uid)
            own=('image',rows()[uid]['icon_image'])
            extras={('image','existing/S'),('image','existing/MARK')}
            actual=set(h.paths);expected=expected_animation|extras|{own}
            if route in ('instant6','instant7','instant8'):expected.add(('animation','native/generic/31'))
            check(f'super.{route}.{uid}',actual,expected);finish(h)
    # 非Unique分支不得进入原ifne目标处追加代码（SKIP语义）。
    for branch in [0,1,6,7,8]:
        for kind in [0,3,14,30,32,41]:
            a,b=world(old),world(new)
            a.instant(branch,OLD,kind);b.instant(branch,OLD,kind)
            check(f'legacy.non_unique.{branch}.{kind}',b.paths,a.paths);finish(b)
    for kind in [0,14,32,37]:
        a,b=world(old),world(new);a.dsl(OLD,kind);b.dsl(OLD,kind)
        check(f'legacy.dsl.non_unique.{kind}',b.paths,a.paths);finish(b)
    # 新入口安全边界及同一asset的缺失后重试。
    for missing in ['E','S','marker','wrong_S','zero_marker','empty_icon','unloaded']:
        d=rows()
        if missing=='E':del d[E]
        if missing=='S':del d[S]
        if missing=='marker':del d[MARK]
        if missing=='wrong_S':d[S]['string_id']='ordinary'
        if missing=='zero_marker':d[S]['string_id']='wfx:61:0:2000:0:S'
        if missing=='empty_icon':d[MARK]['icon_image']=''
        h=World(new,d,missing!='unloaded',overrides);h.helper(E)
        expected=set() if missing in ['E','unloaded'] else set(expected_animation)
        if missing not in ['E','S','wrong_S','unloaded']:expected.add(('image','existing/S'))
        check('missing.'+missing,set(h.paths),expected);finish(h)
    for target in ['table','marker']:
        d=rows();saved=d.get({'E':E,'S':S,'marker':MARK}.get(target,-1))
        if target!='table':del d[{'E':E,'S':S,'marker':MARK}[target]]
        h=World(new,d,target!='table',overrides);h.helper(E);h.paths.clear()
        if target=='table':h.loaded=True
        else:h.table[{'E':E,'S':S,'marker':MARK}[target]]=saved
        h.helper(E)
        check('retry.'+target,set(h.paths),expected_animation|{('image','existing/S'),('image','existing/MARK')});finish(h)
    # 资产容器切换后不能串旧的S/marker关系。
    h=world(new);h.helper(E);h.paths.clear();h.table=rows();h.table[S]['string_id']='wfx:61:0:2000:0:new'
    h.asset={'getMasterTableMaybe':h._table};h.helper(E)
    check('asset.identity',set(h.paths),expected_animation|{('image','existing/S')});finish(h)
    return {'checks':checks,'executed_methods':sorted(executed),'native_animations':sorted(expected_animation)}
