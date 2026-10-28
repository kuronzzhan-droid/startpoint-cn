"""Coop teammate effect suppression client patch (P1-P4)."""
from .patch import TARGETS, build, lock_for_abc, verify_anchors

__all__ = ["TARGETS", "build", "lock_for_abc", "verify_anchors"]
