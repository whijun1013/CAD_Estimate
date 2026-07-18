import {
  BarChart3,
  Cpu,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sliders,
  UploadCloud,
} from 'lucide-react';

function StatusItem({ label, value, tone = 'neutral' }) {
  return (
    <div className={`settings-status ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SampleTools({
  samples,
  importing,
  evaluating,
  importResult,
  evaluationResult,
  onLoad,
  onImport,
  onEvaluate,
}) {
  return (
    <details className="glass-card expandable-settings">
      <summary>
        <Sliders size={17} /> 샘플 데이터 도구
      </summary>
      <div className="expandable-body">
        <p className="settings-help">로컬 샘플 파일을 조회하고 발주 데이터 등록·정확도 평가를 실행합니다.</p>
        <button className="settings-button secondary" onClick={onLoad}>
          <RefreshCw size={15} /> 샘플 목록 불러오기
        </button>

        {samples.length > 0 && (
          <div className="sample-list">
            {samples.map((sample) => (
              <article key={sample.id} className="sample-item">
                <div>
                  <strong>{sample.file_name.split('/').pop()}</strong>
                  <p>{sample.notes}</p>
                  <span className={`availability ${sample.exists ? 'available' : 'missing'}`}>
                    {sample.exists ? `사용 가능${sample.file_size_mb ? ` · ${sample.file_size_mb}MB` : ''}` : '로컬 파일 없음'}
                  </span>
                </div>
                <div className="sample-actions">
                  {sample.file_type === 'xlsx' && (
                    <button
                      className="settings-button secondary"
                      onClick={() => onImport(sample.file_name)}
                      disabled={importing || !sample.exists}
                    >
                      <UploadCloud size={14} /> {importing ? '등록 중' : 'DB 등록'}
                    </button>
                  )}
                  {(sample.intended_use === 'golden_dataset' || sample.file_name.includes('262603000301')) &&
                    (sample.file_type === 'dwg' || sample.file_type === 'xlsx') && (
                      <button
                        className="settings-button secondary"
                        onClick={() => onEvaluate(sample.linked_purchase_order_file || sample.file_name)}
                        disabled={evaluating || !sample.exists}
                      >
                        <BarChart3 size={14} /> {evaluating ? '평가 중' : '정확도 평가'}
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        )}

        {importResult && (
          <div className="settings-result success">
            <strong>발주 데이터 등록 완료</strong>
            <span>{importResult.project} · {importResult.po_number}</span>
            <span>세대 타입 {importResult.apartment_types}종 · BOM {importResult.bom_items}개</span>
          </div>
        )}

        {evaluationResult && (
          <div className="settings-result info">
            <strong>정확도 평가 결과</strong>
            <div className="metrics-grid">
              <span>정밀도 <b>{evaluationResult.summary.precision}%</b></span>
              <span>재현율 <b>{evaluationResult.summary.recall}%</b></span>
              <span>F1 <b>{evaluationResult.summary.f1_score}%</b></span>
              <span>치수 일치율 <b>{evaluationResult.summary.dimension_match_rate}%</b></span>
              <span>수량 오차율 <b>{evaluationResult.summary.quantity_error_rate}%</b></span>
              <span>금액 오차율 <b>{evaluationResult.summary.amount_error_rate}%</b></span>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export default function DeveloperToolsPage({
  healthData,
  config,
  appApiKey,
  onAppApiKeyChange,
  openAiKeyInput,
  onOpenAiKeyInputChange,
  savingOpenAiKey,
  onSaveOpenAiKey,
  samples,
  importingPo,
  evaluating,
  importResult,
  evaluationResult,
  onLoadSamples,
  onImportPo,
  onEvaluateGolden,
}) {
  const providerMode = healthData?.provider_mode;
  const aiReady = config?.provider === 'openai' && config?.openai_configured;

  return (
    <div className="settings-page">
      <section className="glass-card ai-connection-card">
        <div className="settings-heading">
          <span className="settings-heading-icon"><Cpu size={20} /></span>
          <div>
            <h2>OpenAI 연결</h2>
            <p>API 키 하나로 도면 비전 분석과 결과 검수를 함께 활성화합니다.</p>
          </div>
        </div>

        <div className="settings-grid">
          <StatusItem label="연결 상태" value={aiReady ? '사용 가능' : '설정 필요'} tone={aiReady ? 'success' : 'warning'} />
          <StatusItem label="비전 분석" value={config?.provider || 'stub'} tone={config?.provider === 'openai' ? 'success' : 'neutral'} />
          <StatusItem label="AI 검수" value={config?.real_ai_review_enabled ? 'OpenAI' : 'Local'} tone={config?.real_ai_review_enabled ? 'success' : 'neutral'} />
          <StatusItem label="분석 모델" value={config?.model || 'gpt-5.6'} />
        </div>

        <label className="settings-field" htmlFor="openai-key-input">
          <span>OpenAI API 키</span>
          <div className="secret-row">
            <input
              id="openai-key-input"
              type="password"
              autoComplete="off"
              placeholder={aiReady ? '새 키를 입력하면 현재 연결을 교체합니다' : 'sk-...'}
              value={openAiKeyInput}
              onChange={(event) => onOpenAiKeyInputChange(event.target.value)}
            />
            <button
              className="settings-button primary"
              onClick={onSaveOpenAiKey}
              disabled={savingOpenAiKey || !openAiKeyInput.trim()}
            >
              <KeyRound size={15} /> {savingOpenAiKey ? '연결 중' : aiReady ? '키 교체' : '연결하기'}
            </button>
          </div>
        </label>

        <div className="deployment-note">
          <ShieldCheck size={18} />
          <div>
            <strong>배포 환경에서는 비밀키를 서버 환경변수로 등록하세요.</strong>
            <p>화면 입력값은 현재 서버 실행 중에만 유지되며 브라우저와 DB에는 저장하지 않습니다.</p>
            <div className="deployment-vars">
              <code>OPENAI_API_KEY</code>
              <code>OPENAI_MODEL=gpt-5.6</code>
              <code>VISION_ANALYZER_PROVIDER=openai</code>
              <code>AI_REVIEW_PROVIDER=openai</code>
              <code>ALLOW_MOCK_PROVIDER=false</code>
            </div>
          </div>
        </div>
      </section>

      <details className="glass-card expandable-settings">
        <summary>
          <Sliders size={17} /> 고급 진단 및 앱 접근 키
        </summary>
        <div className="expandable-body">
          <label className="settings-field" htmlFor="app-access-key">
            <span>앱 접근 API 키</span>
            <div className="secret-row">
              <input
                id="app-access-key"
                type="password"
                autoComplete="off"
                placeholder="서버 API_KEY와 동일한 값"
                value={appApiKey}
                onChange={(event) => onAppApiKeyChange(event.target.value)}
              />
              {appApiKey && (
                <button className="settings-button danger" onClick={() => onAppApiKeyChange('')}>지우기</button>
              )}
            </div>
          </label>

          {providerMode ? (
            <div className="diagnostic-grid">
              <StatusItem label="도면 변환" value={providerMode.drawing_converter} />
              <StatusItem label="벡터 추출" value={providerMode.vector_extractor} />
              <StatusItem label="비전 분석" value={providerMode.vision_analyzer} />
              <StatusItem label="모의 분석" value={providerMode.allow_mock_provider} tone={providerMode.allow_mock_provider === 'true' ? 'warning' : 'success'} />
            </div>
          ) : (
            <p className="settings-error">서버 진단 정보를 불러오지 못했습니다.</p>
          )}
        </div>
      </details>

      <SampleTools
        samples={samples}
        importing={importingPo}
        evaluating={evaluating}
        importResult={importResult}
        evaluationResult={evaluationResult}
        onLoad={onLoadSamples}
        onImport={onImportPo}
        onEvaluate={onEvaluateGolden}
      />
    </div>
  );
}
