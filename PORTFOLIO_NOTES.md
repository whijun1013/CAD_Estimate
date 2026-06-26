# Portfolio Notes

이 저장소는 CAD/DXF 도면 기반 가구 수량 분석 및 견적 자동화 프로젝트의 포트폴리오 검토용 repository입니다.

## 검토 포인트

- `main.py`: FastAPI API, 프로젝트/도면/견적 관리 엔드포인트
- `pipeline.py`: 파일 검증, DXF 벡터 추출, AI 분석 provider, 견적 산출 pipeline
- `models.py`: 프로젝트, BOM, 견적, task 상태 모델
- `scripts/import_po_xlsx.py`: 발주서 Excel 파싱 및 DB 적재
- `scripts/evaluate_analysis.py`: 산출 결과와 golden fixture 비교 평가
- `tests/`: 파일 검증, DXF 추출, sample fixture, API 흐름 테스트
- `frontend/src/App.jsx`: 업로드, 분석 상태, 산출표, 견적 검토 UI

## 공개/공유 범위

포함:

- synthetic DXF fixture
- CI/테스트용 synthetic golden fixture
- backend/frontend 코드
- 실행/테스트 문서

제외:

- 실제 고객사 DWG/JPG/PDF 원본
- 실제 현장 발주서 XLSX
- 실제 샘플에서 파생된 golden JSON
- 고객사명/현장명이 포함된 sample manifest
- 로컬 SQLite DB
- 업로드 파일과 임시 산출물
- `.env`와 외부 AI API key

## 한계 표기

현재 구현은 DXF 중심의 로컬 처리와 demo/stub provider를 포함합니다. DWG/PDF 원본의 완전 자동 분석, 상용 CAD SDK 연동, 외부 VLM 기반 정밀 판독은 별도 고도화 범위입니다.
