# CAD_Estimate Operation Manual

## 1. 개요
CAD_Estimate는 건설/인테리어 발주서를 자동으로 관리하고, 도면 이미지에서 가구 산출표를 자동 추출하며 AI를 통해 규격 및 단가를 검수하는 애플리케이션입니다.

## 2. 초기 설정 및 실행
1. **환경 변수 설정**: `.env.example`을 참고하여 `.env` 파일을 생성합니다.
   ```env
   ALLOWED_ORIGINS=http://localhost:5173
   VISION_ANALYZER_PROVIDER=openai
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-4o
   ```
2. **백엔드 실행**:
   ```bash
   pip install -r requirements.txt
   python main.py
   ```
3. **프론트엔드 실행**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## 3. 핵심 운영 프로세스
### 3.1 단가 마스터 및 기초 데이터 임포트
발주서 Excel 데이터를 업로드하여 기초 DB를 구축합니다.
- 스크립트 실행: `python scripts/import_po_xlsx.py --file "local_private/sample_po.xlsx" --destructive-reload` (초기화)
- 웹 인터페이스: `API /api/samples/import-po` 호출로도 가능합니다.

### 3.2 도면 업로드 및 AI 산출/검수
- 프론트엔드에서 도면 이미지(JPG/PNG)를 업로드합니다.
- VLM(OpenAI Vision)을 통해 도면의 가구/규격 정보가 추출되고, 기존 마스터 DB와 매칭되어 자동 견적서가 생성됩니다.
- "검토 필요" 항목은 AI가 규격을 추론했거나 규격 외 사이즈(비규격 할증)가 적용된 항목입니다. 운영자는 해당 항목들을 중점적으로 검토해야 합니다.

### 3.3 견적서 수정 및 확정
- 운영자는 "수동 검토 및 편집"을 통해 규격 및 수량을 정정할 수 있습니다.
- 모든 수동 수정 이력은 "견적 수정 이력 추적"에 Audit 로그로 기록되어 추적 가능합니다.
- "확정 완료" 시 최종 발주 데이터로 저장되며, `Excel 다운로드`를 통해 보고서를 추출할 수 있습니다.

## 4. 트러블슈팅
- **AI 응답 지연/오류**: `OPENAI_API_KEY` 설정 여부를 점검하고, 백엔드 로그 `.backend_uvicorn.err.log`를 확인합니다.
- **포트 충돌**: 백엔드는 8000번, 프론트엔드는 5173번 포트를 사용합니다. 실행 중인 다른 프로세스가 없는지 확인합니다.
