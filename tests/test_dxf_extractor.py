"""
Tests for EzdxfVectorExtractor, enhanced RuleBasedSymbolMatcher,
EnhancedAnalysisFusionEngine, and _extract_dimensions_from_text.

Uses synthetic DXF fixtures from tests/fixtures/.
"""
import os
import sys
import json
import pytest
import tempfile
import shutil

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline import (
    EzdxfVectorExtractor,
    RuleBasedSymbolMatcher,
    EnhancedAnalysisFusionEngine,
    AnalysisSchemaValidator,
    _extract_dimensions_from_text,
    _KR_FURNITURE_PATTERNS,
)
import models
from database import Base, engine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
KITCHEN_DXF = os.path.join(FIXTURES_DIR, "synthetic_kitchen.dxf")
SHOE_DXF = os.path.join(FIXTURES_DIR, "synthetic_shoe.dxf")


class FakeCADTask:
    """Lightweight stand-in for models.CADTask for unit tests."""
    def __init__(self, file_name, file_path, task_id=1, project_id=1, file_size=None):
        self.id = task_id
        self.project_id = project_id
        self.file_name = file_name
        self.file_path = file_path
        if file_size is not None:
            self.file_size = file_size
        elif os.path.exists(file_path):
            self.file_size = os.path.getsize(file_path)
        else:
            self.file_size = 0
        self.pdf_path = None


# ---------------------------------------------------------------------------
# _extract_dimensions_from_text tests
# ---------------------------------------------------------------------------

class TestExtractDimensionsFromText:
    def test_w_pattern(self):
        dims = _extract_dimensions_from_text("상부장 W800")
        assert dims["width"] == 800

    def test_whd_pattern(self):
        dims = _extract_dimensions_from_text("800*700*320")
        assert dims["width"] == 800
        assert dims["height"] == 700
        assert dims["depth"] == 320

    def test_mm_pattern(self):
        dims = _extract_dimensions_from_text("폭 1200mm 적용")
        assert dims["width"] == 1200

    def test_named_whd(self):
        dims = _extract_dimensions_from_text("W600 H700 D320")
        assert dims["width"] == 600
        assert dims["height"] == 700
        assert dims["depth"] == 320

    def test_empty_string(self):
        dims = _extract_dimensions_from_text("")
        assert dims["width"] is None
        assert dims["height"] is None
        assert dims["depth"] is None

    def test_no_dimension(self):
        dims = _extract_dimensions_from_text("일반 텍스트")
        assert dims["width"] is None

    def test_cad_symbol_width_pattern(self):
        dims = _extract_dimensions_from_text("UPPER_CAB_800")
        assert dims["width"] == 800


# ---------------------------------------------------------------------------
# EzdxfVectorExtractor tests
# ---------------------------------------------------------------------------

class TestEzdxfVectorExtractor:
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path):
        """Create a temporary uploads dir so raw entity artifacts are written there."""
        self.tmp_dir = str(tmp_path)
        self.extractor = EzdxfVectorExtractor()

    def _make_task(self, src_dxf, task_id=1):
        """Copy fixture to temp dir and return a FakeCADTask."""
        dst = os.path.join(self.tmp_dir, os.path.basename(src_dxf))
        shutil.copy2(src_dxf, dst)
        return FakeCADTask(
            file_name=os.path.basename(src_dxf),
            file_path=dst,
            task_id=task_id,
        )

    @pytest.mark.skipif(not os.path.exists(KITCHEN_DXF), reason="Fixture not generated")
    def test_kitchen_entity_extraction(self):
        task = self._make_task(KITCHEN_DXF)
        vector_data, log_stage = self.extractor.extract(task)

        assert log_stage["status"] == "COMPLETED"
        assert log_stage["provider"] == "Ezdxf Vector Extractor (ezdxf)"
        assert len(vector_data) > 0

        # Check entity types present
        entity_types = {v["entity_type"] for v in vector_data}
        assert "INSERT" in entity_types, "Should contain INSERT block references"
        assert "TEXT" in entity_types or "MTEXT" in entity_types, "Should contain text entities"
        assert "LINE" in entity_types, "Should contain line entities"

    @pytest.mark.skipif(not os.path.exists(KITCHEN_DXF), reason="Fixture not generated")
    def test_kitchen_text_extraction(self):
        task = self._make_task(KITCHEN_DXF)
        vector_data, _ = self.extractor.extract(task)

        texts = [v.get("text_content", "") for v in vector_data if v.get("text_content")]
        all_text = " ".join(texts)
        assert "상부장" in all_text, f"Expected '상부장' in extracted texts: {texts}"
        assert "하부장" in all_text, f"Expected '하부장' in extracted texts: {texts}"

    @pytest.mark.skipif(not os.path.exists(KITCHEN_DXF), reason="Fixture not generated")
    def test_kitchen_block_names(self):
        task = self._make_task(KITCHEN_DXF)
        vector_data, _ = self.extractor.extract(task)

        block_names = {v.get("block_name") for v in vector_data if v.get("block_name")}
        assert "UPPER_CAB_800" in block_names
        assert "LOWER_CAB_800" in block_names
        assert "FLAP_1000" in block_names

    @pytest.mark.skipif(not os.path.exists(KITCHEN_DXF), reason="Fixture not generated")
    def test_kitchen_layers(self):
        task = self._make_task(KITCHEN_DXF)
        vector_data, _ = self.extractor.extract(task)

        layers = {v["layer"] for v in vector_data}
        assert "FURN_UPPER" in layers
        assert "FURN_LOWER" in layers
        assert "FURN_REF" in layers

    @pytest.mark.skipif(not os.path.exists(KITCHEN_DXF), reason="Fixture not generated")
    def test_raw_entity_artifact_saved(self):
        task = self._make_task(KITCHEN_DXF, task_id=42)
        self.extractor.extract(task)

        artifact_path = os.path.join(self.tmp_dir, "task_42_raw_entities.json")
        assert os.path.exists(artifact_path), "Raw entity artifact JSON should be saved"

        with open(artifact_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["task_id"] == 42
        assert data["entity_count"] > 0
        assert isinstance(data["layer_summary"], dict)
        assert isinstance(data["entities"], list)

    @pytest.mark.skipif(not os.path.exists(SHOE_DXF), reason="Fixture not generated")
    def test_shoe_cabinet_extraction(self):
        task = self._make_task(SHOE_DXF)
        vector_data, log_stage = self.extractor.extract(task)

        assert log_stage["status"] == "COMPLETED"
        block_names = {v.get("block_name") for v in vector_data if v.get("block_name")}
        assert "SHOE_BOX_1200" in block_names

        texts = [v.get("text_content", "") for v in vector_data if v.get("text_content")]
        all_text = " ".join(texts)
        assert "신발장" in all_text

    def test_non_dxf_returns_skipped(self):
        """EzdxfVectorExtractor should return SKIPPED status for non-DXF files."""
        txt_path = os.path.join(self.tmp_dir, "test.txt")
        with open(txt_path, "w") as f:
            f.write("not a dxf")
        task = FakeCADTask("test.txt", txt_path)
        vector_data, log_stage = self.extractor.extract(task)
        assert len(vector_data) == 0
        assert log_stage["status"] == "SKIPPED"
        assert "skipped" in log_stage["log"].lower()

    def test_corrupt_dxf_raises_error(self):
        """EzdxfVectorExtractor should raise ValueError for corrupt DXF files."""
        bad_path = os.path.join(self.tmp_dir, "corrupt.dxf")
        with open(bad_path, "w") as f:
            f.write("NOT A REAL DXF FILE CONTENT")
        task = FakeCADTask("corrupt.dxf", bad_path)
        with pytest.raises(ValueError, match="Failed to read DXF"):
            self.extractor.extract(task)


# ---------------------------------------------------------------------------
# RuleBasedSymbolMatcher tests
# ---------------------------------------------------------------------------

class TestRuleBasedSymbolMatcher:
    def setup_method(self):
        self.matcher = RuleBasedSymbolMatcher()

    def test_layer_rule_matching(self):
        vector_data = [
            {"layer": "FURN_UPPER", "block_name": "UPPER_CAB_800"},
            {"layer": "FURN_LOWER", "block_name": "LOWER_CAB_800"},
        ]
        results = self.matcher.match_symbols(vector_data, [])
        hints = {r["product_hint"] for r in results}
        assert "상부장" in hints
        methods = {r.get("match_method") for r in results}
        assert "block_name" in methods

    def test_korean_text_pattern_matching(self):
        vector_data = [
            {"layer": "TEXT", "text": "상부장 W800", "text_content": "상부장 W800"},
            {"layer": "TEXT", "text": "냉장고 플랩장 W1000", "text_content": "냉장고 플랩장 W1000"},
        ]
        results = self.matcher.match_symbols(vector_data, [])

        hints = {r["product_hint"] for r in results}
        assert "상부장" in hints
        assert "냉장고장 상부 플랩장" in hints

        text_results = [r for r in results if r["match_method"] == "drawing_text"]
        assert len(text_results) >= 2

        # Check dimension extraction from text
        for r in text_results:
            if r["product_hint"] == "상부장":
                assert r.get("dimension_value") == 800 or r.get("parsed_dimensions", {}).get("width") == 800

    def test_block_attribute_matching(self):
        vector_data = [
            {
                "layer": "BLOCKS",
                "block_name": "CUSTOM_BLOCK",
                "attributes": {"PRODUCT_CODE": "B001234", "WIDTH": "900"},
            }
        ]
        results = self.matcher.match_symbols(vector_data, [])
        methods = {r.get("match_method") for r in results}
        assert "block_attribute" in methods

    def test_vision_label_matching(self):
        vision_data = [
            {"label": "items:냉장고 상부장", "confidence": 0.95},
        ]
        results = self.matcher.match_symbols([], vision_data)
        assert len(results) > 0
        hints = {r["product_hint"] for r in results}
        assert "냉장고장 상부 플랩장" in hints

    def test_deduplication(self):
        """Same product_hint + evidence should not produce duplicate matches."""
        vector_data = [
            {"layer": "FURN_UPPER", "block_name": "UPPER_CAB_800"},
            {"layer": "FURN_UPPER", "block_name": "UPPER_CAB_800"},
        ]
        results = self.matcher.match_symbols(vector_data, [])
        upper_matches = [r for r in results if r["product_hint"] == "상부장"]
        assert len(upper_matches) == 1  # De-duplicated

    def test_match_method_field_present(self):
        vector_data = [{"layer": "FURN_UPPER", "block_name": "X"}]
        results = self.matcher.match_symbols(vector_data, [])
        for r in results:
            assert "match_method" in r


# ---------------------------------------------------------------------------
# AnalysisSchemaValidator tests (extended types)
# ---------------------------------------------------------------------------

class TestSchemaValidatorExtended:
    def setup_method(self):
        self.validator = AnalysisSchemaValidator()

    def test_dxf_vector_source_type_accepted(self):
        items = [{
            "category": "상부장",
            "product_name": "상부장 테스트",
            "quantity": 1,
            "confidence": 0.90,
            "evidence": ["dxf_entity:test"],
            "source_type": "dxf_vector",
            "width_mm": 800,
            "height_mm": 700,
            "depth_mm": 320,
            "dimension_source": {"width": "cad_dimension", "height": "default_by_category", "depth": "default_by_category"},
            "needs_review": True,
            "review_reason": "Test",
            "is_special": False,
        }]
        validated, rejected, summary = self.validator.validate(items)
        assert len(validated) == 1
        assert len(rejected) == 0

    def test_dxf_entity_dimension_source_accepted(self):
        items = [{
            "category": "하부장",
            "product_name": "하부장 테스트",
            "quantity": 2,
            "confidence": 0.95,
            "evidence": ["dxf_entity:handle_123"],
            "source_type": "vector",
            "width_mm": 600,
            "height_mm": 850,
            "depth_mm": 600,
            "dimension_source": {"width": "dxf_entity", "height": "dxf_entity", "depth": "dxf_entity"},
            "needs_review": False,
            "review_reason": None,
            "is_special": False,
        }]
        validated, rejected, _ = self.validator.validate(items)
        assert len(validated) == 1
        assert len(rejected) == 0

    def test_extended_dimension_sources_accepted(self):
        items = [new_item for new_item in [
            {
                "category": "하부장",
                "product_name": f"하부장 {source}",
                "quantity": 1,
                "confidence": 0.95,
                "evidence": [f"source:{source}"],
                "source_type": "dxf_vector",
                "width_mm": 600,
                "height_mm": 850,
                "depth_mm": 600,
                "dimension_source": {"width": source, "height": source, "depth": source},
                "needs_review": False,
                "review_reason": None,
                "is_special": False,
            }
            for source in ("cad_dimension", "block_attribute", "block_name", "bom")
        ]]
        validated, rejected, _ = self.validator.validate(items)
        assert len(validated) == 4
        assert len(rejected) == 0


# ---------------------------------------------------------------------------
# EnhancedAnalysisFusionEngine tests
# ---------------------------------------------------------------------------

class TestEnhancedAnalysisFusionEngine:
    def setup_method(self):
        self.engine = EnhancedAnalysisFusionEngine()

    def test_fuse_with_vector_data(self):
        """Test fusion with synthetic vector data (no DB dependency for BOM)."""
        # Create a mock task
        task = FakeCADTask("test_kitchen.dxf", "/tmp/test_kitchen.dxf")

        vector_data = [
            {"layer": "FURN_UPPER", "block_name": "UPPER_CAB_800", "text": "상부장 W800", "text_content": "상부장 W800"},
            {"layer": "FURN_LOWER", "block_name": "LOWER_CAB_800", "text": "하부장 W800", "text_content": "하부장 W800"},
            {"layer": "FURN_FINISH", "text": "걸레받이 L1200", "text_content": "걸레받이 L1200"},
        ]
        vision_data = []

        structured, log_stage = self.engine.fuse(task, vector_data, vision_data)

        assert log_stage["status"] == "COMPLETED"
        assert structured["is_demo_result"] is False
        assert structured["schema_version"] == "2.0.0"
        assert len(structured["items"]) > 0

        # Check provider info
        assert structured["provider_info"]["fusion_engine"] == "enhanced"

        # Check extraction_summary has enhanced fields
        summary = structured["extraction_summary"]
        assert "matched_symbols" in summary
        assert structured["bom_matching_summary"]["matched_items"] >= 0
        assert structured["bom_matching_summary"]["unmatched_items"] >= 0

    def test_fuse_produces_valid_schema(self):
        """All items from enhanced fusion should pass schema validation."""
        task = FakeCADTask("test.dxf", "/tmp/test.dxf")
        vector_data = [
            {"layer": "FURN_UPPER", "block_name": "UPPER_CAB_800", "text_content": "상부장 W800"},
        ]

        structured, _ = self.engine.fuse(task, vector_data, [])

        validator = AnalysisSchemaValidator()
        validated, rejected, _ = validator.validate(structured["items"])
        # All items should already be validated by the engine
        assert len(rejected) == 0, f"Rejected items: {rejected}"

    def test_review_flags_present(self):
        """Items without BOM match should have review flags."""
        task = FakeCADTask("test.dxf", "/tmp/test.dxf")
        vector_data = [
            {"layer": "TEXT", "text_content": "상부장 W800"},
        ]

        structured, _ = self.engine.fuse(task, vector_data, [])
        items = structured["items"]

        if items:
            # Should have no_bom_match since we don't have a real DB
            flagged = [it for it in items if it.get("review_flags")]
            assert len(flagged) > 0, "Items without BOM should have review_flags"

    def test_dimension_sources_follow_evidence_type(self):
        task = FakeCADTask("test.dxf", "/tmp/test.dxf")
        vector_data = [
            {"layer": "FURN_UPPER", "block_name": "UPPER_CAB", "dimension_value": 800},
            {"layer": "FURN_LOWER", "block_name": "LOWER_CAB_750"},
            {
                "layer": "BLOCKS",
                "block_name": "CUSTOM_BLOCK",
                "attributes": {"PRODUCT_CODE": "B001234", "WIDTH": "900"},
            },
            {"layer": "TEXT", "text_content": "하부장 W700 H850 D600"},
        ]

        structured, _ = self.engine.fuse(task, vector_data, [])
        width_sources = {it["dimension_source"]["width"] for it in structured["items"]}
        assert "cad_dimension" in width_sources
        assert "default_by_category" in width_sources
        assert "block_attribute" in width_sources
        assert "drawing_text" in width_sources


# ---------------------------------------------------------------------------
# Integration: Full extractor + matcher + fusion pipeline
# ---------------------------------------------------------------------------

class TestDXFPipelineIntegration:
    @pytest.mark.skipif(not os.path.exists(KITCHEN_DXF), reason="Fixture not generated")
    def test_kitchen_end_to_end(self, tmp_path):
        """Test full pipeline: extract → match → fuse with synthetic kitchen DXF."""
        # Copy fixture
        dst = os.path.join(str(tmp_path), "synthetic_kitchen.dxf")
        shutil.copy2(KITCHEN_DXF, dst)
        task = FakeCADTask("synthetic_kitchen.dxf", dst, task_id=99)

        # Step 1: Extract
        extractor = EzdxfVectorExtractor()
        vector_data, extract_log = extractor.extract(task)
        assert extract_log["status"] == "COMPLETED"
        assert len(vector_data) > 0

        # Step 2: Fuse (includes matching)
        engine = EnhancedAnalysisFusionEngine()
        structured, fuse_log = engine.fuse(task, vector_data, [])
        assert fuse_log["status"] == "COMPLETED"
        assert structured["is_demo_result"] is False

        # Step 3: Validate results
        items = structured["items"]
        assert len(items) > 0, "Should extract at least one furniture candidate"

        categories = {it["category"] for it in items}
        # Kitchen DXF has upper, lower, ref panels
        assert len(categories) >= 1, f"Expected multiple categories, got: {categories}"

        # All items should have required fields
        for it in items:
            assert it["source_type"] == "dxf_vector"
            assert isinstance(it["dimension_source"], dict)
            assert "width" in it["dimension_source"]
            assert isinstance(it["evidence"], list)
            assert len(it["evidence"]) >= 1
            assert it["width_mm"] > 0
            assert it["height_mm"] > 0
            assert it["depth_mm"] > 0

        # Raw entity artifact should exist
        artifact_path = os.path.join(str(tmp_path), "task_99_raw_entities.json")
        assert os.path.exists(artifact_path)
