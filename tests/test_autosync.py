"""Tests for auto-sync helpers in server.py."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import MagicMock, patch

import pytest

from hevy2garmin import server
from hevy2garmin.server import (
    _acquire_sync_lock,
    _build_sync_workflow_yaml,
    _format_interval_label,
    _minutes_to_cron,
    _sync_executing,
)


class TestMinutesToCron:
    @pytest.mark.parametrize(
        "minutes,expected",
        [
            (30, "*/30 * * * *"),
            (60, "0 * * * *"),
            (120, "0 */2 * * *"),
            (240, "0 */4 * * *"),
            (360, "0 */6 * * *"),
            (720, "0 */12 * * *"),
            (1440, "0 0 * * *"),
        ],
    )
    def test_supported_intervals(self, minutes: int, expected: str) -> None:
        assert _minutes_to_cron(minutes) == expected

    def test_fallback_for_unexpected_value(self) -> None:
        # Anything not on the supported list falls back to every-2-hours
        assert _minutes_to_cron(45) == "0 */2 * * *"
        assert _minutes_to_cron(0) == "0 */2 * * *"


class TestFormatIntervalLabel:
    @pytest.mark.parametrize(
        "minutes,expected",
        [
            (30, "30 minutes"),
            (60, "1 hour"),
            (120, "2 hours"),
            (240, "4 hours"),
            (1440, "24 hours"),
        ],
    )
    def test_label(self, minutes: int, expected: str) -> None:
        assert _format_interval_label(minutes) == expected


class TestBuildSyncWorkflowYaml:
    def test_cron_reflects_interval(self) -> None:
        yml = _build_sync_workflow_yaml(30)
        assert "cron: '*/30 * * * *'" in yml

    def test_default_2h(self) -> None:
        yml = _build_sync_workflow_yaml(120)
        assert "cron: '0 */2 * * *'" in yml

    def test_24h(self) -> None:
        yml = _build_sync_workflow_yaml(1440)
        assert "cron: '0 0 * * *'" in yml

class TestSyncLock:
    def test_acquire_and_release(self) -> None:
        """Lock can be acquired and released without crashing (verifies time module is imported)."""
        assert _acquire_sync_lock() is True
        _sync_executing.release()

    def test_acquire_blocks_second(self) -> None:
        """Second acquire returns False when lock is held."""
        assert _acquire_sync_lock() is True
        assert _acquire_sync_lock() is False  # Already held
        _sync_executing.release()


class TestCronGraceDeferral:
    def test_all_fresh_workouts_are_deferred_without_calling_sync_helper(self) -> None:
        """Cron returns a useful response when every candidate is in grace."""
        workout = {"id": "fresh-1", "title": "Fresh", "exercises": []}
        hevy = MagicMock()
        hevy.get_workout_count.return_value = 1
        database = MagicMock()

        with (
            patch.object(
                server,
                "load_config",
                return_value={
                    "hevy_api_key": "test-key",
                    "sync": {"grace_period_minutes": 120},
                },
            ),
            patch("hevy2garmin.hevy.HevyClient", return_value=hevy),
            patch.object(server.db, "get_db", return_value=database),
            patch.object(server.db, "get_synced_count", return_value=0),
            patch.object(
                server,
                "_scan_for_unsynced",
                side_effect=[(workout, {}), (None, {})],
            ),
            patch("hevy2garmin.sync._workout_within_grace", return_value=True),
            patch("hevy2garmin.sync.sync_one_workout") as sync_one,
        ):
            response = asyncio.run(server._do_sync_one(respect_grace=True))

        assert json.loads(response.body) == {
            "synced": 0,
            "deferred": 1,
            "remaining": 1,
            "done": False,
        }
        sync_one.assert_not_called()


class TestBuildSyncWorkflowYaml:
    def test_workflow_structure_intact(self) -> None:
        """Make sure essential workflow pieces survive any cron change."""
        yml = _build_sync_workflow_yaml(60)
        assert "name: Sync Workouts" in yml
        assert "workflow_dispatch:" in yml
        assert "repository_dispatch:" in yml
        assert "DATABASE_URL: ${{ secrets.DATABASE_URL }}" in yml
        assert "hevy2garmin sync" in yml

    def test_actions_run_on_node_24(self) -> None:
        """Pin the generated workflow to Node-24 action majors so it doesn't
        regress to the deprecated Node-20 versions (checkout@v4, setup-python@v5)."""
        yml = _build_sync_workflow_yaml(120)
        assert "actions/checkout@v5" in yml
        assert "actions/setup-python@v6" in yml
        assert "actions/checkout@v4" not in yml
        assert "actions/setup-python@v5" not in yml


class TestLifespanAutosync:
    """The startup/shutdown hook lives in the app's lifespan (FastAPI dropped
    on_event), so it only fires when TestClient is used as a context manager."""

    def _run(self, config: dict) -> tuple[list[int], list[int]]:
        from fastapi.testclient import TestClient

        scheduled: list[int] = []
        stopped: list[int] = []
        with patch.object(server, "load_config", lambda: config), \
             patch.object(server, "_schedule_autosync", scheduled.append), \
             patch.object(server, "_stop_autosync", lambda: stopped.append(1)):
            with TestClient(server.app):
                pass
        return scheduled, stopped

    def test_enabled_schedules_configured_interval(self) -> None:
        scheduled, _ = self._run({"auto_sync": {"enabled": True, "interval_minutes": 45}})
        assert scheduled == [45]

    def test_enabled_without_interval_defaults_to_30(self) -> None:
        scheduled, _ = self._run({"auto_sync": {"enabled": True}})
        assert scheduled == [30]

    def test_disabled_schedules_nothing(self) -> None:
        scheduled, _ = self._run({"auto_sync": {"enabled": False}})
        assert scheduled == []

    def test_missing_config_schedules_nothing(self) -> None:
        scheduled, _ = self._run({})
        assert scheduled == []

    def test_shutdown_cancels_timer(self) -> None:
        """A surviving timer could fire a sync against a torn-down process."""
        _, stopped = self._run({"auto_sync": {"enabled": True, "interval_minutes": 60}})
        assert stopped == [1]

    def test_shutdown_cancels_even_when_autosync_disabled(self) -> None:
        _, stopped = self._run({"auto_sync": {"enabled": False}})
        assert stopped == [1]


class TestAutosyncLoop:
    """The loop is an asyncio task (it used to be a chain of threading.Timers),
    so sleeping, rescheduling and stopping are all driven from the event loop."""

    @staticmethod
    def _run_loop(returns: list[int | None], sleeps: list[float]) -> None:
        """Drive _autosync_loop with instant sleeps and canned sync results."""
        pending = list(returns)

        async def fake_sleep(seconds):
            sleeps.append(seconds)

        async def fake_threadpool(fn):
            return pending.pop(0)

        with patch.object(server.asyncio, "sleep", fake_sleep), \
             patch.object(server, "run_in_threadpool", fake_threadpool):
            asyncio.run(server._autosync_loop(30))

    def test_sleeps_the_interval_before_first_sync(self) -> None:
        sleeps: list[float] = []
        self._run_loop([None], sleeps)
        assert sleeps == [30 * 60]

    def test_stops_when_sync_returns_none(self) -> None:
        """None means auto-sync was disabled or the Hevy key is invalid."""
        sleeps: list[float] = []
        self._run_loop([None], sleeps)
        assert len(sleeps) == 1  # did not loop again

    def test_keeps_looping_while_sync_returns_an_interval(self) -> None:
        sleeps: list[float] = []
        self._run_loop([30, 30, None], sleeps)
        assert sleeps == [1800, 1800, 1800]

    def test_picks_up_a_changed_interval(self) -> None:
        """A new interval from the config applies to the next sleep."""
        sleeps: list[float] = []
        self._run_loop([120, None], sleeps)
        assert sleeps == [30 * 60, 120 * 60]

    def test_cancellation_stops_the_loop(self) -> None:
        async def scenario():
            task = asyncio.create_task(server._autosync_loop(60))
            await asyncio.sleep(0)  # let it reach the first await
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        asyncio.run(scenario())


def _really_acquire() -> bool:
    """Stand in for _acquire_sync_lock but take the real lock, so the
    ``finally: release()`` under test has something to release."""
    return server._sync_executing.acquire(blocking=False)


class TestRunAutosyncOnce:
    """_run_autosync_once returns the next interval, or None to stop the loop."""

    def test_returns_none_when_disabled(self) -> None:
        with patch.object(server, "load_config", lambda: {"auto_sync": {"enabled": False}}):
            assert server._run_autosync_once() is None

    def test_returns_none_when_config_missing(self) -> None:
        with patch.object(server, "load_config", lambda: {}):
            assert server._run_autosync_once() is None

    def test_returns_interval_without_syncing_when_lock_held(self) -> None:
        """A sync already in flight must not be joined, but the loop continues."""
        cfg = {"auto_sync": {"enabled": True, "interval_minutes": 45}}
        called = []
        with patch.object(server, "load_config", lambda: cfg), \
             patch.object(server, "_acquire_sync_lock", lambda: False), \
             patch.object(server, "sync", lambda **kw: called.append(kw)):
            assert server._run_autosync_once() == 45
        assert called == []

    def test_returns_interval_after_a_successful_sync(self) -> None:
        cfg = {"auto_sync": {"enabled": True, "interval_minutes": 90}}
        result = {"synced": 2, "skipped": 0, "failed": 0}
        with patch.object(server, "load_config", lambda: cfg), \
             patch.object(server, "_acquire_sync_lock", _really_acquire), \
             patch.object(server, "sync", lambda **kw: result), \
             patch.object(server, "_record_sync_log", lambda *a, **k: None):
            assert server._run_autosync_once() == 90
        # the lock must be free again for the next run
        assert server._sync_executing.acquire(blocking=False)
        server._sync_executing.release()

    def test_releases_lock_when_sync_raises(self) -> None:
        cfg = {"auto_sync": {"enabled": True, "interval_minutes": 30}}

        def boom(**kw):
            raise RuntimeError("hevy down")

        with patch.object(server, "load_config", lambda: cfg), \
             patch.object(server, "_acquire_sync_lock", _really_acquire), \
             patch.object(server, "sync", boom), \
             patch.object(server, "_record_sync_log", lambda *a, **k: None):
            assert server._run_autosync_once() == 30
        assert server._sync_executing.acquire(blocking=False)
        server._sync_executing.release()

    def test_stops_loop_when_hevy_key_is_invalid(self) -> None:
        """A bad key would fail every cycle, so the loop must stop, not spin."""
        from hevy2garmin.hevy import HevyAuthError

        cfg = {"auto_sync": {"enabled": True, "interval_minutes": 30}}
        saved: list[dict] = []

        def boom(**kw):
            raise HevyAuthError("401")

        with patch.object(server, "load_config", lambda: cfg), \
             patch.object(server, "_acquire_sync_lock", _really_acquire), \
             patch.object(server, "sync", boom), \
             patch.object(server, "save_config", saved.append), \
             patch.object(server.db, "get_database_url", lambda: None), \
             patch.object(server, "_record_sync_log", lambda *a, **k: None):
            assert server._run_autosync_once() is None
        assert saved and saved[0]["auto_sync"]["enabled"] is False
