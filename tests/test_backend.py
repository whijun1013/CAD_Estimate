import os
import sys
import datetime
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Set up system path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import secure_filename, ALLOWED_EXTENSIONS, validate_file_content
from database import Base
import models
from pipeline import DrawingAnalysisPipeline

# 1. Filename sanitization tests (Traversal defense)
def test_secure_filename():
    assert secure_filename("normal_drawing.dwg") == "normal_drawing.dwg"
    assert secure_filename("../../../etc/passwd") == "passwd"
    assert secure_filename("subfolder/drawing.dxf") == "drawing.dxf"
    assert secure_filename("..\\..\\win.ini") == "win.ini"
    assert secure_filename("test space & special @#.pdf") == "test space  special .pdf"
    assert secure_filename("도면 테스트.dwg") == "도면 테스트.dwg"
    assert secure_filename("") == "uploaded_file"
    assert secure_filename("..") == "uploaded_file"

# 2. Extension validation checks
def test_allowed_extensions():
    assert "dwg" in ALLOWED_EXTENSIONS
    assert "dxf" in ALLOWED_EXTENSIONS
    assert "pdf" in ALLOWED_EXTENSIONS
    assert "png" in ALLOWED_EXTENSIONS
    assert "jpg" in ALLOWED_EXTENSIONS
    assert "txt" not in ALLOWED_EXTENSIONS
    assert "exe" not in ALLOWED_EXTENSIONS

# 3. Magic byte signature verification tests
def test_validate_file_content():
    # PDF magic byte starts with b"%PDF"
    assert validate_file_content(b"%PDF-1.4\n...", "my_file.pdf") is True
    assert validate_file_content(b"NOTPDF...", "my_file.pdf") is False

    # PNG magic byte starts with b"\x89PNG\r\n\x1a\n"
    assert validate_file_content(b"\x89PNG\r\n\x1a\nIMAGE_DATA", "image.png") is True
    assert validate_file_content(b"NOTPNG...", "image.png") is False

    # JPEG starts with b"\xff\xd8\xff"
    assert validate_file_content(b"\xff\xd8\xff\xe0\x00\x10JFIF", "photo.jpg") is True
    assert validate_file_content(b"NOTJPEG...", "photo.jpg") is False

    # DXF header tests
    assert validate_file_content(b"  0\nSECTION\n  2\nHEADER\n", "drawing.dxf") is True

    # DWG magic byte starts with b"AC10"
    assert validate_file_content(b"AC1032\x00\x00\x00", "drawing.dwg") is True
    assert validate_file_content(b"NOTDWG...", "drawing.dwg") is False

# 4. DB Schema and Quotation Math Tests
def test_quotation_calculations():
    engine = create_engine("sqlite:///:memory:")
    SessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Create project
        proj = models.Project(po_number="TEST-PO-01", name="Test Site")
        db.add(proj)
        db.commit()
        db.refresh(proj)

        # Create task
        task = models.CADTask(project_id=proj.id, file_name="drawing.dwg", file_path="/tmp/drawing.dwg", status="PENDING")
        db.add(task)
        db.commit()
        db.refresh(task)

        # Create Price Masters
        prices = [
            models.CabinetPriceMaster(product_name="상부장", category="상부장", unit_price=70000),
            models.CabinetPriceMaster(product_name="하부장", category="하부장", unit_price=90000)
        ]
        db.add_all(prices)
        db.commit()

        # Check pricing lookup
        pm_dict = {pm.product_name: pm.unit_price for pm in db.query(models.CabinetPriceMaster).all()}
        assert pm_dict["상부장"] == 70000
        assert pm_dict["하부장"] == 90000

        # Create Quotation and calculate items
        quotation = models.Quotation(
            task_id=task.id,
            project_id=proj.id,
            doc_number="QS-TEST",
            date=datetime.date.today(),
            status="DRAFT"
        )
        db.add(quotation)
        db.commit()
        db.refresh(quotation)

        # Items: 2 상부장 (70000 each) and 1 하부장 (90000 each)
        items = [
            models.QuotationItem(
                quotation_id=quotation.id,
                item_no=1,
                category="상부장",
                item_name="상부장",
                qty=2,
                unit_price=70000,
                sum_price=2 * 70000
            ),
            models.QuotationItem(
                quotation_id=quotation.id,
                item_no=2,
                category="하부장",
                item_name="하부장",
                qty=1,
                unit_price=90000,
                sum_price=1 * 90000
            )
        ]
        for item in items:
            db.add(item)
        db.commit()

        # Calculations: Total, VAT, Grand Total
        total_amount = sum(item.sum_price for item in items) # 140000 + 90000 = 230000
        vat_amount = int(total_amount * 0.10) # 23000
        grand_total = total_amount + vat_amount # 253000

        quotation.total_amount = total_amount
        quotation.vat_amount = vat_amount
        quotation.grand_total = grand_total
        db.commit()
        db.refresh(quotation)

        assert quotation.total_amount == 230000
        assert quotation.vat_amount == 23000
        assert quotation.grand_total == 253000

    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

# 5. Clean clean_int test
def test_clean_int():
    from init_db import clean_int
    assert clean_int("100") == 100
    assert clean_int(50) == 50
    assert clean_int("150.5") == 150
    assert clean_int("") == 0
    assert clean_int(None) == 0
    assert clean_int("invalid_number", "test context") == 0

# 6. Pipeline execution & multi-stage status tracking test
def test_pipeline_execution(tmp_path):
    engine = create_engine("sqlite:///:memory:")
    SessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        proj = models.Project(po_number="TEST-PO-2", name="Pipeline Site")
        db.add(proj)
        db.commit()

        prices = [
            models.CabinetPriceMaster(product_name="마감 판넬", category="피라/앤드판넬", unit_price=45000),
            models.CabinetPriceMaster(product_name="상부 마감 휠라 (코니스)", category="코니스/걸레받이", unit_price=28000),
            models.CabinetPriceMaster(product_name="냉장고장 상부 플랩장", category="상부장", unit_price=78000),
            models.CabinetPriceMaster(product_name="좌측 마감 판넬 (일반)", category="피라/앤드판넬", unit_price=45000),
            models.CabinetPriceMaster(product_name="우측 마감 판넬 (비규격)", category="피라/앤드판넬", unit_price=58000)
        ]
        db.add_all(prices)
        db.commit()

        # Test drawing file setup
        # Make a physical dummy file inside tmp_path
        dummy_file_path = str(tmp_path / "tmp_dummy_file.dxf")
        with open(dummy_file_path, "wb") as f:
            f.write(b"  0\nSECTION\n  2\nHEADER\n")

        task = models.CADTask(
            project_id=proj.id,
            file_name="drawing.dxf",
            file_path=dummy_file_path,
            file_size=1024,
            status="PENDING"
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        pipeline = DrawingAnalysisPipeline(db)
        logs = pipeline.run(task.id)

        # Clean up mock file (optional but good practice)
        if os.path.exists(dummy_file_path):
            os.remove(dummy_file_path)

        # Verify 7 stages logged
        assert "파일 검증" in logs
        assert "형식 판별" in logs
        assert "변환 단계" in logs
        assert "텍스트/치수 추출" in logs
        assert "이미지/OCR/비전" in logs
        assert "결과 병합" in logs
        assert "견적 산출" in logs

        quote = db.query(models.Quotation).filter(models.Quotation.task_id == task.id).first()
        assert quote is not None
        assert quote.status == "NEEDS_REVIEW"
        assert len(quote.items) == 4

        # Check special surcharge calculation
        special_item = [item for item in quote.items if item.is_special][0]
        assert special_item.needs_manual_review is True
        assert special_item.confidence == 0.72

    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

# 7. Quotation Sync Update (Add/Update/Delete child collection sync)
def test_quotation_sync_updates():
    engine = create_engine("sqlite:///:memory:")
    SessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        from main import update_quotation, QuotationUpdate, QuotationItemUpdate

        proj = models.Project(po_number="TEST-PO-3", name="Sync Site")
        db.add(proj)
        db.commit()

        quotation = models.Quotation(
            project_id=proj.id,
            doc_number="QS-SYNC-TEST",
            date=datetime.date.today(),
            status="DRAFT"
        )
        db.add(quotation)
        db.commit()

        item1 = models.QuotationItem(
            quotation_id=quotation.id,
            item_no=1,
            category="상부장",
            item_name="Old Upper",
            qty=1,
            unit_price=10000,
            sum_price=10000
        )
        item2 = models.QuotationItem(
            quotation_id=quotation.id,
            item_no=2,
            category="하부장",
            item_name="ToDelete",
            qty=1,
            unit_price=20000,
            sum_price=20000
        )
        db.add_all([item1, item2])
        db.commit()
        db.refresh(quotation)

        # We want to:
        # 1. Update item1 name and qty
        # 2. Delete item2 (by omitting it in payload)
        # 3. Add a new item
        payload = QuotationUpdate(
            status="CONFIRMED",
            remarks="Synced remarks",
            items=[
                # Modify
                QuotationItemUpdate(
                    id=item1.id,
                    item_no=1,
                    category="상부장",
                    item_name="Updated Upper",
                    qty=2,
                    unit="EA",
                    unit_price=12000,
                    is_special=False,
                    remarks="Updated remarks",
                    needs_manual_review=False
                ),
                # Add
                QuotationItemUpdate(
                    id=None,
                    item_no=2,
                    category="키큰장",
                    item_name="New Tall",
                    qty=1,
                    unit="EA",
                    unit_price=30000,
                    is_special=True,
                    remarks="Newly added",
                    needs_manual_review=True
                )
            ]
        )

        res = update_quotation(quotation.id, payload, db)

        # Verify changes
        assert res.status == "CONFIRMED"
        assert res.remarks == "Synced remarks"
        assert len(res.items) == 2

        # Verify item1 updated
        updated_item1 = db.query(models.QuotationItem).filter(models.QuotationItem.id == item1.id).first()
        assert updated_item1.item_name == "Updated Upper"
        assert updated_item1.qty == 2
        assert updated_item1.sum_price == 24000

        # Verify item2 deleted
        deleted_item = db.query(models.QuotationItem).filter(models.QuotationItem.id == item2.id).first()
        assert deleted_item is None

        # Verify item3 added
        new_item = db.query(models.QuotationItem).filter(models.QuotationItem.item_name == "New Tall").first()
        assert new_item is not None
        assert new_item.quotation_id == quotation.id
        assert new_item.qty == 1
        assert new_item.unit_price == 30000
        assert new_item.sum_price == 30000

        # Verify grand totals:
        # total_amount = 24000 (updated item1) + 30000 (new item) = 54000
        # vat = 54000 * 0.1 = 5400
        # grand_total = 59400
        assert res.total_amount == 54000
        assert res.vat_amount == 5400
        assert res.grand_total == 59400

    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

# 8. Scoping and global BOM aggregation calculations
def test_bom_scoping_and_aggregations():
    engine = create_engine("sqlite:///:memory:")
    SessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Create Project
        proj = models.Project(po_number="TEST-PO-4", name="Scope Site")
        db.add(proj)
        db.commit()

        # Create ApartmentType
        apt_type = models.ApartmentType(project_id=proj.id, type_name="84A", household_count=100)
        db.add(apt_type)
        db.commit()

        # Create CabinetBOM
        bom1 = models.CabinetBOM(
            type_id=apt_type.id,
            category="상부장",
            item_no=1,
            product_name="상부장 800",
            qty_sum=3,
            is_special=False
        )
        bom2 = models.CabinetBOM(
            type_id=apt_type.id,
            category="하부장",
            item_no=2,
            product_name="하부장 비규격",
            qty_sum=2,
            is_special=True
        )
        db.add_all([bom1, bom2])
        db.commit()

        # Create BuildingQuantity
        bq1 = models.BuildingQuantity(bom_id=bom1.id, building_no="101", line_no="1-2", qty=300)
        bq2 = models.BuildingQuantity(bom_id=bom2.id, building_no="101", line_no="1-2", qty=200)
        db.add_all([bq1, bq2])
        db.commit()

        # Verify database entries
        assert db.query(models.CabinetBOM).filter(models.CabinetBOM.type_id == apt_type.id).count() == 2

        # Query using the exact endpoint aggregation mathematics
        from sqlalchemy import func
        query = db.query(models.CabinetBOM).filter(models.CabinetBOM.type_id == apt_type.id)
        matching_items = query.all()
        matching_ids = [b.id for b in matching_items]

        total_qty_sum = sum(b.qty_sum or 0 for b in matching_items)
        total_special_count = sum(1 for b in matching_items if b.is_special)
        total_building_qty = db.query(func.sum(models.BuildingQuantity.qty)).filter(models.BuildingQuantity.bom_id.in_(matching_ids)).scalar() or 0

        assert total_qty_sum == 5
        assert total_special_count == 1
        assert total_building_qty == 500

    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


# 9. API Integration Tests using FastAPI TestClient
def test_api_endpoints(tmp_path):
    from fastapi.testclient import TestClient
    from main import app, get_db
    import io

    # Set up a testing database
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    # Set up overrides
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    db = TestingSessionLocal()
    try:
        # Create Project
        proj = models.Project(po_number="TEST-PO-5", name="API Site")
        db.add(proj)
        db.commit()
        db.refresh(proj)

        # A. Empty file upload -> 400 Bad Request
        response = client.post(
            "/api/tasks/upload",
            data={"project_id": proj.id},
            files={"file": ("empty.dwg", b"", "application/octet-stream")}
        )
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

        # B. Invalid PDF upload -> 400 Bad Request
        response = client.post(
            "/api/tasks/upload",
            data={"project_id": proj.id},
            files={"file": ("fake.pdf", b"NOTPDF...", "application/pdf")}
        )
        assert response.status_code == 400
        assert "signature" in response.json()["detail"].lower()

        # C. Invalid DWG upload (no AC10) -> 400 Bad Request
        response = client.post(
            "/api/tasks/upload",
            data={"project_id": proj.id},
            files={"file": ("fake.dwg", b"NOTDWG...", "application/octet-stream")}
        )
        assert response.status_code == 400
        assert "signature" in response.json()["detail"].lower()

        # D. Valid DWG upload (AC10) -> 200 OK
        import main
        original_upload_dir = main.UPLOAD_DIR
        main.UPLOAD_DIR = str(tmp_path)

        try:
            response = client.post(
                "/api/tasks/upload",
                data={"project_id": proj.id},
                files={"file": ("valid.dxf", b"  0\nSECTION\n  2\nHEADER\n", "application/octet-stream")}
            )
            assert response.status_code == 200
            task_data = response.json()
            assert task_data["status"] == "PENDING"
            assert task_data["file_name"] == "valid.dxf"

            # E. Path concealment checks in task response
            assert "uploads" not in task_data["file_path"]
            assert "C:\\" not in task_data["file_path"]
            assert "/" not in task_data["file_path"]
            assert "\\" not in task_data["file_path"]

            # Check status endpoint response
            status_response = client.get(f"/api/tasks/{task_data['id']}/status")
            assert status_response.status_code == 200
            status_data = status_response.json()
            assert "uploads" not in status_data["file_path"]
            assert "C:\\" not in status_data["file_path"]

            # Run pipeline to generate raw response logs with evidence
            from pipeline import DrawingAnalysisPipeline
            pipeline = DrawingAnalysisPipeline(db)
            pipeline_task = db.query(models.CADTask).filter(models.CADTask.id == task_data["id"]).first()
            assert pipeline_task is not None
            logs = pipeline.run(pipeline_task.id)

            # Refresh DB task
            db.refresh(pipeline_task)
            pipeline_task.status = "COMPLETED"
            pipeline_task.ai_raw_response = logs
            db.commit()

            # Query /status again to check if absolute paths are hidden in ai_raw_response
            status_response = client.get(f"/api/tasks/{task_data['id']}/status")
            status_data = status_response.json()
            assert "uploads" not in status_data["ai_raw_response"]
            assert "C:\\" not in status_data["ai_raw_response"]

            # F. BOM aggregates independent of pagination limit
            apt_type = models.ApartmentType(project_id=proj.id, type_name="84A", household_count=100)
            db.add(apt_type)
            db.commit()
            db.refresh(apt_type)

            bom1 = models.CabinetBOM(type_id=apt_type.id, category="상부장", item_no=1, product_name="상부장A", qty_sum=10, is_special=False)
            bom2 = models.CabinetBOM(type_id=apt_type.id, category="하부장", item_no=2, product_name="하부장B", qty_sum=5, is_special=True)
            db.add_all([bom1, bom2])
            db.commit()
            db.refresh(bom1)
            db.refresh(bom2)

            bq1 = models.BuildingQuantity(bom_id=bom1.id, building_no="101", line_no="1", qty=1000)
            bq2 = models.BuildingQuantity(bom_id=bom2.id, building_no="101", line_no="1", qty=500)
            db.add_all([bq1, bq2])
            db.commit()

            # Fetch with limit=1, page=1
            bom_response = client.get(f"/api/apartment-types/{apt_type.id}/bom?page=1&limit=1")
            assert bom_response.status_code == 200
            bom_data = bom_response.json()
            assert bom_data["total"] == 2
            assert len(bom_data["items"]) == 1
            # Aggregate sums must include all matching items (bom1 + bom2)
            assert bom_data["total_qty_sum"] == 15
            assert bom_data["total_special_count"] == 1
            assert bom_data["total_building_qty"] == 1500

            # Fetch with filter (is_special=True)
            bom_response_filter = client.get(f"/api/apartment-types/{apt_type.id}/bom?page=1&limit=10&is_special=true")
            assert bom_response_filter.status_code == 200
            bom_data_filter = bom_response_filter.json()
            assert bom_data_filter["total"] == 1
            assert bom_data_filter["total_qty_sum"] == 5
            assert bom_data_filter["total_special_count"] == 1
            assert bom_data_filter["total_building_qty"] == 500

        finally:
            main.UPLOAD_DIR = original_upload_dir

    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        app.dependency_overrides.clear()


# 10. Additional Integration and Safety Tests

def test_pipeline_failure_propagation(tmp_path):
    from fastapi.testclient import TestClient
    from main import app, get_db
    from unittest.mock import patch
    from sqlalchemy.pool import StaticPool

    # Set up memory database
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    db = TestingSessionLocal()
    try:
        # Create Project
        proj = models.Project(po_number="TEST-PO-FAIL", name="Pipeline Failure Site")
        db.add(proj)
        db.commit()
        db.refresh(proj)

        # We will mock DrawingConverter.convert to fail by returning FAILED status in the stage log
        from pipeline import StubDrawingConverter

        def mock_convert_failed(self, task):
            return "", {
                "stage": "3. 변환 단계 (Format Conversion)",
                "status": "FAILED",
                "provider": "Stub Drawing Converter",
                "duration_sec": 0.01,
                "log": "Conversion failure simulation",
                "confidence": 0.0,
                "evidence": "N/A"
            }

        import main
        original_upload_dir = main.UPLOAD_DIR
        main.UPLOAD_DIR = str(tmp_path)

        with patch('main.SessionLocal', TestingSessionLocal):
            with patch.object(StubDrawingConverter, 'convert', mock_convert_failed):
                # Upload valid DWG
                response = client.post(
                    "/api/tasks/upload",
                    data={"project_id": proj.id},
                    files={"file": ("valid_fail.dwg", b"AC1032validheaderdata...", "application/octet-stream")}
                )
                assert response.status_code == 200
                task_data = response.json()
                task_id = task_data["id"]

                # Run background worker manually to check failure propagation
                from main import run_ai_analysis_pipeline
                run_ai_analysis_pipeline(task_id)

                # Check status of task
                status_response = client.get(f"/api/tasks/{task_id}/status")
                status_data = status_response.json()
                assert status_data["status"] == "FAILED"
                assert "Pipeline stage failed" in status_data["error_message"]

                # Verify /analysis endpoint rejects it with 400 Bad Request
                analysis_response = client.get(f"/api/tasks/{task_id}/analysis")
                assert analysis_response.status_code == 400
                assert "failed" in analysis_response.json()["detail"].lower()

        main.UPLOAD_DIR = original_upload_dir
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        app.dependency_overrides.clear()


def test_upload_db_commit_failure_cleanup(tmp_path):
    from fastapi.testclient import TestClient
    from main import app, get_db
    from unittest.mock import patch
    from sqlalchemy.pool import StaticPool
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import OperationalError
    import os

    # Set up memory database
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    db = TestingSessionLocal()
    try:
        # Create Project
        proj = models.Project(po_number="TEST-PO-CLEAN", name="Upload Safety Site")
        db.add(proj)
        db.commit()
        db.refresh(proj)

        import main
        original_upload_dir = main.UPLOAD_DIR
        main.UPLOAD_DIR = str(tmp_path)

        # Mock db.commit during task creation to raise OperationalError
        with patch.object(Session, 'commit', side_effect=OperationalError("mock commit failure", params=None, orig=None)):
            # Attempt to upload
            response = client.post(
                "/api/tasks/upload",
                data={"project_id": proj.id},
                files={"file": ("test_clean.dwg", b"AC1032validheaderdata...", "application/octet-stream")}
            )
            # Should fail with 500
            assert response.status_code == 500
            assert "transaction failed" in response.json()["detail"].lower()

            # Check that the uploaded file does not remain in UPLOAD_DIR
            files_in_dir = os.listdir(str(tmp_path))
            # Filter for files containing test_clean
            cleanup_worked = True
            for f in files_in_dir:
                if "test_clean.dwg" in f:
                    cleanup_worked = False
            assert cleanup_worked is True

        main.UPLOAD_DIR = original_upload_dir
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        app.dependency_overrides.clear()


def test_api_key_authentication(tmp_path):
    from fastapi.testclient import TestClient
    from main import app, get_db
    from unittest.mock import patch
    from sqlalchemy.pool import StaticPool
    import os

    # Set up memory database
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    # Temporarily set API_KEY env var
    with patch.dict(os.environ, {"API_KEY": "super-secret-key"}):
        # Request projects without key -> should be 401
        res = client.get("/api/projects")
        assert res.status_code == 401

        # Request with invalid header key -> 401
        res = client.get("/api/projects", headers={"X-API-Key": "wrong-key"})
        assert res.status_code == 401

        # Request with valid header key -> 200
        res = client.get("/api/projects", headers={"X-API-Key": "super-secret-key"})
        assert res.status_code == 200

        # Request with invalid Bearer -> 401
        res = client.get("/api/projects", headers={"Authorization": "Bearer wrong-key"})
        assert res.status_code == 401

        # Request with valid Bearer -> 200
        res = client.get("/api/projects", headers={"Authorization": "Bearer super-secret-key"})
        assert res.status_code == 200

    # Unset API_KEY env var -> should bypass security (public access)
    with patch.dict(os.environ, {"API_KEY": ""}):
        res = client.get("/api/projects")
        assert res.status_code == 200

    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()


def test_structured_analysis_and_price_calculation(tmp_path):
    from fastapi.testclient import TestClient
    from main import app, get_db
    from sqlalchemy.pool import StaticPool
    from unittest.mock import patch
    import json

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    db = TestingSessionLocal()
    try:
        # Create Project
        proj = models.Project(po_number="TEST-PO-STRUCT", name="AI Price Site")
        db.add(proj)
        db.commit()
        db.refresh(proj)

        # Add price masters
        prices = [
            models.CabinetPriceMaster(product_name="상부장", category="상부장", unit_price=75000),
            models.CabinetPriceMaster(product_name="하부장", category="하부장", unit_price=95000),
            models.CabinetPriceMaster(product_name="냉장고장 상부 플랩장", category="상부장", unit_price=78000),
            models.CabinetPriceMaster(product_name="우측 마감 판넬 (비규격)", category="피라/앤드판넬", unit_price=58000)
        ]
        db.add_all(prices)
        db.commit()

        import main
        original_upload_dir = main.UPLOAD_DIR
        main.UPLOAD_DIR = str(tmp_path)

        # Upload valid generic drawing
        response = client.post(
            "/api/tasks/upload",
            data={"project_id": proj.id},
            files={"file": ("generic_layout.dxf", b"  0\nSECTION\n  2\nHEADER\n", "application/octet-stream")}
        )
        assert response.status_code == 200
        task_data = response.json()
        task_id = task_data["id"]

        # Run pipeline
        from main import run_ai_analysis_pipeline
        with patch('main.SessionLocal', TestingSessionLocal):
            run_ai_analysis_pipeline(task_id)

        # Refresh and fetch task status
        status_res = client.get(f"/api/tasks/{task_id}/status")
        task_status = status_res.json()
        assert task_status["status"] == "COMPLETED"

        # Check structured analysis JSON matches schema
        struct_str = task_status["structured_analysis"]
        assert struct_str is not None
        # It's already parsed as Dict by field_validator
        assert "items" in struct_str
        assert "warnings" in struct_str
        assert len(struct_str["items"]) > 0

        # Fetch analysis and verify Quotation prices match CabinetPriceMaster
        analysis_res = client.get(f"/api/tasks/{task_id}/analysis")
        assert analysis_res.status_code == 200
        quotation = analysis_res.json()

        # Verify pricing
        items_pricing = {it["item_name"]: (it["qty"], it["unit_price"], it["sum_price"]) for it in quotation["items"]}

        # Assert item fields
        flap_name = "[자동파싱] 냉장고장 상부 플랩장"
        assert flap_name in items_pricing
        qty, u_price, s_price = items_pricing[flap_name]
        assert qty == 2
        assert u_price == 78000
        assert s_price == 156000

        panel_rt_name = "[자동파싱] 우측 마감 판넬 (비규격)"
        assert panel_rt_name in items_pricing
        p_qty, p_u_price, p_s_price = items_pricing[panel_rt_name]
        assert p_qty == 1
        assert p_u_price == int(58000 * 1.30)
        assert p_s_price == int(58000 * 1.30)

        main.UPLOAD_DIR = original_upload_dir
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        app.dependency_overrides.clear()


def test_refined_price_mapping_and_calculations():
    import os
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from pipeline import StubEstimateMapper

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(bind=engine)
    models.Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    try:
        # Seeding database
        db.add_all([
            models.CabinetPriceMaster(product_code="W-TOP-STD", product_name="상부장", category="상부장", unit_price=75000),
            models.CabinetPriceMaster(product_code="B-BASE-STD", product_name="하부장", category="하부장", unit_price=95000),
            # Special item to test code matching priority:
            models.CabinetPriceMaster(product_code="SPECIAL-CODE", product_name="특수품", category="기타", unit_price=200000),
            # Category standard matching fallback:
            models.CabinetPriceMaster(product_code="C-FILLA", product_name="코니스/걸레받이", category="코니스/걸레받이", unit_price=28000),
        ])
        db.commit()

        proj = models.Project(po_number="TEST-PO-PRICING", name="Pricing Engine Test")
        db.add(proj)
        db.commit()

        task = models.CADTask(project_id=proj.id, file_name="drawing.dwg", file_path="drawing.dwg", status="PENDING")
        db.add(task)
        db.commit()

        # Build mock structured analysis containing:
        # 1. Product code match item
        # 2. Product name match item
        # 3. Category fallback item
        # 4. Non-standard width item (width 850mm -> surcharge 30%)
        # 5. Missing price item (category "Unknown", no price master)
        # 6. AI supplied unit price which should be IGNORED in favor of DB master
        structured_analysis = {
            "items": [
                {
                    "category": "기타",
                    "product_name": "AI가 제안한 엉뚱한 이름",
                    "product_code": "SPECIAL-CODE",
                    "width_mm": 800,
                    "depth_mm": 600,
                    "height_mm": 850,
                    "quantity": 1,
                    "confidence": 0.95,
                    "is_special": False,
                    "evidence": ["box:1,2,3,4"],
                    "remarks": "Should match by code SPECIAL-CODE",
                    "unit_price": 999999  # AI supplied unit price to ignore
                },
                {
                    "category": "상부장",
                    "product_name": "상부장",
                    "product_code": None,
                    "width_mm": 800,
                    "depth_mm": 320,
                    "height_mm": 700,
                    "quantity": 2,
                    "confidence": 0.95,
                    "is_special": False,
                    "evidence": ["box:1,2,3,4"],
                    "remarks": "Should match by product_name"
                },
                {
                    "category": "코니스/걸레받이",
                    "product_name": "특수 코니스 부재",
                    "product_code": None,
                    "width_mm": 1200,
                    "depth_mm": 18,
                    "height_mm": 80,
                    "quantity": 1,
                    "confidence": 0.95,
                    "is_special": False,
                    "evidence": ["box:1,2,3,4"],
                    "remarks": "Should fallback to category 코니스/걸레받이"
                },
                {
                    "category": "하부장",
                    "product_name": "하부장",
                    "product_code": "B-BASE-STD",
                    "width_mm": 850,  # Non-standard width (not a multiple of 100) -> 30% surcharge
                    "depth_mm": 600,
                    "height_mm": 850,
                    "quantity": 1,
                    "confidence": 0.95,
                    "is_special": False,
                    "evidence": ["box:1,2,3,4"],
                    "remarks": "Surcharge test"
                },
                {
                    "category": "미확인카테고리",
                    "product_name": "단가 없는 제품",
                    "product_code": None,
                    "width_mm": 600,
                    "depth_mm": 600,
                    "height_mm": 600,
                    "quantity": 1,
                    "confidence": 0.95,
                    "is_special": False,
                    "evidence": ["box:1,2,3,4"],
                    "remarks": "Should be 0 won and flag review"
                }
            ]
        }

        # Environment variables for custom pricing factors
        os.environ["DEFAULT_CONTINGENCY_AMOUNT"] = "50000"
        os.environ["DEFAULT_INSTALLATION_FEE"] = "100000"
        os.environ["DEFAULT_TRANSPORTATION_FEE"] = "80000"

        mapper = StubEstimateMapper()
        quotation, _ = mapper.map_to_quotation(db, task, structured_analysis, surcharge_rate=0.30, vat_rate=0.10)

        # Verify items mapping
        assert len(quotation.items) == 5

        # Item 1: Code match SPECIAL-CODE -> unit_price 200,000 (AI price 999999 ignored)
        it1 = [i for i in quotation.items if i.price_source == "exact_code"][0]
        assert it1.unit_price == 200000
        assert it1.sum_price == 200000
        assert it1.needs_manual_review is False

        # Item 2: Name match 상부장 -> unit_price 75,000
        it2 = [i for i in quotation.items if i.item_name == "[자동파싱] 상부장"][0]
        assert it2.unit_price == 75000
        assert it2.sum_price == 150000
        assert it2.price_source == "exact_name"
        assert it2.needs_manual_review is False

        # Item 3: Category fallback -> unit_price 28,000
        it3 = [i for i in quotation.items if i.price_source == "category_fallback"][0]
        assert it3.unit_price == 28000
        assert it3.sum_price == 28000
        assert it3.needs_manual_review is False

        # Item 4: Surcharge 850mm -> 95,000 * 1.30 = 123,500
        it4 = [i for i in quotation.items if i.spec.startswith("850")][0]
        assert it4.unit_price == 123500
        assert it4.is_special is True
        assert it4.needs_manual_review is True

        # Item 5: Price not found -> 0
        it5 = [i for i in quotation.items if i.price_source == "not_found"][0]
        assert it5.unit_price == 0
        assert it5.needs_manual_review is True
        assert "단가 확인 필요" in it5.pricing_remarks

        # Check overall sums
        # subtotal = 200,000 + 150,000 + 28,000 + 123,500 + 0 = 501,500
        # fees = 50,000 (contingency) + 100,000 (install) + 80,000 (transport) = 230,000
        # total_amount = subtotal + fees = 731,500
        # vat = 731,500 * 0.1 = 73,150
        # grand_total = 731,500 + 73,150 = 804,650
        assert quotation.total_amount == 731500
        assert quotation.vat_amount == 73150
        assert quotation.grand_total == 804650

    finally:
        # Cleanup env vars
        os.environ.pop("DEFAULT_CONTINGENCY_AMOUNT", None)
        os.environ.pop("DEFAULT_INSTALLATION_FEE", None)
        os.environ.pop("DEFAULT_TRANSPORTATION_FEE", None)
        db.close()
        models.Base.metadata.drop_all(bind=engine)
