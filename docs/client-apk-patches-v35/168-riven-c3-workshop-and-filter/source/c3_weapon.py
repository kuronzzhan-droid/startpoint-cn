"""C3 weapon list entry point: single-method inline splices only."""
from c3_weapon_list import queue_list
from c3_weapon_actions import queue_actions
from c3_weapon_view import queue_view


def queue_weapon_splices(e):
    result = {}
    for fn in (queue_list, queue_actions, queue_view):
        result.update(fn(e))
    return result
