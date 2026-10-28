"""C22 existing-method protocol splices, with a shared build-time emitter."""
from c22_protocol_room import apply as room_apply
from c22_protocol_updates import apply as updates_apply


def apply(e):
    return {**room_apply(e), **updates_apply(e)}
