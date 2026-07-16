from __future__ import annotations
from unittest.mock import MagicMock


def _act(aid, manufacturer, start="2026-03-15 18:02:00", dur=2580, type_key="strength_training"):
    return {"activityId": aid, "manufacturer": manufacturer,
            "startTimeGMT": start, "startTimeLocal": start,
            "duration": dur, "activityType": {"typeKey": type_key}}


WORKOUT = {"id": "w1", "title": "Push",
           "start_time": "2026-03-15T18:00:00+00:00",
           "end_time": "2026-03-15T18:45:00+00:00"}


def test_detects_tool_plus_watch_pair():
    from hevy2garmin.reconcile import detect_duplicates
    client = MagicMock()
    client.get_activities_by_date.return_value = [
        _act(1, "DEVELOPMENT"), _act(2, "GARMIN"),
    ]
    dups = detect_duplicates(client, [WORKOUT])
    assert len(dups) == 1
    d = dups[0]
    assert d["workout_id"] == "w1"
    assert {d["tool_activity_id"], d["watch_activity_id"]} == {1, 2}


def test_single_activity_is_not_a_duplicate():
    from hevy2garmin.reconcile import detect_duplicates
    client = MagicMock()
    client.get_activities_by_date.return_value = [_act(1, "DEVELOPMENT")]
    assert detect_duplicates(client, [WORKOUT]) == []


def test_never_raises_on_garmin_error():
    from hevy2garmin.reconcile import detect_duplicates
    client = MagicMock()
    client.get_activities_by_date.side_effect = RuntimeError("boom")
    assert detect_duplicates(client, [WORKOUT]) == []
