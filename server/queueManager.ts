import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import { store } from './store.ts';
import { executeVideoJob } from './videoGenerator.ts';
import type { CreateJobInput, QueueStats, VideoJob } from './types.ts';

const RATE_WINDOW_MS = 60_000;

export class QueueManager extends EventEmitter {
  private activeControllers = new Map<string, AbortController>();
  private rateLimitTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    super();
    setTimeout(() => this.processQueue(), 300);
  }

  private pruneStartTimestamps(now = Date.now()): number[] {
    const valid = store
      .getRecentStartTimestamps()
      .filter((ts) => now - ts < RATE_WINDOW_MS)
      .sort((a, b) => a - b);
    store.setRecentStartTimestamps(valid);
    return valid;
  }

  public getStats(): QueueStats {
    const now = Date.now();
    const jobs = store.getJobs();
    const settings = store.getSettings();
    const recent = this.pruneStartTimestamps(now);

    let queued = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const j of jobs) {
      if (j.status === 'queued') queued++;
      else if (j.status === 'running') running++;
      else if (j.status === 'completed') completed++;
      else if (j.status === 'failed') failed++;
      else if (j.status === 'cancelled') cancelled++;
    }

    let nextRateLimitSlotAt: number | null = null;
    if (
      queued > 0 &&
      !settings.isPaused &&
      running < settings.maxConcurrency &&
      recent.length >= settings.maxJobsPerMinute
    ) {
      const blockingIndex = recent.length - settings.maxJobsPerMinute;
      nextRateLimitSlotAt = recent[blockingIndex] + RATE_WINDOW_MS + 50;
    }

    return {
      total: jobs.length,
      queued,
      running,
      completed,
      failed,
      cancelled,
      jobsStartedLastMinute: recent.length,
      maxJobsPerMinute: settings.maxJobsPerMinute,
      maxConcurrency: settings.maxConcurrency,
      nextRateLimitSlotAt,
      isPaused: settings.isPaused,
      recentStartTimestamps: recent,
    };
  }

  public enqueueBatch(inputs: CreateJobInput[]): VideoJob[] {
    const settings = store.getSettings();
    const batchId = uuidv4();
    const nowIso = new Date().toISOString();

    const created: VideoJob[] = inputs.map((input) => ({
      id: uuidv4(),
      seq: store.allocateSeq(),
      batchId,
      prompt: input.prompt.trim(),
      negativePrompt: input.negativePrompt?.trim() || undefined,
      inputType: input.inputType || 'text_to_video',
      model: input.model || 'veo-3.0-fast-generate-001',
      aspectRatio: input.aspectRatio || '16:9',
      outputCount: Math.max(1, Math.min(8, Math.floor(Number(input.outputCount) || 1))),
      durationSeconds: Math.max(4, Math.min(12, Math.floor(Number(input.durationSeconds) || 8))),
      resolution: input.resolution || '720p',
      imageAsset: input.imageAsset || null,
      firstFrameAsset: input.firstFrameAsset || null,
      lastFrameAsset: input.lastFrameAsset || null,
      status: 'queued',
      progress: 0,
      statusMessage: 'Đang nằm trong hàng đợi...',
      retryCount: 0,
      providerMode: settings.providerMode,
      outputs: [],
      createdAt: nowIso,
    }));

    store.addJobs(created);
    this.broadcastSnapshot('jobs_added');
    this.processQueue();
    return created;
  }

  public retryJob(jobId: string): VideoJob | null {
    const job = store.getJobById(jobId);
    if (!job) return null;
    if (job.status === 'running' || job.status === 'queued') return job;

    const settings = store.getSettings();
    job.status = 'queued';
    job.progress = 0;
    job.error = undefined;
    job.executedProvider = undefined;
    job.failoverFrom = undefined;
    job.failoverReason = undefined;
    job.statusMessage = `Đang chờ thử lại (Lần thử #${job.retryCount + 1})...`;
    job.retryCount += 1;
    job.providerMode = settings.providerMode;
    job.outputs = [];
    job.startedAt = undefined;
    job.completedAt = undefined;

    store.saveSoon();
    this.broadcastJobUpdate(job);
    this.processQueue();
    return job;
  }

  public retryAllFailed(): number {
    const jobs = store.getJobs();
    const settings = store.getSettings();
    let count = 0;

    for (const job of jobs) {
      if (job.status === 'failed' || job.status === 'cancelled') {
        job.status = 'queued';
        job.progress = 0;
        job.error = undefined;
        job.executedProvider = undefined;
        job.failoverFrom = undefined;
        job.failoverReason = undefined;
        job.statusMessage = `Đang chờ thử lại (Lần thử #${job.retryCount + 1})...`;
        job.retryCount += 1;
        job.providerMode = settings.providerMode;
        job.outputs = [];
        job.startedAt = undefined;
        job.completedAt = undefined;
        count++;
      }
    }

    if (count > 0) {
      store.saveSoon();
      this.broadcastSnapshot('jobs_retried');
      this.processQueue();
    }
    return count;
  }

  public cancelJob(jobId: string): VideoJob | null {
    const job = store.getJobById(jobId);
    if (!job) return null;

    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.statusMessage = 'Đã huỷ khỏi hàng đợi';
      store.saveSoon();
      this.broadcastJobUpdate(job);
      this.processQueue();
      return job;
    }

    if (job.status === 'running') {
      const ctrl = this.activeControllers.get(jobId);
      if (ctrl) {
        ctrl.abort();
      }
      return job;
    }

    return job;
  }

  public deleteJob(jobId: string): boolean {
    const job = store.getJobById(jobId);
    if (!job) return false;
    if (job.status === 'running') {
      const ctrl = this.activeControllers.get(jobId);
      ctrl?.abort();
    }
    const ok = store.removeJob(jobId);
    if (ok) {
      this.broadcastSnapshot('job_deleted');
      this.processQueue();
    }
    return ok;
  }

  public onSettingsChanged(): void {
    this.broadcastSnapshot('settings_updated');
    this.processQueue();
  }

  private clearRateLimitTimer(): void {
    if (this.rateLimitTimer) {
      clearTimeout(this.rateLimitTimer);
      this.rateLimitTimer = null;
    }
  }

  public processQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      this.clearRateLimitTimer();
      const settings = store.getSettings();
      if (settings.isPaused) {
        this.broadcastStats();
        return;
      }

      const jobs = store.getJobs();
      let runningCount = jobs.filter((j) => j.status === 'running').length;
      const queuedJobs = jobs.filter((j) => j.status === 'queued');

      if (queuedJobs.length === 0) {
        this.broadcastStats();
        return;
      }

      for (const nextJob of queuedJobs) {
        if (runningCount >= settings.maxConcurrency) {
          break;
        }

        const now = Date.now();
        const recent = this.pruneStartTimestamps(now);
        if (recent.length >= settings.maxJobsPerMinute) {
          const blockingIndex = recent.length - settings.maxJobsPerMinute;
          const wakeAt = recent[blockingIndex] + RATE_WINDOW_MS + 50;
          const waitMs = Math.max(100, wakeAt - now);

          nextJob.statusMessage = `Đang chờ giới hạn ${settings.maxJobsPerMinute} jobs/phút (tự chạy khi mở lượt)...`;
          store.saveSoon();

          this.rateLimitTimer = setTimeout(() => {
            this.rateLimitTimer = null;
            this.processQueue();
          }, waitMs);
          break;
        }

        recent.push(now);
        store.setRecentStartTimestamps(recent);
        runningCount++;

        setTimeout(() => {
          this.pruneStartTimestamps();
          this.broadcastStats();
        }, RATE_WINDOW_MS + 80);

        void this.startJob(nextJob);
      }

      this.broadcastStats();
    } finally {
      this.isProcessing = false;
    }
  }

  private async startJob(job: VideoJob): Promise<void> {
    const settings = store.getSettings();
    const controller = new AbortController();
    this.activeControllers.set(job.id, controller);

    job.status = 'running';
    job.progress = 5;
    job.providerMode = settings.providerMode;
    job.error = undefined;
    job.startedAt = new Date().toISOString();
    job.statusMessage = 'Đang bắt đầu xử lý...';
    store.saveSoon();
    this.broadcastJobUpdate(job);

    try {
      const result = await executeVideoJob(
        job,
        settings,
        (progress, statusMessage) => {
          job.progress = progress;
          job.statusMessage = statusMessage;
          store.saveSoon();
          this.broadcastJobUpdate(job);
        },
        controller.signal,
        () => {
          this.broadcastSettings();
        }
      );

      job.status = 'completed';
      job.progress = 100;
      job.outputs = result.outputs;
      job.executedProvider = result.executedProvider;
      job.failoverFrom = result.failoverFrom;
      job.failoverReason = result.failoverReason;
      job.completedAt = new Date().toISOString();
      job.statusMessage = result.failoverFrom
        ? `Hoàn thành qua dự phòng (${result.outputs.length} video)`
        : `Hoàn thành (${result.outputs.length} video)`;
      store.saveSoon();
      this.broadcastJobUpdate(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        job.status = 'cancelled';
        job.statusMessage = 'Đã huỷ bởi người dùng';
        job.error = undefined;
      } else {
        job.status = 'failed';
        job.error = message;
        job.statusMessage = 'Tạo video thất bại';
      }
      job.completedAt = new Date().toISOString();
      store.saveSoon();
      this.broadcastJobUpdate(job);
    } finally {
      this.activeControllers.delete(job.id);
      this.processQueue();
    }
  }

  private broadcastJobUpdate(job: VideoJob): void {
    this.emit('event', {
      type: 'job_updated',
      job,
      stats: this.getStats(),
      settings: store.getPublicSettings(),
    });
  }

  private broadcastSettings(): void {
    this.emit('event', {
      type: 'settings_updated',
      settings: store.getPublicSettings(),
    });
  }

  private broadcastStats(): void {
    this.emit('event', {
      type: 'stats_updated',
      stats: this.getStats(),
    });
  }

  public broadcastSnapshot(reason = 'snapshot'): void {
    this.emit('event', {
      type: 'snapshot',
      reason,
      jobs: store.getJobs(),
      stats: this.getStats(),
      settings: store.getPublicSettings(),
    });
  }
}

export const queueManager = new QueueManager();
