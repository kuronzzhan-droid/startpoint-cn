"""Archive 110 / O11: display both overlimit costs and owned quantities."""
from overlimit_patch_plugin import apply_selected


def apply(source, target, work):
    return apply_selected(source, target, work, 'O11')
