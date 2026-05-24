"""
Smoke tests — health check and root endpoint.

Run with:
    pytest tests/test_health.py -v
"""
import pytest


@pytest.mark.asyncio
async def test_root_ping(client):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


@pytest.mark.asyncio
async def test_health_check(client):
    response = await client.get("/api/v1/analytics/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("ok", "degraded")
    assert "database" in data
    assert "version" in data


@pytest.mark.asyncio
async def test_get_me(client):
    """
    /me returns the stub user injected by the test fixture.
    No real Clerk JWT needed — dependency is overridden in conftest.
    """
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer stub-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test@finsight.ai"
    assert data["clerk_user_id"] == "user_test123"
