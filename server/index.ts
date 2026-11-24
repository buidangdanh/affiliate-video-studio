import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { ensureStorageDirs, OUTPUTS_DIR, store, UPLOADS_DIR } from './store.ts';
import { queueManager } from './queueManager.ts';
import { flowManager } from './flowAutomation.ts';
import { verifyGeminiApiKey } from './videoGenerator.ts';
import { affiliateEngine } from './affiliateEngine.ts';
import type { CreateJobInput, ProviderMode, UploadedAsset } from './types.ts';
import type { ScoringStrategy, SeasonId } from './affiliateTypes.ts';

ensureStorageDirs();

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.use('/media/uploads', express.static(UPLOADS_DIR));
app.use('/media/outputs', express.static(OUTPUTS_DIR));

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStorageDirs();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const safeExt = ext.replace(/[^.a-zA-Z0-9]/g, '') || '.png';
    cb(null, `${Date.now()}_${uuidv4().slice(0, 8)}${safeExt}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file hình ảnh (PNG, JPG, WEBP, GIF).'));
    }
  },
});

const VALID_PROVIDER_MODES = new Set<ProviderMode>([
  'auto_flow_first',
  'auto_gemini_first',
  'gemini',
  'flow',
  'mock',
]);

app.get('/api/state', async (_req, res) => {
  const flowStatus = await flowManager.getStatus();
  res.json({
    jobs: store.getJobs(),
    stats: queueManager.getStats(),
    settings: store.getPublicSettings(),
    flowStatus,
    affiliate: affiliateEngine.getSnapshot(),
  });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent({
    type: 'snapshot',
    reason: 'connected',
    jobs: store.getJobs(),
    stats: queueManager.getStats(),
    settings: store.getPublicSettings(),
    affiliate: affiliateEngine.getSnapshot(),
  });

  const onQueueEvent = (payload: unknown) => {
    sendEvent(payload);
  };

  const onAffiliateEvent = (payload: unknown) => {
    sendEvent(payload);
  };

  queueManager.on('event', onQueueEvent);
  affiliateEngine.on('event', onAffiliateEvent);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    queueManager.off('event', onQueueEvent);
    affiliateEngine.off('event', onAffiliateEvent);
  });
});

app.put('/api/settings', (req, res) => {
  const body = req.body || {};
  const patch: Record<string, unknown> = {};

  if (VALID_PROVIDER_MODES.has(body.providerMode)) {
    patch.providerMode = body.providerMode;
  }
  if (typeof body.geminiApiKey === 'string') {
    patch.geminiApiKey = body.geminiApiKey;
  }
  if (typeof body.flowProjectUrl === 'string') {
    patch.flowProjectUrl = body.flowProjectUrl;
  }
  if (body.maxConcurrency !== undefined) {
    patch.maxConcurrency = Number(body.maxConcurrency);
  }
  if (body.maxJobsPerMinute !== undefined) {
    patch.maxJobsPerMinute = Number(body.maxJobsPerMinute);
  }
  if (body.mockDurationSec !== undefined) {
    patch.mockDurationSec = Number(body.mockDurationSec);
  }
  if (body.mockFailureRate !== undefined) {
    patch.mockFailureRate = Number(body.mockFailureRate);
  }
  if (body.isPaused !== undefined) {
    patch.isPaused = Boolean(body.isPaused);
  }

  store.updateSettings(patch);
  queueManager.onSettingsChanged();

  res.json({
    settings: store.getPublicSettings(),
    stats: queueManager.getStats(),
  });
});

// Verify Gemini API Key connectivity & list available Veo models
app.post('/api/settings/test-gemini', async (req, res) => {
  try {
    const candidateKey =
      typeof req.body?.geminiApiKey === 'string' && req.body.geminiApiKey.trim()
        ? req.body.geminiApiKey.trim()
        : store.getSettings().geminiApiKey;
    const result = await verifyGeminiApiKey(candidateKey);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Kiểm tra Gemini API Key thất bại.',
    });
  }
});

// Reset exhausted provider cooldown state
app.post('/api/providers/reset', (req, res) => {
  const target =
    req.body?.provider === 'gemini' || req.body?.provider === 'flow'
      ? req.body.provider
      : undefined;
  store.resetProviderHealth(target);
  queueManager.onSettingsChanged();
  res.json({ settings: store.getPublicSettings() });
});

// Google Flow Chrome Browser Session endpoints
app.get('/api/flow/status', async (_req, res) => {
  const status = await flowManager.getStatus();
  res.json({ flowStatus: status });
});

app.post('/api/flow/launch', async (req, res) => {
  try {
    const customUrl =
      typeof req.body?.flowProjectUrl === 'string'
        ? req.body.flowProjectUrl
        : store.getSettings().flowProjectUrl;
    const status = await flowManager.launchAndOpenFlow(customUrl);
    store.resetProviderHealth('flow');
    queueManager.onSettingsChanged();
    res.json({ flowStatus: status, settings: store.getPublicSettings() });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Không thể mở trình duyệt Chrome Flow.',
    });
  }
});

app.post('/api/flow/close', async (_req, res) => {
  await flowManager.closeBrowser();
  const status = await flowManager.getStatus();
  res.json({ flowStatus: status });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Không tìm thấy file ảnh upload.' });
    return;
  }

  const asset: UploadedAsset = {
    id: uuidv4(),
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    url: `/media/uploads/${req.file.filename}`,
    size: req.file.size,
  };

  store.registerAsset(asset);
  res.json({ asset });
});

app.post('/api/jobs/batch', (req, res) => {
  const rawJobs = req.body?.jobs;
  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    res.status(400).json({ error: 'Danh sách job trống. Vui lòng thêm ít nhất 1 job.' });
    return;
  }

  const validated: CreateJobInput[] = [];
  for (let i = 0; i < rawJobs.length; i++) {
    const item = rawJobs[i] as Partial<CreateJobInput>;
    const prompt = (item.prompt || '').trim();
    const inputType = item.inputType || 'text_to_video';

    if (!prompt && inputType === 'text_to_video') {
      res.status(400).json({
        error: `Job dòng #${i + 1}: Vui lòng nhập nội dung mô tả (Prompt).`,
      });
      return;
    }
    if (inputType === 'image_to_video' && !item.imageAsset) {
      res.status(400).json({
        error: `Job dòng #${i + 1}: Loại input "Tạo video từ hình ảnh" cần upload file ảnh.`,
      });
      return;
    }
    if (inputType === 'frames_to_video' && !item.firstFrameAsset) {
      res.status(400).json({
        error: `Job dòng #${i + 1}: Loại input "Tạo video từ khung hình" cần upload ít nhất Khung hình đầu (First Frame).`,
      });
      return;
    }

    validated.push({
      prompt: prompt || 'Animate this scene naturally with smooth cinematic motion',
      negativePrompt: item.negativePrompt,
      inputType,
      model: item.model || 'veo-3.0-fast-generate-001',
      aspectRatio: item.aspectRatio || '16:9',
      outputCount: Math.max(1, Math.min(8, Number(item.outputCount) || 1)),
      durationSeconds: Math.max(4, Math.min(12, Number(item.durationSeconds) || 8)),
      resolution: item.resolution || '720p',
      imageAsset: item.imageAsset || null,
      firstFrameAsset: item.firstFrameAsset || null,
      lastFrameAsset: item.lastFrameAsset || null,
    });
  }

  const created = queueManager.enqueueBatch(validated);
  res.status(201).json({
    createdCount: created.length,
    jobs: created,
    stats: queueManager.getStats(),
  });
});

app.get('/api/jobs/download-all', (req, res) => {
  const filterIds =
    typeof req.query.jobIds === 'string' && req.query.jobIds.trim()
      ? new Set(req.query.jobIds.split(',').map((s) => s.trim()))
      : null;

  const completedJobs = store
    .getJobs()
    .filter(
      (j) =>
        j.status === 'completed' &&
        j.outputs.length > 0 &&
        (!filterIds || filterIds.has(j.id))
    );

  if (completedJobs.length === 0) {
    res.status(404).json({ error: 'Chưa có video hoàn thành nào để tải xuống.' });
    return;
  }

  const zipName = `veo-batch-videos_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', (err) => {
    console.error('[DownloadAll] Archiver error:', err);
    if (!res.headersSent) {
      res.status(500).end();
    }
  });

  archive.pipe(res);

  const manifest: Array<Record<string, unknown>> = [];

  for (const job of completedJobs) {
    const safeModel = job.model.replace(/[^a-zA-Z0-9_-]/g, '-');
    const slugPrompt = job.prompt
      .slice(0, 36)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

    for (const out of job.outputs) {
      const fullPath = path.join(OUTPUTS_DIR, out.filename);
      if (!fs.existsSync(fullPath)) continue;

      const suffix = job.outputs.length > 1 ? `_v${out.index}` : '';
      const entryName = `job-${String(job.seq).padStart(3, '0')}_${safeModel}${suffix}_${slugPrompt || 'video'}.mp4`;
      archive.file(fullPath, { name: entryName });

      manifest.push({
        jobSeq: job.seq,
        file: entryName,
        prompt: job.prompt,
        inputType: job.inputType,
        model: job.model,
        aspectRatio: job.aspectRatio,
        durationSeconds: job.durationSeconds,
        executedProvider: job.executedProvider,
        failoverFrom: job.failoverFrom,
        completedAt: job.completedAt,
      });
    }
  }

  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  void archive.finalize();
});

app.get('/api/jobs/:id/download/:index', (req, res) => {
  const job = store.getJobById(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Không tìm thấy job.' });
    return;
  }

  const idx = Number(req.params.index);
  const out = job.outputs.find((o) => o.index === idx) || job.outputs[0];
  if (!out) {
    res.status(404).json({ error: 'Không tìm thấy file video đầu ra.' });
    return;
  }

  const fullPath = path.join(OUTPUTS_DIR, out.filename);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'File video không tồn tại trên ổ đĩa.' });
    return;
  }

  const safeModel = job.model.replace(/[^a-zA-Z0-9_-]/g, '-');
  const downloadName = `job-${String(job.seq).padStart(3, '0')}_${safeModel}_out${out.index}.mp4`;
  res.download(fullPath, downloadName);
});

app.post('/api/jobs/:id/retry', (req, res) => {
  const job = queueManager.retryJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Không tìm thấy job để thử lại.' });
    return;
  }
  res.json({ job, stats: queueManager.getStats() });
});

app.post('/api/jobs/retry-failed', (_req, res) => {
  const retriedCount = queueManager.retryAllFailed();
  res.json({ retriedCount, stats: queueManager.getStats() });
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = queueManager.cancelJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Không tìm thấy job.' });
    return;
  }
  res.json({ job, stats: queueManager.getStats() });
});

app.delete('/api/jobs/:id', (req, res) => {
  const ok = queueManager.deleteJob(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Không tìm thấy job.' });
    return;
  }
  res.json({ ok: true, stats: queueManager.getStats() });
});

app.post('/api/jobs/clear', (req, res) => {
  const mode = req.body?.mode === 'all' ? 'all' : 'finished';
  const removed =
    mode === 'all' ? store.clearAllNonRunningJobs() : store.clearFinishedJobs();
  queueManager.broadcastSnapshot('jobs_cleared');
  res.json({ removed, stats: queueManager.getStats() });
});

// ==========================================
// Affiliate Seasonal Radar (Shopee & TikTok)
// ==========================================

app.get('/api/affiliate/snapshot', (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  res.json(affiliateEngine.getSnapshot(date));
});

app.put('/api/affiliate/config', (req, res) => {
  const body = req.body || {};
  const snapshot = affiliateEngine.updateConfig({
    activeSeason: body.activeSeason as SeasonId | undefined,
    strategy: body.strategy as ScoringStrategy | undefined,
    autoSyncEnabled: body.autoSyncEnabled,
    hourlyIntervalMinutes: body.hourlyIntervalMinutes,
  });
  res.json(snapshot);
});

app.post('/api/affiliate/sync-hourly', (_req, res) => {
  const snapshot = affiliateEngine.runHourlySync('manual_ui');
  res.json(snapshot);
});

app.post('/api/affiliate/analyze-daily', (_req, res) => {
  const snapshot = affiliateEngine.runDailyTop10Analysis();
  res.json(snapshot);
});

app.post('/api/affiliate/ai-scan', async (req, res) => {
  try {
    const customKeyword =
      typeof req.body?.customKeyword === 'string' ? req.body.customKeyword : '';
    const seasonId = req.body?.seasonId as SeasonId | undefined;
    const result = await affiliateEngine.scanLiveTrendsWithGemini({
      customKeyword,
      seasonId,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error
          ? err.message
          : 'Không thể quét xu hướng bằng Gemini AI.',
    });
  }
});

app.post('/api/affiliate/import', (req, res) => {
  const records = req.body?.records;
  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: 'Danh sách sản phẩm import trống.' });
    return;
  }
  const result = affiliateEngine.importProductsFromRecords(records);
  res.json(result);
});

if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
}

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[Server Error]', err);
    res.status(400).json({ error: err.message || 'Đã xảy ra lỗi máy chủ.' });
  }
);

app.listen(PORT, () => {
  console.log(`[Veo Batch Studio Server] Listening on http://localhost:${PORT}`);
});
