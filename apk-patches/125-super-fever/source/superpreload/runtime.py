"""真实预载整方法与新增方法解释执行；资产读表/收集器为外围替身。"""
from superfever.base_runtime import Harness, VM


def enum(index, *params):
    return {'index':index,'params':list(params)}


class World(Harness):
    def __init__(self, abc, rows, loaded=True, overrides=None):
        super().__init__(abc, rows, loaded, overrides)
        self.paths, self.executed = [], set()
        self.builder = {'addImage':lambda p:self.paths.append(('image',p)),
                        'addAnimationLayout':lambda p:self.paths.append(('animation',p))}
        self.asset['getMasterTable'] = self._table
        self.lex.update({'Boot':{'skip_constructor':False},
                         'InahoAbilityVisuals':{'preload':lambda *a:None},
                         'UniqueConditionLogic':VM.Cls('UniqueConditionLogic',ctor=self.unique),
                         'ConditionChangeContentTools':{'resolveGenericConditionHitEffect':lambda c,b:'native/generic/'+str(c['index'])},
                         'InstantAbilitySource':{}})
        for kind in ('Hit','Player','Shot'):
            name='getAbilityDamage'+kind+'Effect'
            self.lex['InstantAbilitySource'][name]=lambda n,name=name:self.run('InstantAbilitySource$/'+name,self.lex['InstantAbilitySource'],n)

    def _get(self, uid):
        self.calls['get'] += 1
        return self.table[uid]

    def run(self, label, this, *args):
        self.executed.add(label)
        return super().run(label,this,*args)

    def unique(self, uid, assets):
        obj={}
        self.bind(obj,'UniqueConditionLogic',['get_iconImage','resolvePathCollection','wfxSuperPreload','wfxSuperPreloadIcon'])
        self.run('UniqueConditionLogic/<ctor>',obj,uid,assets)
        return obj

    def helper(self, uid):
        # 可在表尚未加载时单独调用新增入口；不调用原生强制读表构造器。
        obj={'id':uid}
        self.bind(obj,'UniqueConditionLogic',['wfxSuperPreload','wfxSuperPreloadIcon'])
        self.run('UniqueConditionLogic/wfxSuperPreload',obj,self.builder,self.asset)

    def source(self, content):
        obj={'content':content,'logicAssets':self.asset}
        self.bind(obj,'InstantAbilitySource',['resolveConditionPathCollection'])
        return obj

    def instant(self, branch, uid, condition_index=31):
        condition=enum(condition_index,uid)
        content=enum(branch,None,condition) if branch==0 else enum(branch,condition)
        self.run('InstantAbilitySource/resolvePathCollection',self.source(content),self.builder,None,None,0)

    def condition(self, uid, kind=31):
        self.run('InstantAbilitySource/resolveConditionPathCollection',self.source(None),self.builder,enum(kind,uid))

    def dsl(self, uid, kind=31):
        params=[None,[enum(kind,uid)],None,enum(0),None,None,None,None]
        obj={'logicAssets':self.asset,'paths':self.builder,'addAnimationLayout':self.builder['addAnimationLayout']}
        self.run('ActionDslAssetResolver/eval',obj,enum(2,enum(21,*params)))

    def native_damage(self, color, kind=13):
        inner=enum(kind,color) if kind==13 else enum(kind,None,color)
        self.run('InstantAbilitySource/resolvePathCollection',self.source(enum(4,None,inner)),self.builder,None,None,0)
