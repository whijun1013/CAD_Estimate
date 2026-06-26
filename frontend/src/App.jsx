import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import {
  Building2,
  Layers,
  Search,
  Tag,
  Info,
  Briefcase,
  Calendar,
  Activity,
  Sliders,
  CheckCircle2,
  Maximize2,
  FileText,
  Cpu,
  UploadCloud,
  AlertTriangle,
  Trash2,
  ChevronUp,
  ChevronDown,
  Check,
  Save,
  Edit3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  List,
  Database
} from 'lucide-react';
import { apiClient } from './apiClient';

const DistributionChart = lazy(() => import('./components/DistributionChart'));

const parsePipelineLogs = (rawResponse) => {
  if (!rawResponse) return [];
  const stages = [];
  const blocks = rawResponse.split('-'.repeat(80));

  blocks.forEach(block => {
    const trimmed = block.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('[Pipeline Success]')) {
      return;
    }

    const headerMatch = trimmed.match(/^\[(.*?)\]\s+Duration:\s+([\d.]+)s\s+\|\s+Status:\s+(\w+)/i);
    if (!headerMatch) return;

    const name = headerMatch[1];
    const duration = parseFloat(headerMatch[2]);
    const status = headerMatch[3];

    const logMatch = trimmed.match(/Log:\s+(.*)/);
    const logText = logMatch ? logMatch[1].trim() : '';

    const confEvidenceMatch = trimmed.match(/Confidence:\s+([\d.]+)\s+\|\s+Evidence:\s+(.*)/);
    const confidence = confEvidenceMatch ? parseFloat(confEvidenceMatch[1]) : 1.0;
    const evidence = confEvidenceMatch ? confEvidenceMatch[2].trim() : '';

    stages.push({
      name,
      duration,
      status,
      logText,
      confidence,
      evidence
    });
  });
  return stages;
};

const MEASURED_DIMENSION_SOURCES = new Set([
  'cad_dimension',
  'block_attribute',
  'block_name',
  'drawing_text',
  'ocr_text',
  'bom',
  'dxf_entity'
]);

const isMeasuredDimensionSource = (src) => MEASURED_DIMENSION_SOURCES.has(src);

const renderDimBadge = (src) => {
  if (src === 'cad_dimension' || src === 'dxf_entity') return <span className="badge-source cad">CAD치수</span>;
  if (src === 'block_attribute') return <span className="badge-source block">블록속성</span>;
  if (src === 'block_name') return <span className="badge-source block">블록명</span>;
  if (src === 'drawing_text') return <span className="badge-source drawing">도면</span>;
  if (src === 'ocr_text') return <span className="badge-source ocr">OCR</span>;
  if (src === 'bom') return <span className="badge-source bom">BOM</span>;
  if (src === 'ai_inferred') return <span className="badge-source inferred">추론</span>;
  if (src === 'default_by_category') return <span className="badge-source default-cat">기본값</span>;
  if (src === 'manual_review') return <span className="badge-source manual">검수완료</span>;
  return <span className="badge-source default-cat">{src || '도면'}</span>;
};

const INFERRED_DIMENSION_STYLE = {
  backgroundColor: 'rgba(245, 158, 11, 0.2)',
  color: '#f59e0b',
  padding: '0.1rem 0.2rem',
  borderRadius: '3px'
};

const splitSpecParts = (spec) => {
  const raw = String(spec || '').trim();
  if (!raw) return ['-', '-', '-'];

  const normalized = raw.replace(/[×xX]/g, '*');
  const starParts = normalized.split('*').map(part => part.trim()).filter(Boolean);
  if (starParts.length >= 3) {
    return [starParts[0], starParts[1], starParts.slice(2).join(' * ')];
  }

  const numericParts = raw.match(/\d+(?:\.\d+)?/g);
  if (numericParts && numericParts.length >= 3) {
    return numericParts.slice(0, 3);
  }

  if (starParts.length === 2) return [starParts[0], starParts[1], '-'];
  if (starParts.length === 1) return [starParts[0], '-', '-'];
  return [raw, '-', '-'];
};

function App() {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [aptTypes, setAptTypes] = useState([]);
  const [selectedType, setSelectedType] = useState(null);

  const [currentPage, setCurrentPage] = useState('dashboard');
  const [editValues, setEditValues] = useState({});
  const [projectPoTab, setProjectPoTab] = useState('bom'); // 'bom', 'specs', 'quotation'
  const [cadUploadTab, setCadUploadTab] = useState('real'); // 'real', 'demo'

  const [materials, setMaterials] = useState([]);
  const [hardware, setHardware] = useState([]);
  const [bom, setBom] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingSpecs, setLoadingSpecs] = useState(false);
  const [loadingBom, setLoadingBom] = useState(false);

  // BOM Pagination, Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [onlySpecial, setOnlySpecial] = useState('All'); // 'All', 'Special', 'Standard'
  const [bomPage, setBomPage] = useState(1);
  const [bomTotal, setBomTotal] = useState(0);
  const bomLimit = 50;

  // Furniture Schedule States
  const [furnitureSchedule, setFurnitureSchedule] = useState([]);
  const [scheduleSummary, setScheduleSummary] = useState({ total_item_types: 0, total_quantity: 0, review_required_count: 0 });
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [scheduleSearchQuery, setScheduleSearchQuery] = useState('');
  const [scheduleCategoryFilter, setScheduleCategoryFilter] = useState('All');
  const [scheduleReviewFilter, setScheduleReviewFilter] = useState('All'); // 'All', 'ReviewRequired', 'Standard'

  const [selectedBomRow, setSelectedBomRow] = useState(null);

  // Global BOM stats from server
  const [bomStats, setBomStats] = useState({ totalQtySum: 0, totalSpecialCount: 0, totalBuildingQty: 0 });

  // Global configurations
  const [config, setConfig] = useState({ surcharge_rate: 0.30, vat_rate: 0.10, categories: [] });

  // Real Upload & Analysis States
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedTaskAnalysis, setSelectedTaskAnalysis] = useState(null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingAnalysisTask, setLoadingAnalysisTask] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditingQuote, setIsEditingQuote] = useState(false);
  const [editedQuote, setEditedQuote] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [showRawLogs, setShowRawLogs] = useState(false);

  // Demo Mockup States
  const [demoData, setDemoData] = useState(null);
  const [loadingDemo, setLoadingDemo] = useState(false);

  // Audits and Developer tools toggle states
  const [quotationAudits, setQuotationAudits] = useState([]);
  const [appApiKey, setAppApiKey] = useState(apiClient.getApiKey());
  const [openAiKeyInput, setOpenAiKeyInput] = useState('');
  const [savingOpenAiKey, setSavingOpenAiKey] = useState(false);

  const handleApiKeyChange = (key) => {
    setAppApiKey(key);
    apiClient.setApiKey(key);
  };

  const handleSaveOpenAiKey = async () => {
    if (!openAiKeyInput.trim()) return;
    setSavingOpenAiKey(true);
    try {
      await apiClient.updateAiProvider({
        provider: 'openai',
        api_key: openAiKeyInput
      });
      showToast('OpenAI 설정이 업데이트되었습니다. 이제 실제 AI 분석이 활성화됩니다.');
      setOpenAiKeyInput('');
      const newConfig = await apiClient.getConfig();
      setConfig(newConfig);
    } catch (err) {
      showToast('OpenAI 설정 업데이트에 실패했습니다: ' + err.message, 'error');
    } finally {
      setSavingOpenAiKey(false);
    }
  };

  const [samplesList, setSamplesList] = useState([]);
  const [importingPo, setImportingPo] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [evaluating, setEvaluating] = useState(false);

  // Custom toast notification state
  const [toast, setToast] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  const isQuoteDirty = useMemo(() => {
    if (!isEditingQuote || !editedQuote || !selectedTaskAnalysis) return false;
    if ((editedQuote.remarks || '') !== (selectedTaskAnalysis.remarks || '')) return true;
    if (editedQuote.items.length !== selectedTaskAnalysis.items.length) return true;
    for (let i = 0; i < editedQuote.items.length; i++) {
      const e = editedQuote.items[i];
      const o = selectedTaskAnalysis.items[i];
      if (!o) return true;
      if (
        e.category !== o.category ||
        e.item_name !== o.item_name ||
        (e.spec || '') !== (o.spec || '') ||
        e.qty !== o.qty ||
        e.unit_price !== o.unit_price ||
        (e.remarks || '') !== (o.remarks || '') ||
        !!e.needs_manual_review !== !!o.needs_manual_review
      ) {
        return true;
      }
    }
    return false;
  }, [isEditingQuote, editedQuote, selectedTaskAnalysis]);

  const isStubMode = useMemo(() => {
    if (!healthData || !healthData.provider_mode) return true;
    const pm = healthData.provider_mode;
    return pm.drawing_converter === 'stub' || pm.vector_extractor === 'stub' || pm.vision_analyzer === 'stub' || pm.allow_mock_provider === 'true';
  }, [healthData]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleEvaluateGolden = async (fileName) => {
    const match = fileName.match(/(\d{6,})/);
    const poNumber = match ? match[1] : '262603000301';
    try {
      setEvaluating(true);
      setEvaluationResult(null);
      showToast("골든 데이터셋 평가를 진행합니다...", "info");
      const res = await apiClient.evaluateGoldenDataset(poNumber);
      setEvaluationResult(res);
      showToast("골든 데이터셋 평가가 성공적으로 완료되었습니다.", "success");
    } catch (err) {
      const displayMsg = err.message || '골든 데이터셋 평가에 실패했습니다.';
      setErrorMessage(displayMsg);
      showToast("평가 실패: " + displayMsg, "error");
    } finally {
      setEvaluating(false);
    }
  };

  const loadSamples = async () => {
    try {
      showToast("샘플 파일 목록을 가져오는 중...", "info");
      const data = await apiClient.getSamples();
      setSamplesList(data);
      showToast("샘플 목록 조회가 완료되었습니다.", "success");
    } catch (err) {
      const displayMsg = err.message || '샘플 목록을 불러오는 데 실패했습니다.';
      setErrorMessage(displayMsg);
      showToast("조회 실패: " + displayMsg, "error");
    }
  };

  const handleImportPo = async (fileName) => {
    try {
      setImportingPo(true);
      setImportResult(null);
      showToast("발주서(P/O) 데이터를 데이터베이스에 등록하는 중...", "info");
      const res = await apiClient.importPo(fileName);
      setImportResult(res);
      const projectsData = await apiClient.getProjects();
      setProjects(projectsData);
      if (projectsData.length > 0) {
        const imported = projectsData.find(p => p.po_number === res.po_number);
        if (imported) {
          setProject(imported);
        }
      }
      showToast("발주서 데이터 DB 임포트가 성공적으로 완료되었습니다.", "success");
    } catch (err) {
      const displayMsg = err.message || 'P/O 임포트에 실패했습니다.';
      setImportResult({ error: displayMsg, details: err.response?.data?.detail || '' });
      showToast("임포트 실패: " + displayMsg, "error");
    } finally {
      setImportingPo(false);
    }
  };

  const structuredAnalysis = useMemo(() => {
    if (!selectedTask || !selectedTask.structured_analysis) return null;
    if (typeof selectedTask.structured_analysis === 'string') {
      try {
        return JSON.parse(selectedTask.structured_analysis);
      } catch (e) {
        console.error("Failed to parse structured_analysis:", e);
        return null;
      }
    }
    return selectedTask.structured_analysis;
  }, [selectedTask]);

  // Fetch initial project metadata & config settings
  useEffect(() => {
    async function initData() {
      try {
        setLoading(true);
        const [projectsData, configData, initialHealth] = await Promise.all([
          apiClient.getProjects(),
          apiClient.getConfig(),
          apiClient.getHealth().catch(err => {
            console.error('Failed to load health check details:', err);
            return null;
          })
        ]);

        setProjects(projectsData);
        setConfig(configData);
        if (initialHealth) {
          setHealthData(initialHealth);
        }
        if (projectsData.length > 0) {
          setProject(projectsData[0]);
        }
        setErrorMessage('');
      } catch (err) {
        console.error('Initialization error:', err);
        setErrorMessage('설정 및 프로젝트 데이터를 불러오는데 실패했습니다: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    initData();
  }, []);

  // Fetch apartment types when project changes (Scoping)
  useEffect(() => {
    if (!project) return;
    async function fetchAptTypes() {
      try {
        const typesData = await apiClient.getApartmentTypes(project.id);
        setAptTypes(typesData);
        if (typesData.length > 0) {
          setSelectedType(typesData[0]);
        } else {
          setSelectedType(null);
        }
        setErrorMessage('');
      } catch (err) {
        console.error('Fetch apartment types error:', err);
        setErrorMessage('현장의 평형 정보를 불러오는데 실패했습니다: ' + err.message);
      }
    }
    fetchAptTypes();
  }, [project]);

  // Fetch specs details when selected apartment type changes
  useEffect(() => {
    if (!selectedType) return;

    async function fetchSpecsDetails() {
      try {
        setLoadingSpecs(true);
        const specsData = await apiClient.getSpecs(selectedType.id);
        setMaterials(specsData.materials);
        setHardware(specsData.hardware);
        setErrorMessage('');
      } catch (err) {
        console.error('Specs fetch error:', err);
        setErrorMessage('사양 정보를 불러오는데 실패했습니다: ' + err.message);
      } finally {
        setLoadingSpecs(false);
      }
    }

    fetchSpecsDetails();
  }, [selectedType]);

  // Fetch BOM data
  useEffect(() => {
    if (!selectedType) return;

    async function fetchBomData() {
      try {
        setLoadingBom(true);
        const isSpecialParam = onlySpecial === 'Special' ? true : (onlySpecial === 'Standard' ? false : null);
        const response = await apiClient.getBom(selectedType.id, {
          page: bomPage,
          limit: bomLimit,
          search: searchQuery,
          category: categoryFilter,
          isSpecial: isSpecialParam
        });

        setBom(response.items);
        setBomTotal(response.total);
        setBomStats({
          totalQtySum: response.total_qty_sum || 0,
          totalSpecialCount: response.total_special_count || 0,
          totalBuildingQty: response.total_building_qty || 0
        });
        setErrorMessage('');

        if (response.items.length > 0) {
          setSelectedBomRow(response.items[0]);
        } else {
          setSelectedBomRow(null);
        }
      } catch (err) {
        console.error('BOM fetch error:', err);
        setErrorMessage('BOM 데이터를 불러오는데 실패했습니다: ' + err.message);
      } finally {
        setLoadingBom(false);
      }
    }
    fetchBomData();
  }, [selectedType, searchQuery, categoryFilter, onlySpecial, bomPage, bomLimit]);

  // Fetch Furniture Schedule callback & effect
  const fetchScheduleData = useCallback(async () => {
    if (!selectedType) return;
    try {
      setLoadingSchedule(true);
      const needsReviewParam = scheduleReviewFilter === 'ReviewRequired' ? true : (scheduleReviewFilter === 'Standard' ? false : null);
      const response = await apiClient.getFurnitureSchedule(selectedType.id, {
        search: scheduleSearchQuery,
        category: scheduleCategoryFilter,
        needsReview: needsReviewParam
      });

      setFurnitureSchedule(response.items || []);
      setScheduleSummary(response.summary || { total_item_types: 0, total_quantity: 0, review_required_count: 0 });
      setErrorMessage('');
    } catch (err) {
      console.error('Furniture Schedule fetch error:', err);
      setErrorMessage('가구 산출표 데이터를 불러오는데 실패했습니다: ' + err.message);
    } finally {
      setLoadingSchedule(false);
    }
  }, [selectedType, scheduleSearchQuery, scheduleCategoryFilter, scheduleReviewFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchScheduleData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchScheduleData]);

  // Load demo mockup analysis data when currentPage is developer-tools or cad-upload
  useEffect(() => {
    if ((currentPage !== 'developer-tools' && currentPage !== 'cad-upload') || demoData) return;

    async function fetchDemo() {
      try {
        setLoadingDemo(true);
        const data = await apiClient.getDemoAnalysis();
        setDemoData(data);
      } catch (err) {
        console.error('Demo load error:', err);
        setErrorMessage('데모 데이터를 불러오는데 실패했습니다: ' + err.message);
      } finally {
        setLoadingDemo(false);
      }
    }
    fetchDemo();
  }, [currentPage, demoData]);

  // Task methods
  const handleSelectTask = useCallback(async (task) => {
    setSelectedTask(task);
    setIsEditingQuote(false);
    setEditedQuote(null);
    setQuotationAudits([]);
    if (task.status === 'COMPLETED') {
      try {
        setLoadingAnalysisTask(true);
        const data = await apiClient.getTaskAnalysis(task.id);
        setSelectedTaskAnalysis(data);
        setErrorMessage('');

        // Load audits
        try {
          const auditList = await apiClient.getQuotationAudits(data.id);
          setQuotationAudits(auditList);
        } catch (auditErr) {
          console.error("Failed to load quotation audits:", auditErr);
        }
      } catch (err) {
        setErrorMessage('상세 분석 결과를 불러오는데 실패했습니다: ' + err.message);
        setSelectedTaskAnalysis(null);
      } finally {
        setLoadingAnalysisTask(false);
      }
    } else {
      setSelectedTaskAnalysis(null);
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      setLoadingTasks(true);
      const data = await apiClient.getTasks(project?.id);
      setTasks(data);
      setErrorMessage('');
    } catch (err) {
      setErrorMessage('분석 이력을 불러오는데 실패했습니다: ' + err.message);
    } finally {
      setLoadingTasks(false);
    }
  }, [project]);

  const fetchTasksSilently = async () => {
    try {
      const data = await apiClient.getTasks(project?.id);

      // Notify user of status transitions in background analysis
      data.forEach(updatedTask => {
        const existingTask = tasks.find(t => t.id === updatedTask.id);
        if (existingTask && existingTask.status !== updatedTask.status) {
          if (updatedTask.status === 'COMPLETED') {
            showToast(`도면 분석 작업[ID: ${updatedTask.id}]이 성공적으로 완료되었습니다.`, "success");
          } else if (updatedTask.status === 'FAILED') {
            showToast(`도면 분석 작업[ID: ${updatedTask.id}]이 실패했습니다: ${updatedTask.error_message || '원인 미상'}`, "error");
          }
        }
      });

      setTasks(data);

      // Update selected task in case status transitioned
      if (selectedTask) {
        const updated = data.find(t => t.id === selectedTask.id);
        if (updated && updated.status !== selectedTask.status) {
          handleSelectTask(updated);
        }
      }
    } catch (err) {
      console.error('Silent task fetch failed:', err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !project) return;

    try {
      setUploading(true);
      setUploadError('');
      setErrorMessage('');
      showToast("도면 파일 업로드 및 분석 요청을 등록하는 중...", "info");
      const newTask = await apiClient.uploadDrawing(project.id, file);
      const data = await apiClient.getTasks(project.id);
      setTasks(data);
      handleSelectTask(newTask);
      showToast("도면 파일이 성공적으로 업로드되어 분석 대기열에 추가되었습니다.", "success");
    } catch (err) {
      const displayMsg = err.message || '도면 업로드 분석 등록에 실패했습니다.';
      setUploadError('도면 업로드 분석 등록 실패: ' + displayMsg);
      setErrorMessage('도면 업로드 분석 등록 실패: ' + displayMsg);
      showToast("업로드 실패: " + displayMsg, "error");
    } finally {
      setUploading(false);
    }
  };

  const handleSampleDrawingAnalysis = async () => {
    if (!project) {
      showToast("먼저 현장을 선택해 주세요.", "error");
      return;
    }

    try {
      setUploading(true);
      setUploadError('');
      setErrorMessage('');
      showToast("샘플 도면으로 필요한 가구 추출을 실행하는 중...", "info");
      const newTask = await apiClient.analyzeSampleDrawing(project.id);
      const data = await apiClient.getTasks(project.id);
      setTasks(data);
      handleSelectTask(newTask);
      setCadUploadTab('real');
      showToast("샘플 도면 분석이 완료되었습니다. 추출 가구와 견적 초안을 확인해 주세요.", "success");
    } catch (err) {
      const displayMsg = err.message || '샘플 도면 분석 실행에 실패했습니다.';
      setUploadError('샘플 도면 분석 실패: ' + displayMsg);
      setErrorMessage('샘플 도면 분석 실패: ' + displayMsg);
      showToast("샘플 분석 실패: " + displayMsg, "error");
    } finally {
      setUploading(false);
    }
  };

  const startEditing = () => {
    if (!selectedTaskAnalysis) return;
    setEditedQuote({
      status: selectedTaskAnalysis.status,
      remarks: selectedTaskAnalysis.remarks || '',
      items: selectedTaskAnalysis.items.map(item => ({ ...item }))
    });
    setIsEditingQuote(true);
  };

  const handleItemChange = (index, field, value) => {
    if (!editedQuote) return;
    const newItems = [...editedQuote.items];
    newItems[index] = {
      ...newItems[index],
      [field]: field === 'qty' || field === 'unit_price' ? parseInt(value) || 0 : value
    };
    newItems[index].sum_price = newItems[index].qty * newItems[index].unit_price;
    setEditedQuote({
      ...editedQuote,
      items: newItems
    });
  };

  const handleDeleteItem = (index) => {
    if (!editedQuote) return;
    const newItems = editedQuote.items.filter((_, idx) => idx !== index)
      .map((item, idx) => ({ ...item, item_no: idx + 1 }));
    setEditedQuote({
      ...editedQuote,
      items: newItems
    });
  };

  const handleSaveQuote = async (status) => {
    if (!selectedTaskAnalysis || !editedQuote) return;
    try {
      setLoadingAnalysisTask(true);
      showToast("변경사항을 반영하여 견적서를 저장하는 중...", "info");
      const updated = await apiClient.updateQuotation(selectedTaskAnalysis.id, {
        status: status,
        remarks: editedQuote.remarks,
        items: editedQuote.items
      });
      setSelectedTaskAnalysis(updated);
      setIsEditingQuote(false);
      setErrorMessage('');
      showToast("견적서 및 변경 이력(Audit Trail)이 성공적으로 반영되었습니다.", "success");

      // Refresh audits
      try {
        const auditList = await apiClient.getQuotationAudits(updated.id);
        setQuotationAudits(auditList);
      } catch (auditErr) {
        console.error("Failed to load quotation audits:", auditErr);
      }
    } catch (err) {
      const displayMsg = err.message || '견적서를 저장하는데 실패했습니다.';
      setErrorMessage('견적서 저장 실패: ' + displayMsg);
      showToast("저장 실패: " + displayMsg, "error");
    } finally {
      setLoadingAnalysisTask(false);
    }
  };

  // Initial tasks load when entering cad-upload or dashboard
  useEffect(() => {
    if ((currentPage === 'cad-upload' || currentPage === 'dashboard') && project) {
      const timer = setTimeout(() => {
        fetchTasks();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [currentPage, project, fetchTasks]);

  // Poll tasks status when page is cad-upload or dashboard and there are active running/pending tasks
  useEffect(() => {
    if ((currentPage !== 'cad-upload' && currentPage !== 'dashboard') || !project) return;

    // Only set interval if there is a running or pending task in the list
    const hasActiveTask = tasks.some(t => t.status === 'RUNNING' || t.status === 'PENDING');
    if (!hasActiveTask) return;

    const interval = setInterval(() => {
      fetchTasksSilently();
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, project, tasks]);

  // Categories list for filtering UI
  const categories = ['All', '상부장', '하부장', '키큰장', '보조주방', '피라/앤드판넬', '코니스/걸레받이'];

  // Overall statistics for the selected type
  const stats = useMemo(() => {
    return {
      totalQty: bomStats.totalQtySum,
      specialCount: bomStats.totalSpecialCount,
      totalItems: bomTotal
    };
  }, [bomStats, bomTotal]);

  // Prepare building quantity chart data for selected BOM item
  const buildingChartData = useMemo(() => {
    if (!selectedBomRow || !selectedBomRow.building_quantities) return [];

    const buildingMap = {};
    selectedBomRow.building_quantities.forEach(bq => {
      const bno = `${bq.building_no}동`;
      buildingMap[bno] = (buildingMap[bno] || 0) + bq.qty;
    });

    return Object.keys(buildingMap).map(b => ({
      name: b,
      qty: buildingMap[b],
      displayQty: `${buildingMap[b]}개`
    })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [selectedBomRow]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>데이터베이스 정보를 확인하는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* 1. Header Area */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-logo">C</div>
          <div>
            <h1 className="brand-name">Smart Purchase Order Analysis</h1>
            <span className="dimmed-text">건설 가구 도면 발주 내역서 검증 엔진</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {project && (
            <div className="project-badge" style={{ margin: 0 }}>
              <Activity size={16} />
              <span>현장명: <strong>{project.name}</strong></span>
            </div>
          )}
          {selectedType && (
            <div className="project-badge" style={{ margin: 0, background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399' }}>
              <Layers size={16} />
              <span>타입: <strong>{selectedType.type_name}</strong></span>
            </div>
          )}
        </div>
      </header>

      {/* Dynamic Provider Mode Banner */}
      {healthData && healthData.provider_mode && (
        <div style={{
          padding: '0.6rem 1.25rem',
          background: isStubMode ? 'linear-gradient(90deg, rgba(245, 158, 11, 0.12) 0%, rgba(245, 158, 11, 0.03) 100%)' : 'linear-gradient(90deg, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.03) 100%)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          fontSize: '0.82rem',
          color: isStubMode ? '#fbbf24' : '#34d399',
          borderRadius: '8px',
          marginBottom: '1rem',
          border: isStubMode ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Cpu size={16} />
            <span>
              {isStubMode ? (
                <strong>⚠️ 데모/시뮬레이션 분석 모드 활성화 중</strong>
              ) : (
                <strong>✓ 실 운영 환경 (Production AI Engine) 활성화 중</strong>
              )}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '0.25rem' }}>
              ({isStubMode ? '일부 도면 판독 결과가 시뮬레이션 데이터로 대체됩니다.' : '실제 도면 벡터 파싱 및 Vision 모델 분석이 실행됩니다.'})
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem' }}>
            <span style={{ opacity: 0.8 }}>도면 변환: <strong>{healthData.provider_mode.drawing_converter}</strong></span>
            <span style={{ opacity: 0.8 }}>벡터 추출: <strong>{healthData.provider_mode.vector_extractor}</strong></span>
            <span style={{ opacity: 0.8 }}>비전 분석: <strong>{healthData.provider_mode.vision_analyzer}</strong></span>
            <span style={{ opacity: 0.8 }}>모의 허용: <strong>{healthData.provider_mode.allow_mock_provider}</strong></span>
          </div>
        </div>
      )}

      {/* Global Error Banner */}
      {errorMessage && (
        <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: '12px', color: '#f87171', fontSize: '0.9rem' }}>
          {errorMessage}
        </div>
      )}

      {/* 2. Main Grid Layout */}
      <div className="dashboard-grid">

        {/* Left Sidebar */}
        <aside className="sidebar">
          {/* Navigation menu */}
          <div className="glass-card">
            <h2 className="card-title">
              <Sliders size={16} /> 서비스 메뉴
            </h2>
            <div className="type-list">
              <button
                id="menu-btn-dashboard"
                className={`type-item ${currentPage === 'dashboard' ? 'active' : ''}`}
                onClick={() => setCurrentPage('dashboard')}
              >
                <span className="type-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Activity size={16} /> 대시보드
                </span>
              </button>
              <button
                id="menu-btn-project-po"
                className={`type-item ${currentPage === 'project-po' ? 'active' : ''}`}
                onClick={() => setCurrentPage('project-po')}
              >
                <span className="type-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Briefcase size={16} /> 1. 발주서 등록
                </span>
              </button>
              <button
                id="menu-btn-cad-upload"
                className={`type-item ${currentPage === 'cad-upload' ? 'active' : ''}`}
                onClick={() => setCurrentPage('cad-upload')}
              >
                <span className="type-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <UploadCloud size={16} /> 2. 도면 분석
                </span>
              </button>
              <button
                id="menu-btn-ai-review"
                className={`type-item ${currentPage === 'ai-review' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('ai-review'); fetchScheduleData(); }}
              >
                <span className="type-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={16} /> 3. 필요 가구 확인
                  </span>
                  {scheduleSummary.review_required_count > 0 && (
                    <span className="badge pink" style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                      {scheduleSummary.review_required_count}
                    </span>
                  )}
                </span>
              </button>
              <button
                id="menu-btn-furniture-schedule"
                className={`type-item ${currentPage === 'furniture-schedule' ? 'active' : ''}`}
                onClick={() => setCurrentPage('furniture-schedule')}
              >
                <span className="type-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ClipboardList size={16} /> 4. 가구 산출표
                </span>
              </button>
              <button
                id="menu-btn-quotation"
                className={`type-item ${currentPage === 'quotation' ? 'active' : ''}`}
                onClick={() => setCurrentPage('quotation')}
              >
                <span className="type-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileText size={16} /> 5. 견적서 작성
                </span>
              </button>
              <button
                id="menu-btn-developer-tools"
                className={`type-item ${currentPage === 'developer-tools' ? 'active' : ''}`}
                onClick={() => setCurrentPage('developer-tools')}
              >
                <span className="type-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Sliders size={16} /> 설정/진단
                </span>
              </button>
            </div>
          </div>

          {/* Project Details */}
          {project && (
            <div className="glass-card">
              <h2 className="card-title">
                <Briefcase size={16} /> 현장 선택
              </h2>
              <select
                className="custom-select"
                style={{ width: '100%', marginBottom: 0 }}
                value={project.id}
                onChange={(e) => {
                  const p = projects.find(proj => proj.id === parseInt(e.target.value));
                  if (p) setProject(p);
                }}
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Apartment Types List */}
          <div className="glass-card">
            <h2 className="card-title">
              <Layers size={16} /> 평형 타입 선택 ({aptTypes.length})
            </h2>
            <div className="type-list">
              {aptTypes.map(t => (
                <div
                  key={t.id}
                  id={`apt-type-selector-${t.type_name}`}
                  className={`type-item ${selectedType?.id === t.id ? 'active' : ''}`}
                  onClick={() => { setSelectedType(t); setBomPage(1); }}
                >
                  <span className="type-name">{t.type_name} 타입</span>
                  <span className="type-qty">{t.household_count}세대</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Main Content */}
        <main className="main-panel">

          {/* ======================================================== */}
          {/* PAGE 1: 대시보드 (Dashboard) */}
          {/* ======================================================== */}
          {currentPage === 'dashboard' && (
            <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {selectedType && (
                <div className="metrics-row">
                  <div className="glass-card metric-card">
                    <div className="metric-icon blue">
                      <Building2 size={24} />
                    </div>
                    <div className="metric-info">
                      <span className="metric-val">{selectedType.household_count}</span>
                      <span className="metric-lbl">세대수</span>
                    </div>
                  </div>

                  <div className="glass-card metric-card">
                    <div className="metric-icon green">
                      <Layers size={24} />
                    </div>
                    <div className="metric-info">
                      <span className="metric-val">{stats.totalItems}종</span>
                      <span className="metric-lbl">가구 모듈 종류</span>
                    </div>
                  </div>

                  <div className="glass-card metric-card">
                    <div className="metric-icon blue">
                      <CheckCircle2 size={24} />
                    </div>
                    <div className="metric-info">
                      <span className="metric-val">{stats.totalQty}개</span>
                      <span className="metric-lbl">세대당 가구 총 수량</span>
                    </div>
                  </div>

                  <div className="glass-card metric-card">
                    <div className="metric-icon amber">
                      <Maximize2 size={24} />
                    </div>
                    <div className="metric-info">
                      <span className="metric-val">{stats.specialCount}종</span>
                      <span className="metric-lbl">비규격(S) 모듈 수</span>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
                {project && (
                  <div className="glass-card">
                    <h2 className="card-title">
                      <Briefcase size={16} /> 프로젝트 상세 개요
                    </h2>
                    <div className="project-info-list" style={{ fontSize: '0.95rem' }}>
                      <div className="info-row">
                        <span className="info-label">프로젝트명</span>
                        <span className="info-value text-highlight" style={{ fontWeight: 'bold' }}>{project.name}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">거래선 (발주처)</span>
                        <span className="info-value">{project.client}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">P/O 번호</span>
                        <span className="info-value"><code>{project.po_number}</code></span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">계약번호</span>
                        <span className="info-value">{project.contract_number || 'N/A'}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">시공거래선</span>
                        <span className="info-value">{project.partner_installer || 'N/A'}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">최초 투입일</span>
                        <span className="info-value">
                          <Calendar size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                          {project.first_delivery_date || '미정'}
                        </span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">입주 예정일</span>
                        <span className="info-value">{project.opening_date || '미정'}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">현장 종류</span>
                        <span className="info-value">{project.site_type || 'N/A'}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">최고 층수</span>
                        <span className="info-value">{project.max_floor ? `${project.max_floor}층` : 'N/A'}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">분절 공사 여부</span>
                        <span className="info-value">{project.is_divided_work ? 'Y' : 'N'}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Quick action links */}
                  <div className="glass-card">
                    <h2 className="card-title">
                      <Sliders size={16} /> 바로가기 및 퀵메뉴
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {/* CTA 1. 발주서 등록 */}
                      <button
                        className="tab-btn active"
                        onClick={() => setCurrentPage('project-po')}
                        style={{ padding: '0.75rem 1rem', width: '100%', justifyContent: 'center', background: 'var(--card-bg-light)', border: '1px solid var(--border-color)' }}
                      >
                        <Briefcase size={16} style={{ marginRight: '0.5rem' }} /> 1. 발주서 등록
                      </button>

                      {/* CTA 2. 도면 분석 */}
                      <button
                        className="tab-btn active"
                        onClick={() => setCurrentPage('cad-upload')}
                        style={{ padding: '0.75rem 1rem', width: '100%', justifyContent: 'center', background: 'var(--card-bg-light)', border: '1px solid var(--border-color)' }}
                      >
                        <UploadCloud size={16} style={{ marginRight: '0.5rem' }} /> 2. 도면 분석
                      </button>

                      {/* CTA 3. 필요 가구 확인 */}
                      <button
                        className="tab-btn active"
                        onClick={() => { setCurrentPage('ai-review'); fetchScheduleData(); }}
                        style={{
                          padding: '0.75rem 1rem',
                          width: '100%',
                          justifyContent: 'center',
                          background: scheduleSummary.review_required_count > 0 ? 'var(--accent-gradient)' : 'var(--card-bg-light)',
                          borderColor: scheduleSummary.review_required_count > 0 ? 'transparent' : 'var(--border-color)',
                          fontWeight: scheduleSummary.review_required_count > 0 ? 700 : 'normal'
                        }}
                      >
                        <CheckCircle2 size={16} style={{ marginRight: '0.5rem' }} />
                        3. 필요 가구 확인 {scheduleSummary.review_required_count > 0 ? `(${scheduleSummary.review_required_count}건 대기 중! 클릭하여 이동)` : ''}
                      </button>

                      {/* CTA 4. 견적서 작성 */}
                      <button
                        className="tab-btn active"
                        onClick={() => setCurrentPage('quotation')}
                        style={{ padding: '0.75rem 1rem', width: '100%', justifyContent: 'center', background: 'var(--primary-gradient)', border: 'none', color: '#fff' }}
                      >
                        <FileText size={16} style={{ marginRight: '0.5rem' }} /> 4. 견적서 작성
                      </button>
                    </div>
                  </div>

                  {/* Task Summary Metrics */}
                  <div className="glass-card">
                    <h2 className="card-title">
                      <Activity size={16} /> 도면 AI 판독 큐 상태
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>완료된 도면 분석 건수</span>
                        <span style={{ fontWeight: 600, color: '#10b981' }}>{tasks.filter(t => t.status === 'COMPLETED').length}건</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>분석 진행 중인 건수</span>
                        <span style={{ fontWeight: 600, color: '#3b82f6' }}>{tasks.filter(t => t.status === 'RUNNING' || t.status === 'PENDING').length}건</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>에러/실패 건수</span>
                        <span style={{ fontWeight: 600, color: '#ef4444' }}>{tasks.filter(t => t.status === 'FAILED' || t.status === 'FAILED_VALIDATION').length}건</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* PAGE 2: 프로젝트 / 발주서 (Project & PO) */}
          {/* ======================================================== */}
          {currentPage === 'project-po' && (
            <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* PO Import Section */}
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  <h2 className="card-title" style={{ marginBottom: 0 }}>
                    <Briefcase size={16} /> 발주서 데이터 추가 (PO Import)
                  </h2>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      className="tab-btn active"
                      onClick={() => handleImportPo('PO_BR_262603000301_0_1.xlsx')}
                      disabled={importingPo}
                    >
                      <Database size={14} style={{ marginRight: '0.4rem' }} /> 샘플 발주서 1 Import
                    </button>
                    <button
                      className="tab-btn active"
                      onClick={() => handleImportPo('디엘건설 인천 전도관 주방가구/PO_BR_262512001101_3_1.xlsx')}
                      disabled={importingPo}
                    >
                      <Database size={14} style={{ marginRight: '0.4rem' }} /> 샘플 발주서 2 Import
                    </button>
                  </div>
                </div>

                {importingPo && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                    <div className="spinner" style={{ width: '16px', height: '16px', borderTopColor: 'var(--primary)' }}></div>
                    <span style={{ fontSize: '0.9rem' }}>발주서를 파싱하고 등록하는 중입니다...</span>
                  </div>
                )}

                {importResult && (
                  <div style={{
                    padding: '1rem',
                    background: importResult.error ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                    border: `1px solid ${importResult.error ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                    borderRadius: '8px',
                    fontSize: '0.9rem'
                  }}>
                    {importResult.error ? (
                      <div style={{ color: '#ef4444' }}>
                        <strong style={{ display: 'block', marginBottom: '0.3rem' }}><AlertTriangle size={14} /> Import 실패</strong>
                        {importResult.error}
                        {importResult.details && <pre style={{ marginTop: '0.5rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px', overflowX: 'auto' }}>{importResult.details}</pre>}
                      </div>
                    ) : (
                      <div style={{ color: '#10b981' }}>
                        <strong style={{ display: 'block', marginBottom: '0.5rem' }}><CheckCircle2 size={14} /> Import 성공</strong>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                          <div>현장명: <strong style={{ color: 'var(--text-bright)' }}>{importResult.project || '-'}</strong></div>
                          <div>등록된 타입 수: <strong style={{ color: 'var(--text-bright)' }}>{importResult.apartment_types || 0}개</strong></div>
                          <div>BOM 품목 수: <strong style={{ color: 'var(--text-bright)' }}>{importResult.bom_items || 0}개</strong></div>
                          <div>총 수량: <strong style={{ color: 'var(--text-bright)' }}>{importResult.stats?.total_quantity || 0}개</strong></div>
                        </div>
                        {importResult.stats && (importResult.stats.added > 0 || importResult.stats.deleted > 0) && (
                          <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(16, 185, 129, 0.2)' }}>
                            <strong style={{ display: 'block', color: '#fbbf24', marginBottom: '0.3rem' }}>Diff 리포트 (이전 BOM 대비 변경사항)</strong>
                            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem' }}>
                              <span>추가: <strong style={{ color: '#10b981' }}>{importResult.stats.added}</strong>건</span>
                              <span>삭제: <strong style={{ color: '#ef4444' }}>{importResult.stats.deleted}</strong>건</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="tabs-bar">
                <button
                  className={`tab-btn ${projectPoTab === 'bom' ? 'active' : ''}`}
                  onClick={() => setProjectPoTab('bom')}
                >
                  <ClipboardList size={16} /> 가구 내역서 (BOM) & 분배
                </button>
                <button
                  className={`tab-btn ${projectPoTab === 'specs' ? 'active' : ''}`}
                  onClick={() => setProjectPoTab('specs')}
                >
                  <Sliders size={16} /> 마감 사양서 & 하드웨어
                </button>
              </div>

              {/* Sub-tab 1: BOM */}
              {projectPoTab === 'bom' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {loadingBom ? (
                    <div className="loading-screen">
                      <div className="spinner"></div>
                    </div>
                  ) : (
                    <div className="glass-card">
                      {/* Search and Filters */}
                      <div className="filter-bar">
                        <div className="search-input-wrapper">
                          <Search size={16} className="search-icon" />
                          <input
                            id="bom-search-input"
                            type="text"
                            placeholder="제품명, 제품코드, 속성코드를 검색해 보세요..."
                            className="search-input"
                            value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setBomPage(1); }}
                          />
                        </div>

                        <div className="filter-selects">
                          <select
                            id="bom-category-select"
                            className="custom-select"
                            value={categoryFilter}
                            onChange={e => { setCategoryFilter(e.target.value); setBomPage(1); }}
                          >
                            {categories.map(c => (
                              <option key={c} value={c}>{c === 'All' ? '전체 구분' : c}</option>
                            ))}
                          </select>

                          <select
                            id="bom-sizing-select"
                            className="custom-select"
                            value={onlySpecial}
                            onChange={e => { setOnlySpecial(e.target.value); setBomPage(1); }}
                          >
                            <option value="All">규격 구분 (전체)</option>
                            <option value="Standard">일반 규격품</option>
                            <option value="Special">비규격품 (Special)</option>
                          </select>
                        </div>
                      </div>

                      {/* Cabinet BOM Table */}
                      <div className="table-wrapper">
                        <table className="custom-table">
                          <thead>
                            <tr>
                              <th>NO</th>
                              <th>구분</th>
                              <th>제품명</th>
                              <th>제품코드</th>
                              <th>속성코드</th>
                              <th>가로(W)</th>
                              <th>세로(H)</th>
                              <th>깊이(D)</th>
                              <th>규격구분</th>
                              <th>도면(좌/중/우)</th>
                              <th>반대(좌/중/우)</th>
                              <th>세대수량</th>
                              <th>전체수량</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bom.length === 0 ? (
                              <tr>
                                <td colSpan={13} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                  검색 결과 조건에 맞는 모듈이 없습니다.
                                </td>
                              </tr>
                            ) : (
                              bom.map(item => (
                                <tr
                                  key={item.id}
                                  id={`bom-row-item-${item.item_no}`}
                                  className={selectedBomRow?.id === item.id ? 'selected-row' : ''}
                                  onClick={() => setSelectedBomRow(item)}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <td>{item.item_no}</td>
                                  <td>
                                    <span className={`badge ${
                                      item.category === '상부장' ? 'blue' :
                                      item.category === '하부장' ? 'green' :
                                      item.category === '키큰장' ? 'orange' : 'pink'
                                    }`}>
                                      {item.category}
                                    </span>
                                  </td>
                                  <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                                  <td><code>{item.product_code || '-'}</code></td>
                                  <td><code>{item.attribute_code || '-'}</code></td>
                                  <td>{item.width || '-'}</td>
                                  <td>{item.height || '-'}</td>
                                  <td>{item.depth || '-'}</td>
                                  <td>
                                    {item.is_special ? (
                                      <span className="special-badge">비규격 S</span>
                                    ) : (
                                      <span className="normal-badge">정규격</span>
                                    )}
                                  </td>
                                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {item.qty_drawing_left}/{item.qty_drawing_mid}/{item.qty_drawing_right}
                                  </td>
                                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {item.qty_opposite_left}/{item.qty_opposite_mid}/{item.qty_opposite_right}
                                  </td>
                                  <td style={{ fontWeight: 'bold' }}>{item.qty_sum}개</td>
                                  <td style={{ color: 'var(--primary)', fontWeight: 'bold' }}>
                                    {(item.qty_sum * (selectedType?.household_count || 0)).toLocaleString()}개
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination Controls */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.6rem 1.25rem', background: 'rgba(30, 41, 59, 0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          전체 <strong style={{ color: 'var(--text-bright)' }}>{bomTotal}</strong>개 중 <strong style={{ color: 'var(--text-bright)' }}>{bom.length > 0 ? (bomPage - 1) * bomLimit + 1 : 0} - {Math.min(bomPage * bomLimit, bomTotal)}</strong>개 표시
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <button
                            className="tab-btn"
                            disabled={bomPage === 1}
                            onClick={() => setBomPage(prev => Math.max(prev - 1, 1))}
                            style={{ padding: '0.3rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', opacity: bomPage === 1 ? 0.5 : 1, cursor: bomPage === 1 ? 'not-allowed' : 'pointer' }}
                          >
                            <ChevronLeft size={14} /> 이전
                          </button>
                          <span style={{ alignSelf: 'center', fontWeight: 'bold', color: 'var(--text-bright)' }}>{bomPage} / {Math.ceil(bomTotal / bomLimit) || 1}</span>
                          <button
                            className="tab-btn"
                            disabled={bomPage >= Math.ceil(bomTotal / bomLimit)}
                            onClick={() => setBomPage(prev => prev + 1)}
                            style={{ padding: '0.3rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', opacity: bomPage >= Math.ceil(bomTotal / bomLimit) ? 0.5 : 1, cursor: bomPage >= Math.ceil(bomTotal / bomLimit) ? 'not-allowed' : 'pointer' }}
                          >
                            다음 <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>

                      {selectedBomRow && (
                        <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
                          <div className="glass-card distribution-panel" style={{ padding: 0, border: 'none', background: 'none' }}>
                            <div>
                              <h3 className="card-title">
                                <Layers size={16} /> 동별 배분 시각화 ({selectedBomRow.product_name})
                              </h3>

                              {buildingChartData.length === 0 ? (
                                <div className="chart-container">
                                  <span className="chart-placeholder">선택된 모듈은 동별 세부 물량 데이터가 등록되어 있지 않습니다.</span>
                                </div>
                              ) : (
                                <div className="chart-container">
                                  <Suspense fallback={<div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>차트 로딩 중...</div>}>
                                    <DistributionChart buildingChartData={buildingChartData} />
                                  </Suspense>
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              <h3 className="card-title">
                                <Building2 size={16} /> 동/라인별 세부 배분표
                              </h3>

                              <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '10px', fontSize: '0.85rem' }}>
                                <p style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)' }}>가구 정보:</p>
                                <h4 style={{ margin: 0, color: 'var(--text-bright)' }}>
                                  [{selectedBomRow.item_no}] {selectedBomRow.product_name}
                                </h4>
                                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                  규격: {selectedBomRow.width}W * {selectedBomRow.height}H * {selectedBomRow.depth}D | 세대수량: <strong>{selectedBomRow.qty_sum}개</strong>
                                </p>
                              </div>

                              <div className="table-wrapper" style={{ maxHeight: '270px' }}>
                                <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                                  <thead>
                                    <tr>
                                      <th>동 번호</th>
                                      <th>라인 / 호수</th>
                                      <th>세대당 수량</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedBomRow.building_quantities && selectedBomRow.building_quantities.length > 0 ? (
                                      selectedBomRow.building_quantities.map(bq => (
                                        <tr key={bq.id}>
                                          <td style={{ fontWeight: 600 }}>{bq.building_no}동</td>
                                          <td>{bq.line_no} 라인</td>
                                          <td style={{ color: 'var(--secondary)', fontWeight: 600 }}>{bq.qty} 개</td>
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                          배분 정보가 없습니다.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tab 2: Specs */}
              {projectPoTab === 'specs' && (
                loadingSpecs ? (
                  <div className="loading-screen" style={{ gridColumn: 'span 2' }}>
                    <div className="spinner"></div>
                  </div>
                ) : (
                  <div className="specs-container">
                    <div className="spec-category-section">
                      <div className="glass-card">
                        <h3 className="card-title">
                          <Sliders size={16} /> 자재 마감 사양서 (주요 부위 마감재 및 심재)
                        </h3>

                        {materials.length === 0 ? (
                          <div className="empty-state">
                            <p>이 평형 타입에 등록된 마감 자재 사양서가 없습니다.</p>
                          </div>
                        ) : (
                          <div className="table-wrapper">
                            <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                              <thead>
                                <tr>
                                  <th>구분</th>
                                  <th>부위명</th>
                                  <th>소재/두께/등급</th>
                                  <th>주마감재 (소재 / 상세 NO)</th>
                                  <th>배면재 / 엣지재</th>
                                </tr>
                              </thead>
                              <tbody>
                                {materials.map(m => (
                                  <tr key={m.id}>
                                    <td>
                                      <span className="badge blue">{m.category}</span>
                                    </td>
                                    <td style={{ fontWeight: 600 }}>{m.part_name}</td>
                                    <td>
                                      {m.material} {m.thickness ? `(${m.thickness})` : ''} {m.grade ? `/ ${m.grade}` : ''}
                                    </td>
                                    <td>
                                      {m.primary_material && (
                                        <span><strong>{m.primary_material}</strong>: {m.primary_material_detail || '-'}</span>
                                      )}
                                    </td>
                                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                      <div>배면: {m.backing_material || '-'} ({m.backing_material_detail || '-'})</div>
                                      <div>엣지: {m.edge_material || '-'} ({m.edge_material_detail || '-'})</div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="spec-category-section">
                      <div className="glass-card">
                        <h3 className="card-title">
                          <Tag size={16} /> 하드웨어 및 수하 사양서 (경첩, 서랍재, 특기)
                        </h3>

                        {hardware.length === 0 ? (
                          <div className="empty-state">
                            <p>이 평형 타입에 등록된 하드웨어 사양서가 없습니다.</p>
                          </div>
                        ) : (
                          <div className="table-wrapper">
                            <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                              <thead>
                                <tr>
                                  <th>구분</th>
                                  <th>항목</th>
                                  <th>적용값</th>
                                  <th>상세 특기사항</th>
                                </tr>
                              </thead>
                              <tbody>
                                {hardware.map(h => (
                                  <tr key={h.id}>
                                    <td>
                                      <span className="badge orange">{h.item_group}</span>
                                    </td>
                                    <td style={{ fontWeight: 600 }}>{h.item_name}</td>
                                    <td style={{ color: 'var(--text-bright)' }}>{h.application || '-'}</td>
                                    <td style={{ whiteSpace: 'normal', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                      {h.special_remarks || '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}


          {/* ======================================================== */}
          {/* PAGE 5: 견적서 (Quotation) */}
          {/* ======================================================== */}
          {/* Sub-tab 3: Quotation */}
          {currentPage === 'quotation' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {selectedTask && selectedTask.status === 'COMPLETED' ? (
                loadingAnalysisTask ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                    <div className="spinner"></div>
                  </div>
                ) : selectedTaskAnalysis ? (
                  <div className="quote-sheet">
                    {structuredAnalysis && structuredAnalysis.is_demo_result && (
                      <div className="demo-badge-banner" style={{ marginBottom: '1.5rem' }}>
                        <AlertTriangle size={16} />
                        <span>[시뮬레이션] 데모/Stub 분석 결과에 따라 생성된 견적서입니다.</span>
                      </div>
                    )}
                    <div className="quote-sheet-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          {isEditingQuote ? "수동 검토 및 편집 진행 중" : "AI 자동 분석 가구 견적서"}
                        </span>
                        <h2 className="quote-sheet-title">가구 발주 견적 내역서</h2>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: '1rem' }}>
                          <div>문서번호: {selectedTaskAnalysis.doc_number}</div>
                          <div>발행일자: {selectedTaskAnalysis.date}</div>
                        </div>
                        <div>
                          {!isEditingQuote ? (
                            selectedTaskAnalysis.status === 'CONFIRMED' ? (
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <span className="badge green" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', fontWeight: 'bold' }}>✓ 최종 검토 완료</span>
                                <button className="tab-btn" onClick={startEditing} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <Edit3 size={14} /> 재수정
                                </button>
                                <button className="tab-btn" onClick={() => window.location.href = `/api/quotations/${selectedTaskAnalysis.id}/export`} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                                  <FileText size={14} /> 견적서 Excel 다운로드
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button className="tab-btn active" onClick={startEditing} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <Edit3 size={14} /> 수동 검토 및 편집
                                </button>
                                <button className="tab-btn" onClick={() => window.location.href = `/api/quotations/${selectedTaskAnalysis.id}/export`} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                                  <FileText size={14} /> 견적서 Excel 다운로드
                                </button>
                              </div>
                            )
                          ) : (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button className="tab-btn" onClick={() => setIsEditingQuote(false)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer' }}>취소</button>
                              <button className="tab-btn active" onClick={() => handleSaveQuote("DRAFT")} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Save size={14} /> 임시저장
                              </button>
                              <button className="tab-btn active" onClick={() => handleSaveQuote("CONFIRMED")} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'var(--secondary)', borderColor: 'var(--secondary)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Check size={14} /> 확정 완료
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="quote-meta-row">
                      <div className="quote-meta-item">
                        <span className="quote-meta-label">공사명</span>
                        <span className="quote-meta-val">{project?.name || '-'}</span>
                      </div>
                      <div className="quote-meta-item">
                        <span className="quote-meta-label">발주처</span>
                        <span className="quote-meta-val">{project?.client || '-'}</span>
                      </div>
                      <div className="quote-meta-item">
                        <span className="quote-meta-label">승인 상태</span>
                        <span className="quote-meta-val">
                          {selectedTaskAnalysis.status === 'CONFIRMED' ? (
                            <span className="badge green">최종 검토 완료</span>
                          ) : selectedTaskAnalysis.status === 'DRAFT' ? (
                            <span className="badge blue">임시 저장</span>
                          ) : (
                            <span className="badge orange">검토 대기 (NEEDS REVIEW)</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Top Summary Cards */}
                    {(() => {
                      const total = isEditingQuote && editedQuote
                        ? editedQuote.items.reduce((sum, item) => sum + (item.qty * item.unit_price), 0)
                        : selectedTaskAnalysis.total_amount;
                      const vat = isEditingQuote && editedQuote
                        ? Math.floor(total * config.vat_rate)
                        : selectedTaskAnalysis.vat_amount;
                      const grand = total + vat;
                      const reviewCount = isEditingQuote && editedQuote
                        ? editedQuote.items.filter(item => item.needs_manual_review).length
                        : selectedTaskAnalysis.items?.filter(item => item.needs_manual_review).length || 0;

                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>공급가액 합계</span>
                            <h4 style={{ fontSize: '1.2rem', color: 'var(--text-bright)', marginTop: '0.25rem', fontWeight: 700 }}>
                              ₩{total.toLocaleString()}
                            </h4>
                          </div>
                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>부가가치세 ({(config.vat_rate * 100).toFixed(0)}%)</span>
                            <h4 style={{ fontSize: '1.2rem', color: 'var(--text-bright)', marginTop: '0.25rem', fontWeight: 700 }}>
                              ₩{vat.toLocaleString()}
                            </h4>
                          </div>
                          <div style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(16, 185, 129, 0.1) 100%)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--secondary)', textAlign: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>총 청구 금액 (VAT 포함)</span>
                            <h4 style={{ fontSize: '1.2rem', color: 'var(--secondary)', fontWeight: 800, marginTop: '0.25rem' }}>
                              ₩{grand.toLocaleString()}
                            </h4>
                          </div>
                          <div style={{
                            background: reviewCount > 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                            padding: '1rem',
                            borderRadius: '8px',
                            border: reviewCount > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
                            textAlign: 'center'
                          }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>검토 요망 항목 수</span>
                            <h4 style={{ fontSize: '1.2rem', color: reviewCount > 0 ? '#ef4444' : '#10b981', fontWeight: 800, marginTop: '0.25rem' }}>
                              {reviewCount}건
                            </h4>
                          </div>
                        </div>
                      );
                    })()}

                    {isEditingQuote && editedQuote ? (
                      /* Editing View */
                      <div className="table-wrapper">
                        <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                          <thead>
                            <tr>
                              <th style={{ width: '45px' }}>NO</th>
                              <th style={{ width: '130px' }}>구분</th>
                              <th>품명</th>
                              <th style={{ width: '130px' }}>규격</th>
                              <th style={{ width: '75px', textAlign: 'right' }}>수량</th>
                              <th style={{ width: '50px' }}>단위</th>
                              <th style={{ width: '120px', textAlign: 'right' }}>단가</th>
                              <th style={{ width: '120px', textAlign: 'right' }}>금액</th>
                              <th>비고</th>
                              <th style={{ width: '60px', textAlign: 'center' }}>검토</th>
                              <th style={{ width: '50px', textAlign: 'center' }}>삭제</th>
                            </tr>
                          </thead>
                          <tbody>
                            {editedQuote.items.map((item, index) => (
                              <tr key={item.id || index} style={{
                                background: (item.needs_manual_review || (item.confidence && item.confidence < 0.8)) ? 'rgba(239, 68, 68, 0.04)' : '',
                                borderLeft: (item.needs_manual_review || (item.confidence && item.confidence < 0.8)) ? '3px solid #ef4444' : 'none'
                              }}>
                                <td>{item.item_no}</td>
                                <td>
                                  <select
                                    className="custom-select"
                                    style={{ width: '100%', padding: '0.2rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-bright)' }}
                                    value={item.category || ''}
                                    onChange={(e) => handleItemChange(index, 'category', e.target.value)}
                                  >
                                    <option value="상부장">상부장</option>
                                    <option value="하부장">하부장</option>
                                    <option value="키큰장">키큰장</option>
                                    <option value="기타">기타</option>
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="search-input"
                                    style={{ width: '100%', padding: '0.2rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-bright)' }}
                                    value={item.item_name || ''}
                                    onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="search-input"
                                    style={{ width: '100%', padding: '0.2rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-bright)', fontFamily: 'monospace' }}
                                    value={item.spec || ''}
                                    onChange={(e) => handleItemChange(index, 'spec', e.target.value)}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    className="search-input"
                                    style={{ width: '100%', padding: '0.2rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-bright)', textAlign: 'right' }}
                                    value={item.qty}
                                    onChange={(e) => handleItemChange(index, 'qty', e.target.value)}
                                  />
                                </td>
                                <td>{item.unit}</td>
                                <td>
                                  <input
                                    type="number"
                                    className="search-input"
                                    style={{ width: '100%', padding: '0.2rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-bright)', textAlign: 'right' }}
                                    value={item.unit_price}
                                    onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)}
                                  />
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                  ₩{(item.qty * item.unit_price).toLocaleString()}
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="search-input"
                                    style={{ width: '100%', padding: '0.2rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-bright)' }}
                                    value={item.remarks || ''}
                                    onChange={(e) => handleItemChange(index, 'remarks', e.target.value)}
                                  />
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={item.needs_manual_review}
                                    onChange={(e) => handleItemChange(index, 'needs_manual_review', e.target.checked)}
                                  />
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (window.confirm(`"${item.item_name}" 항목을 정말 삭제하시겠습니까?`)) {
                                        handleDeleteItem(index);
                                      }
                                    }}
                                    style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.2rem' }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* Read-Only View */
                      <div className="table-wrapper">
                        <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                          <thead>
                            <tr>
                              <th style={{ width: '45px' }}>NO</th>
                              <th>구분</th>
                              <th>품명</th>
                              <th>규격 (W*D*H)</th>
                              <th style={{ textAlign: 'right' }}>수량</th>
                              <th>단위</th>
                              <th style={{ textAlign: 'right' }}>단가</th>
                              <th style={{ textAlign: 'right' }}>금액</th>
                              <th>비고</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedTaskAnalysis.items && selectedTaskAnalysis.items.map(item => {
                              const rawItem = selectedTask.structured_analysis?.items?.find(ri => ri.item_no === item.item_no) || {};
                              const aiReviewStatus = rawItem.ai_review_status;
                              const reviewFlags = rawItem.review_flags || [];

                              const isLowConf = item.confidence && item.confidence < 0.8;
                              const shouldHighlight = item.needs_manual_review || isLowConf || (aiReviewStatus && aiReviewStatus !== 'approved') || reviewFlags.length > 0;
                              const specParts = splitSpecParts(item.spec);
                              return (
                                <tr key={item.id} style={{ background: shouldHighlight ? 'rgba(239,68,68,0.04)' : '' }}>
                                  <td style={{
                                    position: 'relative',
                                    borderLeft: shouldHighlight ? '3px solid #ef4444' : 'none',
                                    paddingLeft: shouldHighlight ? 'calc(1rem - 3px)' : '1rem'
                                  }}>{item.item_no}</td>
                                  <td>
                                    <span className={`badge ${
                                      item.category === '상부장' ? 'blue' :
                                      item.category === '하부장' ? 'green' :
                                      item.category === '키큰장' ? 'orange' : 'pink'
                                    }`}>
                                      {item.category}
                                    </span>
                                  </td>
                                  <td>
                                    <div style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
                                      {item.item_name}
                                      {item.is_special && <span className="special-badge" style={{ marginLeft: '0.5rem', padding: '0.1rem 0.3rem', fontSize: '0.7rem' }}>비규격</span>}
                                      {shouldHighlight && <span className="special-badge" style={{ marginLeft: '0.5rem', padding: '0.1rem 0.3rem', fontSize: '0.7rem', background: '#ef4444' }}>검토요망</span>}
                                    </div>
                                    {aiReviewStatus && (
                                      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                                        {aiReviewStatus === 'approved' ? (
                                          <span style={{ color: '#10b981', fontWeight: 600, background: 'rgba(16, 185, 129, 0.1)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>✓ 검토완료</span>
                                        ) : (
                                          <span style={{ color: '#ef4444', fontWeight: 600, background: 'rgba(239, 68, 68, 0.1)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>⚠️ 검토필요</span>
                                        )}
                                        {reviewFlags.map(f => (
                                          <span key={f} style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>{f}</span>
                                        ))}
                                      </div>
                                    )}
                                    {item.confidence && (
                                      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', marginTop: '0.15rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                        <span style={{ color: item.needs_manual_review ? '#f87171' : '#10b981', fontWeight: 600 }}>
                                          정확도: {(item.confidence * 100).toFixed(0)}%
                                        </span>
                                        {item.original_text && <span>| 원문: "{item.original_text}"</span>}
                                        {item.bounding_box && <span>| 위치: [{item.bounding_box}]</span>}
                                      </div>
                                    )}
                                    {(item.price_source || item.pricing_remarks) && (
                                      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', marginTop: '0.15rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                        <span style={{ color: item.unit_price === 0 ? '#f43f5e' : 'var(--secondary)', fontWeight: 600 }}>
                                          단가출처: {item.price_source === 'exact_code' ? '코드 매치' : item.price_source === 'exact_name' ? '품명 매치' : item.price_source === 'category_fallback' ? '카테고리 대체' : '단가 없음'}
                                        </span>
                                        {item.pricing_remarks && <span>| 메모: {item.pricing_remarks}</span>}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'left' }}>
                                    <code style={{ background: 'transparent' }}>
                                      <span style={item.width_inferred ? INFERRED_DIMENSION_STYLE : {}}>{specParts[0]}</span>
                                      {' * '}
                                      <span style={item.depth_inferred ? INFERRED_DIMENSION_STYLE : {}}>{specParts[1]}</span>
                                      {' * '}
                                      <span style={item.height_inferred ? INFERRED_DIMENSION_STYLE : {}}>{specParts[2]}</span>
                                    </code>
                                  </td>
                                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.qty}</td>
                                  <td>{item.unit}</td>
                                  <td style={{ textAlign: 'right', color: item.unit_price === 0 ? '#ef4444' : 'inherit', fontWeight: item.unit_price === 0 ? 600 : 'normal' }}>
                                    {item.unit_price === 0 ? '단가 확인 필요' : `₩${item.unit_price.toLocaleString()}`}
                                  </td>
                                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: item.unit_price === 0 ? '#ef4444' : 'var(--primary)' }}>
                                    {item.unit_price === 0 ? '단가 확인 필요' : `₩${item.sum_price.toLocaleString()}`}
                                  </td>
                                  <td style={{ whiteSpace: 'normal', fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '200px' }}>
                                    {item.remarks}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.01)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <h5 style={{ color: 'var(--text-bright)', marginBottom: '0.5rem', fontWeight: 600 }}>특기사항 및 견적 기준</h5>
                      <ul style={{ paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <li>본 견적서는 업로드된 파일 {selectedTask.file_name}의 가공 검증을 통한 연산 결과입니다.</li>
                        <li>{isEditingQuote && editedQuote ? (
                          <input
                            type="text"
                            className="search-input"
                            style={{ width: '100%', padding: '0.2rem', marginTop: '0.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-bright)' }}
                            value={editedQuote.remarks}
                            onChange={(e) => setEditedQuote({ ...editedQuote, remarks: e.target.value })}
                            placeholder="견적 기준 특기사항 입력..."
                          />
                        ) : selectedTaskAnalysis.remarks}</li>
                      </ul>
                    </div>

                    {/* Audits Panel */}
                    {quotationAudits && quotationAudits.length > 0 && (
                      <div style={{ marginTop: '1.5rem', padding: '1.25rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'rgba(30, 41, 59, 0.15)' }}>
                        <h4 style={{ color: 'var(--text-bright)', fontSize: '0.9rem', marginBottom: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Activity size={16} style={{ color: 'var(--primary)' }} /> 견적 변경 이력 (Audit Trail)
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                          {quotationAudits.map((aud) => {
                            const createdTime = new Date(aud.created_at).toLocaleString();
                            const isQuotationLevel = aud.field_name.startsWith('quotation:') || ['remarks', 'status', 'total_amount', 'vat_amount', 'grand_total'].includes(aud.field_name);
                            const displayFieldName = isQuotationLevel ? aud.field_name.replace('quotation:', '견적 ') : aud.field_name;

                            let detailText = "";
                            if (aud.field_name === 'item_added') {
                              detailText = `새 품목 추가: ${aud.new_value}`;
                            } else if (aud.field_name === 'item_deleted') {
                              detailText = `품목 삭제: ${aud.old_value}`;
                            } else {
                              detailText = `필드 [${displayFieldName}] 변경: "${aud.old_value || '공백'}" ➔ "${aud.new_value || '공백'}"`;
                            }

                            return (
                              <div key={aud.id} style={{
                                padding: '0.6rem 0.85rem',
                                background: isQuotationLevel ? 'rgba(59, 130, 246, 0.03)' : 'rgba(16, 185, 129, 0.03)',
                                border: `1px solid ${isQuotationLevel ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)'}`,
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '1rem'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span className="badge" style={{
                                    fontSize: '0.62rem',
                                    padding: '0.1rem 0.35rem',
                                    background: isQuotationLevel ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                    color: isQuotationLevel ? '#60a5fa' : '#34d399',
                                    border: `1px solid ${isQuotationLevel ? 'rgba(59, 130, 246, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`
                                  }}>
                                    {isQuotationLevel ? '견적공통' : '품목변경'}
                                  </span>
                                  <span style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{detailText}</span>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({aud.source})</span>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                                  {createdTime}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {isEditingQuote && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                        <div>
                          {isQuoteDirty ? (
                            <span className="unsaved-changes-indicator">
                              <AlertTriangle size={14} /> 수정 중 (저장되지 않은 변경사항 있음)
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>변경사항이 없습니다.</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <button className="tab-btn" onClick={() => setIsEditingQuote(false)} style={{ padding: '0.5rem 1.25rem', fontSize: '0.88rem', cursor: 'pointer' }}>
                            취소
                          </button>
                          <button className="tab-btn active" onClick={() => handleSaveQuote("DRAFT")} style={{ padding: '0.5rem 1.25rem', fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <Save size={16} /> 임시저장
                          </button>
                          <button className="tab-btn active" onClick={() => handleSaveQuote("CONFIRMED")} style={{ padding: '0.5rem 1.25rem', fontSize: '0.88rem', background: 'var(--secondary)', borderColor: 'var(--secondary)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <Check size={16} /> 검토 확정 완료
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    상세 견적 데이터를 불러올 수 없습니다.
                  </div>
                )
              ) : (
                <div className="glass-card empty-state">
                  <div className="empty-icon">📊</div>
                  <p>완료된 도면 분석 이력이 없습니다. 도면 분석을 먼저 실행해 주세요.</p>
                  <button className="tab-btn active" style={{ marginTop: '1rem' }} onClick={() => setCurrentPage('cad-upload')}>
                    도면 업로드 화면으로 이동
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

          {/* ======================================================== */}
          {/* PAGE 3: 도면 업로드 / 분석 (CAD Upload) */}
          {/* ======================================================== */}
          {currentPage === 'cad-upload' && (
            <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="tabs-bar">
                <button
                  className={`tab-btn ${cadUploadTab === 'real' ? 'active' : ''}`}
                  onClick={() => setCadUploadTab('real')}
                >
                  <UploadCloud size={16} /> 실제 도면 업로드 & 분석
                </button>
                <button
                  className={`tab-btn ${cadUploadTab === 'demo' ? 'active' : ''}`}
                  onClick={() => setCadUploadTab('demo')}
                >
                  <Cpu size={16} /> [체험용] 고정 샘플 데모
                </button>
              </div>

              {cadUploadTab === 'real' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Wizard Progress Bar */}
                  <div className="wizard-stepper" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '1.25rem 2rem',
                    background: 'rgba(30, 41, 59, 0.3)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    boxShadow: 'var(--shadow-sm)',
                    marginBottom: '1rem',
                    position: 'relative'
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '10%',
                      right: '10%',
                      height: '2px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      zIndex: 1,
                      transform: 'translateY(-12px)'
                    }}></div>

                    <div className="step" style={{ zIndex: 2, textAlign: 'center', flex: 1 }}>
                      <div style={{
                        margin: '0 auto 0.5rem',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: project ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '0.85rem',
                        border: project ? '2px solid rgba(255,255,255,0.2)' : '2px solid transparent',
                        boxShadow: project ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none',
                        transition: 'all 0.3s'
                      }}>
                        {project ? '✓' : '1'}
                      </div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: project ? 'var(--text-bright)' : 'var(--text-muted)' }}>도면 분석</div>
                    </div>

                    <div className="step" style={{ zIndex: 2, textAlign: 'center', flex: 1 }}>
                      <div style={{
                        margin: '0 auto 0.5rem',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: selectedTask ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '0.85rem',
                        border: selectedTask ? '2px solid rgba(255,255,255,0.2)' : '2px solid transparent',
                        boxShadow: selectedTask ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none',
                        transition: 'all 0.3s'
                      }}>
                        {selectedTask && selectedTask.status !== 'PENDING' && selectedTask.status !== 'RUNNING' ? '✓' : '2'}
                      </div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: selectedTask ? 'var(--text-bright)' : 'var(--text-muted)' }}>산출 완료</div>
                    </div>

                    <div className="step" style={{ zIndex: 2, textAlign: 'center', flex: 1 }}>
                      <div style={{
                        margin: '0 auto 0.5rem',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: selectedTask?.status === 'RUNNING' || selectedTask?.status === 'COMPLETED' ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '0.85rem',
                        border: selectedTask?.status === 'RUNNING' || selectedTask?.status === 'COMPLETED' ? '2px solid rgba(255,255,255,0.2)' : '2px solid transparent',
                        boxShadow: selectedTask?.status === 'RUNNING' || selectedTask?.status === 'COMPLETED' ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none',
                        transition: 'all 0.3s'
                      }}>
                        {selectedTask?.status === 'COMPLETED' ? '✓' : '3'}
                      </div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: selectedTask?.status === 'RUNNING' || selectedTask?.status === 'COMPLETED' ? 'var(--text-bright)' : 'var(--text-muted)' }}>검토 필요</div>
                    </div>

                    <div className="step" style={{ zIndex: 2, textAlign: 'center', flex: 1 }}>
                      <div style={{
                        margin: '0 auto 0.5rem',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: selectedTaskAnalysis ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.1)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '0.85rem',
                        border: selectedTaskAnalysis ? '2px solid rgba(255,255,255,0.2)' : '2px solid transparent',
                        boxShadow: selectedTaskAnalysis ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none',
                        transition: 'all 0.3s'
                      }}>
                        {selectedTaskAnalysis?.status === 'CONFIRMED' ? '✓' : '4'}
                      </div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: selectedTaskAnalysis ? 'var(--text-bright)' : 'var(--text-muted)' }}>견적 생성</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr', gap: '1.5rem' }}>
                    {/* Upload Card */}
                    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <h3 className="card-title" style={{ margin: 0 }}><FileText size={16} /> CAD 도면 업로드</h3>

                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px dashed rgba(59, 130, 246, 0.3)',
                        borderRadius: '8px',
                        padding: '2rem 1rem',
                        background: 'rgba(30, 41, 59, 0.2)',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)'}
                      >
                        {uploading ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                            <div className="spinner" style={{ width: '28px', height: '28px' }}></div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>업로드 및 분석 처리 중...</p>
                          </div>
                        ) : (
                          <>
                            <UploadCloud size={32} style={{ color: 'var(--primary)' }} />
                            <div style={{ textAlign: 'center' }}>
                              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-bright)', marginBottom: '0.25rem' }}>
                                클릭하여 도면 파일 업로드
                              </p>
                              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                지원: DWG, DXF, PDF, 이미지<br />
                                최대 크기: 50MB
                              </p>
                            </div>
                            <input
                              type="file"
                              accept=".dwg,.dxf,.pdf,.png,.jpg,.jpeg"
                              onChange={handleFileUpload}
                              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                            />
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleSampleDrawingAnalysis}
                        disabled={uploading || !project}
                        className="tab-btn active"
                        style={{
                          width: '100%',
                          justifyContent: 'center',
                          gap: '0.4rem',
                          opacity: uploading || !project ? 0.6 : 1,
                          cursor: uploading || !project ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <Cpu size={15} /> 샘플 도면으로 바로 가구 추출
                      </button>

                      {uploadError && (
                        <div style={{
                          padding: '0.75rem',
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: '6px',
                          color: '#f87171',
                          fontSize: '0.78rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                          <span>{uploadError}</span>
                        </div>
                      )}

                      <div style={{
                        padding: '0.75rem',
                        background: 'rgba(30, 41, 59, 0.3)',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.4rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>AI 분석 엔진</span>
                          <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{config?.provider?.toUpperCase() || 'STUB'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>AI 자동 검수</span>
                          <span style={{ color: config?.real_ai_review_enabled ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                            {config?.real_ai_review_enabled ? '활성 (OpenAI)' : '비활성 (Stub)'}
                          </span>
                        </div>
                        <div style={{
                          marginTop: '0.5rem',
                          paddingTop: '0.5rem',
                          borderTop: '1px dashed rgba(255,255,255,0.1)',
                          color: 'var(--text-muted)',
                          fontSize: '0.75rem',
                          lineHeight: '1.4'
                        }}>
                          <span style={{ color: '#10b981' }}>✓ DXF/JPG/PNG 완벽 지원</span><br/>
                          <span style={{ color: '#f59e0b' }}>△ PDF/DWG 원본은 데모 시뮬레이션(Stub) 작동</span>
                        </div>
                      </div>

                      {/* Task Status List */}
                      <h3 className="card-title" style={{ marginTop: '1rem', margin: 0 }}><Activity size={16} /> 업로드 분석 이력</h3>
                      {loadingTasks ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
                          <div className="spinner" style={{ width: '24px', height: '24px' }}></div>
                        </div>
                      ) : tasks.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>진행된 분석 이력이 없습니다.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '350px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                          {tasks.map(t => {
                            let statusColor = 'orange';
                            let statusLabel = t.status;
                            if (t.status === 'COMPLETED') {
                              statusColor = 'green';
                              statusLabel = '분석 완료';
                            } else if (t.status === 'RUNNING') {
                              statusColor = 'blue';
                              statusLabel = '분석 중';
                            } else if (t.status === 'PENDING') {
                              statusColor = 'blue';
                              statusLabel = '대기 중';
                            } else if (t.status === 'FAILED') {
                              statusColor = 'pink';
                              statusLabel = '분석 실패';
                            } else if (t.status === 'FAILED_VALIDATION') {
                              statusColor = 'pink';
                              statusLabel = '검증 실패';
                            }

                            return (
                              <div
                                key={t.id}
                                className={`task-card ${selectedTask?.id === t.id ? 'active' : ''}`}
                                onClick={() => handleSelectTask(t)}
                                style={{
                                  padding: '0.8rem',
                                  borderRadius: '8px',
                                  border: '1px solid var(--border-color)',
                                  background: selectedTask?.id === t.id ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                                  borderColor: selectedTask?.id === t.id ? 'var(--primary)' : 'var(--border-color)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '0.4rem',
                                  transition: 'all 0.2s',
                                }}
                              >
                                <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 700, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px', color: 'var(--text-bright)' }} title={t.file_name}>
                                    📄 {t.file_name}
                                  </span>
                                  <span className={`badge ${statusColor}`} style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                                    {statusLabel}
                                  </span>
                                </div>

                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                  <div>업로드: {new Date(t.created_at).toLocaleString()}</div>
                                  {t.completed_at && <div>완료: {new Date(t.completed_at).toLocaleString()}</div>}
                                </div>

                                {t.status === 'COMPLETED' && (
                                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.7rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
                                    <span style={{ color: t.confidence_avg > 0.85 ? '#10b981' : '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                                      신뢰도: {(t.confidence_avg * 100).toFixed(0)}%
                                    </span>
                                    {t.needs_review_count > 0 ? (
                                      <span style={{ color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                                        검토 대상: {t.needs_review_count}건
                                      </span>
                                    ) : (
                                      <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>✓ 검토 완료</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Status Detail & Results Card */}
                    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      {selectedTask ? (
                        <>
                          <h3 className="card-title" style={{ margin: 0 }}>
                            <Info size={16} /> 태스크 분석 처리 상태
                          </h3>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.01)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <div>
                              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>파일명</p>
                              <p style={{ fontWeight: 600, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedTask.file_name}</p>
                            </div>
                            <div>
                              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>상태</p>
                              <div style={{ marginTop: '0.15rem' }}>
                                {(() => {
                                  if (selectedTask.status === 'COMPLETED') {
                                    return <span className="badge green" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>분석 완료 (COMPLETED)</span>;
                                  } else if (selectedTask.status === 'RUNNING') {
                                    return <span className="badge blue" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>분석 중 (RUNNING)</span>;
                                  } else if (selectedTask.status === 'PENDING') {
                                    return <span className="badge orange" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>대기 중 (PENDING)</span>;
                                  } else if (selectedTask.status === 'FAILED') {
                                    return <span className="badge pink" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>분석 실패 (FAILED)</span>;
                                  }
                                  return <span className="badge info" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>{selectedTask.status}</span>;
                                })()}
                              </div>
                            </div>
                            <div>
                              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>크기</p>
                              <p>{selectedTask.file_size ? `${(selectedTask.file_size / 1024).toFixed(1)} KB` : '-'}</p>
                            </div>
                            <div>
                              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>생성일시</p>
                              <p>{new Date(selectedTask.created_at).toLocaleString()}</p>
                            </div>
                          </div>

                          {/* Structured AI Detections Summary */}
                          {structuredAnalysis && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                              {structuredAnalysis.is_demo_result && (
                                <div className="demo-badge-banner">
                                  <AlertTriangle size={16} />
                                  <span>[시뮬레이션] 데모/Stub 분석 결과입니다.</span>
                                </div>
                              )}
                              {structuredAnalysis.is_demo_result === false && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '6px', fontSize: '0.78rem', color: '#10b981' }}>
                                  <CheckCircle2 size={14} />
                                  <span><strong>실제 분석 결과</strong> — DXF 벡터 추출 기반 분석이 완료되었습니다.</span>
                                </div>
                              )}

                              {/* Provider Info Card */}
                              {structuredAnalysis.provider_info && (
                                <div className="analysis-provider-card">
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>분석 Provider 구성</span>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
                                    {structuredAnalysis.provider_info.vector_extractor && (
                                      <span className="badge font-mono" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>
                                        Vector: {structuredAnalysis.provider_info.vector_extractor}
                                      </span>
                                    )}
                                    {structuredAnalysis.provider_info.vision_provider && (
                                      <span className="badge font-mono" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
                                        Vision: {structuredAnalysis.provider_info.vision_provider}
                                      </span>
                                    )}
                                    {structuredAnalysis.provider_info.fusion_engine && (
                                      <span className="badge font-mono" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', background: 'rgba(14,165,233,0.12)', color: '#38bdf8' }}>
                                        Fusion: {structuredAnalysis.provider_info.fusion_engine}
                                      </span>
                                    )}
                                    {structuredAnalysis.schema_version && (
                                      <span className="badge font-mono" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                                        Schema: v{structuredAnalysis.schema_version}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              <h4 style={{ fontSize: '0.88rem', color: 'var(--text-bright)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Cpu size={14} /> AI 가구 분석 초안 요약
                              </h4>

                              {(() => {
                                const items = structuredAnalysis.items || [];
                                const warnings = structuredAnalysis.warnings || [];
                                const rejected = structuredAnalysis.rejected_items || [];
                                const extSummary = structuredAnalysis.extraction_summary || {};
                                const readiness = structuredAnalysis.readiness_summary || null;
                                const totalItems = items.reduce((sum, it) => sum + (it.quantity || 0), 0);
                                const avgConfidence = items.length > 0
                                  ? items.reduce((sum, it) => sum + (it.confidence || 0), 0) / items.length
                                  : 0;

                                const needsReviewCount = extSummary.needs_review_count !== undefined
                                  ? extSummary.needs_review_count
                                  : items.filter(it => (it.confidence || 0) < 0.8 || it.is_special || it.needs_manual_review).length;

                                    return (
                                      <>
                                        <div style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          background: 'rgba(255,255,255,0.02)',
                                          border: '1px solid var(--border-color)',
                                          borderRadius: '6px',
                                          padding: '0.6rem 0.8rem',
                                          marginBottom: '0.75rem',
                                          fontSize: '0.75rem'
                                        }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>분석 모드:</span>
                                            <strong style={{ color: structuredAnalysis.is_demo_result ? '#fbbf24' : '#10b981' }}>
                                              {structuredAnalysis.is_demo_result ? '샘플/Vision 추론 모드' : 'DXF 벡터 추출 모드'}
                                            </strong>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>가구목록:</span>
                                            <strong style={{ color: readiness?.usable_for_required_furniture_list ? '#10b981' : '#fbbf24' }}>
                                              {readiness?.usable_for_required_furniture_list ? '사용 가능' : '제한적'}
                                            </strong>
                                          </div>
                                        </div>

                                        {readiness && (
                                      <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                        gap: '0.6rem',
                                        alignItems: 'center',
                                        background: readiness.usable_for_quote ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)',
                                        border: readiness.usable_for_quote ? '1px solid rgba(16,185,129,0.18)' : '1px solid rgba(245,158,11,0.18)',
                                        borderRadius: '6px',
                                        padding: '0.7rem',
                                        fontSize: '0.72rem'
                                      }}>
                                        <div>
                                          <div style={{ color: 'var(--text-bright)', fontWeight: 700, marginBottom: '0.15rem' }}>
                                            {readiness.real_ai_review_enabled ? 'AI 자동 검수 완료' : '분석 결과 사용성'}
                                          </div>
                                          <div style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                            {readiness.real_ai_review_enabled
                                              ? 'OpenAI 기반 도면 판독 및 검수가 완료되었습니다.'
                                              : '추출된 가구 후보를 견적 초안으로 변환했습니다.'}
                                          </div>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)' }}>견적 적용</span>
                                          <strong style={{ color: readiness.usable_for_quote ? '#10b981' : '#fbbf24' }}>
                                            {readiness.usable_for_quote ? '사용 가능' : '제한적'}
                                          </strong>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)' }}>가구 후보</span>
                                          <strong style={{ color: 'var(--text-bright)' }}>{items.length}건</strong>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)' }}>수동 검토 필요</span>
                                          <strong style={{ color: readiness.manual_review_items > 0 ? '#f87171' : '#10b981' }}>
                                            {readiness.manual_review_items ?? 0}건
                                          </strong>
                                        </div>
                                      </div>
                                    )}

                                    {readiness?.blocking_issues?.length > 0 && (
                                      <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', padding: '0.65rem 0.85rem', fontSize: '0.76rem', color: '#f87171', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                                        <strong style={{ display: 'block', marginBottom: '0.25rem' }}>⚠️ 시스템 에러 (블로킹 이슈)</strong>
                                        <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                          {readiness.blocking_issues.map((b, bIdx) => <li key={bIdx}>{b}</li>)}
                                        </ul>
                                      </div>
                                    )}

                                    {/* DXF Vector Extraction Stats (shown when available) */}
                                    {(extSummary.total_entities !== undefined) && (
                                      <div className="analysis-vector-stats">
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, gridColumn: '1 / -1' }}>🔍 DXF 벡터 추출 요약</span>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem', fontSize: '0.62rem' }}>전체 엔티티</span>
                                          <span style={{ fontWeight: 700, color: '#818cf8', fontSize: '0.85rem' }}>{extSummary.total_entities}</span>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem', fontSize: '0.62rem' }}>텍스트</span>
                                          <span style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.85rem' }}>{extSummary.text_entities ?? '-'}</span>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem', fontSize: '0.62rem' }}>치수</span>
                                          <span style={{ fontWeight: 700, color: '#34d399', fontSize: '0.85rem' }}>{extSummary.dimension_entities ?? '-'}</span>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem', fontSize: '0.62rem' }}>블록참조</span>
                                          <span style={{ fontWeight: 700, color: '#fbbf24', fontSize: '0.85rem' }}>{extSummary.insert_entities ?? '-'}</span>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem', fontSize: '0.62rem' }}>심볼 매칭</span>
                                          <span style={{ fontWeight: 700, color: '#c084fc', fontSize: '0.85rem' }}>{extSummary.matched_symbols ?? '-'}</span>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                          <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem', fontSize: '0.62rem' }}>BOM 검증</span>
                                          <span style={{ fontWeight: 700, color: extSummary.bom_cross_validated ? '#10b981' : '#f87171', fontSize: '0.85rem' }}>
                                            {extSummary.bom_cross_validated ? '✓' : '✗'}
                                          </span>
                                        </div>
                                        {extSummary.layers && extSummary.layers.length > 0 && (
                                          <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.15rem' }}>
                                            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginRight: '0.25rem' }}>레이어:</span>
                                            {extSummary.layers.map((l, i) => (
                                              <span key={i} className="badge font-mono" style={{ fontSize: '0.55rem', padding: '0.05rem 0.25rem', background: 'rgba(255,255,255,0.06)' }}>{l}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem', background: 'rgba(255,255,255,0.01)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.03)', fontSize: '0.7rem' }}>
                                      <div style={{ textAlign: 'center' }}>
                                        <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem' }}>Vector 검지</span>
                                        <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{extSummary.vector_items_count ?? '-'}건</span>
                                      </div>
                                      <div style={{ textAlign: 'center' }}>
                                        <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem' }}>Vision 검지</span>
                                        <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{extSummary.vision_items_count ?? '-'}건</span>
                                      </div>
                                      <div style={{ textAlign: 'center' }}>
                                        <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem' }}>BOM 매칭</span>
                                        <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{extSummary.bom_matched_items_count ?? '-'}건</span>
                                      </div>
                                      <div style={{ textAlign: 'center' }}>
                                        <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem' }}>부적격 필터</span>
                                        <span style={{ fontWeight: 600, color: rejected.length > 0 ? '#f87171' : 'var(--text-bright)' }}>{extSummary.rejected_items_count ?? rejected.length}건</span>
                                      </div>
                                      <div style={{ textAlign: 'center' }}>
                                        <span style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '0.1rem' }}>검수 요망</span>
                                        <span style={{ fontWeight: 600, color: needsReviewCount > 0 ? '#fbbf24' : '#10b981' }}>{needsReviewCount}건</span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>평균 신뢰도</span>
                                        <p style={{ fontSize: '1rem', fontWeight: 700, color: avgConfidence >= 0.85 ? '#10b981' : avgConfidence >= 0.7 ? '#fbbf24' : '#ef4444', marginTop: '0.15rem' }}>
                                          {(avgConfidence * 100).toFixed(0)}%
                                        </p>
                                      </div>
                                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>검지 품목 수량</span>
                                        <p style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-bright)', marginTop: '0.15rem' }}>
                                          {items.length}종 / {totalItems}개
                                        </p>
                                      </div>
                                      <div style={{
                                        background: needsReviewCount > 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(16, 185, 129, 0.05)',
                                        padding: '0.65rem',
                                        borderRadius: '6px',
                                        border: needsReviewCount > 0 ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(16, 185, 129, 0.2)',
                                        textAlign: 'center'
                                      }}>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>수동 검토 요망</span>
                                        <p style={{ fontSize: '1rem', fontWeight: 700, color: needsReviewCount > 0 ? '#ef4444' : '#10b981', marginTop: '0.15rem' }}>
                                          {needsReviewCount}건
                                        </p>
                                      </div>
                                    </div>

                                    {warnings.length > 0 && (
                                      <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', padding: '0.65rem 0.85rem', fontSize: '0.76rem', color: '#f87171' }}>
                                        <strong style={{ display: 'block', marginBottom: '0.25rem' }}>⚠️ 시스템 경고 및 검토 요망 사항 ({warnings.length}건)</strong>
                                        <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                          {warnings.map((w, wIdx) => <li key={wIdx}>{w}</li>)}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Candidate items list */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '250px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'rgba(0,0,0,0.2)', padding: '0.4rem' }}>
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, paddingLeft: '0.25rem' }}>자동 검지된 가구 후보 목록</span>
                                      {items.map((it, idx) => {
                                        const isLowConf = (it.confidence || 0) < 0.8;
                                        const isUnmatchedPrice = it.unit_price === 0 || it.price_source === 'not_found';
                                        let cardBg = 'rgba(255,255,255,0.01)';
                                        let cardBorder = 'var(--border-color)';
                                        if (isLowConf || isUnmatchedPrice) {
                                          cardBg = 'rgba(239, 68, 68, 0.03)';
                                          cardBorder = 'rgba(239, 68, 68, 0.15)';
                                        } else if (it.is_special || it.needs_review) {
                                          cardBg = 'rgba(245, 158, 11, 0.03)';
                                          cardBorder = 'rgba(245, 158, 11, 0.15)';
                                        }

                                        return (
                                          <div key={idx} style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            background: cardBg,
                                            border: `1px solid ${cardBorder}`,
                                            borderRadius: '6px',
                                            padding: '0.5rem 0.75rem',
                                            fontSize: '0.75rem',
                                            gap: '0.5rem'
                                          }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: 1 }}>
                                              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                                                <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{it.product_name}</span>
                                                <span className="badge font-mono" style={{ fontSize: '0.6rem', padding: '0.05rem 0.2rem', background: 'rgba(255,255,255,0.08)' }}>{it.category}</span>

                                                {/* Source type badge */}
                                                {it.source_type === 'dxf_vector' && (
                                                  <span className="badge font-mono" style={{ fontSize: '0.55rem', padding: '0.05rem 0.2rem', background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>DXF</span>
                                                )}

                                                {/* Issues Badges */}
                                                {isLowConf && <span className="badge pink" style={{ fontSize: '0.6rem', padding: '0.05rem 0.2rem' }}>낮은 신뢰도</span>}
                                                {it.is_special && <span className="badge orange" style={{ fontSize: '0.6rem', padding: '0.05rem 0.2rem' }}>비규격 치수</span>}
                                                {isUnmatchedPrice && <span className="badge pink" style={{ fontSize: '0.6rem', padding: '0.05rem 0.2rem', background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>단가 미매칭</span>}
                                                {it.needs_review && !isLowConf && !it.is_special && !isUnmatchedPrice && <span className="badge orange" style={{ fontSize: '0.6rem', padding: '0.05rem 0.2rem', background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>검토 요망</span>}

                                                {/* Review flags */}
                                                {it.review_flags && it.review_flags.length > 0 && it.review_flags.map((flag, fi) => (
                                                  <span key={fi} className="badge font-mono" style={{ fontSize: '0.5rem', padding: '0.02rem 0.2rem', background: 'rgba(245,158,11,0.08)', color: '#d97706' }}>
                                                    {flag}
                                                  </span>
                                                ))}
                                              </div>
                                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                규격: {it.width_mm}x{it.depth_mm}x{it.height_mm}mm | 근거: {it.evidence ? (Array.isArray(it.evidence) ? it.evidence.join(', ') : it.evidence) : '없음'}
                                              </span>
                                              {it.review_reason && (
                                                <span style={{ fontSize: '0.62rem', color: '#fbbf24', fontStyle: 'italic' }}>
                                                  사유: {it.review_reason}
                                                </span>
                                              )}
                                            </div>
                                            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'end', gap: '0.15rem', flexShrink: 0 }}>
                                              <span style={{ fontWeight: 700, color: 'var(--text-bright)' }}>{it.quantity}개</span>
                                              <span style={{ fontSize: '0.65rem', color: isLowConf ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                                                신뢰도: {((it.confidence || 0) * 100).toFixed(0)}%
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {/* Rejected Items Collapsible */}
                                    {rejected.length > 0 && (
                                      <details className="analysis-rejected-section">
                                        <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#f87171', fontWeight: 600, padding: '0.4rem 0' }}>
                                          ❌ 부적격 항목 ({rejected.length}건) — 클릭하여 펼치기
                                        </summary>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.3rem' }}>
                                          {rejected.map((rj, rjIdx) => (
                                            <div key={rjIdx} style={{
                                              background: 'rgba(239,68,68,0.05)',
                                              border: '1px solid rgba(239,68,68,0.15)',
                                              borderRadius: '4px',
                                              padding: '0.35rem 0.6rem',
                                              fontSize: '0.7rem',
                                            }}>
                                              <span style={{ fontWeight: 600, color: '#f87171' }}>{rj.product_name || '(이름 없음)'}</span>
                                              <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }}>
                                                사유: {rj.rejection_reason || '알 수 없음'}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </details>
                                    )}

                                    {/* Analysis Action CTAs */}
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                      <button
                                        className="tab-btn active"
                                        style={{ flex: 1, justifyContent: 'center' }}
                                        onClick={() => {
                                          setCurrentPage('quotation');
                                        }}
                                      >
                                        <FileText size={15} /> 견적 초안 확인 및 검수
                                      </button>
                                      <button
                                        className="tab-btn"
                                        style={{ flex: 1, justifyContent: 'center' }}
                                        onClick={() => {
                                          setCurrentPage('furniture-schedule');
                                        }}
                                      >
                                        <List size={15} /> 가구 산출표 보기
                                      </button>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          )}

                          {/* AI Pipeline Stages */}
                          {selectedTask.ai_raw_response && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                              <h4 style={{ fontSize: '0.88rem', color: 'var(--text-bright)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Cpu size={14} /> AI 분석 파이프라인 단계별 처리 현황
                              </h4>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {parsePipelineLogs(selectedTask.ai_raw_response).map((stage, idx) => {
                                  const isCompleted = stage.status === 'COMPLETED' || stage.status === 'PASSED';
                                  const isWarning = stage.status === 'WARNING';
                                  return (
                                    <div key={idx} style={{
                                      background: 'rgba(255,255,255,0.01)',
                                      border: '1px solid var(--border-color)',
                                      borderRadius: '6px',
                                      padding: '0.75rem 1rem',
                                      fontSize: '0.8rem',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '0.4rem'
                                    }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                          <div style={{
                                            width: '18px',
                                            height: '18px',
                                            borderRadius: '50%',
                                            background: isCompleted ? 'rgba(16,185,129,0.15)' : isWarning ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                                            color: isCompleted ? '#10b981' : isWarning ? '#fbbf24' : '#9ca3af',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '0.7rem',
                                            fontWeight: 800
                                          }}>
                                            {isCompleted ? '✓' : idx + 1}
                                          </div>
                                          <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '0.85rem' }}>{stage.name}</span>
                                        </div>
                                        <span className={`badge ${isCompleted ? 'green' : isWarning ? 'orange' : 'pink'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                                          {stage.status}
                                        </span>
                                      </div>

                                      <div style={{ paddingLeft: '1.4rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', borderLeft: '2px solid rgba(255,255,255,0.05)', marginLeft: '0.5rem' }}>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-main)' }}>
                                          {stage.logText}
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                          <span>⏱️ 소요시간: <strong>{stage.duration.toFixed(3)}초</strong></span>
                                          <span>📊 신뢰도: <strong style={{ color: stage.confidence >= 0.85 ? '#10b981' : '#f59e0b' }}>{(stage.confidence * 100).toFixed(0)}%</strong></span>
                                          <span>🔍 검출 근거: <strong>{stage.evidence || 'N/A'}</strong></span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Collapsible raw logs */}
                              <div>
                                <button
                                  className="tab-btn"
                                  onClick={() => setShowRawLogs(!showRawLogs)}
                                  style={{
                                    padding: '0.35rem 0.6rem',
                                    fontSize: '0.75rem',
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.25rem'
                                  }}
                                >
                                  {showRawLogs ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                  <span>{showRawLogs ? '개발자 Raw 로그 접기' : '개발자 Raw 로그 펼치기'}</span>
                                </button>
                                {showRawLogs && (
                                  <pre style={{
                                    marginTop: '0.5rem',
                                    background: '#070a13',
                                    padding: '0.75rem',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    color: '#34d399',
                                    fontSize: '0.72rem',
                                    fontFamily: 'monospace',
                                    whiteSpace: 'pre-wrap',
                                    lineHeight: '1.4',
                                    maxHeight: '180px',
                                    overflowY: 'auto'
                                  }}>
                                    {selectedTask.ai_raw_response}
                                  </pre>
                                )}
                              </div>
                            </div>
                          )}

                          {selectedTask.status === 'FAILED' && (
                            <div style={{ padding: '1.25rem', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                <AlertTriangle size={16} /> 도면 분석 중 오류가 발생했습니다
                              </div>
                              <p style={{ margin: 0 }}>
                                <strong>오류 원인:</strong> {selectedTask.error_message || '알 수 없는 파이프라인 내부 에러가 발생했습니다.'}
                              </p>
                              <div style={{ borderTop: '1px solid rgba(239, 68, 68, 0.15)', paddingTop: '0.5rem', fontSize: '0.78rem', color: 'rgba(255, 255, 255, 0.6)', lineHeight: '1.4' }}>
                                💡 <strong>권장 다음 행동:</strong><br />
                                1. 도면 파일의 유효성(파일 확장자, 크기, 깨짐 여부)을 확인해 주세요.<br />
                                2. Stub/AI Provider 설정 상태를 점검하거나 API Key 설정을 확인해 주세요.
                              </div>
                            </div>
                          )}

                          {selectedTask.status === 'RUNNING' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)', fontSize: '0.85rem' }}>
                              <div className="spinner" style={{ width: '20px', height: '20px' }}></div>
                              <span>도면 데이터를 파싱하고 있습니다. 잠시만 기다려 주세요 (5초 자동 갱신).</span>
                            </div>
                          )}

                          {selectedTask.status === 'PENDING' && (
                            <div style={{ padding: '1rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.85rem' }}>
                              <span>태스크 대기 중입니다...</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="empty-state" style={{ padding: '5rem 2rem' }}>
                          <div className="empty-icon">📊</div>
                          <p>업로드 분석 이력에서 태스크를 선택하거나,<br />새로운 도면 파일을 업로드하여 견적 결과를 확인하세요.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {cadUploadTab === 'demo' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div style={{
                    background: 'linear-gradient(90deg, rgba(217, 119, 6, 0.15) 0%, rgba(217, 119, 6, 0.05) 100%)',
                    border: '1px solid rgba(217, 119, 6, 0.3)',
                    borderRadius: '8px',
                    padding: '1rem 1.25rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    fontSize: '0.88rem',
                    lineHeight: '1.5'
                  }}>
                    <AlertTriangle size={18} style={{ color: '#d97706', marginTop: '0.1rem', flexShrink: 0 }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: '0.2rem', color: '#fbbf24' }}>
                        고정 샘플 데모 데이터 모드 (Static Mockup Mode)
                      </strong>
                      <span style={{ color: 'var(--text-muted)' }}>
                        이 화면은 업로드 및 AI 도면 판독 API를 직접 실행하지 않고, 시스템 이해를 돕기 위해 사전에 수집된 고정 도면과 산출 견적서 샘플을 보여주는 데모 전용 공간입니다.
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSampleDrawingAnalysis}
                    disabled={uploading || !project}
                    className="tab-btn active"
                    style={{
                      alignSelf: 'flex-start',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      opacity: uploading || !project ? 0.6 : 1,
                      cursor: uploading || !project ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <Cpu size={15} /> 이 샘플 도면을 실제 분석 이력으로 실행
                  </button>

                  {loadingDemo ? (
                    <div className="loading-screen">
                      <div className="spinner"></div>
                      <p style={{ color: 'var(--text-muted)' }}>데모 분석 데이터를 로드하는 중...</p>
                    </div>
                  ) : demoData ? (
                    <div className="analysis-grid">
                      <div>
                        <div className="glass-card" style={{ marginBottom: '1.5rem', borderTop: '2px solid rgba(217, 119, 6, 0.4)' }}>
                          <h3 className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <Layers size={16} /> 데모 대상 도면 샘플
                            </span>
                            <span className="badge orange" style={{ fontSize: '0.72rem' }}>고정 샘플</span>
                          </h3>
                          <div className="drawing-box">
                            <img
                              src="/api/demo/drawing"
                              alt="도면 샘플"
                              className="drawing-image"
                            />
                            <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                              김해삼계푸르지오 주방가구 평면 및 입면도 데모용
                            </div>
                          </div>
                        </div>

                        <div className="glass-card">
                          <h3 className="card-title">
                            <Cpu size={16} /> AI 도면 분석 & 견적서 생성 흐름도
                          </h3>
                          <div className="flowchart-list">
                            {demoData.flowchart_steps.map(step => (
                              <div key={step.id} className="flow-step-card">
                                <div className="flow-step-number">{step.id}</div>
                                <div className="flow-step-body">
                                  <div className="flow-step-title">{step.title}</div>
                                  <div className="flow-step-desc">{step.desc}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="quote-sheet" style={{ borderTop: '4px solid #d97706' }}>
                          <div className="quote-sheet-header">
                            <div>
                              <span style={{ fontSize: '0.78rem', color: '#fbbf24', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#fbbf24' }}></span>
                                데모 전용 고정 샘플 데이터 (편집 불가)
                              </span>
                              <h2 className="quote-sheet-title" style={{ marginTop: '0.2rem' }}>가구 견적서 (샘플)</h2>
                            </div>
                            <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              <div>문서번호: {demoData.quote_metadata.doc_number}</div>
                              <div>발행일자: {demoData.quote_metadata.date}</div>
                            </div>
                          </div>

                          <div className="quote-meta-row">
                            <div className="quote-meta-item">
                              <span className="quote-meta-label">공사명</span>
                              <span className="quote-meta-val">{demoData.quote_metadata.project_name}</span>
                            </div>
                            <div className="quote-meta-item">
                              <span className="quote-meta-label">발주처</span>
                              <span className="quote-meta-val">{demoData.quote_metadata.client}</span>
                            </div>
                            <div className="quote-meta-item">
                              <span className="quote-meta-label">분석 타입</span>
                              <span className="quote-meta-val">{demoData.quote_metadata.type_name}</span>
                            </div>
                          </div>

                          <div className="table-wrapper">
                            <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                              <thead>
                                <tr>
                                  <th style={{ width: '40px' }}>NO</th>
                                  <th>구분</th>
                                  <th>품명</th>
                                  <th>규격 (W*D*H)</th>
                                  <th style={{ textAlign: 'right' }}>수량</th>
                                  <th>단위</th>
                                  <th style={{ textAlign: 'right' }}>단가</th>
                                  <th style={{ textAlign: 'right' }}>금액</th>
                                  <th>비고</th>
                                </tr>
                              </thead>
                              <tbody>
                                {demoData.quote_items.map(item => (
                                  <tr key={item.item_no}>
                                    <td>{item.item_no}</td>
                                    <td>
                                      <span className={`badge ${
                                        item.category === '상부장' ? 'blue' :
                                        item.category === '하부장' ? 'green' :
                                        item.category === '키큰장' ? 'orange' : 'pink'
                                      }`}>
                                        {item.category}
                                      </span>
                                    </td>
                                    <td style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{item.item_name}</td>
                                    <td><code>{item.spec}</code></td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.qty}</td>
                                    <td>{item.unit}</td>
                                    <td style={{ textAlign: 'right' }}>₩{item.unit_price.toLocaleString()}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--primary)' }}>
                                      ₩{item.sum_price.toLocaleString()}
                                    </td>
                                    <td style={{ whiteSpace: 'normal', fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '200px' }}>
                                      {item.remarks}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '1.5rem' }}>
                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>공급가액 합계</span>
                              <h4 style={{ fontSize: '1.25rem', color: 'var(--text-bright)', marginTop: '0.25rem' }}>
                                ₩{demoData.total_amount.toLocaleString()}
                              </h4>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>부가가치세 (10%)</span>
                              <h4 style={{ fontSize: '1.25rem', color: 'var(--text-bright)', marginTop: '0.25rem' }}>
                                ₩{demoData.vat_amount.toLocaleString()}
                              </h4>
                            </div>
                            <div style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--secondary)', textAlign: 'center' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>총 청구 금액 (VAT 포함)</span>
                              <h4 style={{ fontSize: '1.25rem', color: 'var(--secondary)', fontWeight: 800, marginTop: '0.25rem' }}>
                                ₩{demoData.grand_total.toLocaleString()}
                              </h4>
                            </div>
                          </div>

                          <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.01)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <h5 style={{ color: 'var(--text-bright)', marginBottom: '0.5rem', fontWeight: 600 }}>특기사항 및 견적 기준</h5>
                            <ul style={{ paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <li>본 견적서는 샘플 도면을 AI 비전 판독 및 치수 매칭으로 자동 산출한 데모 결과입니다.</li>
                              <li>{demoData.quote_metadata.remarks}</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-card empty-state">
                      <p>데모 분석 데이터를 불러올 수 없습니다.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* PAGE 4: 가구 산출표 (Furniture Schedule) */}
          {/* ======================================================== */}
          {currentPage === 'furniture-schedule' && (
            <div className="tab-content">
              {loadingSchedule ? (
                <div className="loading-screen">
                  <div className="spinner"></div>
                </div>
              ) : (
                <div className="glass-card">
                  <div className="filter-bar">
                    <div className="search-input-wrapper">
                      <Search size={16} className="search-icon" />
                      <input
                        id="schedule-search-input"
                        type="text"
                        placeholder="가구명, 카테고리, 속성을 검색해 보세요..."
                        className="search-input"
                        value={scheduleSearchQuery}
                        onChange={e => setScheduleSearchQuery(e.target.value)}
                      />
                    </div>

                    <div className="filter-selects">
                      <select
                        id="schedule-category-select"
                        className="custom-select"
                        value={scheduleCategoryFilter}
                        onChange={e => setScheduleCategoryFilter(e.target.value)}
                      >
                        {categories.map(c => (
                          <option key={c} value={c}>{c === 'All' ? '전체 카테고리' : c}</option>
                        ))}
                      </select>

                      <select
                        id="schedule-review-select"
                        className="custom-select"
                        value={scheduleReviewFilter}
                        onChange={e => setScheduleReviewFilter(e.target.value)}
                      >
                        <option value="All">검토 상태 (전체)</option>
                        <option value="ReviewRequired">검토 필요 (추론 포함)</option>
                        <option value="Standard">검토 불필요 (확정)</option>
                      </select>
                    </div>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="glass-card metric-card" style={{ padding: '1rem' }}>
                      <div className="metric-info">
                        <span className="metric-val" style={{ color: 'var(--secondary)', fontSize: '1.4rem' }}>
                          {scheduleSummary.total_item_types} 종
                        </span>
                        <span className="metric-lbl">필요 가구 모듈 타입 수</span>
                      </div>
                    </div>
                    <div className="glass-card metric-card" style={{ padding: '1rem' }}>
                      <div className="metric-info">
                        <span className="metric-val" style={{ color: 'var(--primary)', fontSize: '1.4rem' }}>
                          {scheduleSummary.total_quantity} EA
                        </span>
                        <span className="metric-lbl">세대당 필요 가구 총 수량</span>
                      </div>
                    </div>
                    <div className="glass-card metric-card" style={{ padding: '1rem' }}>
                      <div className="metric-info">
                        <span className="metric-val" style={{ color: scheduleSummary.review_required_count > 0 ? '#f59e0b' : 'var(--text-bright)', fontSize: '1.4rem' }}>
                          {scheduleSummary.review_required_count} 건
                        </span>
                        <span className="metric-lbl">AI 치수 추론 및 검토 필요</span>
                      </div>
                    </div>
                  </div>

                  {/* Schedule Legend */}
                  <div className="schedule-legend">
                    <span className="legend-title">🔍 치수 출처 범례:</span>
                    <div className="legend-items">
                      <div className="legend-item">
                        {renderDimBadge('cad_dimension')}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>CAD 치수 엔티티</span>
                      </div>
                      <div className="legend-item">
                        {renderDimBadge('block_attribute')}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>블록 속성/블록명</span>
                      </div>
                      <div className="legend-item">
                        {renderDimBadge('drawing_text')}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>도면 텍스트 직접 추출</span>
                      </div>
                      <div className="legend-item">
                        {renderDimBadge('ocr_text')}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>OCR 판독</span>
                      </div>
                      <div className="legend-item">
                        {renderDimBadge('bom')}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>발주서 BOM 기준</span>
                      </div>
                      <div className="legend-item">
                        {renderDimBadge('ai_inferred')}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>AI 치수 추론</span>
                      </div>
                      <div className="legend-item">
                        {renderDimBadge('default_by_category')}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>카테고리별 기본값</span>
                      </div>
                      <div className="legend-item">
                        {renderDimBadge('manual_review')}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>관리자 검수 완료</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      * 금액 정보가 제외된 <strong>물량 산출 내역서</strong> 모드입니다.
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          showToast("가구 산출표 엑셀 다운로드를 시작합니다...", "info");
                          const needsReviewParam = scheduleReviewFilter === 'ReviewRequired' ? true : (scheduleReviewFilter === 'Standard' ? false : null);
                          await apiClient.downloadFurnitureSchedule(selectedType.id, {
                            search: scheduleSearchQuery,
                            category: scheduleCategoryFilter,
                            needsReview: needsReviewParam
                          });
                          showToast("가구 산출표 엑셀 파일 다운로드가 성공적으로 완료되었습니다.", "success");
                        } catch (err) {
                          showToast("다운로드 실패: " + err.message, "error");
                        }
                      }}
                      className="tab-btn active"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}
                    >
                      <FileText size={14} /> 가구 산출표 Excel 다운로드
                    </button>
                  </div>

                  {/* Schedule Table */}
                  <div className="table-responsive" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th>No</th>
                          <th>카테고리</th>
                          <th>가구명</th>
                          <th>규격 (W*H*D)</th>
                          <th style={{ textAlign: 'right' }}>폭 (W)</th>
                          <th style={{ textAlign: 'right' }}>높이 (H)</th>
                          <th style={{ textAlign: 'right' }}>깊이 (D)</th>
                          <th style={{ textAlign: 'right' }}>수량</th>
                          <th>산출 근거</th>
                          <th style={{ textAlign: 'center' }}>신뢰도</th>
                          <th style={{ textAlign: 'center' }}>검토 필요</th>
                        </tr>
                      </thead>
                      <tbody>
                        {furnitureSchedule.length === 0 ? (
                          <tr>
                            <td colSpan="11" style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                              조건에 맞는 가구 산출 내역이 존재하지 않습니다.
                            </td>
                          </tr>
                        ) : (
                          furnitureSchedule.map((item, idx) => {
                            return (
                              <tr key={idx} className={item.needs_review ? 'row-warning' : ''}>
                                <td>{item.item_no}</td>
                                <td>
                                  <span className="badge blue" style={{ fontSize: '0.7rem' }}>
                                    {item.category || '미분류'}
                                  </span>
                                </td>
                                <td style={{ fontWeight: '600', color: 'var(--text-bright)' }}>
                                  {item.furniture_name}
                                </td>
                                <td className="font-mono" style={{ fontSize: '0.85rem' }}>
                                  {item.spec_label}
                                </td>
                                <td style={{ textAlign: 'right' }} className="font-mono">
                                  <div>{item.width_mm}mm</div>
                                  <div style={{ marginTop: '0.15rem' }}>{renderDimBadge(item.dimension_source.width)}</div>
                                </td>
                                <td style={{ textAlign: 'right' }} className="font-mono">
                                  <div>{item.height_mm}mm</div>
                                  <div style={{ marginTop: '0.15rem' }}>{renderDimBadge(item.dimension_source.height)}</div>
                                </td>
                                <td style={{ textAlign: 'right' }} className="font-mono">
                                  <div>{item.depth_mm}mm</div>
                                  <div style={{ marginTop: '0.15rem' }}>{renderDimBadge(item.dimension_source.depth)}</div>
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--accent)' }} className="font-mono">
                                  {item.qty} {item.unit}
                                </td>
                                <td style={{ fontSize: '0.8rem', color: item.needs_review ? 'var(--text-bright)' : 'var(--text-muted)' }}>
                                  {item.needs_review ? item.review_reason : '도면 텍스트에서 규격 값 추출 완료'}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <span className={`badge ${item.confidence >= 0.9 ? 'green' : item.confidence >= 0.75 ? 'orange' : 'pink'}`} style={{ fontSize: '0.7rem' }}>
                                    {Math.round(item.confidence * 100)}%
                                  </span>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  {item.needs_review ? (
                                    <span className="special-badge" style={{ backgroundColor: '#ef4444', color: 'white', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem' }}>
                                      검토 필요
                                    </span>
                                  ) : (
                                    <span className="normal-badge" style={{ fontSize: '0.7rem' }}>정상</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* PAGE 5: AI 검수 (AI Review) */}
          {/* ======================================================== */}
          {currentPage === 'ai-review' && (
            <div className="tab-content">
              {loadingSchedule ? (
                <div className="loading-screen">
                  <div className="spinner"></div>
                </div>
              ) : (
                <div className="glass-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <div>
                      <h3 className="card-title" style={{ margin: 0 }}>
                        <CheckCircle2 size={16} /> AI 치수 검수 및 승인 센터
                      </h3>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        AI가 도면 분석 과정에서 치수를 추론(기본값 적용 포함)한 항목들입니다. 현장 사양에 맞춰 검토하고 확정해 주세요.
                      </p>
                    </div>
                    <span className="badge pink" style={{ fontSize: '0.9rem', padding: '0.3rem 0.75rem' }}>
                      검토 필요 항목: {furnitureSchedule.filter(item => item.needs_review).length}건
                    </span>
                  </div>

                  {furnitureSchedule.filter(item => item.needs_review).length === 0 ? (
                    <div className="empty-state" style={{ padding: '5rem 2rem' }}>
                      <div className="empty-icon">🎉</div>
                      <p style={{ color: 'var(--text-bright)', fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        모든 가구의 치수 검수가 완료되었습니다!
                      </p>
                      <p style={{ color: 'var(--text-muted)' }}>
                        이 평형 타입의 모든 가구가 도면 텍스트를 기준으로 매칭되었거나 수동으로 검수 승인되었습니다.
                      </p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                        <thead>
                          <tr>
                            <th style={{ width: '50px' }}>No</th>
                            <th style={{ width: '100px' }}>카테고리</th>
                            <th>가구명</th>
                            <th>추론 규격</th>
                            <th style={{ width: '120px' }}>가로 (W)</th>
                            <th style={{ width: '120px' }}>높이 (H)</th>
                            <th style={{ width: '120px' }}>깊이 (D)</th>
                            <th style={{ width: '70px', textAlign: 'right' }}>수량</th>
                            <th>AI 추론 근거 / 검토 필요 사유</th>
                            <th style={{ width: '150px', textAlign: 'center' }}>조치</th>
                          </tr>
                        </thead>
                        <tbody>
                          {furnitureSchedule.filter(item => item.needs_review).map((item) => {
                            const currentEdits = editValues[item.id] || {
                              width: item.width_mm,
                              height: item.height_mm,
                              depth: item.depth_mm
                            };

                            const handleValChange = (field, val) => {
                              setEditValues(prev => ({
                                ...prev,
                                [item.id]: {
                                  ...currentEdits,
                                  [field]: parseInt(val) || 0
                                }
                              }));
                            };

                            const isWInferred = !isMeasuredDimensionSource(item.dimension_source.width);
                            const isHInferred = !isMeasuredDimensionSource(item.dimension_source.height);
                            const isDInferred = !isMeasuredDimensionSource(item.dimension_source.depth);

                            const handleSaveAndApprove = async () => {
                              try {
                                setLoadingSchedule(true);
                                await apiClient.updateCabinetBom(item.id, {
                                  width: currentEdits.width,
                                  height: currentEdits.height,
                                  depth: currentEdits.depth,
                                  width_source: isWInferred && currentEdits.width !== item.width_mm ? 'manual_review' : item.dimension_source.width,
                                  height_source: isHInferred && currentEdits.height !== item.height_mm ? 'manual_review' : item.dimension_source.height,
                                  depth_source: isDInferred && currentEdits.depth !== item.depth_mm ? 'manual_review' : item.dimension_source.depth,
                                });
                                await apiClient.approveCabinetBom(item.id);
                                await fetchScheduleData();
                                setErrorMessage('');
                                showToast(`"${item.furniture_name}" 가구 치수 수동 수정 및 검수 승인이 성공적으로 완료되었습니다.`, "success");
                              } catch (err) {
                                const displayMsg = err.message || '검수 승인 처리에 실패했습니다.';
                                setErrorMessage('검수 승인 실패: ' + displayMsg);
                                showToast("검수 승인 실패: " + displayMsg, "error");
                              } finally {
                                setLoadingSchedule(false);
                              }
                            };

                            const handleApproveAsIs = async () => {
                              try {
                                setLoadingSchedule(true);
                                await apiClient.approveCabinetBom(item.id);
                                await fetchScheduleData();
                                setErrorMessage('');
                                showToast(`"${item.furniture_name}" 가구가 현재 AI 추론치로 최종 승인되었습니다.`, "success");
                              } catch (err) {
                                const displayMsg = err.message || '검수 승인 처리에 실패했습니다.';
                                setErrorMessage('검수 승인 실패: ' + displayMsg);
                                showToast("검수 승인 실패: " + displayMsg, "error");
                              } finally {
                                setLoadingSchedule(false);
                              }
                            };

                            return (
                              <tr key={item.id} className="row-warning">
                                <td>{item.item_no}</td>
                                <td>
                                  <span className="badge blue" style={{ fontSize: '0.7rem' }}>
                                    {item.category}
                                  </span>
                                </td>
                                <td style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
                                  {item.furniture_name}
                                </td>
                                <td className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  {item.spec_label}
                                </td>

                                {/* Width Input */}
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <input
                                      type="number"
                                      value={currentEdits.width}
                                      onChange={(e) => handleValChange('width', e.target.value)}
                                      className="search-input"
                                      style={{ padding: '0.25rem 0.5rem', width: '70px', background: 'rgba(0,0,0,0.3)', border: isWInferred ? '1px solid var(--accent)' : '1px solid var(--border-color)', color: '#fff', fontSize: '0.8rem', textAlign: 'right' }}
                                    />
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>mm</span>
                                  </div>
                                </td>

                                {/* Height Input */}
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <input
                                      type="number"
                                      value={currentEdits.height}
                                      onChange={(e) => handleValChange('height', e.target.value)}
                                      className="search-input"
                                      style={{ padding: '0.25rem 0.5rem', width: '70px', background: 'rgba(0,0,0,0.3)', border: isHInferred ? '1px solid var(--accent)' : '1px solid var(--border-color)', color: '#fff', fontSize: '0.8rem', textAlign: 'right' }}
                                    />
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>mm</span>
                                  </div>
                                </td>

                                {/* Depth Input */}
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <input
                                      type="number"
                                      value={currentEdits.depth}
                                      onChange={(e) => handleValChange('depth', e.target.value)}
                                      className="search-input"
                                      style={{ padding: '0.25rem 0.5rem', width: '70px', background: 'rgba(0,0,0,0.3)', border: isDInferred ? '1px solid var(--accent)' : '1px solid var(--border-color)', color: '#fff', fontSize: '0.8rem', textAlign: 'right' }}
                                    />
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>mm</span>
                                  </div>
                                </td>

                                <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--accent)' }}>
                                  {item.qty} {item.unit}
                                </td>

                                <td style={{ whiteSpace: 'normal', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                                  {item.review_reason}
                                </td>

                                <td style={{ textAlign: 'center' }}>
                                  <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                                    <button
                                      onClick={handleSaveAndApprove}
                                      className="tab-btn active"
                                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'var(--primary-gradient)', border: 'none', cursor: 'pointer' }}
                                    >
                                      승인 & 저장
                                    </button>
                                    <button
                                      onClick={handleApproveAsIs}
                                      className="tab-btn"
                                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                                    >
                                      그대로 승인
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* PAGE 6: 개발자 도구 (Developer Tools) */}
          {/* ======================================================== */}
          {currentPage === 'developer-tools' && (
            <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="glass-card">
                <h2 className="card-title">
                  <Cpu size={16} /> AI 파이프라인 분석 엔진 프로바이더 상태
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                    백엔드에서 도면을 분석할 때 사용할 AI 모델 및 파이프라인 엔진 설정 정보입니다. (서버 .env에서 변경 가능)
                  </p>
                  {healthData && healthData.provider_mode ? (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '1rem',
                      background: 'rgba(0,0,0,0.2)',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      marginTop: '0.5rem'
                    }}>
                      <div>
                        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.2rem' }}>도면 변환 모듈 (Drawing Converter)</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{healthData.provider_mode.drawing_converter}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.2rem' }}>벡터 추출 모듈 (Vector Extractor)</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{healthData.provider_mode.vector_extractor}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.2rem' }}>비전 분석 모델 (Vision Analyzer)</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{healthData.provider_mode.vision_analyzer}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.2rem' }}>모의 분석 허용 여부 (Allow Mock Provider)</span>
                        <span style={{
                          fontWeight: 600,
                          color: healthData.provider_mode.allow_mock_provider === 'true' ? '#fbbf24' : '#10b981'
                        }}>{healthData.provider_mode.allow_mock_provider}</span>
                      </div>
                    </div>
                  ) : (
                    <p style={{ margin: 0, color: '#f87171' }}>서버의 헬스체크 데이터를 로드하지 못했습니다.</p>
                  )}
                </div>
              </div>

              <div className="glass-card">
                <h2 className="card-title">
                  <Sliders size={16} /> API 키 설정
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem 1rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>API KEY:</span>
                  {appApiKey ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 600 }}>● 설정됨 (Masked)</span>
                      <button
                        onClick={() => handleApiKeyChange('')}
                        style={{
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          color: '#f87171',
                          fontSize: '0.75rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        지우기
                      </button>
                    </div>
                  ) : (
                    <input
                      type="password"
                      placeholder="API Key 입력 (선택)"
                      value={appApiKey}
                      onChange={(e) => handleApiKeyChange(e.target.value)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-bright)',
                        fontSize: '0.85rem',
                        outline: 'none',
                        width: '200px',
                        padding: 0,
                        margin: 0
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="glass-card" style={{ marginTop: '1rem' }}>
                <h2 className="card-title">
                  <Cpu size={16} /> AI 연동 상태 및 설정
                </h2>

                <div style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>현재 Provider</span>
                    <strong style={{ color: config?.provider === 'openai' ? '#10b981' : 'var(--text-bright)' }}>{config?.provider || '알 수 없음'}</strong>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>OpenAI 키 설정</span>
                    <strong style={{ color: config?.openai_configured ? '#10b981' : '#f87171' }}>{config?.openai_configured ? '설정됨' : '미설정'}</strong>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>AI 검수(Review) 활성화</span>
                    <strong style={{ color: config?.real_ai_review_enabled ? '#10b981' : '#fbbf24' }}>{config?.real_ai_review_enabled ? '활성 (OpenAI)' : '비활성 (Stub)'}</strong>
                  </div>
                  <div style={{ background: 'rgba(245,158,11,0.05)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.75rem' }}>
                    <span style={{ color: '#d97706', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>지원 포맷 제한 안내</span>
                    <span style={{ color: 'var(--text-bright)' }}>JPG/PNG (O) / DXF벡터 (O) / PDF, DWG (제한적)</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem 1rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>OPENAI_API_KEY:</span>
                  {config?.openai_configured ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 600 }}>● 설정됨 (Runtime / .env)</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                      <input
                        type="password"
                        placeholder="sk-..."
                        value={openAiKeyInput}
                        onChange={(e) => setOpenAiKeyInput(e.target.value)}
                        style={{
                          background: 'rgba(0,0,0,0.2)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: 'var(--text-bright)',
                          fontSize: '0.85rem',
                          outline: 'none',
                          flex: 1,
                          padding: '0.4rem 0.5rem',
                          borderRadius: '4px'
                        }}
                      />
                      <button
                        onClick={handleSaveOpenAiKey}
                        disabled={savingOpenAiKey || !openAiKeyInput.trim()}
                        style={{
                          background: 'var(--accent-primary)',
                          border: 'none',
                          color: '#fff',
                          fontSize: '0.75rem',
                          padding: '0.4rem 0.8rem',
                          borderRadius: '4px',
                          cursor: (savingOpenAiKey || !openAiKeyInput.trim()) ? 'not-allowed' : 'pointer',
                          opacity: (savingOpenAiKey || !openAiKeyInput.trim()) ? 0.5 : 1
                        }}
                      >
                        {savingOpenAiKey ? '저장 중...' : 'API 키 저장 및 활성화'}
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  현재 세션 런타임에만 저장되며, 브라우저나 DB에 평문으로 기록되지 않습니다. 영구적인 적용을 원하시면 <code>.env</code> 파일에 설정해주세요.
                </div>
              </div>

              <div className="glass-card">
                <h2 className="card-title">
                  <Sliders size={16} /> 샘플 목록 동기화 및 PO 임포트
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                    sample 폴더의 실제 도면/발주서(xlsx) 목록을 로드하고 DB에 검증 데이터를 동기화합니다.
                  </p>

                  <button
                    className="tab-btn active"
                    onClick={loadSamples}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', alignSelf: 'start', cursor: 'pointer' }}
                  >
                    샘플 목록 로드
                  </button>

                  {samplesList.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>샘플 목록 ({samplesList.length}):</span>
                      {samplesList.map(s => (
                        <div key={s.id} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem', paddingTop: '0.5rem' }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-bright)', fontSize: '0.82rem' }}>{s.file_name.split('/').pop()}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>설명: {s.notes}</span>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                            <span style={{
                              fontSize: '0.7rem',
                              padding: '0.1rem 0.35rem',
                              borderRadius: '3px',
                              fontWeight: 600,
                              background: s.exists ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                              color: s.exists ? '#34d399' : '#fbbf24',
                              border: s.exists ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(245, 158, 11, 0.25)'
                            }}>
                              {s.exists ? `보유 ${s.file_size_mb ? `(${s.file_size_mb}MB)` : ''}` : (s.file_type === 'dwg' ? '보안 미보유 (Git 제외)' : '파일 없음')}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>용도: {s.intended_use}</span>
                          </div>

                          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                            {s.file_type === 'xlsx' && (
                              <button
                                onClick={() => handleImportPo(s.file_name)}
                                disabled={importingPo || !s.exists}
                                style={{
                                  padding: '0.3rem 0.6rem',
                                  fontSize: '0.75rem',
                                  background: s.exists ? 'var(--secondary-gradient)' : 'rgba(255,255,255,0.05)',
                                  border: 'none',
                                  color: s.exists ? '#fff' : 'var(--text-muted)',
                                  borderRadius: '4px',
                                  cursor: s.exists ? 'pointer' : 'not-allowed',
                                  width: 'fit-content'
                                }}
                              >
                                {importingPo ? '임포트 중...' : 'DB 임포트 실행'}
                              </button>
                            )}
                            {(s.intended_use === 'golden_dataset' || s.file_name.includes('262603000301')) && (s.file_type === 'dwg' || s.file_type === 'xlsx') && (
                              <button
                                onClick={() => handleEvaluateGolden(s.linked_purchase_order_file || s.file_name)}
                                disabled={evaluating || !s.exists}
                                style={{
                                  padding: '0.3rem 0.6rem',
                                  fontSize: '0.75rem',
                                  background: s.exists ? 'var(--primary-gradient)' : 'rgba(255,255,255,0.05)',
                                  border: 'none',
                                  color: s.exists ? '#fff' : 'var(--text-muted)',
                                  borderRadius: '4px',
                                  cursor: s.exists ? 'pointer' : 'not-allowed',
                                  width: 'fit-content'
                                }}
                              >
                                {evaluating ? '평가 중...' : '골든 데이터 평가 실행'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {importResult && (
                    <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', padding: '0.75rem', borderRadius: '6px', marginTop: '0.5rem' }}>
                      <strong>임포트 성공!</strong>
                      <div style={{ marginTop: '0.2rem' }}>현장: {importResult.project}</div>
                      <div>P/O: {importResult.po_number}</div>
                      <div>세대 타입: {importResult.apartment_types}종</div>
                      <div>BOM 품목: {importResult.bom_items}개</div>
                    </div>
                  )}

                  {evaluationResult && (
                    <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', padding: '0.75rem', borderRadius: '6px', marginTop: '0.5rem' }}>
                      <strong style={{ color: '#fff', display: 'block', marginBottom: '0.4rem' }}>📊 골든 데이터셋 평가 결과</strong>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginBottom: '0.5rem' }}>
                        <div>정밀도(Precision): <span style={{ fontWeight: 600, color: '#fff' }}>{evaluationResult.summary.precision}%</span></div>
                        <div>재현율(Recall): <span style={{ fontWeight: 600, color: '#fff' }}>{evaluationResult.summary.recall}%</span></div>
                        <div style={{ gridColumn: 'span 2' }}>F1-Score: <span style={{ fontWeight: 600, color: '#34d399' }}>{evaluationResult.summary.f1_score}%</span></div>
                      </div>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div>매칭/골든 전체: {evaluationResult.summary.matched_items} / {evaluationResult.summary.total_expected_items}개</div>
                        <div>누락/과검출: {evaluationResult.summary.missing_items_count} / {evaluationResult.summary.over_detected_items_count}개</div>
                        <div>치수 일치율: {evaluationResult.summary.dimension_match_rate}%</div>
                        <div>수량 오차율: {evaluationResult.summary.quantity_error_rate}%</div>
                        <div>금액 오차율: {evaluationResult.summary.amount_error_rate}%</div>
                        {evaluationResult.summary.ambiguous_actual_count > 0 && (
                          <div style={{ color: '#fbbf24', marginTop: '0.2rem', fontWeight: 500 }}>
                            ⚠️ 모호한 항목 (타입 없음) {evaluationResult.summary.ambiguous_actual_count}개 발견
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* Toast Notification Container */}
      {toast && (
        <div className={`toast-notification ${toast.type}`}>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
