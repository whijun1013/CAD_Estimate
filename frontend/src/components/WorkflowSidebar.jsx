import {
  Activity,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  FileText,
  Layers,
  Sliders,
  UploadCloud,
} from 'lucide-react';

const workflowSteps = [
  { page: 'project-po', label: '발주서 등록', hint: '현장과 발주 내역 확인', icon: Briefcase },
  { page: 'cad-upload', label: '도면 분석', hint: '도면 업로드 및 AI 판독', icon: UploadCloud },
  { page: 'ai-review', label: '분석 검토', hint: 'AI 추론 항목 확인', icon: CheckCircle2 },
  { page: 'quotation', label: '견적서 확정', hint: '금액 검토 및 저장', icon: FileText },
];

export default function WorkflowSidebar({
  currentPage,
  onNavigate,
  reviewCount,
  project,
  projects,
  onProjectChange,
  apartmentTypes,
  selectedType,
  onTypeChange,
}) {
  return (
    <aside className="sidebar" aria-label="업무 탐색">
      <nav className="glass-card workflow-nav" aria-label="발주 업무 단계">
        <button
          id="menu-btn-dashboard"
          className={`overview-link ${currentPage === 'dashboard' ? 'active' : ''}`}
          onClick={() => onNavigate('dashboard')}
        >
          <Activity size={18} />
          <span>업무 현황</span>
        </button>

        <p className="nav-section-label">발주 진행</p>
        <ol className="workflow-list">
          {workflowSteps.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentPage === step.page;
            return (
              <li key={step.page}>
                <button
                  id={`menu-btn-${step.page}`}
                  className={`workflow-step ${isActive ? 'active' : ''}`}
                  onClick={() => onNavigate(step.page)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="workflow-index">{index + 1}</span>
                  <Icon size={18} aria-hidden="true" />
                  <span className="workflow-copy">
                    <strong>{step.label}</strong>
                    <small>{step.hint}</small>
                  </span>
                  {step.page === 'ai-review' && reviewCount > 0 && (
                    <span className="workflow-count" aria-label={`검토 필요 ${reviewCount}건`}>
                      {reviewCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="secondary-nav">
          <button
            id="menu-btn-furniture-schedule"
            className={currentPage === 'furniture-schedule' ? 'active' : ''}
            onClick={() => onNavigate('furniture-schedule')}
          >
            <ClipboardList size={17} /> 상세 산출표
          </button>
          <button
            id="menu-btn-developer-tools"
            className={currentPage === 'developer-tools' ? 'active' : ''}
            onClick={() => onNavigate('developer-tools')}
          >
            <Sliders size={17} /> AI 연결 · 설정
          </button>
        </div>
      </nav>

      {project && (
        <section className="glass-card context-card" aria-labelledby="project-context-title">
          <h2 id="project-context-title" className="card-title">
            <Briefcase size={16} /> 작업 대상
          </h2>
          <label className="field-label" htmlFor="project-selector">현장</label>
          <select
            id="project-selector"
            className="custom-select"
            value={project.id}
            onChange={(event) => onProjectChange(Number(event.target.value))}
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>

          <label className="field-label" htmlFor="type-selector">평형 타입</label>
          <select
            id="type-selector"
            className="custom-select"
            value={selectedType?.id ?? ''}
            onChange={(event) => onTypeChange(Number(event.target.value))}
            disabled={apartmentTypes.length === 0}
          >
            {apartmentTypes.length === 0 && <option value="">등록된 타입 없음</option>}
            {apartmentTypes.map((item) => (
              <option key={item.id} id={`apt-type-selector-${item.type_name}`} value={item.id}>
                {item.type_name} 타입 · {item.household_count}세대
              </option>
            ))}
          </select>
          <div className="context-summary">
            <Layers size={15} />
            <span>{apartmentTypes.length}개 타입 중 선택</span>
          </div>
        </section>
      )}
    </aside>
  );
}
