import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import ffmpegStatic from 'ffmpeg-static';
import { OUTPUTS_DIR, store, UPLOADS_DIR } from './store.ts';
import {
  isFlowQuotaOrUnavailableError,
  isGeminiQuotaOrBillingError,
  ProviderQuotaExhaustedError,
  type RealProvider,
} from './errors.ts';
import { flowManager } from './flowAutomation.ts';
import type {
  AspectRatio,
  ExecutedProvider,
  GeneratedVideoOutput,
  SystemSettings,
  UploadedAsset,
  VideoJob,
} from './types.ts';

const execFileAsync = promisify(execFile);

export interface ProgressCallback {
  (progress: number, statusMessage: string): void;
}

export interface VideoExecutionResult {
  outputs: GeneratedVideoOutput[];
  executedProvider: ExecutedProvider;
  failoverFrom?: RealProvider;
  failoverReason?: string;
}

function getDimensionsForAspectRatio(ratio: AspectRatio): { width: number; height: number } {
  switch (ratio) {
    case '16:9':
      return { width: 960, height: 540 };
    case '9:16':
      return { width: 540, height: 960 };
    case '1:1':
      return { width: 720, height: 720 };
    case '4:3':
      return { width: 720, height: 540 };
    case '3:4':
      return { width: 540, height: 720 };
    default:
      return { width: 960, height: 540 };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Job đã bị huỷ'));
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Job đã bị huỷ'));
      },
      { once: true }
    );
  });
}

function readUploadedImageBase64(asset: UploadedAsset): { data: string; mimeType: string } {
  const fullPath = path.join(UPLOADS_DIR, asset.filename);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Không tìm thấy file ảnh đã upload: ${asset.originalName}`);
  }
  const buf = fs.readFileSync(fullPath);
  return {
    data: buf.toString('base64'),
    mimeType: asset.mimeType || 'image/png',
  };
}

/**
 * Maps legacy Veo model IDs (retired on Gemini Developer API v1beta)
 * to the active Gemini Omni Flash video generation models on Gemini API,
 * while preserving explicit gemini-omni-* selections.
 */
function resolveGeminiApiVideoModel(requestedModel: string): string {
  const m = (requestedModel || '').trim().toLowerCase();
  if (m.startsWith('gemini-omni-')) {
    return requestedModel.trim();
  }
  if (m.includes('veo-2') || m.includes('1.1')) {
    return 'gemini-omni-1.1-flash';
  }
  return 'gemini-omni-1.2-flash';
}

async function renderMockMp4(
  job: VideoJob,
  outputIndex: number,
  outFilePath: string
): Promise<void> {
  const ffmpegBin = ffmpegStatic as unknown as string | null;
  if (!ffmpegBin || !fs.existsSync(ffmpegBin)) {
    throw new Error('Không tìm thấy ffmpeg-static binary để tạo video demo');
  }

  const { width, height } = getDimensionsForAspectRatio(job.aspectRatio);
  const hueShift = ((job.seq * 47 + outputIndex * 83) % 360).toFixed(0);
  const durationSec = Math.max(4, Math.min(12, Number(job.durationSeconds) || 8));

  const firstAsset =
    job.inputType === 'image_to_video'
      ? job.imageAsset
      : job.inputType === 'frames_to_video'
        ? job.firstFrameAsset
        : null;
  const lastAsset = job.inputType === 'frames_to_video' ? job.lastFrameAsset : null;

  const firstPath = firstAsset ? path.join(UPLOADS_DIR, firstAsset.filename) : null;
  const lastPath = lastAsset ? path.join(UPLOADS_DIR, lastAsset.filename) : null;

  const hasFirst = Boolean(firstPath && fs.existsSync(firstPath));
  const hasLast = Boolean(lastPath && fs.existsSync(lastPath));

  let args: string[];

  if (job.inputType === 'frames_to_video' && hasFirst && hasLast && firstPath && lastPath) {
    const fadeDur = 1.5;
    const clipDur = (durationSec + fadeDur) / 2;
    const offset = Math.max(0.5, clipDur - fadeDur);
    const filter = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p[v0]`,
      `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p[v1]`,
      `[v0][v1]xfade=transition=fade:duration=${fadeDur}:offset=${offset.toFixed(2)},hue=h=${(outputIndex - 1) * 12}[outv]`,
    ].join(';');

    args = [
      '-y',
      '-loop',
      '1',
      '-t',
      clipDur.toFixed(2),
      '-i',
      firstPath,
      '-loop',
      '1',
      '-t',
      clipDur.toFixed(2),
      '-i',
      lastPath,
      '-filter_complex',
      filter,
      '-map',
      '[outv]',
      '-r',
      '24',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outFilePath,
    ];
  } else if (hasFirst && firstPath) {
    const zoomExpr =
      outputIndex % 2 === 1 ? 'min(zoom+0.0015,1.25)' : 'if(eq(on,1),1.25,max(1.0,zoom-0.0015))';
    const filter = `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${durationSec * 24}:s=${width}x${height}:fps=24,format=yuv420p`;

    args = [
      '-y',
      '-i',
      firstPath,
      '-vf',
      filter,
      '-t',
      String(durationSec),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outFilePath,
    ];
  } else {
    args = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${width}x${height}:rate=24:duration=${durationSec}`,
      '-vf',
      `hue=h=${hueShift}:s=1.35,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outFilePath,
    ];
  }

  await execFileAsync(ffmpegBin, args, { timeout: 45_000 });
}

async function generateMockVideos(
  job: VideoJob,
  settings: SystemSettings,
  onProgress: ProgressCallback,
  signal: AbortSignal
): Promise<GeneratedVideoOutput[]> {
  if (job.inputType === 'image_to_video' && !job.imageAsset) {
    throw new Error('Loại input "Tạo video từ hình ảnh" yêu cầu phải upload file ảnh đầu vào.');
  }
  if (job.inputType === 'frames_to_video' && !job.firstFrameAsset && !job.lastFrameAsset) {
    throw new Error(
      'Loại input "Tạo video từ khung hình" yêu cầu upload ít nhất Khung hình đầu (First Frame).'
    );
  }

  const totalMs = Math.max(1500, settings.mockDurationSec * 1000);
  const steps = 6;
  const stepMs = Math.floor(totalMs / steps);

  onProgress(
    8,
    `[Demo ${job.durationSeconds || 8}s] Đang khởi tạo yêu cầu tạo ${job.outputCount} video...`
  );

  for (let i = 1; i <= steps - 1; i++) {
    await sleep(stepMs, signal);
    if (i === 3 && settings.mockFailureRate > 0) {
      const roll = Math.random() * 100;
      if (roll < settings.mockFailureRate) {
        throw new Error(
          `Lỗi giả lập (Tỉ lệ lỗi thử nghiệm ${settings.mockFailureRate}%): Máy chủ quá tải tạm thời. Nhấn Retry để thử lại!`
        );
      }
    }
    const pct = Math.min(88, Math.round((i / steps) * 85) + 5);
    onProgress(pct, `[Demo ${job.model}] Đang render khung hình (${pct}%)...`);
  }

  onProgress(
    92,
    `[Demo] Đang đóng gói ${job.outputCount} file MP4 dài ${job.durationSeconds || 8}s (${job.aspectRatio})...`
  );

  const outputs: GeneratedVideoOutput[] = [];
  for (let idx = 1; idx <= job.outputCount; idx++) {
    if (signal.aborted) throw new Error('Job đã bị huỷ');
    const safeModel = job.model.replace(/[^a-zA-Z0-9_-]/g, '-');
    const filename = `job-${String(job.seq).padStart(3, '0')}_demo_${safeModel}_${idx}_${Date.now()}.mp4`;
    const fullPath = path.join(OUTPUTS_DIR, filename);

    await renderMockMp4(job, idx, fullPath);
    const stat = fs.statSync(fullPath);

    outputs.push({
      index: idx,
      filename,
      url: `/media/outputs/${filename}`,
      downloadUrl: `/api/jobs/${job.id}/download/${idx}`,
      mimeType: 'video/mp4',
      sizeBytes: stat.size,
    });
  }

  await sleep(Math.min(400, stepMs), signal);
  onProgress(100, `[Demo] Hoàn tất tạo ${outputs.length} video (${job.durationSeconds || 8}s)!`);
  return outputs;
}

/**
 * Generates videos using Google's Gemini Interactions API v1beta (@google/genai v3+)
 * via gemini-omni-1.2-flash / gemini-omni-1.1-flash.
 */
async function generateGeminiVideos(
  job: VideoJob,
  settings: SystemSettings,
  onProgress: ProgressCallback,
  signal: AbortSignal
): Promise<GeneratedVideoOutput[]> {
  const apiKey = settings.geminiApiKey.trim();
  if (!apiKey) {
    throw new ProviderQuotaExhaustedError(
      'gemini',
      'Chưa cấu hình Gemini API Key.',
      5 * 60 * 1000
    );
  }

  if (job.inputType === 'image_to_video' && !job.imageAsset) {
    throw new Error('Loại input "Tạo video từ hình ảnh" yêu cầu upload ảnh đầu vào.');
  }
  if (job.inputType === 'frames_to_video' && !job.firstFrameAsset) {
    throw new Error('Loại input "Tạo video từ khung hình" yêu cầu upload Khung hình đầu (First Frame).');
  }

  const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
  const targetModel = resolveGeminiApiVideoModel(job.model);

  // Build multimodal input blocks for Interactions API
  const inputBlocks: Array<Record<string, unknown>> = [];

  if (job.inputType === 'image_to_video' && job.imageAsset) {
    const img = readUploadedImageBase64(job.imageAsset);
    inputBlocks.push({
      type: 'image',
      data: img.data,
      mime_type: img.mimeType,
    });
    inputBlocks.push({
      type: 'text',
      text: job.prompt || 'Animate this image with smooth, natural cinematic motion.',
    });
  } else if (job.inputType === 'frames_to_video') {
    if (job.firstFrameAsset) {
      const first = readUploadedImageBase64(job.firstFrameAsset);
      inputBlocks.push({
        type: 'image',
        data: first.data,
        mime_type: first.mimeType,
      });
    }
    if (job.lastFrameAsset) {
      const last = readUploadedImageBase64(job.lastFrameAsset);
      inputBlocks.push({
        type: 'image',
        data: last.data,
        mime_type: last.mimeType,
      });
    }
    const frameInstruction = job.lastFrameAsset
      ? `Generate a smooth video starting from the first frame image and ending at the second frame image. ${job.prompt}`
      : `Generate a smooth video starting from this frame. ${job.prompt}`;
    inputBlocks.push({
      type: 'text',
      text: frameInstruction,
    });
  } else {
    inputBlocks.push({
      type: 'text',
      text: job.prompt,
    });
  }

  const totalWanted = Math.max(1, job.outputCount);
  const outputs: GeneratedVideoOutput[] = [];
  const requestedAspect = job.aspectRatio === '9:16' ? '9:16' : '16:9';
  const durationStr = `${Math.max(3, Math.min(15, Number(job.durationSeconds) || 8))}s`;

  for (let outIdx = 1; outIdx <= totalWanted; outIdx++) {
    if (signal.aborted) throw new Error('Job đã bị huỷ');

    const itemSuffix = totalWanted > 1 ? ` (Video ${outIdx}/${totalWanted})` : '';
    onProgress(
      10 + Math.round(((outIdx - 1) / totalWanted) * 80),
      `[Gemini API • ${targetModel}] Đang khởi tạo yêu cầu tạo video ${durationStr}${itemSuffix}...`
    );

    const interaction = await ai.interactions.create({
      api_version: 'v1beta',
      model: targetModel,
      input: inputBlocks as never,
      response_format: {
          type: 'video',
          aspect_ratio: requestedAspect,
          duration: durationStr,
          resolution: (job.resolution || '720p') as '720p' | '1080p',
        },
      background: true,
    });

    let current = interaction as unknown as {
      id: string;
      status: string;
      steps?: Array<{
        type?: string;
        content?: Array<{
          type?: string;
          data?: string;
          uri?: string;
          mime_type?: string;
        }>;
        error?: { code?: string | number; message?: string };
      }>;
      errors?: Array<{ code?: string | number; message?: string }>;
    };

    let pollCount = 0;
    while (current.status === 'in_progress') {
      pollCount++;
      const pct = Math.min(
        88,
        15 + Math.round(((outIdx - 1 + Math.min(0.85, pollCount * 0.08)) / totalWanted) * 75)
      );
      onProgress(
        pct,
        `[Gemini API • ${targetModel}] Đang tạo video trên máy chủ Google (${pollCount * 6}s)${itemSuffix}...`
      );
      await sleep(6000, signal);
      current = (await ai.interactions.get(current.id, {
        api_version: 'v1beta',
      })) as unknown as typeof current;
    }

    if (current.status !== 'completed') {
      const errEntry = current.errors?.[0];
      const errCode = String(errEntry?.code || '');
      const errMessage = errEntry?.message || `Trạng thái trả về: ${current.status}`;

      if (errCode.toUpperCase().includes('RESOURCE_EXHAUSTED')) {
        throw new ProviderQuotaExhaustedError(
          'gemini',
          `Gemini API trả về RESOURCE_EXHAUSTED: ${errMessage}. Chưa xác định nguyên nhân cụ thể; hãy kiểm tra Usage, Rate limits và Billing của project chứa key trong Google AI Studio. Key hợp lệ không đồng nghĩa còn hạn mức tạo video.`
        );
      }
      throw new Error(`Lỗi từ Gemini API (${errCode || current.status}): ${errMessage}`);
    }

    // Extract video block(s) from completed interaction steps
    const videoBlocks: Array<{ data?: string; uri?: string; mime_type?: string }> = [];
    for (const step of current.steps || []) {
      if (step.type === 'model_output' && Array.isArray(step.content)) {
        for (const block of step.content) {
          if (block.type === 'video' && (block.data || block.uri)) {
            videoBlocks.push(block);
          }
        }
      }
    }

    if (videoBlocks.length === 0) {
      throw new Error('Gemini API đã xử lý xong nhưng không trả về dữ liệu video (có thể bị lọc nội dung an toàn).');
    }

    const chosen = videoBlocks[0];
    const safeModel = targetModel.replace(/[^a-zA-Z0-9_-]/g, '-');
    const filename = `job-${String(job.seq).padStart(3, '0')}_gemini_${safeModel}_${outIdx}_${Date.now()}.mp4`;
    const fullPath = path.join(OUTPUTS_DIR, filename);

    if (chosen.data) {
      fs.writeFileSync(fullPath, Buffer.from(chosen.data, 'base64'));
    } else if (chosen.uri) {
      const sep = chosen.uri.includes('?') ? '&' : '?';
      const resp = await fetch(`${chosen.uri}${sep}key=${encodeURIComponent(apiKey)}`, {
        headers: { 'x-goog-api-key': apiKey },
        signal,
      });
      if (!resp.ok) {
        throw new Error(`Không thể tải file video từ URI (${resp.status} ${resp.statusText})`);
      }
      const ab = await resp.arrayBuffer();
      fs.writeFileSync(fullPath, Buffer.from(ab));
    }

    const stat = fs.statSync(fullPath);
    outputs.push({
      index: outIdx,
      filename,
      url: `/media/outputs/${filename}`,
      downloadUrl: `/api/jobs/${job.id}/download/${outIdx}`,
      mimeType: chosen.mime_type || 'video/mp4',
      sizeBytes: stat.size,
    });
  }

  onProgress(100, `[Gemini API] Hoàn tất tạo ${outputs.length} video!`);
  return outputs;
}

function resolveProviderChain(settings: SystemSettings): RealProvider[] {
  if (settings.providerMode === 'gemini') return ['gemini'];
  if (settings.providerMode === 'flow') return ['flow'];

  const health = store.getProviderHealth();
  const now = Date.now();
  const geminiCoolingDown = Boolean(
    health.geminiExhaustedUntil && health.geminiExhaustedUntil > now
  );
  const flowCoolingDown = Boolean(
    health.flowExhaustedUntil && health.flowExhaustedUntil > now
  );

  if (settings.providerMode === 'auto_gemini_first') {
    if (geminiCoolingDown && !flowCoolingDown) {
      return ['flow', 'gemini'];
    }
    return ['gemini', 'flow'];
  }

  if (flowCoolingDown && !geminiCoolingDown) {
    return ['gemini', 'flow'];
  }
  return ['flow', 'gemini'];
}

function providerDisplayName(p: RealProvider): string {
  return p === 'gemini' ? 'Phương án 1 (Gemini API)' : 'Phương án 2 (Google Flow Ultra)';
}

export async function executeVideoJob(
  job: VideoJob,
  settings: SystemSettings,
  onProgress: ProgressCallback,
  signal: AbortSignal,
  onHealthChanged?: () => void
): Promise<VideoExecutionResult> {
  if (settings.providerMode === 'mock') {
    const outputs = await generateMockVideos(job, settings, onProgress, signal);
    return { outputs, executedProvider: 'mock' };
  }

  const chain = resolveProviderChain(settings);
  let firstFailureProvider: RealProvider | undefined;
  let firstFailureReason: string | undefined;

  for (let idx = 0; idx < chain.length; idx++) {
    const provider = chain[idx];
    const hasBackup = idx < chain.length - 1;

    try {
      if (provider === 'gemini') {
        const outputs = await generateGeminiVideos(job, settings, onProgress, signal);
        return {
          outputs,
          executedProvider: 'gemini',
          failoverFrom: firstFailureProvider,
          failoverReason: firstFailureReason,
        };
      } else {
        const canFailoverToGemini =
          hasBackup && settings.geminiApiKey.trim().length > 0 && !firstFailureProvider;
        const outputs = await flowManager.executeFlowJob(
          job,
          {
            flowProjectUrl: settings.flowProjectUrl,
            canFailoverImmediately: canFailoverToGemini,
          },
          onProgress,
          signal
        );
        return {
          outputs,
          executedProvider: 'flow',
          failoverFrom: firstFailureProvider,
          failoverReason: firstFailureReason,
        };
      }
    } catch (err) {
      if (signal.aborted) throw err;

      const errMsg = err instanceof Error ? err.message : String(err);
      const isExhausted =
        provider === 'gemini'
          ? isGeminiQuotaOrBillingError(err)
          : isFlowQuotaOrUnavailableError(err);

      if (isExhausted) {
        const cooldown =
          err instanceof ProviderQuotaExhaustedError ? err.cooldownMs : 15 * 60 * 1000;
        store.markProviderExhausted(provider, errMsg, cooldown);
        onHealthChanged?.();
      }

      if (hasBackup && isExhausted) {
        const backup = chain[idx + 1];
        firstFailureProvider = provider;
        firstFailureReason = errMsg;
        store.recordFailover();
        onHealthChanged?.();

        onProgress(
          12,
          `⚡ ${providerDisplayName(provider)} hết hạn mức/chưa sẵn sàng -> Đang tự động chuyển sang ${providerDisplayName(backup)}...`
        );
        await sleep(800, signal);
        continue;
      }

      if (firstFailureProvider) {
        throw new Error(
          `Cả 2 phương án đều không thể hoàn tất. [${providerDisplayName(firstFailureProvider)}]: ${firstFailureReason} | [${providerDisplayName(provider)}]: ${errMsg}`
        );
      }

      throw err;
    }
  }

  throw new Error('Không tìm thấy phương án tạo video khả dụng.');
}

export async function verifyGeminiApiKey(apiKey: string): Promise<{
  ok: boolean;
  veoModels: string[];
  message: string;
}> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('Vui lòng nhập Gemini API Key để kiểm tra.');
  }

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
    {
      headers: { 'x-goog-api-key': trimmed },
      signal: AbortSignal.timeout(20_000),
    }
  );
  const data = (await res.json()) as {
    models?: Array<{ name?: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(data.error?.message || `API Key không hợp lệ (${res.status})`);
  }

  const videoCapableModels = (data.models || [])
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((name) => /omni|veo|video/i.test(name));

  return {
    ok: true,
    veoModels: videoCapableModels,
    message:
      videoCapableModels.length > 0
        ? `Key hợp lệ. Model video được API liệt kê: ${videoCapableModels.join(', ')}. Kiểm tra này chưa xác nhận hạn mức hoặc khả năng tạo video thực tế.`
        : 'Key hợp lệ nhưng API chưa liệt kê model video cho key này.',
  };
}
