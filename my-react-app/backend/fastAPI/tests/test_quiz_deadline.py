"""routes/quiz/deadline.py：有等待上限的背景執行。

要鎖住：逾時就放棄等待（工作仍在背景跑完）、工作滿載時立刻放棄不排隊、例外不外洩、
名額一定會歸還（不然跑幾次之後所有更新都會變成 busy）。"""
import threading
import time

import pytest

from fastAPI.routes.quiz import deadline


def test_returns_the_value_when_the_work_finishes_in_time():
    assert deadline.run_with_deadline(lambda: 42, 1.0) == ("ok", 42)


def test_a_slow_job_times_out_but_keeps_running_in_the_background():
    release, finished = threading.Event(), threading.Event()

    def slow():
        release.wait(5)
        finished.set()
        return "done"
    started = time.monotonic()
    status, value = deadline.run_with_deadline(slow, 0.05)
    assert (status, value) == ("timeout", None) and time.monotonic() - started < 1.0
    release.set()
    assert finished.wait(2)                         # 逾時不會中斷工作，它在背景完成


def test_exceptions_become_error_status_not_raised():
    def boom():
        raise RuntimeError("down")
    assert deadline.run_with_deadline(boom, 1.0) == ("error", None)


def test_slots_are_returned_after_success_failure_and_timeout(monkeypatch):
    monkeypatch.setattr(deadline, "_slots", threading.BoundedSemaphore(2))
    release = threading.Event()
    for _ in range(5):
        assert deadline.run_with_deadline(lambda: 1, 1.0)[0] == "ok"
    for _ in range(5):
        assert deadline.run_with_deadline(lambda: 1 / 0, 1.0)[0] == "error"
    assert deadline.run_with_deadline(lambda: release.wait(5), 0.02)[0] == "timeout"
    release.set()
    time.sleep(0.1)                                 # 讓背景工作結束、歸還名額
    for _ in range(5):
        assert deadline.run_with_deadline(lambda: 1, 1.0)[0] == "ok"


def test_when_all_slots_are_taken_it_gives_up_immediately_without_queueing(monkeypatch):
    sem = threading.BoundedSemaphore(1)
    sem.acquire()
    monkeypatch.setattr(deadline, "_slots", sem)
    ran = []
    started = time.monotonic()
    assert deadline.run_with_deadline(lambda: ran.append(1), 5.0) == ("busy", None)
    assert time.monotonic() - started < 0.5 and ran == []


def test_a_scheduling_failure_returns_the_slot(monkeypatch):
    sem = threading.BoundedSemaphore(1)
    monkeypatch.setattr(deadline, "_slots", sem)

    class BrokenPool:
        def submit(self, fn):
            raise RuntimeError("shutdown")
    monkeypatch.setattr(deadline, "_pool", BrokenPool())
    assert deadline.run_with_deadline(lambda: 1, 1.0) == ("error", None)
    assert sem.acquire(blocking=False)              # 名額有歸還


def test_the_pool_is_recreated_after_shutdown_so_a_restarted_app_still_works(monkeypatch):
    monkeypatch.setattr(deadline, "_pool", None)
    assert deadline.run_with_deadline(lambda: 1, 1.0) == ("ok", 1)
    first = deadline._pool
    deadline.shutdown()
    assert deadline._pool is None
    assert deadline.run_with_deadline(lambda: 2, 1.0) == ("ok", 2)
    assert deadline._pool is not None and deadline._pool is not first
    deadline.shutdown()


def test_shutdown_without_a_pool_is_harmless(monkeypatch):
    monkeypatch.setattr(deadline, "_pool", None)
    deadline.shutdown()
    deadline.shutdown()


def test_shutdown_does_not_wait_for_a_stuck_job(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    release = threading.Event()
    monkeypatch.setattr(deadline, "_pool", ThreadPoolExecutor(max_workers=1))
    monkeypatch.setattr(deadline, "_slots", threading.BoundedSemaphore(1))
    assert deadline.run_with_deadline(lambda: release.wait(5), 0.02)[0] == "timeout"
    started = time.monotonic()
    deadline.shutdown()
    assert time.monotonic() - started < 0.5
    release.set()


def test_the_app_lifespan_shuts_the_pool_down():
    from unittest.mock import patch
    from fastapi.testclient import TestClient
    from fastAPI.main import app
    with patch.object(deadline, "shutdown") as shutdown:
        with TestClient(app):
            assert not shutdown.called
        assert shutdown.called


def test_the_number_of_concurrent_jobs_never_exceeds_the_worker_count():
    running, peak, lock = 0, 0, threading.Lock()
    release = threading.Event()

    def job():
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        release.wait(2)
        with lock:
            running -= 1
    results = []
    threads = [threading.Thread(target=lambda: results.append(deadline.run_with_deadline(job, 0.3)[0])) for _ in range(deadline.MAX_WORKERS + 6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    release.set()
    time.sleep(0.2)
    assert peak <= deadline.MAX_WORKERS and "busy" in results
