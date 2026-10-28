"""Restore and loading-boundary splices; validation executes in existing methods."""
import asm
from bootstrap import sha
from c1_lookup import number
from c2_common import get, queue
from c22_restore_views import views, relevant

READ = 'BattleHeaderReadRestore$/readString'
RESTORE = 'SingleBattleRestoreLoadingTask/restoreInput'
LOAD = 'MultiQuestStartLoadingTask/remoteFinishedHandler'
LOCKS = {
    READ: 'c66170a3a0d728d8c5d10aca5c58274987b88b4a424246f4f18fc544f9e33c26',
    RESTORE: 'e991b6513a99b14790970cec7308fcbaece90ceff60eb0ebc2724428d8e30292',
}


def abort(e, message):
    return [('getlex', e.q('pinball.error::ClientError')), number(e, 6800),
            e.string(message), ('construct', 2), ('throw',)]


def assets(e):
    return [('getlocal_0',), ('getproperty', e.q('globalLogic')),
            ('callproperty', e.q('getLogicAssets'), 0)]


def validate_views(e, values, first, fail, done, tag, catalog, check_assets=False):
    from c22_protocol_validate import validate
    scan, first = relevant(e, values, first, tag + '_active', done, tag + '_scan')
    code = scan + [('label', tag + '_active')]
    parts, v = views(e, values, first, fail, tag + '_views')
    code += parts
    parts, a = validate(e, v['roster'], v['next_local'], fail, tag + '_all', catalog,
                        assets=assets(e) if check_assets else None, source=True)
    code += parts
    parts, b = validate(e, v['ordered'], a['next_local'], fail, tag + '_split', catalog,
                        assets=assets(e) if check_assets else None, source=True)
    code += parts
    for key in ('snapshot', 'canonical', 'mode', 'has_context', 'reason'):
        code += [('getlocal', a[key]), ('getlocal', b[key]), ('ifne', fail)]
    return code


def read_string(e, catalog):
    body = e.body(READ)
    assert sha(body[5]) == LOCKS[READ]
    ops = asm.decode(body[5])
    assert ops[8].name == 'callproperty' and e.abc.mn_name(ops[8].args[0]) == 'parseWithInfo'
    assert ops[10].name == 'returnvalue'
    header, value = body[2], body[2] + 1
    done, fail = 'c22_read_done', 'c22_read_fail'
    code = [('setlocal', header), ('getlocal', header), ('getproperty', e.q('index')),
            number(e, 1), ('ifne', done), ('getlocal', header), ('getproperty', e.q('params')),
            number(e, 0), ('getproperty', 14), ('setlocal', value)]
    code += validate_views(e, value, value + 1, fail, done, 'c22_read', catalog)
    code += [('jump', done), ('label', fail), *abort(e, '裂罅联机恢复快照无效'),
             ('label', done), ('getlocal', header)]
    return queue(e, READ, code, 10)


def restore_input(e, catalog):
    body = e.body(RESTORE)
    assert sha(body[5]) == LOCKS[RESTORE]
    ops = asm.decode(body[5])
    assert ops[89].name == 'setlocal' and ops[89].args == [8]
    done, fail = 'c22_restore_done', 'c22_restore_fail'
    code = validate_views(e, 8, body[2], fail, done, 'c22_restore', catalog, True)
    code += [('jump', done), ('label', fail), *abort(e, '裂罅联机恢复快照或资源无效'), ('label', done)]
    return queue(e, RESTORE, code, 90)


def loading(e, catalog):
    from c22_protocol_validate import validate
    body = e.body(LOAD)
    roster, committed = body[2], body[2] + 1
    fail, done = 'c22_load_fail', 'c22_load_continue'
    code = [('getlocal_0',), ('getproperty', e.q('mates')), ('setlocal', roster)]
    parts, out = validate(e, roster, committed + 1, fail, 'c22_load', catalog, assets=assets(e))
    code += parts + [('getlocal_0',), ('getproperty', e.q('continuationData')), ('iffalse', fail),
                    ('getlocal_0',), ('getproperty', e.q('continuationData')),
                    *get(e, 'wfr2_committed'), ('setlocal', committed),
                    ('getlocal', out['has_context']), ('iftrue', 'c22_load_p2'),
                    ('getlocal', committed), ('iftrue', fail), ('jump', done),
                    ('label', 'c22_load_p2'),
                    ('getlocal', committed), ('iffalse', fail)]
    for key in ('snapshot', 'canonical', 'reason'):
        code += [('getlocal', committed), *get(e, key), ('getlocal', out[key]), ('ifne', fail)]
    code += [('jump', done), ('label', fail), *abort(e, '裂罅联机加载快照不一致'), ('label', done)]
    return queue(e, LOAD, code)


def apply(e, catalog):
    result = {READ: read_string(e, catalog), RESTORE: restore_input(e, catalog), LOAD: loading(e, catalog)}
    assert not e.new_methods and not e.traits
    return {'methods': result, 'full_multi_views_compared': True,
            'restore_failure_code': 6800, 'read_failure_caught_by_existing_readHeaderFile': True}
