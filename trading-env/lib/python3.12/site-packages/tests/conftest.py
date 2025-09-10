"""Tests fixtures."""

import pytest

from krakenapi import KrakenApi


@pytest.fixture
def mock_ka_public() -> KrakenApi:
    """
    Mock KrakenApi object with public methods.

    Returns:
        KrakenApi: Mocked KrakenApi object.
    """
    return KrakenApi("api_public_key", "api_private_key")


@pytest.fixture
def mock_ka_private() -> KrakenApi:
    """
    Mock KrakenApi object with private methods.

    Returns:
        KrakenApi: Mocked KrakenApi object.
    """
    return KrakenApi(
        "R6/OvXmIQEv1E8nyJd7+a9Zmaf84yJ7uifwe2yj5BgV1N+lgqURsxQwQ",
        "MWZ9lFF/mreK4Fdk/SEpFLvVn//nbKUbCytGShSwvCvYlgRkn4K8i7VY18UQEgOHzBIEsqg78BZJCEhvFIzw1Q==",
    )
