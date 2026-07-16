"""Detect (log-only) duplicate Garmin activities left by past sync races.

When hevy2garmin syncs a workout before its Garmin watch activity has landed, it
uploads a fresh activity; the watch copy appears later and the user has two
activities for one workout. This module finds those pairs and logs them. It does
NOT delete anything — deletion is a separate, opt-in feature.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from hevy2garmin.fit import _parse_timestamp

logger = logging.getLogger("hevy2garmin")


def detect_duplicates(client, workouts: list[dict], limiter=None) -> list[dict]:
    """Return a list of duplicate descriptors, one per workout window that holds
    both a tool-created (manufacturer DEVELOPMENT) and a watch (other
    manufacturer) activity. Best-effort: never raises."""
    dups: list[dict] = []
    for workout in workouts:
        try:
            start = _parse_timestamp(workout.get("start_time") or workout.get("startTime", ""))
            end = _parse_timestamp(workout.get("end_time") or workout.get("endTime", ""))
            if start is None or end is None:
                continue
            # Normalize to naive UTC for comparison so Garmin's naive GMT strings
            # (no offset) and workout's aware UTC strings can be compared safely.
            start_naive = start.replace(tzinfo=None)
            end_naive = end.replace(tzinfo=None)
            date_str = str(workout.get("start_time") or "")[:10]
            call = (limiter.call if limiter is not None else (lambda f, *a: f(*a)))
            acts = call(client.get_activities_by_date, date_str, date_str)
            tool_id = watch_id = None
            for act in acts or []:
                a_start = _parse_timestamp(act.get("startTimeGMT") or act.get("startTimeLocal", ""))
                a_dur = act.get("duration", 0) or 0
                if a_start is None or a_dur <= 0:
                    continue
                # Normalize activity timestamps to naive UTC as well.
                a_start_naive = a_start.replace(tzinfo=None)
                a_end_naive = a_start_naive + timedelta(seconds=a_dur)
                if a_start_naive > end_naive or a_end_naive < start_naive:
                    continue
                manufacturer = str(act.get("manufacturer") or "").upper()
                if manufacturer == "DEVELOPMENT":
                    tool_id = act.get("activityId")
                elif manufacturer:
                    watch_id = act.get("activityId")
            if tool_id is not None and watch_id is not None:
                dup = {"workout_id": workout.get("id"),
                       "workout_title": workout.get("title"),
                       "tool_activity_id": tool_id,
                       "watch_activity_id": watch_id}
                logger.warning(
                    "  ⚠ Duplicate for workout %s: tool activity %s + watch activity %s",
                    dup["workout_id"], tool_id, watch_id,
                )
                dups.append(dup)
        except Exception:
            logger.debug("duplicate detection skipped for a workout", exc_info=True)
            continue
    return dups
