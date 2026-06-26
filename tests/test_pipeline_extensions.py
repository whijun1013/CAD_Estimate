from collections import namedtuple

from pipeline import EnhancedAnalysisFusionEngine, _extract_dimensions_from_text


def test_extract_dimensions_from_text_supports_common_drawing_formats():
    assert _extract_dimensions_from_text("상부장 1200*300*800") == {
        "width": 1200,
        "depth": 300,
        "height": 800,
    }
    assert _extract_dimensions_from_text("상부장 1200x300x800") == {
        "width": 1200,
        "depth": 300,
        "height": 800,
    }
    assert _extract_dimensions_from_text("가로1500 세로600 깊이400") == {
        "width": 1500,
        "depth": 400,
        "height": 600,
    }
    assert _extract_dimensions_from_text("폭 800 높이 850 깊이 600") == {
        "width": 800,
        "depth": 600,
        "height": 850,
    }


def test_extract_dimensions_from_text_handles_partial_and_irrelevant_text():
    assert _extract_dimensions_from_text("하부장 W900 H850") == {
        "width": 900,
        "depth": None,
        "height": 850,
    }
    assert _extract_dimensions_from_text("보조주방 1200mm") == {
        "width": 1200,
        "depth": None,
        "height": None,
    }
    assert _extract_dimensions_from_text("싱크볼(볼만)") == {
        "width": None,
        "depth": None,
        "height": None,
    }


def test_enhanced_fusion_marks_category_defaults_as_inferred():
    engine = EnhancedAnalysisFusionEngine()
    task = namedtuple("MockTask", ["project_id"])(project_id=1)
    vector_data = [
        {"text": "상부장", "x": 10, "y": 10, "layer": "FURNITURE", "dimension": None}
    ]

    result, log = engine.fuse(task, vector_data, [])

    assert log["status"] == "COMPLETED"
    assert result["items"]
    item = result["items"][0]
    assert item["product_name"] == "상부장"
    assert item["needs_review"] is True
    assert item["ai_inferred_dimensions"]["width"] is True
    assert item["ai_inferred_dimensions"]["depth"] is True
    assert item["ai_inferred_dimensions"]["height"] is True
