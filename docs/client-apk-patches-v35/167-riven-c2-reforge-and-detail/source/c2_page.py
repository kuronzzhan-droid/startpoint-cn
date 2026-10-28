"""C2 page patch orchestration; existing method bodies only."""
from c2_page_entry import queue_entry
from c2_page_logic import queue_logic
from c2_page_view import queue_view


def queue_page_splices(e):
    queued = {}
    for builder in (queue_entry, queue_logic, queue_view):
        additions = builder(e)
        assert not queued.keys() & additions.keys()
        queued.update(additions)
    return {'queued': queued, 'dto': 'Array<{mode:wfx_riven,rarity:5,description}>',
            'context': 'ExBoost second argument Some(context) -> loadedData.wfx_riven',
            'normal_ex': 'All mode-guarded prefixes fall through to original bytes'}
