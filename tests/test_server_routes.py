"""HTTP-level tests for state-mutating routes that had no coverage.

Everything here goes through TestClient rather than calling handlers directly,
so the middleware stack (check_setup, reverse_proxy_prefix, security_headers)
runs too — that is the part unit tests on the handlers cannot reach.

The routes covered here mutate or destroy state: they drop sync records, delete
custom mappings, abandon in-flight uploads, invalidate every session, or turn
auto-sync on and off. Their guard rails (explicit confirmation, id validation,
demo-mode refusal) were previously unverified.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from hevy2garmin import server as srv


@pytest.fixture
def client():
    """Configured, unauthenticated client.

    _is_configured_cache short-circuits the "not configured → /setup" redirect
    that would otherwise swallow every request.
    """
    srv._is_configured_cache = True
    with patch.dict(os.environ, {}, clear=False):
        for k in ("HEVY2GARMIN_SECRET", "H2G_PASSWORD", "H2G_PASSWORD_HASH", "DEMO_MODE",
                  "VERCEL", "GITHUB_PAT"):
            os.environ.pop(k, None)
        yield TestClient(srv.app)


@pytest.fixture
def demo_client():
    """Client with DEMO_MODE on — mutating routes must refuse."""
    srv._is_configured_cache = True
    with patch.dict(os.environ, {"DEMO_MODE": "true"}, clear=False):
        for k in ("HEVY2GARMIN_SECRET", "H2G_PASSWORD"):
            os.environ.pop(k, None)
        yield TestClient(srv.app)


class TestUnsyncOne:
    """POST /api/unsync/{hevy_id} — drops a sync record so it can re-sync."""

    def test_unknown_workout_returns_404(self, client) -> None:
        with patch.object(srv.db, "get_garmin_id", lambda h: None), \
             patch.object(srv.db, "unsync", lambda h: False):
            r = client.post("/api/unsync/nope")
        assert r.status_code == 404
        assert r.json()["ok"] is False

    def test_removes_record_and_clears_cached_pages(self, client) -> None:
        """The workouts page reads cached pages, so they must be invalidated."""
        cleared: list[str] = []

        class FakeDB:
            def set_app_config(self, k, v):
                cleared.append(k)

        with patch.object(srv.db, "get_garmin_id", lambda h: None), \
             patch.object(srv.db, "unsync", lambda h: True), \
             patch.object(srv.db, "get_db", lambda: FakeDB()):
            r = client.post("/api/unsync/w1")
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert cleared == [f"hevy_workouts_page_{p}" for p in range(1, 11)]

    def test_does_not_touch_garmin_unless_asked(self, client) -> None:
        """Without delete_garmin the Garmin activity must survive."""

        class FakeDB:
            def set_app_config(self, k, v):
                pass

        with patch.object(srv.db, "get_garmin_id", lambda h: "g123"), \
             patch.object(srv.db, "unsync", lambda h: True), \
             patch.object(srv.db, "get_db", lambda: FakeDB()):
            r = client.post("/api/unsync/w1")
        assert r.status_code == 200
        assert r.json()["garmin_deleted"] is False


class TestAbandonPending:
    """POST /api/pending/{hevy_id}/abandon — gives up on an in-flight upload.

    Abandoning can leave an orphan activity on Garmin, so it is guarded by an
    explicit confirmation echoing the workout id.
    """

    def test_rejects_malformed_id(self, client) -> None:
        r = client.post("/api/pending/bad%20id!/abandon", data={"confirm": "bad id!"})
        assert r.status_code == 400
        assert "Invalid workout ID" in r.json()["error"]

    def test_requires_confirmation_matching_the_id(self, client) -> None:
        called: list[str] = []
        with patch.object(srv.db, "delete_pending", lambda h: called.append(h) or True):
            r = client.post("/api/pending/w1/abandon", data={"confirm": "w2"})
        assert r.status_code == 400
        assert "Explicit confirmation required" in r.json()["error"]
        assert called == [], "must not delete when confirmation does not match"

    def test_missing_confirmation_is_rejected(self, client) -> None:
        called: list[str] = []
        with patch.object(srv.db, "delete_pending", lambda h: called.append(h) or True):
            r = client.post("/api/pending/w1/abandon")
        assert r.status_code == 400
        assert called == []

    def test_no_pending_operation_returns_404(self, client) -> None:
        with patch.object(srv.db, "delete_pending", lambda h: False):
            r = client.post("/api/pending/w1/abandon", data={"confirm": "w1"})
        assert r.status_code == 404

    def test_correct_confirmation_abandons(self, client) -> None:
        called: list[str] = []
        with patch.object(srv.db, "delete_pending", lambda h: called.append(h) or True):
            r = client.post("/api/pending/w1/abandon", data={"confirm": "w1"})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert called == ["w1"]


class TestDeleteMapping:
    """POST /api/mapping/delete — removes a custom exercise mapping."""

    def test_empty_name_is_rejected(self, client) -> None:
        r = client.post("/api/mapping/delete", data={"hevy_name": "   "})
        assert r.status_code == 200  # HTMX partial, not a JSON error
        assert "required" in r.text.lower()

    def test_deletes_from_db_on_cloud(self, client) -> None:
        """With DATABASE_URL set the mapping lives in the DB, not on disk."""
        deleted: list[str] = []

        class FakeDB:
            def delete_custom_mapping(self, name):
                deleted.append(name)

        with patch.object(srv.db, "get_database_url", lambda: "postgres://x"), \
             patch.object(srv.db, "get_db", lambda: FakeDB()):
            r = client.post("/api/mapping/delete", data={"hevy_name": "Zercher Squat"})
        assert r.status_code == 200
        assert deleted == ["Zercher Squat"]

    def test_deletes_from_disk_when_self_hosted(self, client, tmp_path, monkeypatch) -> None:
        """Self-hosted keeps custom mappings in ~/.hevy2garmin/custom_mappings.json."""
        import json

        home = tmp_path
        monkeypatch.setenv("HOME", str(home))
        cfg = home / ".hevy2garmin"
        cfg.mkdir()
        (cfg / "custom_mappings.json").write_text(
            json.dumps({"Zercher Squat": [3, 4], "Keep Me": [1, 2]})
        )

        with patch.object(srv.db, "get_database_url", lambda: None):
            r = client.post("/api/mapping/delete", data={"hevy_name": "Zercher Squat"})
        assert r.status_code == 200
        left = json.loads((cfg / "custom_mappings.json").read_text())
        assert "Zercher Squat" not in left
        assert left["Keep Me"] == [1, 2], "must not touch other mappings"


class TestToggleAutosync:
    """POST /api/toggle-autosync — starts and stops the auto-sync loop."""

    def _run(self, client, form: dict):
        started: list[int] = []
        stopped: list[int] = []
        saved: list[dict] = []
        with patch.object(srv, "load_config", lambda: {}), \
             patch.object(srv, "save_config", saved.append), \
             patch.object(srv.db, "get_database_url", lambda: None), \
             patch.object(srv, "_schedule_autosync", started.append), \
             patch.object(srv, "_stop_autosync", lambda: stopped.append(1)):
            r = client.post("/api/toggle-autosync", data=form)
        return r, started, stopped, saved

    def test_enabling_starts_the_loop_and_persists(self, client) -> None:
        r, started, stopped, saved = self._run(client, {"enabled": "true", "interval": "60"})
        assert r.status_code == 200
        assert started == [60]
        assert stopped == []
        assert saved[0]["auto_sync"] == {"enabled": True, "interval_minutes": 60}

    def test_disabling_stops_the_loop_and_persists(self, client) -> None:
        r, started, stopped, saved = self._run(client, {"enabled": "false", "interval": "60"})
        assert r.status_code == 200
        assert started == []
        assert stopped == [1]
        assert saved[0]["auto_sync"]["enabled"] is False

    @pytest.mark.parametrize("interval", ["30", "60", "120", "240", "360", "720", "1440"])
    def test_allowed_intervals_pass_through(self, client, interval) -> None:
        _, started, _, saved = self._run(client, {"enabled": "true", "interval": interval})
        assert started == [int(interval)]
        assert saved[0]["auto_sync"]["interval_minutes"] == int(interval)

    @pytest.mark.parametrize("bad", ["7", "0", "-30", "99999", "abc", ""])
    def test_unsupported_interval_falls_back_to_120(self, client, bad) -> None:
        """An arbitrary interval would generate an invalid cron, so it is clamped."""
        _, started, _, saved = self._run(client, {"enabled": "true", "interval": bad})
        assert started == [120]
        assert saved[0]["auto_sync"]["interval_minutes"] == 120

    def test_demo_mode_refuses_and_changes_nothing(self, demo_client) -> None:
        started: list[int] = []
        saved: list[dict] = []
        with patch.object(srv, "save_config", saved.append), \
             patch.object(srv, "_schedule_autosync", started.append):
            r = demo_client.post("/api/toggle-autosync", data={"enabled": "true"})
        assert r.json()["status"] == "demo"
        assert started == [] and saved == []


class TestUnsyncAllGuards:
    """POST /api/unsync-all — wipes every sync record."""

    def test_demo_mode_returns_403(self, demo_client) -> None:
        wiped: list[int] = []
        with patch.object(srv.db, "unsync_all", lambda: wiped.append(1) or 0):
            r = demo_client.post("/api/unsync-all", data={"confirm": "RESET"})
        assert r.status_code == 403
        assert wiped == []

    @pytest.mark.parametrize("confirm", ["", "reset", "yes", "RESET "])
    def test_wrong_confirmation_wipes_nothing(self, client, confirm) -> None:
        wiped: list[int] = []
        with patch.object(srv.db, "unsync_all", lambda: wiped.append(1) or 0):
            r = client.post("/api/unsync-all", data={"confirm": confirm})
        assert r.status_code == 400
        assert wiped == [], f"confirm={confirm!r} must not wipe"


class TestLogoutAll:
    """POST /logout-all — bumps the session epoch so every device signs out."""

    def test_bumps_the_epoch(self, client) -> None:
        store: dict = {"session_epoch": {"n": 4}}

        class FakeDB:
            def get_app_config(self, k):
                return store.get(k)

            def set_app_config(self, k, v):
                store[k] = v

        with patch.object(srv.db, "get_db", lambda: FakeDB()):
            r = client.post("/logout-all", follow_redirects=False)
        assert r.status_code == 303
        assert store["session_epoch"] == {"n": 5}

    def test_starts_from_zero_when_never_set(self, client) -> None:
        store: dict = {}

        class FakeDB:
            def get_app_config(self, k):
                return store.get(k)

            def set_app_config(self, k, v):
                store[k] = v

        with patch.object(srv.db, "get_db", lambda: FakeDB()):
            r = client.post("/logout-all", follow_redirects=False)
        assert r.status_code == 303
        assert store["session_epoch"] == {"n": 1}

    def test_db_failure_surfaces_the_error_instead_of_faking_success(self, client) -> None:
        """If the epoch never advanced, other devices are still signed in. The
        route keeps this session and redirects to /settings with an error rather
        than to /login as if sign-out-everywhere had worked."""

        class BrokenDB:
            def get_app_config(self, k):
                raise RuntimeError("db down")

            def set_app_config(self, k, v):
                raise RuntimeError("db down")

        with patch.object(srv.db, "get_db", lambda: BrokenDB()):
            r = client.post("/logout-all", follow_redirects=False)
        assert r.status_code == 303
        assert "err=logout_all" in r.headers["location"]
        assert "/login" not in r.headers["location"]
        assert "set-cookie" not in r.headers, "the current session must be kept"


class TestValidateHevy:
    """GET /api/validate-hevy — used by the setup page to test an API key."""

    def test_missing_key_returns_400(self, client) -> None:
        r = client.get("/api/validate-hevy")
        assert r.status_code == 400
        assert "No key provided" in r.json()["error"]

    def test_valid_key_reports_workout_count(self, client) -> None:
        class FakeClient:
            def __init__(self, api_key):
                self.api_key = api_key

            def get_workout_count(self):
                return 42

        with patch("hevy2garmin.hevy.HevyClient", FakeClient):
            r = client.get("/api/validate-hevy", params={"key": "k"})
        assert r.status_code == 200
        assert r.json() == {"valid": True, "workout_count": 42}

    def test_rejected_key_reports_invalid(self, client) -> None:
        class FakeClient:
            def __init__(self, api_key):
                pass

            def get_workout_count(self):
                raise RuntimeError("401 Unauthorized")

        with patch("hevy2garmin.hevy.HevyClient", FakeClient):
            r = client.get("/api/validate-hevy", params={"key": "bad"})
        assert r.status_code == 400
        assert r.json()["valid"] is False
