# CAD/DWG 도면 가구 수량 분석 및 견적 자동화 솔루션 (Smart Purchase Order Analysis)

본 프로젝트는 아파트 현장 도면(CAD/DWG/DXF/PDF) 분석을 통해 주방 및 현관 신발장 가구 모듈의 수량을 자동으로 추출하고, 단가 마스터 정보와 연동하여 자동으로 가구 발주서 및 견적 내역서를 생성하고 수동으로 검증/조정할 수 있는 기업형(Sales Demo/Pilot) 솔루션입니다.

---

## 1. 주요 기능
* **도면 파일 보안 업로드**: 빈 파일 차단, 최대 50MB 크기 제어, 파일명 충돌 제거(UUID+Timestamp 조합) 및 Path Traversal 방어.
* **매직 바이트(Magic Bytes) 헤더 검증**: 파일 확장자 위조 방지를 위해 파일의 실제 바이너리 헤더(PDF, PNG, JPG, DXF, DWG) 검증 및 위험 감지.
* **7단계 분석 파이프라인 (Multi-Stage Pipeline)**:
  1. `파일 검증 (FILE_VALIDATION)`: 업로드 파일 물리 보안 및 포맷 체크.
  2. `형식 판별 (FORMAT_IDENTIFICATION)`: DWG/DXF 바이너리 시그니처 대조 및 변환 대상 필터링.
  3. `변환 단계 (FORMAT_CONVERSION)`: 도면 파일 벡터 렌더링 및 PDF/이미지 정규화.
  4. `텍스트/치수 추출 단계 (TEXT_DIMENSION_EXTRACTION)`: CAD 벡터 구성요소 치수선 텍스트 및 레이블 1차 추출.
  5. `이미지/OCR/비전 분석 단계 (OCR_VISION_ANALYSIS)`: Gemini/OpenAI 비전 모델 기반 입면도 가구 배치 구조 판독.
  6. `결과 병합 단계 (VISUAL_VECTOR_ANCHOR_MERGING)`: 비전 인식 바운딩 박스와 CAD 치수 정밀 좌표 상호 크로스 앵커링.
  7. `견적 산출 단계 (PRICING_ESTIMATE_CALCULATION)`: 마스터 단가표(CabinetPriceMaster) 및 비규격 할증률을 결합한 견적서 자동 산출.
  8. `AI 자동 검수 단계 (AI_REVIEW_AND_REPORTING)`: AI가 단가 출처, 규격, 할증 사유를 분석하고 "수동 검토 필요" 여부를 자동으로 마킹.
* **BOM 발주서 양방향 동기화 및 Diff 검증**: 발주처 Excel 데이터를 업로드 시 기존 데이터베이스의 멱등(Idempotent) 갱신은 물론 추가/수정/삭제된 항목을 식별하는 Diff Report 출력.
* **Excel 보고서 내보내기**: AI의 치수/단가 검토 사유 및 신뢰도, 출처가 모두 포함된 산출물(`견적서 Excel`, `가구 산출표 Excel`) 다운로드 지원.
* **인터랙티브 검증 및 collection 동기화**: 생성된 견적서 내역에 대해 관리자가 직접 수정/추가/삭제할 수 있는 동기화 API.
* **프로젝트 다중 스코핑**: 하나의 시스템에서 여러 현장(Project) 정보를 격리하여 평형 정보, BOM 마스터, 태스크, 견적 등을 관리.
* **타입별 필요 가구 산출표**: 가격 중심의 견적이 아니라, 실제 시공 도면에 적힌 가구의 폭/높이/깊이 치수를 바탕으로 평형 타입별 필요 가구를 추출하여 집계하고, 누락된 치수는 카테고리별 기본값을 기준으로 AI 추론 보완하여 검토 필요 항목과 산출 근거를 투명하게 제공.

---

## 2. 실제 분석 vs 데모/Stub 한계
현재 배포된 데모 버전은 실제 AI/CAD 분석 파이프라인의 물리 구조를 시각화하고 영업 데모를 매끄럽게 수행하기 위해 다음과 같이 구현되어 있습니다.

* **동적 파일 분석 시뮬레이션(Stub)**: 업로드된 파일명 및 평형 마스터 정보(예: `84A`)에 따라 데이터베이스에 적합한 BOM 자재들을 실시간 바인딩하여 각각 다른 견적서를 연산해 줍니다.
* **DWG/DXF 로컬 변환 제약 및 구현 범위**: 이번 작업 범위에서는 외부 유료 API나 상용 CAD SDK 없이 무료/로컬 구현 가능하도록, **DWG의 자동 변환/파싱 기능은 제외하고 DXF 업로드를 메인 입력으로 고정**합니다. DWG 업로드 시 변환을 중단하고 사용자에게 DXF로 변환 후 재업로드 하도록 명시적 오류 메시지를 반환합니다. DXF 파싱 시에는 도면의 치수, 텍스트, 레이어, 블록 정보를 기반으로 가구 후보를 산출하고, 누락된 치수는 AI 추론 로직을 통해 보완한 뒤 관리자가 검토/수정할 수 있도록 지원합니다.
* **DWG/DXF 물리 파서 격리**: 서버 백엔드 리포지토리의 `pipeline.py` 내에 7대 핵심 단계가 명시적으로 구분되어 있으며, 실제 로컬 변환 및 API 처리가 어려운 단계는 **Stub Provider**로 격리되어 안전하게 동작합니다.
* **실제 OpenAI 연동 모드 지원 (Responses API 기반)**: `.env`에 `OPENAI_API_KEY`를 등록하고 `VISION_ANALYZER_PROVIDER=openai`를 설정하면, Stub 모드를 벗어나 실제 OpenAI API(gpt-4o 모델 등)를 호출하여 도면(이미지) 비전 분석 및 AI 가구 산출, AI 자동 검수 로직이 구동됩니다. 이 과정에서 **OpenAI Responses API (Structured Outputs)** 를 엄격하게 사용하여 JSON 스키마 기반의 견고한 객체 반환을 보장합니다. 프론트엔드의 업로드 페이지에 현재 엔진 상태와 활성화 여부가 투명하게 표시됩니다.
* **포맷별 분석 지원 한계 (PDF/DWG)**: 현재 파일 업로드 시 JPG, PNG와 같은 이미지 형식과 순수 `ezdxf` 기반의 DXF 형식은 실제 분석 파이프라인(Vision 및 Vector 추출)을 통해 완벽히 지원됩니다. 그러나 복잡한 기하 변환이 필요한 PDF 및 DWG 원본 형식에 대해서는 실제 서버 파이프라인에서 추출하는 대신 **제한적 Fixture 우회(Stub) 로직**이 동작하도록 설정되어 있으므로, 실 환경 적용 전 PDF/DWG 파싱 모듈 추가 등 고도화가 요구됩니다.

---

## 3. 기술 스택
* **Backend**: FastAPI (Python 3.10+), SQLAlchemy Core/ORM, SQLite, Pydantic V2, Pytest
* **Frontend**: React (Vite), Vanilla CSS, Lucide React (아이콘), Recharts (동별 수량 차트)

---

## 4. 환경 변수 및 설정 (`.env`)
프로젝트 루트 디렉터리에 아래와 같이 `.env` 파일을 구성합니다. (보안상의 이유로 리포지토리에 직접 커밋되지 않습니다.)

```env
# CORS 설정 (쉼표 구분)
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# 파일 업로드 제어
UPLOAD_DIR=./uploads
MAX_UPLOAD_SIZE=52428800

# 견적 계산 변수
DEFAULT_VAT_RATE=0.10
SURCHARGE_RATE=0.30

# 데이터베이스 경로
DATABASE_URL=sqlite:///./construction_orders.db

# AI 분석 & VLM Provider 설정
# 지원 Provider: stub | openai | anthropic | qwen_local
VISION_ANALYZER_PROVIDER=stub
# AI 검수 Provider: local | stub | disabled | openai
AI_REVIEW_PROVIDER=local

# OpenAI 설정 (openai provider 사용 시 필수)
# OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o

# Anthropic 설정 (anthropic provider 사용 시 필수)
# ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Qwen Local 설정 (qwen_local provider 사용 시 필수)
QWEN_LOCAL_ENDPOINT=http://localhost:11434/v1
```

---

## 4-1. 무료 로컬 처리와 비용 발생 가능 항목

DXF 업로드를 기본 입력으로 사용하는 현재 구현에서는 다음 기능을 외부 유료 서비스 없이 로컬에서 실행할 수 있습니다.

* **무료/로컬 처리 가능**: DXF 파일 검증, `ezdxf` 기반 벡터/치수/텍스트 추출, 룰 기반 필요 가구 산출, 누락 치수 기본값 보완, 검토 필요 플래그, 수량/규격/단가 수동 수정, Excel 견적서 생성, SQLite 기반 로컬 저장.
* **비용 발생 가능**: OpenAI 등 외부 AI API 기반 비전/검수, 클라우드 서버/DB/스토리지/백업/모니터링, 도메인/SSL 운영, 이메일/문자 알림, 상용 CAD SDK 또는 DWG 자동 변환 도구 연동.
* **운영 권장값**: `VISION_ANALYZER_PROVIDER=stub`, `AI_REVIEW_PROVIDER=local`을 기본값으로 두고, 실제 OpenAI 검수는 API 키와 비용 한도를 명시적으로 설정한 환경에서만 `AI_REVIEW_PROVIDER=openai`로 활성화합니다.
* **DWG 정책**: 이번 범위에서는 DWG 자동 변환을 구현하지 않습니다. 사용자는 AutoCAD, TrueView, ODA 등 별도 도구에서 DXF로 변환한 뒤 업로드해야 합니다.

---

## 5. 실행 및 설정 방법

### 백엔드 (Backend)
1. Python 의존성 라이브러리를 설치합니다.
   ```bash
   pip install -r requirements.txt
   ```
2. 데이터베이스를 초기화하고 초기 마스터 데이터를 시딩(Seed)합니다. (Excel 데이터 마이그레이션 포함)
   ```bash
   # 기존 DB를 초기화하고 신규 리셋 시딩
   python init_db.py --reset
   ```
3. 백엔드 개발 서버를 기동합니다.
   ```bash
   python main.py
   ```
   * 서버 주소: `http://localhost:8000`
   * API 대화형 문서: `http://localhost:8000/docs`

### 프론트엔드 (Frontend)
1. 프론트엔드 디렉터리로 이동하여 NPM 패키지를 설치합니다.
   ```bash
   cd frontend
   npm install
   ```
2. 개발 모드로 웹 애플리케이션을 실행합니다.
   ```bash
   npm run dev
   ```
   * 웹 주소: `http://localhost:5173`

---

## 6. 데이터베이스 마이그레이션 (DB Schema Migrations)

시스템 스키마 변경 시 아래의 멱등(Idempotent) 마이그레이션 스크립트를 사용하여 데이터 유실 없이 안전하게 스키마를 업데이트할 수 있습니다.
* **SQLite 및 PostgreSQL 지원**: 로컬 SQLite와 상용 PostgreSQL을 감지하여 안전하게 컬럼 및 테이블 검증을 진행합니다.
* **멱등성 보장**: 마이그레이션 스크립트는 여러 번 반복 실행해도 에러를 내지 않고 안전하게 넘어갑니다.

### 실행 방법
```bash
# 1. 마이그레이션 시뮬레이션 실행 (드라이런)
python scripts/migrate_db.py --dry-run

# 2. 실제 데이터베이스 마이그레이션 반영
python scripts/migrate_db.py --database sqlite:///./construction_orders.db
```

---

## 7. 테스트 및 검증 실행 (Testing & Verification)

본 프로젝트는 테스트의 목적과 구동 조건에 따라 다음 세 가지 검증 프로세스로 분리되어 관리됩니다.

### 1) 단위/통합 테스트 (Unit & Integration Tests)
로컬에 외부 의존성(구동 중인 웹 서버)이 없어도 FastAPI `TestClient` 등을 활용해 로컬 코드 자체의 올바름을 입증하는 격리 테스트 세트입니다.
```bash
# 잠금 에러 방지를 위해 임시 디렉토리를 지정하여 pytest 실행
python -m pytest tests -q --basetemp .pytest_tmp_run
```

### 2) 로컬 스모크 테스트 (Local Self-contained Smoke Test)
서버를 실제 구동시키지 않은 상태에서 백엔드 핵심 라이브러리와 API의 전반적인 결합 흐름을 모의 검증하는 스모크 테스트입니다.
```bash
python scripts/smoke_test_local.py
```

### 3) 구동 서버 스모크 테스트 (Running-server Smoke Test)
실제 구동 중인 외부 또는 로컬 웹 서버(`uvicorn main:app` 등)의 API 종단점을 직접 호출하며 네트워크 및 파일 업로드, AI 분석 비파괴적 파이프라인의 완성도를 점검하는 테스트입니다.
```bash
# uvicorn main:app 기동 후, 다른 터미널에서 실행
python smoke_test.py --base-url http://127.0.0.1:8000/api
```
* **동작 특징**: 대상 서버가 실행되지 않았거나 통신이 불가능할 경우, 테스트 실패 에러 대신 명확한 가이드라인과 함께 **[SKIP]** 처리되어 안전하게 종료됩니다.

### 4) 프론트엔드 빌드 및 린트 검증 (NPM CMD 사용)
```bash
cd frontend
npm run lint
npm run build
```

---

## 8. GitHub Push 전 체크리스트 및 보안/민감 파일 정책
* [ ] `.env` 파일이 `.gitignore`에 등록되어 커밋 제외 처리되었는지 여부.
* [ ] 로컬 SQLite DB 파일(`construction_orders.db`) 및 `uploads/` 폴더가 커밋 대상에서 빠졌는지 여부.
* [ ] 빌드 결과물(`frontend/dist/`) 및 의존성 라이브러리(`node_modules/`, `__pycache__/`, `.pytest_*/`)가 커밋 제외되었는지 여부.
* [ ] 민감한 실무 발주서 원본(`.xlsx` 파일) 및 개인 정보(연락처/담당자명)가 포함된 골든 Fixtures(`tests/fixtures/golden/po_262512001101.json`, `tests/fixtures/golden/po_262508001001.json`)가 커밋 및 push 목록에서 완벽히 배제되었는지 여부.
* [ ] 테스트 및 빌드 도중 생성되는 임시/비교 데이터 파일(`tests/fixtures/golden/*_actual.json` 등)이 Git 추적 대상에서 차단되었는지 여부.
* [ ] `python -m pytest` 실행 시 에러 없이 통과하는지 여부.
* [ ] 프론트엔드 `npm run build` 및 `npm run lint`가 에러 없이 성공하는지 여부.
* [ ] `scripts/migrate_db.py --dry-run`이 정상적으로 실행되는지 여부.
* [ ] `smoke_test.py` 실행 시 서버 미동작에 대한 안내가 안전하게 나오는지 여부.

---

## 9. 향후 실제 DWG/DXF 분석 고도화 로드맵
1. **ezdxf 기반 파서 도입**: DXF 파일 내 `INSERT`, `LINE`, `TEXT`, `MTEXT` 엔티티를 완벽히 매핑하여 시공 도면의 가식선과 가전(냉장고 등) 영역을 분리.
2. **Gemini 2.5 Pro Vision 튜닝**: 가구 입면도 이미지를 fine-tuning하여 비정형 손글씨 및 비규격 시공 요청 조건의 인식률을 98% 이상 확보.
3. **영역 매칭 앵커 알고리즘**: 비전 경계 정보의 좌표(Pixel)를 CAD 내 실제 1mm 단위의 도면 좌표(Millimeter)로 변환해 정확한 제품코드를 마스터 단가표와 자동 매핑하는 AI-Vector 하이브리드 엔진 구축.

---

## 10. Public Fixture Workflow

이 repository는 public 공개를 전제로 정리되어 있으며, 실제 현장 도면, 발주서, 고객사명, 현장명, 단가/수량 정보가 포함된 샘플은 포함하지 않습니다.

> [!NOTE]
> 실제 고객사 도면/DWG/XLSX와 해당 파일에서 파생된 golden JSON은 Git에 커밋하지 않습니다. 공개 저장소에서는 synthetic fixture만 사용합니다.

### 1) 공개 fixture 구성

공개 검증에는 아래 파일만 사용합니다.

* `tests/fixtures/synthetic_kitchen.dxf`
* `tests/fixtures/synthetic_shoe.dxf`
* `tests/fixtures/golden/po_synthetic_sample.json`

### 2) XLSX 발주서 파싱 및 DB 임포트

실제 발주서 Excel은 로컬 보안 저장소에서만 사용합니다.

```bash
python scripts/import_po_xlsx.py --file "local_private/sample_po.xlsx"
```

`local_private/`, `sample/`, `uploads/`, `*.dwg`, `*.db`는 Git 추적 대상에서 제외되어야 합니다.

### 3) 골든 데이터셋 JSON 익스포트

공개 저장소에는 synthetic golden fixture만 유지합니다. 실제 발주서에서 생성한 golden JSON은 로컬 검증용으로만 사용합니다.

```bash
python scripts/export_golden_dataset.py \
  --file "local_private/sample_po.xlsx" \
  --output "local_private/golden/private_po.json"
```

### 4) AI 분석 결과 평가 방법

AI가 산출한 수량/품목 JSON 결과와 synthetic fixture 간의 오차 및 매칭률을 검증합니다.

```bash
python scripts/evaluate_analysis.py \
  --expected tests/fixtures/golden/po_synthetic_sample.json \
  --actual local_private/po_synthetic_actual.json \
  --apartment-type 84A \
  --dimension-tolerance-mm 10
```
* **평가 메트릭 및 평가 지표 정의**:
  - **정밀도(Precision)**: AI가 검출한 품목 중 실제 정답(Expected)과 매치되는 비율.
  - **재현율(Recall)**: 실제 정답 품목 중 AI가 누락 없이 성공적으로 찾아낸 비율.
  - **F1-Score**: 정밀도와 재현율의 조화 평균으로, AI 가식 검증의 핵심 종합 성능 지표.
  - **치수 일치율(Dimension Match Rate)**: 가로/세로/깊이 규격이 지정한 허용 오차(`--dimension-tolerance-mm`, 기본 10mm) 내에서 정답과 일치하는 매칭 품목의 비율.
  - **수량 오차율(Quantity Error Rate)**: 전체 예상 수량 대비 누락되거나 초과 검출된 절대 수량 편차의 비율.
  - **금액 오차율(Amount Error Rate)**: 마스터 단가표 기준의 예상 전체 견적 금액 대비 AI 검출 결과 금액의 편차 백분율.
  - **모호한 항목(Ambiguous Actual Items)**: 실제 검출 목록 중 평형 타입(`apartment_type`)이 지정되지 않아 매칭 비교 시 ambiguous 처리되는 품목군.

### 5) 운영 보안 및 성능 원칙
* **DWG 원본 파일 비공개 유지**: 고객사 도면 자산인 DWG 파일은 보안을 위해 절대 원격 Git 퍼블릭 레포에 커밋되어서는 안 됩니다. `.gitignore`의 `*.dwg` 규칙으로 신규 DWG 추가를 차단하며, 기존에 추적되던 DWG도 Git 인덱스에서 제거한 뒤 로컬/보안 저장소에서만 관리합니다.
* **민감 XLSX/파생 Fixture 비공개 유지**: 고객사 원본 XLSX와 해당 파일에서 생성한 golden JSON은 Git에 커밋하지 않습니다. CI와 public 검증에는 synthetic fixture만 사용합니다.
* **회귀 테스트 연산 최소화**: 대용량 도면 전체 파싱은 리소스를 크게 소모하므로, public 테스트는 synthetic DXF와 synthetic JSON fixture 위주로 경량 수행합니다.

---

## 11. 타입별 필요 가구 산출 및 치수 추론 정책

본 솔루션은 실제 도면에서 일부 가구의 높이(Height)나 깊이(Depth) 값이 모호하게 표현되거나 누락되는 실무적 문제를 해결하기 위해 **치수 추론 보조 정책**을 적용하고 있습니다.

### 1) 치수 추론 및 검토 필요 기준
* **폭(Width)**: 도면 텍스트나 BOM에서 가장 신뢰성이 높게 추출되므로 기본적으로 도면 텍스트(`drawing_text`)로 인식합니다. 만약 누락된 경우 기본값 `600`을 적용하고 `default_by_category`로 표시합니다.
* **높이(Height) / 깊이(Depth)**: 값이 없거나 `0`인 경우, 가구 카테고리별 표준 치수를 기준으로 자동 추론합니다:
  - `상부장` (상부, 후드, 플랩 등 포함) &rarr; 높이: 700mm, 깊이: 320mm
  - `하부장` (하부, 싱크 등 포함) &rarr; 높이: 850mm, 깊이: 600mm
  - `키큰장` (키큰장, 냉장고장, 톨장 등 포함) &rarr; 높이: 2200mm, 깊이: 600mm
  - `피라/앤드판넬` (판넬, 휠라, 피라 등 포함) &rarr; 높이: 2200mm, 깊이: 600mm
  - `코니스/걸레받이` (코니스, 걸레받이, 서라운드 등 포함) &rarr; 높이: 80mm, 깊이: 18mm
  - `기타 (기본 fallback)` &rarr; 높이: 700mm, 깊이: 320mm
* **검토 여부 및 신뢰도 패널티**:
  - 치수가 하나라도 추론/기본값으로 채워지면 해당 품목은 자동으로 **검토 필요(`needs_review = true`)** 상태가 되며, 구체적인 추론 사유가 산출 근거에 기재됩니다.
  - 추론 필드가 많아질수록 신뢰도(Confidence)가 하향 조정됩니다 (0개 추론: 100%, 1개 추론: 85%, 2개 추론: 75%, 3개 추론: 60%).

### 2) 화면 표시 및 UI 컴포넌트
* **필요 가구 산출표 탭**: 평형별 상세 보기 화면에 추가된 전용 탭에서 품목 정보 및 수량을 한눈에 확인 가능합니다.
* **치수 구분**: 추론 및 기본값이 적용된 치수 옆에는 `[추론]` 배지가 시각적으로 표시되어 확정값과 명확히 구분됩니다.
* **검토 필요 표시**: 빨간색 `검토 필요` 경고 배지와 구체적인 이유가 적힌 가이드 컬럼을 통해 관리자가 즉시 인지하고 수정 검증할 수 있도록 지원합니다.

---

## 12. API Key 인증 사용법

본 시스템은 중요 API 종단점(프로젝트 관리, 도면 업로드, 견적 갱신 등)의 무단 사용을 방지하기 위해 **API Key 인증**을 지원합니다.
* **보안 설정**: `.env` 파일의 `API_KEY` 값을 임의의 안전한 키(예: `my_secret_api_key_2026`)로 설정하여 서버를 구동합니다. 만약 `API_KEY` 값이 비어있는 경우, 로컬 개발 편의를 위해 인증 과정이 생략됩니다.
* **클라이언트 인증 전달 방식**:
  - **헤더 인증**: 모든 요청의 HTTP 헤더에 `X-API-Key: [본인의_API_KEY]` 형식으로 키를 실어 보냅니다.
  - **Bearer 인증**: HTTP Authorization 헤더에 `Bearer [본인의_API_KEY]` 형식으로 키를 실어 보낼 수 있습니다.
* **개발자 도구 연동**: 프론트엔드의 `개발자 도구` 메뉴에서 현재 사용 중인 API Key를 등록/수정하여 웹 인터페이스에서 즉시 통신이 가능하도록 지원합니다.

---

## 13. 업로드 파일 보관 및 삭제 정책

* **파일명 고유화**: 업로드된 도면 파일은 중복 충돌 및 덮어쓰기 방지를 위해 `[Timestamp]_[UUID]_[원본파일명]` 형식의 고유화된 이름으로 변환되어 `uploads/` 디렉터리에 격리 보관됩니다.
* **임시/부분 파일 정리**: 네트워크 전송 도중 에러가 나거나 데이터베이스 커밋 실패 등 비정상적으로 종료되는 경우, `uploads/` 폴더 내에 누적되는 불필요한 부분 파일(Partial file)이나 임시 파일은 백엔드에서 감지하여 예외 처리 시 즉시 물리적 삭제(`os.remove`)되도록 보장합니다.
* **DWG/DXF 설계 도면 자산**: 설계 원본 파일(DWG)은 외부 유출을 방지하기 위해 Git 형상 관리에서 배제되며 로컬 스토리지에만 저장됩니다.
