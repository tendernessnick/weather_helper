"""Shared test fixtures.

The analytics/verification modules keep module-level TTL caches (fine in the
long-running service, poison between tests): clear them around every test so
each starts from an empty database in fact and in cache.
"""
import pytest

from app.services import analytics, verification


@pytest.fixture(autouse=True)
def _clear_module_caches():
    yield
    for cache in (verification._summaries_cache, analytics._overview_cache,
                  analytics._disagree_cache, analytics._ranking_cache):
        cache.update(data=None, built=None)
