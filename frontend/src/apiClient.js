// Common API Client for the Construction Order Verification App

const BASE_URL = '/api';
let apiKey = localStorage.getItem('CAD_ESTIMATE_API_KEY') || '';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;

  if (!options.headers) {
    options.headers = {};
  }

  if (apiKey) {
    options.headers['X-API-Key'] = apiKey;
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      let errorMsg = `HTTP error! Status: ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.detail) {
          errorMsg = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
        }
      } catch {
        // Fallback if not JSON
      }
      throw new Error(errorMsg);
    }

    return await response.json();
  } catch (error) {
    console.error(`API Call failed on ${endpoint}:`, error);
    throw error;
  }
}

export const apiClient = {
  setApiKey: (key) => {
    apiKey = key;
    if (key) {
      localStorage.setItem('CAD_ESTIMATE_API_KEY', key);
    } else {
      localStorage.removeItem('CAD_ESTIMATE_API_KEY');
    }
  },
  getApiKey: () => apiKey,

  // Projects
  getProjects: () => request('/projects'),
  getProject: () => request('/project'),

  // Apartment Types
  getApartmentTypes: (projectId = null) => {
    const endpoint = projectId ? `/apartment-types?project_id=${projectId}` : '/apartment-types';
    return request(endpoint);
  },
  getSpecs: (typeId) => request(`/apartment-types/${typeId}/specs`),
  getConfig: () => request('/config'),
  getHealth: () => request('/health'),

  // Cabinet BOM (supports pagination, search, filter)
  getBom: (typeId, { page = 1, limit = 50, search = '', category = '', isSpecial = null } = {}) => {
    const params = new URLSearchParams();
    params.append('page', page);
    params.append('limit', limit);
    if (search) params.append('search', search);
    if (category && category !== 'All') params.append('category', category);
    if (isSpecial !== null) params.append('is_special', isSpecial);

    return request(`/apartment-types/${typeId}/bom?${params.toString()}`);
  },

  // Stats
  getStats: (projectId = null) => {
    const endpoint = projectId ? `/stats?project_id=${projectId}` : '/stats';
    return request(endpoint);
  },

  // Tasks (Drawing upload and AI Analysis)
  uploadDrawing: (projectId, file) => {
    const formData = new FormData();
    formData.append('project_id', projectId);
    formData.append('file', file);

    return request('/tasks/upload', {
      method: 'POST',
      body: formData,
    });
  },

  getTasks: (projectId = null) => {
    const endpoint = projectId ? `/tasks/list?project_id=${projectId}` : '/tasks/list';
    return request(endpoint);
  },

  getTaskStatus: (taskId) => request(`/tasks/${taskId}/status`),

  getTaskAnalysis: (taskId) => request(`/tasks/${taskId}/analysis`),

  // Demo API (backwards compatibility and mockup display)
  getDemoAnalysis: () => request('/demo/analysis'),

  // Samples & Golden Dataset APIs
  getSamples: () => request('/samples'),
  analyzeSampleDrawing: (projectId = null) => request('/samples/analyze-drawing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ project_id: projectId }),
  }),
  importPo: (fileName) => request('/samples/import-po', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_name: fileName }),
  }),
  getGoldenDataset: (poNumber) => request(`/samples/golden/${poNumber}`),
  evaluateGoldenDataset: (poNumber, apartmentType = '') => {
    let url = `/samples/evaluate/${poNumber}`;
    if (apartmentType) {
      url += `?apartment_type=${encodeURIComponent(apartmentType)}`;
    }
    return request(url);
  },

  updateQuotation: (quotationId, quotationData) => {
    return request(`/quotations/${quotationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(quotationData),
    });
  },
  getQuotationAudits: (quotationId) => request(`/quotations/${quotationId}/audits`),

  updateAiProvider: (settings) => request('/settings/ai-provider', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings)
  }),

  getFurnitureSchedule: (typeId, { category = '', needsReview = null, search = '' } = {}) => {
    const params = new URLSearchParams();
    if (category && category !== 'All') params.append('category', category);
    if (needsReview !== null) params.append('needs_review', needsReview);
    if (search) params.append('search', search);
    return request(`/apartment-types/${typeId}/furniture-schedule?${params.toString()}`);
  },

  downloadFurnitureSchedule: async (typeId, { category = '', needsReview = null, search = '' } = {}) => {
    const params = new URLSearchParams();
    if (category && category !== 'All') params.append('category', category);
    if (needsReview !== null) params.append('needs_review', needsReview);
    if (search) params.append('search', search);

    const url = `${BASE_URL}/apartment-types/${typeId}/furniture-schedule.xlsx?${params.toString()}`;
    const headers = {};
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Excel 다운로드에 실패했습니다: ${response.statusText}`);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'furniture_schedule.xlsx';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename\*=UTF-8''(.+)/);
      if (match && match[1]) {
        filename = decodeURIComponent(match[1]);
      } else {
        const fallbackMatch = contentDisposition.match(/filename="(.+)"/);
        if (fallbackMatch && fallbackMatch[1]) {
          filename = fallbackMatch[1];
        }
      }
    }

    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
  },

  updateCabinetBom: (bomId, { width, height, depth, width_source = 'manual_review', height_source = 'manual_review', depth_source = 'manual_review' }) => {
    return request(`/cabinet-boms/${bomId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ width, height, depth, width_source, height_source, depth_source }),
    });
  },

  approveCabinetBom: (bomId) => {
    return request(`/cabinet-boms/${bomId}/approve`, {
      method: 'POST',
    });
  },
};
