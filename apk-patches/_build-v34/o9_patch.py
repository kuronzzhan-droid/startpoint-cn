"""Archive 109 / O9: refuse overlimit confirmation without paradox core."""
from overlimit_patch_plugin import apply_selected


def apply(source, target, work):
    return apply_selected(source, target, work, 'O9')
