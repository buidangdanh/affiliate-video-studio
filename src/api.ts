import type {
  DraftJob,
  FlowBrowserStatus,
  ProviderMode,
  PublicSystemSettings,
  QueueStats,
  UploadedAsset,
  VideoJob,
} from './types';
import type {
  AffiliateRadarSnapshot,
  EcommercePlatform,
  ScoringStrategy,
  SeasonId,
  SellerBadge,
} from './affiliateTypes';
import { standaloneClient } from './standaloneClientEngine';

export interface InitialStateResponse {
  jobs: VideoJob[];
  stats: QueueStats;
  settings: PublicSystemSettings;
  flowStatus: FlowBrowserStatus;
  affiliate?: AffiliateRadarSnapshot;
  isCloudMode?: boolean;
}

let cloudModeActive = false;

export function isRunningInCloudMode(): boolean {
  return cloudModeActive;
}

async function fetchApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('NON_JSON_STATIC_HOST');
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export async function fetchInitialState(): Promise<InitialStateResponse> {
  try {
    const data = await fetchApiJson<InitialStateResponse>('/api/state');
    cloudModeActive = false;
    return { ...data, isCloudMode: false };
  } catch {
    cloudModeActive = true;
    return {
      jobs: standaloneClient.getJobs(),
      stats: standaloneClient.getStats(),
      settings: standaloneClient.getPublicSettings(),
      flowStatus: standaloneClient.getFlowStatus(),
      affiliate: standaloneClient.getAffiliateSnapshot(),
      isCloudMode: true,
    };
  }
}

export async function updateSystemSettings(
  patch: Partial<{
    providerMode: ProviderMode;
    geminiApiKey: string;
    flowProjectUrl: string;
    maxConcurrency: number;
    maxJobsPerMinute: number;
    mockDurationSec: number;
    mockFailureRate: number;
    isPaused: boolean;
  }>
): Promise<{ settings: PublicSystemSettings; stats: QueueStats }> {
  if (cloudModeActive) {
    const cur = standaloneClient.loadSettings();
    standaloneClient.saveSettings({
      ...cur,
      ...patch,
      geminiApiKey:
        patch.geminiApiKey !== undefined ? patch.geminiApiKey.trim() : cur.geminiApiKey,
    });
    return {
      settings: standaloneClient.getPublicSettings(),
      stats: standaloneClient.getStats(),
    };
  }
  return fetchApiJson('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function testGeminiApiKeyConnection(
  geminiApiKey?: string
): Promise<{ ok: boolean; veoModels: string[]; message: string }> {
  if (cloudModeActive) {
    const key = (geminiApiKey || standaloneClient.loadSettings().geminiApiKey || '').trim();
    if (!key) throw new Error('Vui lòng nhập Gemini API Key để kiểm tra.');
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
      { headers: { 'x-goog-api-key': key } }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'API Key không hợp lệ.');
    const veoModels = (data.models || [])
      .map((m: { name?: string }) => String(m.name || '').replace(/^models\//, ''))
      .filter((n: string) => /omni|veo|flash/i.test(n))
      .slice(0, 6);
    return {
      ok: true,
      veoModels,
      message: `Kết nối Gemini API thành công trên Web Online! Các model khả dụng: ${veoModels.join(', ')}`,
    };
  }
  return fetchApiJson('/api/settings/test-gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geminiApiKey }),
  });
}

export async function resetProvidersCooldown(
  provider?: 'gemini' | 'flow'
): Promise<{ settings: PublicSystemSettings }> {
  if (cloudModeActive) {
    return { settings: standaloneClient.getPublicSettings() };
  }
  return fetchApiJson('/api/providers/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
}

export async function fetchFlowBrowserStatus(): Promise<{ flowStatus: FlowBrowserStatus }> {
  if (cloudModeActive) {
    return { flowStatus: standaloneClient.getFlowStatus() };
  }
  return fetchApiJson('/api/flow/status');
}

export async function launchFlowChrome(
  flowProjectUrl?: string
): Promise<{ flowStatus: FlowBrowserStatus; settings: PublicSystemSettings }> {
  if (cloudModeActive) {
    throw new Error(
      'Điều khiển Chrome Flow chỉ hoạt động khi chạy bản Local trên máy tính (npm run dev).'
    );
  }
  return fetchApiJson('/api/flow/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowProjectUrl }),
  });
}

export async function closeFlowChrome(): Promise<{ flowStatus: FlowBrowserStatus }> {
  if (cloudModeActive) {
    return { flowStatus: standaloneClient.getFlowStatus() };
  }
  return fetchApiJson('/api/flow/close', { method: 'POST' });
}

export async function uploadImageFile(file: File): Promise<UploadedAsset> {
  if (cloudModeActive) {
    const objectUrl = URL.createObjectURL(file);
    return {
      id: `local-asset-${Date.now()}`,
      filename: file.name,
      originalName: file.name,
      mimeType: file.type || 'image/png',
      url: objectUrl,
      size: file.size,
    };
  }
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload ảnh thất bại.');
  return data.asset;
}

export async function submitJobsBatch(
  drafts: DraftJob[]
): Promise<{ createdCount: number; jobs: VideoJob[]; stats: QueueStats }> {
  if (cloudModeActive) {
    return standaloneClient.enqueueCloudDrafts(drafts);
  }

  const payload = drafts.map((d) => ({
    prompt: d.prompt,
    inputType: d.inputType,
    model: d.model,
    aspectRatio: d.aspectRatio,
    outputCount: d.outputCount,
    durationSeconds: d.durationSeconds || 8,
    imageAsset: d.inputType === 'image_to_video' ? d.imageAsset : null,
    firstFrameAsset: d.inputType === 'frames_to_video' ? d.firstFrameAsset : null,
    lastFrameAsset: d.inputType === 'frames_to_video' ? d.lastFrameAsset : null,
  }));

  return fetchApiJson('/api/jobs/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: payload }),
  });
}

export async function retrySingleJob(
  jobId: string
): Promise<{ job: VideoJob; stats: QueueStats }> {
  return fetchApiJson(`/api/jobs/${jobId}/retry`, { method: 'POST' });
}

export async function retryAllFailedJobs(): Promise<{
  retriedCount: number;
  stats: QueueStats;
}> {
  return fetchApiJson('/api/jobs/retry-failed', { method: 'POST' });
}

export async function cancelSingleJob(
  jobId: string
): Promise<{ job: VideoJob; stats: QueueStats }> {
  return fetchApiJson(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
}

export async function deleteSingleJob(jobId: string): Promise<void> {
  if (cloudModeActive) {
    const remaining = standaloneClient.getJobs().filter((j) => j.id !== jobId);
    localStorage.setItem('tao_video_cloud_jobs_v1', JSON.stringify(remaining));
    return;
  }
  const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không thể xoá job.');
  }
}

export async function clearQueueJobs(mode: 'finished' | 'all'): Promise<void> {
  if (cloudModeActive) {
    localStorage.removeItem('tao_video_cloud_jobs_v1');
    return;
  }
  await fetchApiJson('/api/jobs/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

// ==========================================
// Affiliate Seasonal Radar API (Server + Cloud Fallback)
// ==========================================

export async function fetchAffiliateSnapshot(
  date?: string
): Promise<AffiliateRadarSnapshot> {
  if (cloudModeActive) {
    return standaloneClient.getAffiliateSnapshot();
  }
  try {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return await fetchApiJson<AffiliateRadarSnapshot>(`/api/affiliate/snapshot${qs}`);
  } catch {
    cloudModeActive = true;
    return standaloneClient.getAffiliateSnapshot();
  }
}

export async function updateAffiliateConfig(patch: {
  activeSeason?: SeasonId;
  strategy?: ScoringStrategy;
  autoSyncEnabled?: boolean;
  hourlyIntervalMinutes?: number;
}): Promise<AffiliateRadarSnapshot> {
  if (cloudModeActive) {
    return standaloneClient.updateAffiliateConfig(patch);
  }
  return fetchApiJson('/api/affiliate/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function triggerHourlyAffiliateSync(): Promise<AffiliateRadarSnapshot> {
  if (cloudModeActive) {
    return standaloneClient.runHourlySync();
  }
  return fetchApiJson('/api/affiliate/sync-hourly', { method: 'POST' });
}

export async function triggerDailyTop10Analysis(): Promise<AffiliateRadarSnapshot> {
  if (cloudModeActive) {
    return standaloneClient.runDailyAnalysis();
  }
  return fetchApiJson('/api/affiliate/analyze-daily', { method: 'POST' });
}

export async function scanLiveAffiliateTrends(
  customKeyword?: string,
  seasonId?: SeasonId
): Promise<{
  addedCount: number;
  usedSearchGrounding: boolean;
  modelUsed: string;
  aiSummary: string;
  snapshot: AffiliateRadarSnapshot;
}> {
  if (cloudModeActive) {
    return standaloneClient.scanTrendsDirectWithGemini(customKeyword, seasonId);
  }
  return fetchApiJson('/api/affiliate/ai-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customKeyword, seasonId }),
  });
}

export async function importAffiliateProducts(
  records: Array<{
    name: string;
    platform?: EcommercePlatform;
    category?: string;
    priceVnd?: number;
    commissionRatePct?: number;
    soldToday?: number;
    shopName?: string;
    shopBadge?: SellerBadge;
    rating?: number;
  }>
): Promise<{ importedCount: number; snapshot: AffiliateRadarSnapshot }> {
  if (cloudModeActive) {
    return standaloneClient.importProducts(records);
  }
  return fetchApiJson('/api/affiliate/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
}
