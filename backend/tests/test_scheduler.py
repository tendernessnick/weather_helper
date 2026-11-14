"""Startup and interval ticks must share locks without losing the scheduler."""
import threading

import pytest

from app import main, scheduler as jobs


def install_job(monkeypatch, fn):
    monkeypatch.setattr(jobs, "JOBS", [("test", fn, 10)])
    monkeypatch.setattr(jobs, "_JOB_FNS", {"test": fn})
    monkeypatch.setattr(jobs, "_job_locks", {"test": threading.Lock()})
    scheduler = jobs.SimpleScheduler()
    scheduler._next["test"] = 0
    return scheduler


def test_interval_tick_skips_same_job_running_at_boot(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    calls = []

    def blocking_job():
        calls.append("run")
        entered.set()
        assert release.wait(timeout=2)

    scheduler = install_job(monkeypatch, blocking_job)
    boot = threading.Thread(target=jobs.run_job_exclusive, args=("test",))
    boot.start()
    try:
        assert entered.wait(timeout=2)
        scheduler._tick()
        jobs.run_job_exclusive("test")  # another startup caller also skips
        assert calls == ["run"]
        assert scheduler.status()["test"]["runs"] == 0
        assert scheduler._next["test"] > 0
    finally:
        release.set()
        boot.join(timeout=2)
    assert not boot.is_alive()
    assert not jobs._job_locks["test"].locked()


def test_boot_skips_same_job_running_in_scheduler(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    calls = []

    def blocking_job():
        calls.append("run")
        entered.set()
        assert release.wait(timeout=2)

    scheduler = install_job(monkeypatch, blocking_job)
    tick = threading.Thread(target=scheduler._tick)
    tick.start()
    try:
        assert entered.wait(timeout=2)
        jobs.run_job_exclusive("test")
        assert calls == ["run"]
    finally:
        release.set()
        tick.join(timeout=2)
    assert scheduler.status()["test"]["runs"] == 1
    assert not jobs._job_locks["test"].locked()


def test_exclusive_failure_releases_lock_for_retry(monkeypatch):
    calls = []

    def fails_once():
        calls.append("run")
        if len(calls) == 1:
            raise RuntimeError("upstream unavailable")

    install_job(monkeypatch, fails_once)
    with pytest.raises(RuntimeError):
        jobs.run_job_exclusive("test")
    assert not jobs._job_locks["test"].locked()
    jobs.run_job_exclusive("test")
    assert len(calls) == 2


def test_scheduled_failure_is_logged_and_next_tick_can_retry(monkeypatch):
    calls = []

    def fails_once():
        calls.append("run")
        if len(calls) == 1:
            raise RuntimeError("upstream unavailable")

    scheduler = install_job(monkeypatch, fails_once)
    scheduler._tick()
    assert scheduler.status()["test"]["failures"] == 1
    assert "RuntimeError" in scheduler.status()["test"]["last_error"]
    assert not jobs._job_locks["test"].locked()
    scheduler._next["test"] = 0
    scheduler._tick()
    assert scheduler.status()["test"]["runs"] == 2
    assert scheduler.status()["test"]["last_error"] is None


def test_first_boot_uses_shared_exclusive_path_and_survives_one_source_failure(monkeypatch):
    calls = []

    def fake_run(job_id):
        calls.append(job_id)
        if len(calls) == 1:
            raise RuntimeError("one source unavailable")

    monkeypatch.setattr(main, "run_job_exclusive", fake_run)
    main._first_boot_ingest()
    assert calls == list(main._FIRST_BOOT_JOBS)


def test_scheduler_start_is_idempotent_and_restart_clears_stop(monkeypatch):
    # Replace the thread, not any actual ingest function: no networking occurs.
    created = []
    class FakeThread:
        def __init__(self, **kwargs):
            self.alive = False
            created.append(self)
        def start(self):
            self.alive = True
        def is_alive(self):
            return self.alive
        def join(self, timeout):
            self.alive = False
    monkeypatch.setattr(jobs.threading, "Thread", FakeThread)
    scheduler = jobs.SimpleScheduler()
    scheduler.start()
    scheduler.start()
    assert len(created) == 1
    scheduler.shutdown()
    scheduler.start()
    assert len(created) == 2
    assert not scheduler._stop.is_set()
