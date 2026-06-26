"""
scripts/smoke_test_local.py
===========================
Self-contained smoke test using FastAPI TestClient (no live server required).

This script validates the application's core API flows without requiring
a running server, making it reliable in CI/CD pipelines and local dev environments.

It clearly distinguishes:
    - Server-connection errors (not applicable here, TestClient handles in-process)
    - Functional failures (API returns wrong status code or unexpected response)
    - Missing database seed data (warns clearly, exits gracefully)

Usage:
    python scripts/smoke_test_local.py
    python scripts/smoke_test_local.py --verbose

Exit codes:
    0 - All tests passed
    1 - At least one functional test failed
"""

import os
import sys
import json
import tempfile
import argparse
import logging
from datetime import date

# Ensure project root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

PASS = "\033[92m[PASS]\033[0m"
FAIL = "\033[91m[FAIL]\033[0m"
WARN = "\033[93m[WARN]\033[0m"
INFO = "\033[94m[INFO]\033[0m"


def run_smoke_tests(verbose: bool = False) -> int:
    """
    Runs smoke tests using an in-process TestClient.

    Returns:
        Number of failed tests (0 = all passed).
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from fastapi.testclient import TestClient
    from database import Base
    import models
    import main

    print("\n" + "=" * 70)
    print("  CAD_Estimate Smoke Test (in-process, no server required)")
    print("=" * 70 + "\n")

    # ── Setup: in-memory isolated SQLite for test isolation ─────────────────
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    main.app.dependency_overrides[main.get_db] = override_get_db
    main.app.dependency_overrides[main.verify_api_key] = lambda: True

    import database
    original_main_session = main.SessionLocal
    original_db_session = database.SessionLocal
    main.SessionLocal = TestingSessionLocal
    database.SessionLocal = TestingSessionLocal
    client = TestClient(main.app, raise_server_exceptions=True)

    failed = 0
    passed = 0

    def check(label: str, condition: bool, detail: str = ""):
        nonlocal failed, passed
        if condition:
            print(f"{PASS} {label}")
            if detail and verbose:
                print(f"      {detail}")
            passed += 1
        else:
            print(f"{FAIL} {label}")
            if detail:
                print(f"      {detail}")
            failed += 1

    try:
        # ── Seed a project ───────────────────────────────────────────────────────
        project = models.Project(po_number="SMOKE-PO-001", name="스모크 테스트 현장")
        db.add(project)
        db.commit()
        db.refresh(project)
        project_id = project.id

        # ── 1. GET /api/projects ─────────────────────────────────────────────────
        print(f"\n{INFO} 1. GET /api/projects")
        r = client.get("/api/projects")
        check(
            "GET /api/projects returns 200 and a list",
            r.status_code == 200 and isinstance(r.json(), list),
            f"status={r.status_code} body_preview={str(r.json())[:200]}"
        )
        check(
            "GET /api/projects contains seeded project",
            any(p["po_number"] == "SMOKE-PO-001" for p in r.json()),
            f"projects: {[p['po_number'] for p in r.json()]}"
        )

        # ── 2. GET /api/stats ────────────────────────────────────────────────────
        print(f"\n{INFO} 2. GET /api/stats?project_id={project_id}")
        r = client.get(f"/api/stats?project_id={project_id}")
        check(
            "GET /api/stats returns 200",
            r.status_code == 200,
            f"status={r.status_code}"
        )
        check(
            "GET /api/stats project_id matches",
            r.json().get("project_id") == project_id,
            f"response={r.json()}"
        )

        # ── 3. POST /api/tasks/upload — invalid extension ────────────────────────
        print(f"\n{INFO} 3. POST /api/tasks/upload (invalid extension)")
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
            tmp.write(b"dummy content")
            tmp_path = tmp.name

        try:
            with open(tmp_path, "rb") as f:
                r = client.post(
                    "/api/tasks/upload",
                    data={"project_id": str(project_id)},
                    files={"file": ("test.txt", f, "text/plain")}
                )
            check(
                "Upload of .txt file returns 400",
                r.status_code == 400,
                f"status={r.status_code} detail={r.json().get('detail', '')}"
            )
        finally:
            os.unlink(tmp_path)

        # ── 4. POST /api/tasks/upload — valid PDF ────────────────────────────────
        print(f"\n{INFO} 4. POST /api/tasks/upload (valid PDF)")
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(b"%PDF-1.4 valid pdf content for smoke test")
            tmp_pdf_path = tmp.name

        task_id = None
        try:
            with open(tmp_pdf_path, "rb") as f:
                r = client.post(
                    "/api/tasks/upload",
                    data={"project_id": str(project_id)},
                    files={"file": ("drawing.pdf", f, "application/pdf")}
                )
            check(
                "Upload of valid PDF returns 200 with task id",
                r.status_code == 200 and r.json().get("id") is not None,
                f"status={r.status_code} body_preview={str(r.json())[:200]}"
            )
            if r.status_code == 200:
                task_id = r.json()["id"]
        finally:
            os.unlink(tmp_pdf_path)

        # ── 5. GET /api/tasks/{task_id}/status ───────────────────────────────────
        if task_id:
            print(f"\n{INFO} 5. GET /api/tasks/{task_id}/status")
            r = client.get(f"/api/tasks/{task_id}/status")
            check(
                f"GET /api/tasks/{task_id}/status returns 200",
                r.status_code == 200,
                f"status={r.status_code} body={r.json()}"
            )
            check(
                "Task status is a valid value",
                r.json().get("status") in ("PENDING", "RUNNING", "COMPLETED", "FAILED"),
                f"status={r.json().get('status')}"
            )
        else:
            print(f"\n{WARN} 5. Skipped task status check (upload failed)")

        # 6. GET /api/project (single active/default project endpoint)
        print(f"\n{INFO} 6. GET /api/project")
        r = client.get("/api/project")
        check(
            "GET /api/project returns 200",
            r.status_code == 200,
            f"status={r.status_code}"
        )
        check(
            "Project po_number matches",
            r.json().get("po_number") == "SMOKE-PO-001",
            f"po_number={r.json().get('po_number')}"
        )

        # ── 7. Quotation Create & Update cycle ───────────────────────────────────
        print(f"\n{INFO} 7. Quotation CRUD cycle")

        # Create a task manually for quotation test
        task2 = models.CADTask(
            project_id=project_id,
            file_name="smoke.pdf",
            file_path="/tmp/smoke.pdf",
            status="COMPLETED"
        )
        db.add(task2)
        db.commit()
        db.refresh(task2)

        quot = models.Quotation(
            project_id=project_id,
            task_id=task2.id,
            doc_number=f"SMOKE-Q-{project_id}",
            date=date.today(),
            status="DRAFT"
        )
        db.add(quot)
        db.commit()
        db.refresh(quot)

        q_item = models.QuotationItem(
            quotation_id=quot.id,
            item_no=1,
            category="상부장",
            item_name="상부장",
            qty=1,
            unit="EA",
            unit_price=75000,
            sum_price=75000
        )
        db.add(q_item)
        db.commit()
        db.refresh(q_item)

        update_payload = {
            "status": "CONFIRMED",
            "remarks": "Smoke test confirmed",
            "items": [
                {
                    "id": q_item.id,
                    "item_no": 1,
                    "category": "상부장",
                    "item_name": "상부장 수정",
                    "spec": "800*320*700",
                    "qty": 2,
                    "unit": "EA",
                    "unit_price": 80000,
                    "is_special": False,
                    "needs_manual_review": False
                }
            ]
        }
        r = client.put(f"/api/quotations/{quot.id}", json=update_payload)
        check(
            f"PUT /api/quotations/{quot.id} returns 200",
            r.status_code == 200,
            f"status={r.status_code} body_preview={str(r.json())[:300]}"
        )
        if r.status_code == 200:
            data = r.json()
            check(
                "Quotation status updated to CONFIRMED",
                data.get("status") == "CONFIRMED",
                f"status={data.get('status')}"
            )
            check(
                "Quotation total_amount recalculated (2 * 80000 = 160000)",
                data.get("total_amount") == 160000,
                f"total_amount={data.get('total_amount')}"
            )

        # ── 8. Audit log created for item changes ────────────────────────────────
        print(f"\n{INFO} 8. Audit log verification")
        audits = db.query(models.QuotationItemAudit).filter(
            models.QuotationItemAudit.quotation_item_id == q_item.id
        ).all()
        check(
            "Audit records created for qty/unit_price/item_name changes",
            len(audits) >= 3,
            f"audit_count={len(audits)}, fields={[a.field_name for a in audits]}"
        )

        # ── 9. GET /api/samples ──────────────────────────────────────────────────
        print(f"\n{INFO} 9. GET /api/samples (manifest check)")
        r = client.get("/api/samples")
        if r.status_code == 404:
            print(f"{WARN} /api/samples returned 404 (sample/manifest.json not present – acceptable in CI)")
        else:
            check(
                "GET /api/samples returns 200",
                r.status_code == 200,
                f"status={r.status_code}"
            )
            if r.status_code == 200:
                check(
                    "Samples manifest is a list",
                    isinstance(r.json(), list),
                    f"type={type(r.json())}"
                )

        # ── Cleanup ───────────────────────────────────────────────────────────────
    finally:
        main.SessionLocal = original_main_session
        database.SessionLocal = original_db_session
        # ── Cleanup ───────────────────────────────────────────────────────────────
        main.app.dependency_overrides.clear()
        db.close()

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    total = passed + failed
    if failed == 0:
        print(f"  \033[92m[PASS] All {total} smoke tests PASSED\033[0m")
    else:
        print(f"  \033[91m[FAIL] {failed}/{total} smoke tests FAILED\033[0m")
    print("=" * 70 + "\n")

    return failed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run in-process smoke tests for CAD_Estimate API."
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print detail output for passing tests too"
    )
    args = parser.parse_args()

    failures = run_smoke_tests(verbose=args.verbose)
    sys.exit(1 if failures > 0 else 0)
