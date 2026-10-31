"""在第二版助手全部追加之后再尾增CT资源；两处均指令级可逆拼接。"""
import copy
import asm
from perf2_core import splice_with_exits
from framework import sha
from static_check import check_body
from . import ct_state, ct_record

TICK = 'MemberImpl$/wfxHealDamageTick'
DAMAGE = 'MemberImpl/wfxHealAnyDamage'
ADDED = ['MemberImpl$/wfxHealAnyCTQueue', 'MemberImpl$/wfxHealAnyCTTick',
         'MemberImpl/wfxHealAnyCTRecord']
SECOND_DAMAGE_SHA = '460581f38184615d7581f23a6182b96de844531a29298fa818db20f0e0f23ad3'
SECOND_DAMAGE_HEADER = [5, 10, 1, 2]


def install(e, m, value):
    queue, battle, pending = ct_state.queue(e, m)
    tick = ct_state.tick(e, m, battle, pending)
    record = ct_record.install(e, m, queue, value)
    e.insert(TICK, 2, [('getlocal_0',), ('getlocal_1',), ('callpropvoid', tick, 1)])
    old = copy.deepcopy(e.body(DAMAGE))
    # Existing second-edition generated helper is locked independently as well.
    assert sha(old[5]) == SECOND_DAMAGE_SHA and old[1:5] == SECOND_DAMAGE_HEADER, 'second-edition Damage SHA/header'
    source = [('getlocal_0',), ('getlocal_1',), ('getlocal_2',), ('getlocal_3',),
              ('getlocal', 4), ('callproperty', record, 4), ('iffalse', 'OLD'),
              ('returnvoid',), ('label', 'OLD'), ('label', 'END')]
    raw, exc, _, count = splice_with_exits(old, 2, source, {}, asm.ENTER)
    assert asm.unsplice_many(raw, [(2, count, asm.ENTER)]) == old[5]
    body = e.body(DAMAGE)
    body[5], body[6] = raw, exc
    body[1] = max(body[1], 5)
    checks = check_body(e.abc, body)
    metadata = next(row for row in e.new_methods if row['label'] == DAMAGE)
    metadata.update(sha256=sha(raw), header=body[1:5], static_check=checks,
                    second_edition_sha256=SECOND_DAMAGE_SHA, ct_insertions=[(2, count, asm.ENTER)])
