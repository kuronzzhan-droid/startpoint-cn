"""码34全敌能力弹沿码30预载19种原生资源。"""
import sys
import bootstrap
sys.path.append(str(bootstrap.ROOT.parent/'run3'))
from superpreload.runtime import World


def suite(before, after):
    uid = 910034
    checks = []
    def world(abc, code):
        return World(abc, {uid:{'string_id':f'wfx:{code}:50:100000:150000:hidden_any',
                              'icon_image':'native/test/icon'}})
    native = world(before, 30)
    native.helper(uid)
    assert len(set(native.paths)) == 19
    for code in [30,31,32,35,60,61]:
        old,new=world(before,code),world(after,code)
        old.helper(uid);new.helper(uid)
        assert new.paths==old.paths,code
        checks.append('preload-old.'+str(code))
    for route in ['helper','condition','dsl','instant0','instant1','instant6','instant7','instant8']:
        h=world(after,34)
        if route.startswith('instant'): h.instant(int(route[-1]),uid)
        else: getattr(h,route)(uid)
        assert set(native.paths).issubset(set(h.paths)),(route,h.paths)
        checks.append('preload34.'+route)
    return checks
