"""Shared test fixtures.

Set the test environment BEFORE any app import: app.config reads DATABASE_URL
at import time, and conftest is imported before every test module - importing
app first would bind the engine to the real ./weather.db and let test
drop_all wipe it.

The analytics/verification modules keep module-level TTL caches (fine in the
long-running service, poison between tests): clear them around every test so
each starts from an empty database in fact and in cache.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite://")  # in-memory for tests
os.environ.setdefault("ADMIN_TOKEN", "test-token")

import pytest  # noqa: E402

from app.services import analytics, verification  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_module_caches():
    yield
    for cache in (verification._summaries_cache, analytics._overview_cache,
                  analytics._disagree_cache, analytics._ranking_cache):
        cache.update(data=None, built=None)
