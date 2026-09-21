"""Translate provider timestamps to the trimmed delivery timeline.

Text matching remains based on the complete original subtitle. Trimming silence
must never hide an inserted word from the content gate.
"""
from __future__ import annotations


def delivery_edges(metrics: dict, qc: dict) -> tuple[float | None, float | None]:
    lead, tail = metrics.get('lead_in_seconds'), metrics.get('tail_seconds')
    trim = qc.get('trim')
    if trim and lead is not None and tail is not None:
        source_seconds = float(metrics.get('duration') or
                               (qc.get('source_pcm') or {}).get('seconds') or 0)
        lead = max(0.0, float(lead) - float(trim['start_seconds']))
        tail = max(0.0, float(tail) - max(0.0, source_seconds - float(trim['end_seconds'])))
    if lead is None or tail is None:
        # New reports measure the actual deliverable; retain legacy fallback.
        pcm = qc.get('mastered_pcm') or {}
        if 'leading_quiet_seconds' not in pcm or 'trailing_quiet_seconds' not in pcm:
            pcm = qc.get('source_pcm') or {}
        lead, tail = pcm.get('leading_quiet_seconds'), pcm.get('trailing_quiet_seconds')
    return (None if lead is None else round(float(lead), 3),
            None if tail is None else round(float(tail), 3))


def delivery_dead_air(metrics: dict, qc: dict) -> float:
    lead, tail = delivery_edges(metrics, qc)
    seconds = float(qc.get('seconds') or metrics.get('duration') or 0)
    if seconds > 0 and lead is not None and tail is not None:
        return min(1.0, (lead + tail) / seconds)
    return float(metrics.get('dead_air_share') or 0)
