import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type {
  ProviderHealth,
  PublicSystemSettings,
  SystemSettings,
  UploadedAsset,
  VideoJob,
} from './types.ts';

dotenv.config();

export const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
export const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
export const OUTPUTS_DIR = path.join(STORAGE_ROOT, 'outputs');
export const STATE_FILE = path.join(STORAGE_ROOT, 'state.json');

export function ensureStorageDirs(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

interface PersistedState {
  nextSeq: number;
  settings: SystemSettings;
  providerHealth: ProviderHealth;
  jobs: VideoJob[];
  assets: Record<string, UploadedAsset>;
  recentStartTimestamps: number[];
}

const DEFAULT_SETTINGS: SystemSettings = {
  providerMode: process.env.GEMINI_API_KEY ? 'auto_gemini_first' : 'auto_flow_first',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  flowProjectUrl: 'https://labs.google/fx/tools/flow',
  maxConcurrency: 4,
  maxJobsPerMinute: 4,
  mockDurationSec: 8,
  mockFailureRate: 0,
  isPaused: false,
};

const DEFAULT_HEALTH: ProviderHealth = {
  geminiExhaustedUntil: null,
  geminiExhaustedReason: null,
  flowExhaustedUntil: null,
  flowExhaustedReason: null,
  totalFailovers: 0,
};

class AppStore {
  private state: PersistedState;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    ensureStorageDirs();
    this.state = this.load();
  }

  private load(): PersistedState {
    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
        for (const job of jobs) {
          if (!job.durationSeconds) {
            job.durationSeconds = 8;
          }
          if (job.status === 'running') {
            job.status = 'queued';
            job.progress = 0;
            job.statusMessage = 'Được khôi phục vào hàng đợi sau khi khởi động lại server';
          }
        }
        return {
          nextSeq: typeof parsed.nextSeq === 'number' ? parsed.nextSeq : jobs.length + 1,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(parsed.settings || {}),
            geminiApiKey:
              parsed.settings?.geminiApiKey || process.env.GEMINI_API_KEY || '',
          },
          providerHealth: {
            ...DEFAULT_HEALTH,
            ...(parsed.providerHealth || {}),
          },
          jobs,
          assets: parsed.assets || {},
          recentStartTimestamps: Array.isArray(parsed.recentStartTimestamps)
            ? parsed.recentStartTimestamps
            : [],
        };
      } catch (err) {
        console.error('[Store] Failed to parse state.json, starting fresh:', err);
      }
    }
    return {
      nextSeq: 1,
      settings: { ...DEFAULT_SETTINGS },
      providerHealth: { ...DEFAULT_HEALTH },
      jobs: [],
      assets: {},
      recentStartTimestamps: [],
    };
  }

  public saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 150);
  }

  public saveNow(): void {
    try {
      ensureStorageDirs();
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Store] Failed to save state.json:', err);
    }
  }

  public getSettings(): SystemSettings {
    return this.state.settings;
  }

  public getProviderHealth(): ProviderHealth {
    const now = Date.now();
    const h = this.state.providerHealth;
    if (h.geminiExhaustedUntil && h.geminiExhaustedUntil <= now) {
      h.geminiExhaustedUntil = null;
      h.geminiExhaustedReason = null;
    }
    if (h.flowExhaustedUntil && h.flowExhaustedUntil <= now) {
      h.flowExhaustedUntil = null;
      h.flowExhaustedReason = null;
    }
    return h;
  }

  public markProviderExhausted(
    provider: 'gemini' | 'flow',
    reason: string,
    cooldownMs = 15 * 60 * 1000
  ): void {
    const until = Date.now() + cooldownMs;
    if (provider === 'gemini') {
      this.state.providerHealth.geminiExhaustedUntil = until;
      this.state.providerHealth.geminiExhaustedReason = reason;
    } else {
      this.state.providerHealth.flowExhaustedUntil = until;
      this.state.providerHealth.flowExhaustedReason = reason;
    }
    this.saveSoon();
  }

  public recordFailover(): void {
    this.state.providerHealth.totalFailovers += 1;
    this.saveSoon();
  }

  public resetProviderHealth(provider?: 'gemini' | 'flow'): void {
    if (!provider || provider === 'gemini') {
      this.state.providerHealth.geminiExhaustedUntil = null;
      this.state.providerHealth.geminiExhaustedReason = null;
    }
    if (!provider || provider === 'flow') {
      this.state.providerHealth.flowExhaustedUntil = null;
      this.state.providerHealth.flowExhaustedReason = null;
    }
    this.saveSoon();
  }

  public getPublicSettings(): PublicSystemSettings {
    const s = this.state.settings;
    const key = s.geminiApiKey.trim();
    const masked =
      key.length > 8
        ? `${key.slice(0, 4)}${'•'.repeat(12)}${key.slice(-4)}`
        : key.length > 0
          ? '••••••••'
          : '';
    return {
      providerMode: s.providerMode,
      hasGeminiApiKey: key.length > 0,
      maskedGeminiApiKey: masked,
      flowProjectUrl: s.flowProjectUrl || 'https://labs.google/fx/tools/flow',
      maxConcurrency: s.maxConcurrency,
      maxJobsPerMinute: s.maxJobsPerMinute,
      mockDurationSec: s.mockDurationSec,
      mockFailureRate: s.mockFailureRate,
      isPaused: s.isPaused,
      providerHealth: this.getProviderHealth(),
    };
  }

  public updateSettings(patch: Partial<SystemSettings>): SystemSettings {
    const next = { ...this.state.settings };
    if (patch.providerMode !== undefined) next.providerMode = patch.providerMode;
    if (patch.geminiApiKey !== undefined) {
      next.geminiApiKey = patch.geminiApiKey.trim();
      // Updating API key automatically clears Gemini exhaustion flag
      this.resetProviderHealth('gemini');
    }
    if (patch.flowProjectUrl !== undefined) {
      next.flowProjectUrl = patch.flowProjectUrl.trim() || 'https://labs.google/fx/tools/flow';
    }
    if (patch.maxConcurrency !== undefined) {
      next.maxConcurrency = Math.max(1, Math.min(20, Math.floor(patch.maxConcurrency)));
    }
    if (patch.maxJobsPerMinute !== undefined) {
      next.maxJobsPerMinute = Math.max(1, Math.min(120, Math.floor(patch.maxJobsPerMinute)));
    }
    if (patch.mockDurationSec !== undefined) {
      next.mockDurationSec = Math.max(1, Math.min(120, Number(patch.mockDurationSec)));
    }
    if (patch.mockFailureRate !== undefined) {
      next.mockFailureRate = Math.max(0, Math.min(100, Number(patch.mockFailureRate)));
    }
    if (patch.isPaused !== undefined) {
      next.isPaused = Boolean(patch.isPaused);
    }
    this.state.settings = next;
    this.saveSoon();
    return next;
  }

  public allocateSeq(): number {
    const seq = this.state.nextSeq++;
    this.saveSoon();
    return seq;
  }

  public getJobs(): VideoJob[] {
    return this.state.jobs;
  }

  public getJobById(id: string): VideoJob | undefined {
    return this.state.jobs.find((j) => j.id === id);
  }

  public addJobs(newJobs: VideoJob[]): void {
    this.state.jobs.push(...newJobs);
    this.saveSoon();
  }

  public removeJob(id: string): boolean {
    const idx = this.state.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    this.state.jobs.splice(idx, 1);
    this.saveSoon();
    return true;
  }

  public clearFinishedJobs(): number {
    const before = this.state.jobs.length;
    this.state.jobs = this.state.jobs.filter(
      (j) => j.status === 'queued' || j.status === 'running'
    );
    if (this.state.jobs.length === 0) {
      this.state.nextSeq = 1;
    }
    const removed = before - this.state.jobs.length;
    this.saveSoon();
    return removed;
  }

  public clearAllNonRunningJobs(): number {
    const before = this.state.jobs.length;
    this.state.jobs = this.state.jobs.filter((j) => j.status === 'running');
    if (this.state.jobs.length === 0) {
      this.state.nextSeq = 1;
    }
    const removed = before - this.state.jobs.length;
    this.saveSoon();
    return removed;
  }

  public registerAsset(asset: UploadedAsset): void {
    this.state.assets[asset.id] = asset;
    this.saveSoon();
  }

  public getAsset(id: string): UploadedAsset | undefined {
    return this.state.assets[id];
  }

  public getRecentStartTimestamps(): number[] {
    return this.state.recentStartTimestamps;
  }

  public setRecentStartTimestamps(ts: number[]): void {
    this.state.recentStartTimestamps = ts;
    this.saveSoon();
  }
}

export const store = new AppStore();
