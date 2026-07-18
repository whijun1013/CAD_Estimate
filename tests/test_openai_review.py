import os

import pytest
from unittest.mock import MagicMock
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from database import Base
from fastapi import HTTPException

from main import AIProviderSettings, update_ai_provider
from pipeline import OpenAIAIReviewEngine, OpenAIVisionAnalyzer, StubEstimateMapper, get_ai_review_engine

@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()

def test_openai_review_engine_success():
    engine = OpenAIAIReviewEngine("fake_key", "gpt-4o")

    # Mock the client
    mock_parse = MagicMock()

    class MockParsed:
        def __init__(self):
            self.reviewed_items = [
                MagicMock(
                    original_item_name="Upper cabinet",
                    ai_review_status="approved",
                    ai_review_reason="Looks good",
                    ai_review_confidence=0.95,
                    review_flags=[]
                ),
                MagicMock(
                    original_item_name="Base cabinet",
                    ai_review_status="needs_review",
                    ai_review_reason="Dimension mismatch",
                    ai_review_confidence=0.6,
                    review_flags=["dimension_mismatch"]
                )
            ]
            self.global_review_summary = "Review completed."

    class MockResponse:
        def __init__(self):
            self.output_parsed = MockParsed()

    mock_parse.return_value = MockResponse()
    engine.client.responses.parse = mock_parse

    task = models.CADTask(id=1, project_id=1)
    structured_analysis = {
        "items": [
            {"item_no": 1, "product_name": "Upper cabinet", "quantity": 1},
            {"item_no": 2, "product_name": "Base cabinet", "quantity": 1}
        ],
        "readiness_summary": {}
    }

    result, log = engine.review(task, structured_analysis)

    assert result["items"][0]["ai_review_status"] == "approved"
    assert result["items"][1]["ai_review_status"] == "needs_review"
    assert result["items"][1]["review_flags"] == ["dimension_mismatch"]
    assert log["status"] == "COMPLETED"


def test_openai_review_engine_failure():
    engine = OpenAIAIReviewEngine("fake_key", "gpt-4o")

    mock_parse = MagicMock(side_effect=Exception("API Error"))
    engine.client.responses.parse = mock_parse

    task = models.CADTask(id=1, project_id=1)
    structured_analysis = {"items": [{"item_no": 1, "product_name": "Upper cabinet", "quantity": 1}], "readiness_summary": {}}

    result, log = engine.review(task, structured_analysis)

    assert log["status"] == "FAILED"
    assert "API Error" in log["log"]
    assert "AI Review Error: API Error" in result["readiness_summary"]["blocking_issues"]


def test_openai_vision_engine_uses_responses_api(tmp_path):
    image_path = tmp_path / "drawing.png"
    image_path.write_bytes(b"fake-image")

    detected_item = MagicMock()
    detected_item.model_dump.return_value = {"product_name": "Upper cabinet", "quantity": 1}
    parsed = SimpleNamespace(detected_items=[detected_item], overall_confidence=0.91)
    response = SimpleNamespace(output_parsed=parsed)

    engine = OpenAIVisionAnalyzer("fake_key", "gpt-5.6")
    engine.client.responses.parse = MagicMock(return_value=response)

    result, log = engine.analyze(SimpleNamespace(file_path=str(image_path)))

    assert result == [{"product_name": "Upper cabinet", "quantity": 1}]
    assert log["status"] == "COMPLETED"
    request = engine.client.responses.parse.call_args.kwargs
    assert request["text_format"].__name__ == "VisionAnalysisResponseSchema"
    assert request["input"][0]["content"][1]["type"] == "input_image"


def test_update_ai_provider_enables_vision_and_review(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.setenv("ALLOW_MOCK_PROVIDER", "true")
    monkeypatch.setenv("VISION_ANALYZER_PROVIDER", "stub")
    monkeypatch.setenv("AI_REVIEW_PROVIDER", "local")

    result = update_ai_provider(
        AIProviderSettings(provider="openai", api_key="test-key", model="gpt-5.6"),
        True,
    )

    assert result["openai_configured"] is True
    assert result["model"] == "gpt-5.6"
    assert result["provider"] == "openai"
    assert os.environ["VISION_ANALYZER_PROVIDER"] == "openai"
    assert os.environ["AI_REVIEW_PROVIDER"] == "openai"
    assert os.environ["ALLOW_MOCK_PROVIDER"] == "false"


def test_update_ai_provider_rejects_missing_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        update_ai_provider(AIProviderSettings(provider="openai"), True)

    assert exc_info.value.status_code == 422


def test_estimate_mapper_needs_review_propagation(db_session):
    mapper = StubEstimateMapper()

    new_project = models.Project(name="Test", po_number="PO-TEST-AI-PROPAGATION")
    db_session.add(new_project)
    db_session.commit()
    db_session.refresh(new_project)

    task = models.CADTask(project_id=new_project.id, file_name="test.dxf", file_path="/fake/test.dxf")
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    db_session.add_all([
        models.CabinetPriceMaster(
            product_name="Needs review cabinet",
            category="Upper cabinet",
            unit_price=10000,
        ),
        models.CabinetPriceMaster(
            product_name="Approved cabinet",
            category="Base cabinet",
            unit_price=10000,
        ),
    ])
    db_session.commit()

    structured_analysis = {
        "items": [
            {
                "item_no": 1,
                "product_name": "Needs review cabinet",
                "category": "Upper cabinet",
                "quantity": 1,
                "evidence": [],
                "confidence": 0.9,
                "ai_review_status": "needs_review",
                "ai_review_confidence": 0.9,
                "review_flags": ["dimension_mismatch"],
                "ai_review_reason": "Dimension mismatch"
            },
            {
                "item_no": 2,
                "product_name": "Approved cabinet",
                "category": "Base cabinet",
                "quantity": 1,
                "evidence": [],
                "confidence": 0.9,
                "ai_review_status": "approved",
                "ai_review_confidence": 0.9,
                "review_flags": [],
                "ai_review_reason": "Approved"
            }
        ]
    }

    quotation, _ = mapper.map_to_quotation(db_session, task, structured_analysis, 0.3, 0.1)

    assert len(quotation.items) == 2

    # First item should need review due to AI review status & flags
    item1 = next(it for it in quotation.items if it.item_no == 1)
    assert item1.needs_manual_review is True
    assert "[AI" in item1.pricing_remarks
    assert "Dimension mismatch" in item1.pricing_remarks

    # Second item is approved
    item2 = next(it for it in quotation.items if it.item_no == 2)
    assert item2.needs_manual_review is False


def test_get_ai_review_engine_error(monkeypatch):
    monkeypatch.setenv("AI_REVIEW_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)

    with pytest.raises(ValueError, match="AI_REVIEW_PROVIDER.*OPENAI_API_KEY or OPENAI_MODEL"):
        get_ai_review_engine()

    monkeypatch.setenv("AI_REVIEW_PROVIDER", "local")
    assert get_ai_review_engine().__class__.__name__ == "StubAIReviewEngine"


def test_get_ai_review_engine_defaults_to_local_for_non_openai_vision(monkeypatch):
    monkeypatch.delenv("AI_REVIEW_PROVIDER", raising=False)
    monkeypatch.setenv("VISION_ANALYZER_PROVIDER", "anthropic")

    assert get_ai_review_engine().__class__.__name__ == "StubAIReviewEngine"
