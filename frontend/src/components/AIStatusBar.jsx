import { CheckCircle2, Cpu, Sliders } from 'lucide-react';

export default function AIStatusBar({ isStubMode, config, healthData, onOpenSettings }) {
  if (!healthData?.provider_mode) return null;

  const isReady = !isStubMode && config?.openai_configured;

  return (
    <section className={`ai-status-bar ${isReady ? 'ready' : 'setup'}`} aria-live="polite">
      <div className="ai-status-copy">
        <span className="ai-status-icon">
          {isReady ? <CheckCircle2 size={19} /> : <Cpu size={19} />}
        </span>
        <div>
          <strong>{isReady ? '실제 AI 분석 준비 완료' : '현재 데모 분석 모드'}</strong>
          <p>
            {isReady
              ? `${config.provider?.toUpperCase()} · ${config.model || '설정 모델'}로 도면을 분석합니다.`
              : 'OpenAI API 키를 연결하면 업로드한 도면을 실제 모델로 바로 분석할 수 있습니다.'}
          </p>
        </div>
      </div>
      <button className="ai-status-action" onClick={onOpenSettings}>
        <Sliders size={16} /> {isReady ? 'AI 설정 확인' : 'AI 연결하기'}
      </button>
    </section>
  );
}
