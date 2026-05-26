"""
Tests for anomaly detection — Phase 3 Week 6 Day 1-3.

Uses a synthetic 4-year history of revenue values for a ticker, then injects
a 5th "anomalous" document with revenue 3 stdev above the mean. Asserts that
run_anomaly_detection() flags it as an alert with severity='high'.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db.models import (
    Alert,
    Chunk,
    ChunkType,
    Document,
    DocumentStatus,
    DocumentType,
    MetricHistory,
    Workspace,
)


@pytest_asyncio.fixture
async def workspace_with_history(db_session):
    """Insert workspace + 4 historical Apple 10-K-style docs with revenue values."""
    ws = Workspace(id="ws-anomaly-test", owner_id="test-user-id", name="AAPL", is_default=True)
    db_session.add(ws)
    await db_session.flush()

    # Historical revenue (in millions) — pretend FY2018-2021
    historical = [
        ("doc-aapl-fy18", "FY2018", 265595.0),
        ("doc-aapl-fy19", "FY2019", 260174.0),
        ("doc-aapl-fy20", "FY2020", 274515.0),
        ("doc-aapl-fy21", "FY2021", 365817.0),  # Outlier? Real number — kept
    ]
    for doc_id, period, revenue in historical:
        db_session.add(Document(
            id=doc_id,
            workspace_id=ws.id,
            original_filename=f"AAPL_{period}.pdf",
            mime_type="application/pdf",
            file_size_bytes=1_000_000,
            page_count=80,
            doc_type=DocumentType.TEN_K,
            company_name="Apple Inc.",
            ticker="AAPL",
            fiscal_period=period,
            status=DocumentStatus.INDEXED,
        ))
        db_session.add(MetricHistory(
            workspace_id=ws.id,
            document_id=doc_id,
            ticker="AAPL",
            metric_name="revenue",
            metric_value=revenue,
            fiscal_period=period,
        ))

    await db_session.commit()
    return {"workspace": ws, "history": historical}


@pytest_asyncio.fixture
async def new_apple_doc(db_session, workspace_with_history):
    """Add a new FY2022 doc whose extracted revenue we control via the mock."""
    ws = workspace_with_history["workspace"]
    doc = Document(
        id="doc-aapl-fy22-new",
        workspace_id=ws.id,
        original_filename="Apple_10K_FY2022.pdf",
        mime_type="application/pdf",
        file_size_bytes=4_500_000,
        page_count=88,
        doc_type=DocumentType.TEN_K,
        company_name="Apple Inc.",
        ticker="AAPL",
        fiscal_period="FY2022",
        status=DocumentStatus.INDEXED,
    )
    db_session.add(doc)
    db_session.add(Chunk(
        id="chunk-aapl-fy22-1",
        document_id=doc.id,
        text="Apple FY2022 results: revenue grew strongly.",
        chunk_type=ChunkType.PROSE,
        chunk_index=0,
        page_number=1,
    ))
    await db_session.commit()
    return doc


# ── Pure function tests ───────────────────────────────────────────────────────
def test_compute_z_score_basic():
    from app.services.analytics.anomaly import compute_z_score

    history = [100.0, 110.0, 95.0, 105.0]  # mean=102.5, pstdev≈5.59
    result = compute_z_score(120.0, history)
    assert result is not None
    assert result["sample_size"] == 4
    assert result["mean"] == pytest.approx(102.5)
    assert result["stdev"] > 0
    # Z = (120 - 102.5) / 5.59 ≈ 3.13 → anomaly + high severity
    assert result["z_score"] > 3.0
    assert result["is_anomaly"] is True
    assert result["severity"] == "high"


def test_compute_z_score_within_normal_range():
    from app.services.analytics.anomaly import compute_z_score

    history = [100.0, 110.0, 95.0, 105.0, 102.0]
    result = compute_z_score(103.0, history)
    assert result is not None
    assert abs(result["z_score"]) < 2.0
    assert result["is_anomaly"] is False


def test_compute_z_score_too_few_samples():
    from app.services.analytics.anomaly import compute_z_score

    # Only 2 samples — should refuse to score
    result = compute_z_score(100.0, [98.0, 102.0])
    assert result is None


def test_compute_z_score_zero_stdev():
    from app.services.analytics.anomaly import compute_z_score

    # All identical values → stdev=0 → can't compute meaningful z
    result = compute_z_score(100.0, [100.0, 100.0, 100.0])
    assert result is None


# ── End-to-end test with DB ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_run_anomaly_detection_flags_outlier(db_session, new_apple_doc):
    """Inject a revenue value 4σ above the mean and verify the alert is created."""
    from app.services.analytics import anomaly

    # Mock the GPT-4o extractor so test is offline + deterministic.
    # Historical revenues: ~265B, 260B, 275B, 366B → mean≈291.5B, stdev≈42.3B
    # We feed a current value of 600B → z ≈ +7σ (very anomalous)
    fake_metrics = {
        "revenue": {"value": 600000.0, "currency": "USD", "period": "FY2022"},
        "net_income": {"value": 99800.0, "currency": "USD", "period": "FY2022"},
        "earnings_per_share": {"basic_eps": 6.15, "diluted_eps": 6.11, "period": "FY2022"},
        "_extraction_metadata": {"model_used": "stub"},
    }

    async def fake_extract(content, metadata):
        return fake_metrics

    with patch("app.services.analytics.anomaly.extract_financial_metrics", fake_extract):
        alerts = await anomaly.run_anomaly_detection(new_apple_doc.id, db_session)
        await db_session.commit()

    # Revenue should have been flagged
    revenue_alerts = [a for a in alerts if a.metric_name == "revenue"]
    assert len(revenue_alerts) == 1, f"Expected 1 revenue alert, got {len(alerts)}"

    alert = revenue_alerts[0]
    assert alert.alert_type == "anomaly"
    assert alert.severity == "high"  # |z| > 3.0
    assert alert.ticker == "AAPL"
    assert alert.metric_value == pytest.approx(600000.0)
    assert alert.z_score is not None and alert.z_score > 3.0
    assert alert.sample_size == 4  # 4 historical docs
    assert "AAPL" in alert.title
    assert "above" in alert.description.lower()

    # And it was persisted
    db_alerts = (await db_session.execute(
        select(Alert).where(Alert.metric_name == "revenue")
    )).scalars().all()
    assert len(db_alerts) == 1
    assert db_alerts[0].id == alert.id

    # New metric_history row also written
    hist_rows = (await db_session.execute(
        select(MetricHistory).where(MetricHistory.document_id == new_apple_doc.id)
    )).scalars().all()
    rev_rows = [r for r in hist_rows if r.metric_name == "revenue"]
    assert len(rev_rows) == 1
    assert rev_rows[0].metric_value == pytest.approx(600000.0)


@pytest.mark.asyncio
async def test_run_anomaly_detection_normal_value_no_alert(db_session, new_apple_doc):
    """A revenue value within 2σ of historical mean must NOT trigger an alert."""
    from app.services.analytics import anomaly

    # Within normal range — between 260B and 366B
    fake_metrics = {
        "revenue": {"value": 295000.0, "currency": "USD", "period": "FY2022"},
        "_extraction_metadata": {"model_used": "stub"},
    }

    async def fake_extract(content, metadata):
        return fake_metrics

    with patch("app.services.analytics.anomaly.extract_financial_metrics", fake_extract):
        alerts = await anomaly.run_anomaly_detection(new_apple_doc.id, db_session)
        await db_session.commit()

    revenue_alerts = [a for a in alerts if a.metric_name == "revenue"]
    assert revenue_alerts == [], f"Should not have flagged a normal value. Alerts: {[a.title for a in alerts]}"


@pytest.mark.asyncio
async def test_run_anomaly_detection_skips_doc_without_ticker(db_session):
    """A document with no ticker can't have history — must skip silently."""
    from app.services.analytics import anomaly

    ws = Workspace(id="ws-no-ticker", owner_id="test-user-id", name="Misc", is_default=True)
    doc = Document(
        id="doc-no-ticker",
        workspace_id=ws.id,
        original_filename="random.pdf",
        mime_type="application/pdf",
        file_size_bytes=1000,
        doc_type=DocumentType.OTHER,
        ticker=None,  # explicit
        status=DocumentStatus.INDEXED,
    )
    db_session.add_all([ws, doc])
    await db_session.commit()

    alerts = await anomaly.run_anomaly_detection(doc.id, db_session)
    assert alerts == []


@pytest.mark.asyncio
async def test_run_anomaly_detection_uses_pre_extracted_metrics(db_session, new_apple_doc):
    """If caller supplies pre_extracted_metrics, no LLM call should happen."""
    from app.services.analytics import anomaly

    metrics = {
        "revenue": {"value": 400000.0, "currency": "USD", "period": "FY2022"},
        "_extraction_metadata": {"model_used": "supplied"},
    }

    # Set extract_financial_metrics to a sentinel that would raise if called
    sentinel = AsyncMock(side_effect=AssertionError("extractor should not be called"))
    with patch("app.services.analytics.anomaly.extract_financial_metrics", sentinel):
        alerts = await anomaly.run_anomaly_detection(
            new_apple_doc.id, db_session, pre_extracted_metrics=metrics,
        )
        await db_session.commit()

    sentinel.assert_not_called()
    # 400B is ~2.5σ above the mean of [265B, 260B, 275B, 366B] → should flag
    rev_alerts = [a for a in alerts if a.metric_name == "revenue"]
    assert len(rev_alerts) == 1



# ─────────────────────────────────────────────────────────────────────────────
# Week 11 — extended Z-score threshold tests
#
# The detector classifies severity by |z|:
#     |z| > 3.0   → "high"
#     |z| > 2.5   → "medium"
#     |z| > 2.0   → "low"
#     |z| ≤ 2.0   → not an anomaly
#
# We construct histories with known mean and stdev, then feed values that land
# precisely in each bucket. Boundaries are exclusive: |z| = 2.0 must NOT alert.
# ─────────────────────────────────────────────────────────────────────────────


def _history_with_known_stats():
    """
    Hand-picked history: mean=100, pstdev=10.

    statistics.pstdev([90, 110, 90, 110]) = sqrt(((10²+10²+10²+10²)/4)) = 10.0
    statistics.mean([90, 110, 90, 110])   = 100.0
    """
    return [90.0, 110.0, 90.0, 110.0]


def test_z_threshold_low_severity_just_above_2sigma():
    """|z| = 2.1 → 'low' severity anomaly."""
    from app.services.analytics.anomaly import compute_z_score

    history = _history_with_known_stats()
    # Need (current - 100) / 10 = 2.1  →  current = 121
    result = compute_z_score(121.0, history)
    assert result is not None
    assert result["is_anomaly"] is True
    assert result["severity"] == "low"
    assert result["z_score"] == pytest.approx(2.1, abs=0.001)


def test_z_threshold_medium_severity_above_2_5sigma():
    """|z| = 2.6 → 'medium'."""
    from app.services.analytics.anomaly import compute_z_score

    result = compute_z_score(126.0, _history_with_known_stats())
    assert result is not None
    assert result["is_anomaly"] is True
    assert result["severity"] == "medium"
    assert result["z_score"] == pytest.approx(2.6, abs=0.001)


def test_z_threshold_high_severity_above_3sigma():
    """|z| = 3.5 → 'high'."""
    from app.services.analytics.anomaly import compute_z_score

    result = compute_z_score(135.0, _history_with_known_stats())
    assert result is not None
    assert result["is_anomaly"] is True
    assert result["severity"] == "high"
    assert result["z_score"] == pytest.approx(3.5, abs=0.001)


def test_z_threshold_negative_z_still_triggers_high():
    """A value far BELOW the historical mean should also flag as 'high'."""
    from app.services.analytics.anomaly import compute_z_score

    # current = 60 → z = (60-100)/10 = -4.0
    result = compute_z_score(60.0, _history_with_known_stats())
    assert result["is_anomaly"] is True
    assert result["severity"] == "high"
    assert result["z_score"] == pytest.approx(-4.0)


def test_z_threshold_exactly_2sigma_is_NOT_an_anomaly():
    """|z| = 2.0 must NOT alert — the threshold is strict greater-than."""
    from app.services.analytics.anomaly import compute_z_score

    # current = 120 → z = (120-100)/10 = 2.0
    result = compute_z_score(120.0, _history_with_known_stats())
    assert result is not None
    assert result["z_score"] == pytest.approx(2.0)
    assert result["is_anomaly"] is False
    assert result["severity"] is None


def test_z_threshold_exactly_at_mean_returns_zero_z():
    """A value exactly at the mean is the most boring possible reading."""
    from app.services.analytics.anomaly import compute_z_score

    result = compute_z_score(100.0, _history_with_known_stats())
    assert result is not None
    assert result["z_score"] == 0.0
    assert result["is_anomaly"] is False


def test_severity_classifier_buckets():
    """The internal _severity_for_z helper must respect the documented bands."""
    from app.services.analytics.anomaly import _severity_for_z

    # Above 3.0 → high (positive and negative)
    assert _severity_for_z(3.01) == "high"
    assert _severity_for_z(-3.5) == "high"
    # 2.5 < |z| ≤ 3.0 → medium
    assert _severity_for_z(2.51) == "medium"
    assert _severity_for_z(-2.9) == "medium"
    # 2.0 < |z| ≤ 2.5 → low
    assert _severity_for_z(2.1) == "low"
    assert _severity_for_z(-2.4) == "low"
    # At/under 2.0 the function still returns 'low' (caller decides whether to alert)
    # but we sanity-check the >3 / >2.5 boundaries are correctly ordered
    assert _severity_for_z(2.50) == "low"
    assert _severity_for_z(3.00) == "medium"


def test_min_history_samples_enforced():
    """Below MIN_HISTORY_SAMPLES (3) the detector refuses to score even an outlier."""
    from app.services.analytics.anomaly import compute_z_score, MIN_HISTORY_SAMPLES

    assert MIN_HISTORY_SAMPLES == 3
    # 2 samples — too small
    assert compute_z_score(1000.0, [50.0, 60.0]) is None
    # 0 samples — also None
    assert compute_z_score(1000.0, []) is None
