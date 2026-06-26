import sys
import os
import time
import urllib.request
import urllib.error
import json

BASE_URL = "http://localhost:8000/api"

def make_request(url, method="GET", data=None, headers=None, is_json=True):
    if headers is None:
        headers = {}

    req = urllib.request.Request(url, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req, data=data) as response:
            res_data = response.read()
            if is_json:
                return json.loads(res_data.decode("utf-8")), response.status
            return res_data, response.status
    except urllib.error.HTTPError as e:
        err_data = e.read().decode("utf-8")
        try:
            err_json = json.loads(err_data)
            return err_json, e.code
        except:
            return err_data, e.code
    except Exception as e:
        print(f"Connection failed: {e}")
        return None, 500

import argparse

def normalize_base_url(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    if not base_url.endswith("/api"):
        base_url = f"{base_url}/api"
    return base_url


def run_smoke_test(base_url="http://localhost:8000/api"):
    base_url = normalize_base_url(base_url)
    print(f"=== Starting Smoke Test against {base_url} ===")

    # 0. Connection Pre-check
    print("\n0. Testing server connectivity/health...")
    health, status = make_request(f"{base_url}/config")
    if status != 200 or health is None:
        print("[SKIP] Server is not running or unreachable at the given URL.")
        print("Please start the backend server first (e.g. uvicorn main:app) before running the smoke test.")
        sys.exit(0)
    print(f"[PASS] Connection established. Config retrieved.")

    # 1. Test Project Listing
    print("\n1. Testing GET /api/projects...")
    projects, status = make_request(f"{base_url}/projects")
    if status != 200 or not isinstance(projects, list):
        print(f"[FAIL] Expected status 200 and list of projects, got status {status}: {projects}")
        sys.exit(1)
    print(f"[PASS] Retrieved {len(projects)} projects.")

    if len(projects) == 0:
        print("[WARN] No projects found. Make sure database is seeded.")
        sys.exit(0)

    project_id = projects[0]["id"]
    print(f"Using project ID: {project_id}")

    # 2. Test Stats
    print("\n2. Testing GET /api/stats...")
    stats, status = make_request(f"{base_url}/stats?project_id={project_id}")
    if status != 200 or stats.get("project_id") != project_id:
        print(f"[FAIL] Expected status 200 and project stats, got status {status}: {stats}")
        sys.exit(1)
    print(f"[PASS] Project stats: {stats}")

    # 3. Test Invalid File Upload (Txt extension)
    print("\n3. Testing invalid upload (txt extension)...")
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="project_id"\r\n\r\n'
        f"{project_id}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n'
        f"Content-Type: text/plain\r\n\r\n"
        f"dummy text content\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")

    resp, status = make_request(f"{base_url}/tasks/upload", method="POST", data=body, headers=headers)
    if status != 400:
        print(f"[FAIL] Expected status 400 for bad extension upload, got {status}: {resp}")
        sys.exit(1)
    print(f"[PASS] Blocked invalid extension with error: {resp.get('detail')}")

    # 4. Test Valid File Upload (Pdf extension)
    print("\n4. Testing valid upload (pdf extension)...")
    body_pdf = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="project_id"\r\n\r\n'
        f"{project_id}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="drawing.pdf"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
        f"%PDF-1.4 dummy pdf content\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")

    task, status = make_request(f"{base_url}/tasks/upload", method="POST", data=body_pdf, headers=headers)
    if status != 200 or not task.get("id"):
        print(f"[FAIL] Expected status 200 for valid file upload, got {status}: {task}")
        sys.exit(1)

    task_id = task["id"]
    print(f"[PASS] File uploaded successfully. Task ID: {task_id}")

    # 5. Poll task status
    print("\n5. Polling task status...")
    max_attempts = 10
    completed = False
    for attempt in range(max_attempts):
        time.sleep(1)
        status_data, status_code = make_request(f"{base_url}/tasks/{task_id}/status")
        if status_code != 200:
            print(f"[FAIL] Failed to fetch task status on attempt {attempt}: {status_data}")
            sys.exit(1)

        current_status = status_data.get("status")
        print(f"Attempt {attempt + 1}: Status = {current_status}")
        if current_status == "COMPLETED":
            completed = True
            break
        elif current_status == "FAILED":
            print(f"[FAIL] Task failed: {status_data.get('error_message')}")
            sys.exit(1)

    if not completed:
        print("[FAIL] Task did not complete in time.")
        sys.exit(1)
    print("[PASS] Task completed successfully.")

    # 6. Retrieve analysis results
    print("\n6. Retrieving quotation analysis results...")
    analysis, status = make_request(f"{base_url}/tasks/{task_id}/analysis")
    if status != 200 or not analysis.get("doc_number"):
        print(f"[FAIL] Expected status 200 and quotation, got {status}: {analysis}")
        sys.exit(1)

    print(f"[PASS] Quotation doc number: {analysis['doc_number']}")
    print(f"Total Amount: KRW {analysis['total_amount']:,}")
    print(f"Grand Total (with VAT): KRW {analysis['grand_total']:,}")
    print(f"Quotation Items count: {len(analysis['items'])}")

    print("\n=== Smoke Test Passed Successfully ===")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Smoke test for CAD_Estimate backend API.")
    parser.add_argument("--base-url", default="http://localhost:8000/api", help="Base URL of backend API (default: http://localhost:8000/api)")
    args = parser.parse_args()
    run_smoke_test(base_url=args.base_url)
