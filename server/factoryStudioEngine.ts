import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { v4 as uuidv4 } from 'uuid';
import ffmpegStatic from 'ffmpeg-static';
import { GoogleGenAI } from '@google/genai';
import {
  ensureStorageDirs,
  OUTPUTS_DIR,
  STORAGE_ROOT,
  store,
  UPLOADS_DIR,
} from './store.ts';
import { queueManager } from './queueManager.ts';
import { flowManager } from './flowAutomation.ts';
import type { CreateJobInput, UploadedAsset, VideoJob } from './types.ts';
import type {
  AidaStage,
  FactoryProject,
  FactorySceneItem,
  FactoryStylePreset,
  GenerateFactoryScriptInput,
  McOutfitPreset,
  StitchedVideoOutput,
} from './factoryTypes.ts';
import {
  buildFallback5SceneStoryboard,
  buildMasterPromptVerbatim,
  composeThreeBlockVideoPrompt6s,
  MC_OUTFIT_DESCRIPTIONS,
  STYLE_PRESET_DESCRIPTIONS,
} from './factoryPromptBuilder.ts';

const execFileAsync = promisify(execFile);
const FACTORY_PROJECTS_FILE = path.join(STORAGE_ROOT, 'factory-projects.json');

function readAssetBase64(asset: UploadedAsset): { data: string; mimeType: string } | null {
  const fullPath = path.join(UPLOADS_DIR, asset.filename);
  if (!fs.existsSync(fullPath)) return null;
  const buf = fs.readFileSync(fullPath);
  return {
    data: buf.toString('base64'),
    mimeType: asset.mimeType || 'image/png',
  };
}

async function inspectMediaClip(filePath: string): Promise<{
  hasAudio: boolean;
  durationSec: number;
}> {
  const ffmpegBin = ffmpegStatic as unknown as string | null;
  if (!ffmpegBin || !fs.existsSync(ffmpegBin)) {
    return { hasAudio: false, durationSec: 6 };
  }

  try {
    await execFileAsync(ffmpegBin, ['-i', filePath], { timeout: 10_000 });
    return { hasAudio: false, durationSec: 6 };
  } catch (err: unknown) {
    const stderr = String((err as { stderr?: string })?.stderr || '');
    const hasAudio = /Stream #\d+:\d+.*Audio:/i.test(stderr);
    let durationSec = 6;
    const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (durMatch) {
      durationSec =
        Number(durMatch[1]) * 3600 +
        Number(durMatch[2]) * 60 +
        Number(durMatch[3]);
    }
    return {
      hasAudio,
      durationSec: Math.max(1, durationSec),
    };
  }
}

export async function stitchClipsToFullHdMp4(
  clipFilePaths: string[],
  outFilePath: string
): Promise<{ totalDurationSec: number; sizeBytes: number }> {
  const ffmpegBin = ffmpegStatic as unknown as string | null;
  if (!ffmpegBin || !fs.existsSync(ffmpegBin)) {
    throw new Error('Không tìm thấy ffmpeg-static binary để ghép nối video.');
  }
  if (clipFilePaths.length === 0) {
    throw new Error('Không có clip phân cảnh nào để ghép nối.');
  }

  const metas = await Promise.all(clipFilePaths.map((p) => inspectMediaClip(p)));
  const anyAudio = metas.some((m) => m.hasAudio);
  const totalDurationSec = Number(
    metas.reduce((acc, m) => acc + m.durationSec, 0).toFixed(1)
  );

  const inputArgs: string[] = ['-y'];
  for (const p of clipFilePaths) {
    inputArgs.push('-i', p);
  }

  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < clipFilePaths.length; i++) {
    // Normalize every clip to Full HD 1080x1920 @ 30fps (exact format from Xuan Chien AI CapCut export)
    filterParts.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p[v${i}]`
    );

    if (anyAudio) {
      if (metas[i].hasAudio) {
        filterParts.push(
          `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
        );
      } else {
        filterParts.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${metas[i].durationSec.toFixed(2)},asetpts=PTS-STARTPTS[a${i}]`
        );
      }
      concatInputs.push(`[v${i}][a${i}]`);
    } else {
      concatInputs.push(`[v${i}]`);
    }
  }

  if (anyAudio) {
    filterParts.push(
      `${concatInputs.join('')}concat=n=${clipFilePaths.length}:v=1:a=1[outv][outa]`
    );
  } else {
    filterParts.push(
      `${concatInputs.join('')}concat=n=${clipFilePaths.length}:v=1:a=0[outv]`
    );
  }

  const args: string[] = [
    ...inputArgs,
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[outv]',
  ];

  if (anyAudio) {
    args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '128k');
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outFilePath
  );

  await execFileAsync(ffmpegBin, args, { timeout: 180_000 });
  const stat = fs.statSync(outFilePath);
  return { totalDurationSec, sizeBytes: stat.size };
}

async function createFallback916FramePng(
  sourceAsset: UploadedAsset | null,
  sceneNumber: number,
  outPngPath: string
): Promise<void> {
  const ffmpegBin = ffmpegStatic as unknown as string | null;
  if (!ffmpegBin || !fs.existsSync(ffmpegBin)) {
    throw new Error('Không tìm thấy ffmpeg-static để tạo khung hình 9:16.');
  }

  const sourcePath = sourceAsset ? path.join(UPLOADS_DIR, sourceAsset.filename) : null;
  if (sourcePath && fs.existsSync(sourcePath)) {
    // Frame the uploaded product photo cleanly onto a 1080x1920 9:16 vertical studio canvas with subtle per-scene crop/zoom variation
    const zoomFactor = 1 + ((sceneNumber - 1) % 3) * 0.06;
    const vf = `scale=${Math.round(1080 * zoomFactor)}:${Math.round(1920 * zoomFactor)}:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:#111827,format=rgb24`;
    await execFileAsync(
      ffmpegBin,
      ['-y', '-i', sourcePath, '-vf', vf, '-frames:v', '1', outPngPath],
      { timeout: 20_000 }
    );
  } else {
    const colors = ['#1e293b', '#0f172a', '#1e1b4b', '#172554', '#064e3b'];
    const bg = colors[(sceneNumber - 1) % colors.length];
    await execFileAsync(
      ffmpegBin,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${bg}:s=1080x1920:d=1`,
        '-frames:v',
        '1',
        outPngPath,
      ],
      { timeout: 15_000 }
    );
  }
}

class FactoryStudioEngine extends EventEmitter {
  private projects: FactoryProject[] = [];
  private saveTimer: NodeJS.Timeout | null = null;
  private stitchingIds = new Set<string>();

  constructor() {
    super();
    ensureStorageDirs();
    this.projects = this.loadProjects();

    // Listen to queue updates so completed 5-scene batches automatically stitch into 30s Full HD MP4!
    queueManager.on('event', (payload: { type?: string; job?: VideoJob }) => {
      if (payload.type === 'job_updated' && payload.job) {
        void this.onJobUpdated(payload.job);
      }
    });
  }

  private loadProjects(): FactoryProject[] {
    if (fs.existsSync(FACTORY_PROJECTS_FILE)) {
      try {
        const raw = fs.readFileSync(FACTORY_PROJECTS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as FactoryProject[];
      } catch (err) {
        console.error('[FactoryStudio] Error loading factory-projects.json:', err);
      }
    }
    return [];
  }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        ensureStorageDirs();
        fs.writeFileSync(
          FACTORY_PROJECTS_FILE,
          JSON.stringify(this.projects, null, 2),
          'utf-8'
        );
      } catch (err) {
        console.error('[FactoryStudio] Error saving factory-projects.json:', err);
      }
    }, 150);
  }

  private broadcastProject(project: FactoryProject, reason = 'project_updated'): void {
    this.emit('event', {
      type: 'factory_updated',
      reason,
      project,
      projects: this.projects,
    });
  }

  public getProjects(): FactoryProject[] {
    return this.projects;
  }

  public getProjectById(id: string): FactoryProject | undefined {
    return this.projects.find((p) => p.id === id);
  }

  private async resolveTextModel(apiKey: string): Promise<string> {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
        {
          headers: { 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(8_000),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
        };
        const names = (data.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => String(m.name || '').replace(/^models\//, ''))
          .filter((n) => !/tts|image|embedding|veo|aqa/i.test(n));
        const flash = names.find((n) => /2\.5-flash|3-flash|2\.0-flash|flash/i.test(n));
        if (flash) return flash;
      }
    } catch {
      // Fallback
    }
    return 'gemini-2.5-flash';
  }

  private async resolveImageGenModel(apiKey: string): Promise<string | null> {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
        {
          headers: { 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(8_000),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
        };
        const names = (data.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => String(m.name || '').replace(/^models\//, ''));
        const imgModel = names.find((n) =>
          /flash-image|image-generation|nano-banana|gemini-2\.5-flash-image|gemini-3.*image/i.test(
            n
          )
        );
        if (imgModel) return imgModel;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  public async generateStoryboardScript(input: GenerateFactoryScriptInput): Promise<{
    usedAiVision: boolean;
    masterPromptUsed: string;
    scenes: FactorySceneItem[];
  }> {
    const productName = (input.productName || '').trim() || 'Sản Phẩm Gia Dụng Thông Minh';
    const productHighlights = (input.productHighlights || '').trim();
    const stylePreset: FactoryStylePreset = input.stylePreset || 'factory_conveyor';
    const mcOutfitPreset: McOutfitPreset = input.mcOutfitPreset || 'cream_polo';
    const productAssets = input.productAssets || [];
    const mcFaceAsset = input.mcFaceAsset || null;

    const apiKey = store.getSettings().geminiApiKey.trim();
    if (!apiKey) {
      const fallback = buildFallback5SceneStoryboard({
        productName,
        productHighlights,
        stylePreset,
        mcOutfitPreset,
      });
      return { usedAiVision: false, ...fallback };
    }

    try {
      const modelName = await this.resolveTextModel(apiKey);
      const ai = new GoogleGenAI({ apiKey });
      const styleInfo = STYLE_PRESET_DESCRIPTIONS[stylePreset];
      const mcInfo = MC_OUTFIT_DESCRIPTIONS[mcOutfitPreset];
      const masterPromptUsed = buildMasterPromptVerbatim(
        productName,
        productHighlights,
        stylePreset,
        mcOutfitPreset
      );

      const parts: Array<Record<string, unknown>> = [];
      for (const asset of productAssets.slice(0, 5)) {
        const b64 = readAssetBase64(asset);
        if (b64) {
          parts.push({
            inlineData: {
              data: b64.data,
              mimeType: b64.mimeType,
            },
          });
        }
      }
      if (mcFaceAsset) {
        const mcB64 = readAssetBase64(mcFaceAsset);
        if (mcB64) {
          parts.push({
            inlineData: {
              data: mcB64.data,
              mimeType: mcB64.mimeType,
            },
          });
        }
      }

      parts.push({
        text: `${masterPromptUsed}

Hãy quan sát kỹ các hình ảnh sản phẩm đính kèm (màu sắc thực tế, chất liệu vỏ/ruột, nút bấm, kiểu dáng, kích thước) và trả về DUY NHẤT một JSON hợp lệ gồm đúng 5 phân cảnh theo cấu trúc AIDA chuẩn sau:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "Tiêu đề ngắn Cảnh 1",
      "cameraAngle": "Góc máy dọc 9:16 (VD: Trung toàn cảnh cạnh băng chuyền, push-in nhẹ)",
      "imagePrompt916": "Câu lệnh tiếng Việt chi tiết tạo ảnh dọc 9:16 chân thực như chụp điện thoại tại ${styleInfo.shortLabel}, mô tả rõ ${mcInfo.outfitVi} và mô tả chính xác 100% đặc điểm ngoại hình sản phẩm ${productName}. Lưu ý từ Cảnh 2 đến Cảnh 5 phải mở đầu bằng 'Bối cảnh tiếp tục chính xác nhà xưởng Cảnh 1...'",
      "actionAndCameraVi": "Mô tả chuyển động 6 giây của MC thao tác với sản phẩm, băng chuyền chuyển động phía sau và chuyển động camera.",
      "spokenDialogueVi": "Đúng 1 câu lời thoại tiếng Việt tự nhiên khoảng 15-19 chữ vừa khít 6 giây nói (Cảnh 5 kêu gọi bấm vào giỏ hàng)."
    }
  ]
}`,
      });

      const resp = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.45,
        },
      });

      const rawText = resp.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Invalid AI JSON');

      const parsed = JSON.parse(jsonMatch[0]) as {
        scenes?: Array<{
          sceneNumber?: number;
          title?: string;
          cameraAngle?: string;
          imagePrompt916?: string;
          actionAndCameraVi?: string;
          spokenDialogueVi?: string;
        }>;
      };

      const aidaStages: AidaStage[] = [
        'Attention (Thu hút tại xưởng)',
        'Interest (Chất liệu & Thiết kế)',
        'Interest (Dung tích & Thông số)',
        'Desire (Test thực tế)',
        'Action (Kho hàng & Chốt giỏ)',
      ];

      if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 3) {
        throw new Error('Too few scenes returned');
      }

      const shortName =
        productName.split(' ').length > 7
          ? productName.split(' ').slice(0, 7).join(' ')
          : productName;

      const scenes: FactorySceneItem[] = parsed.scenes.slice(0, 5).map((s, idx) => {
        const spokenDialogueVi =
          (s.spokenDialogueVi || '').trim() ||
          `Tham khảo ngay mẫu ${shortName} chính hãng tại giỏ hàng góc trái nhé!`;
        const actionAndCameraVi =
          (s.actionAndCameraVi || '').trim() ||
          `MC cầm chắc sản phẩm ${shortName} giới thiệu tự nhiên bên cạnh dây chuyền sản xuất, camera push-in nhẹ.`;

        return {
          sceneNumber: idx + 1,
          aidaStage: aidaStages[idx] || 'Interest (Chất liệu & Thiết kế)',
          title: s.title || `Cảnh ${idx + 1}`,
          cameraAngle: s.cameraAngle || 'Góc dọc 9:16 trung cảnh nhà xưởng',
          imagePrompt916: s.imagePrompt916 || '',
          spokenDialogueVi,
          videoPrompt6s: composeThreeBlockVideoPrompt6s({
            productName: shortName,
            actionAndCameraVi,
            spokenDialogueVi,
          }),
          durationSeconds: 6,
          keyframeAsset: null,
          linkedJobId: null,
        };
      });

      return {
        usedAiVision: true,
        masterPromptUsed,
        scenes,
      };
    } catch (err) {
      console.warn('[FactoryStudio] AI vision script fallback triggered:', err);
      const fallback = buildFallback5SceneStoryboard({
        productName,
        productHighlights,
        stylePreset,
        mcOutfitPreset,
      });
      return { usedAiVision: false, ...fallback };
    }
  }

  public createOrUpdateProject(payload: {
    id?: string;
    productName: string;
    productHighlights?: string;
    stylePreset?: FactoryStylePreset;
    mcOutfitPreset?: McOutfitPreset;
    videoModel?: string;
    productAssets?: UploadedAsset[];
    mcFaceAsset?: UploadedAsset | null;
    masterPromptUsed?: string;
    scenes: FactorySceneItem[];
  }): FactoryProject {
    const nowIso = new Date().toISOString();
    const existing = payload.id ? this.getProjectById(payload.id) : undefined;

    if (existing) {
      existing.productName = payload.productName;
      existing.productHighlights = payload.productHighlights || '';
      existing.stylePreset = payload.stylePreset || existing.stylePreset;
      existing.mcOutfitPreset = payload.mcOutfitPreset || existing.mcOutfitPreset;
      existing.videoModel = payload.videoModel || existing.videoModel;
      if (payload.productAssets) existing.productAssets = payload.productAssets;
      if (payload.mcFaceAsset !== undefined) existing.mcFaceAsset = payload.mcFaceAsset;
      if (payload.masterPromptUsed) existing.masterPromptUsed = payload.masterPromptUsed;
      existing.scenes = payload.scenes;
      existing.updatedAt = nowIso;
      this.saveSoon();
      this.broadcastProject(existing);
      return existing;
    }

    const created: FactoryProject = {
      id: uuidv4(),
      productName: payload.productName,
      productHighlights: payload.productHighlights || '',
      stylePreset: payload.stylePreset || 'factory_conveyor',
      mcOutfitPreset: payload.mcOutfitPreset || 'cream_polo',
      videoModel: payload.videoModel || 'gemini-omni-1.1-flash',
      productAssets: payload.productAssets || [],
      mcFaceAsset: payload.mcFaceAsset || null,
      masterPromptUsed: payload.masterPromptUsed || '',
      scenes: payload.scenes,
      status: 'draft',
      statusMessage: 'Đã tạo kịch bản 5 cảnh AIDA sẵn sàng dựng video.',
      stitchedOutput: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.projects.unshift(created);
    if (this.projects.length > 30) {
      this.projects = this.projects.slice(0, 30);
    }
    this.saveSoon();
    this.broadcastProject(created, 'project_created');
    return created;
  }

  /**
   * Generates consistent 9:16 start-frame images across all 5 scenes:
   * - Scene 1 uses uploaded product photos + MC face photo.
   * - Scenes 2..5 ALSO attach Scene 1's generated image as anchor (7-reference consistency lock!).
   * - Falls back cleanly to FFmpeg 1080x1920 vertical framing of uploaded product photos if no Gemini image model is available.
   */
  public async generateProjectKeyframes(projectId: string): Promise<{
    usedAiImageModel: string | null;
    project: FactoryProject;
  }> {
    const project = this.getProjectById(projectId);
    if (!project) throw new Error('Không tìm thấy dự án kịch bản 5 cảnh.');

    const settings = store.getSettings();
    const apiKey = settings.geminiApiKey.trim();
    const useFlowForImages =
      settings.providerMode === 'flow' || settings.providerMode === 'auto_flow_first';
    const imgModel = apiKey ? await this.resolveImageGenModel(apiKey) : null;
    const ai = apiKey && imgModel ? new GoogleGenAI({ apiKey }) : null;

    let scene1AnchorAsset: UploadedAsset | null = null;
    let usedModelName: string | null = null;

    for (let idx = 0; idx < project.scenes.length; idx++) {
      const scene = project.scenes[idx];
      const outFilename = `factory_frame_s${scene.sceneNumber}_${Date.now()}_${uuidv4().slice(0, 6)}.png`;
      const outPath = path.join(UPLOADS_DIR, outFilename);
      let generatedByAi = false;

      // 1. Try Google Flow Nano Banana Pro 9:16 when Flow mode is active!
      if (useFlowForImages) {
        const refPaths: string[] = [];
        if (idx > 0 && scene1AnchorAsset) {
          refPaths.push(path.join(UPLOADS_DIR, scene1AnchorAsset.filename));
        }
        for (const pAsset of project.productAssets.slice(0, 5)) {
          refPaths.push(path.join(UPLOADS_DIR, pAsset.filename));
        }
        if (project.mcFaceAsset) {
          refPaths.push(path.join(UPLOADS_DIR, project.mcFaceAsset.filename));
        }

        const okFlowImg = await flowManager.generateFlowImage916({
          prompt: scene.imagePrompt916,
          referenceFilePaths: refPaths,
          outPngPath: outPath,
          flowProjectUrl: settings.flowProjectUrl,
        });
        if (okFlowImg && fs.existsSync(outPath)) {
          generatedByAi = true;
          usedModelName = 'Google Flow • Nano Banana Pro (9:16)';
        }
      }

      // 2. Otherwise try Gemini API Image model if configured
      if (!generatedByAi && ai && imgModel) {
        try {
          const parts: Array<Record<string, unknown>> = [];
          // Attach Scene 1 anchor image first for Scenes 2..5!
          if (idx > 0 && scene1AnchorAsset) {
            const anchorB64 = readAssetBase64(scene1AnchorAsset);
            if (anchorB64) {
              parts.push({
                inlineData: { data: anchorB64.data, mimeType: anchorB64.mimeType },
              });
            }
          }
          // Attach all uploaded product reference screenshots
          for (const pAsset of project.productAssets.slice(0, 5)) {
            const b64 = readAssetBase64(pAsset);
            if (b64) {
              parts.push({ inlineData: { data: b64.data, mimeType: b64.mimeType } });
            }
          }
          // Attach MC face reference if provided
          if (project.mcFaceAsset) {
            const mcB64 = readAssetBase64(project.mcFaceAsset);
            if (mcB64) {
              parts.push({ inlineData: { data: mcB64.data, mimeType: mcB64.mimeType } });
            }
          }
          parts.push({
            text: `Generate a photorealistic vertical 9:16 portrait smartphone photograph (1080x1920): ${scene.imagePrompt916}. Do not include any text overlays or watermarks.`,
          });

          const resp = await ai.models.generateContent({
            model: imgModel,
            contents: [{ role: 'user', parts }],
            config: {
              responseModalities: ['IMAGE', 'TEXT'],
            },
          });

          const candidateParts = resp.candidates?.[0]?.content?.parts || [];
          const imagePart = candidateParts.find(
            (p) => p.inlineData && p.inlineData.data
          );
          if (imagePart?.inlineData?.data) {
            fs.writeFileSync(
              outPath,
              Buffer.from(imagePart.inlineData.data, 'base64')
            );
            generatedByAi = true;
            usedModelName = imgModel;
          }
        } catch (err) {
          console.warn(
            `[FactoryStudio] Gemini image gen skipped on scene ${scene.sceneNumber}:`,
            err
          );
        }
      }

      if (!generatedByAi) {
        const refAsset =
          project.productAssets[idx % Math.max(1, project.productAssets.length)] ||
          project.mcFaceAsset ||
          null;
        await createFallback916FramePng(refAsset, scene.sceneNumber, outPath);
      }

      const stat = fs.statSync(outPath);
      const asset: UploadedAsset = {
        id: uuidv4(),
        filename: outFilename,
        originalName: `Canh_${scene.sceneNumber}_9x16.png`,
        mimeType: 'image/png',
        url: `/media/uploads/${outFilename}`,
        size: stat.size,
      };
      store.registerAsset(asset);
      scene.keyframeAsset = asset;
      if (idx === 0) {
        scene1AnchorAsset = asset;
      }
    }

    project.statusMessage = usedModelName
      ? `Đã tạo 5 ảnh gốc 9:16 đồng nhất nhân vật & sản phẩm bằng AI (${usedModelName})!`
      : 'Đã chuẩn bị 5 khung hình chuẩn 9:16 (1080x1920) từ bộ ảnh sản phẩm tham chiếu!';
    project.updatedAt = new Date().toISOString();
    this.saveSoon();
    this.broadcastProject(project, 'keyframes_generated');

    return { usedAiImageModel: usedModelName, project };
  }

  /**
   * Enqueues all 5 scenes (6s, 9:16, Frames-to-Video or Text-to-Video) into QueueManager
   * and activates automatic FFmpeg 30s Full HD stitching when all scenes complete!
   */
  public launchProjectVideoBatch(projectId: string): {
    project: FactoryProject;
    jobs: VideoJob[];
  } {
    const project = this.getProjectById(projectId);
    if (!project) throw new Error('Không tìm thấy dự án kịch bản 5 cảnh.');

    const fallbackRefAsset = project.productAssets[0] || null;

    const jobInputs: CreateJobInput[] = project.scenes.map((scene, idx) => {
      const frameAsset =
        scene.keyframeAsset ||
        project.productAssets[idx % Math.max(1, project.productAssets.length)] ||
        fallbackRefAsset;

      return {
        prompt: scene.videoPrompt6s,
        negativePrompt:
          'phụ đề, chữ tự sinh, watermark, biến dạng bàn tay, méo sản phẩm, sai logo',
        inputType: frameAsset ? 'frames_to_video' : 'text_to_video',
        model: project.videoModel || 'gemini-omni-1.1-flash',
        aspectRatio: '9:16',
        outputCount: 1,
        durationSeconds: scene.durationSeconds || 6,
        resolution: '720p',
        firstFrameAsset: frameAsset || null,
      };
    });

    const createdJobs = queueManager.enqueueBatch(jobInputs);
    project.scenes.forEach((scene, idx) => {
      scene.linkedJobId = createdJobs[idx]?.id || null;
    });

    project.status = 'generating_clips';
    project.stitchedOutput = null;
    project.statusMessage = `Đang tạo 0/${project.scenes.length} phân cảnh 6s (sẽ tự động ghép thành 1 video Full HD 30s ngay khi đủ 5 cảnh)...`;
    project.updatedAt = new Date().toISOString();

    this.saveSoon();
    this.broadcastProject(project, 'batch_launched');
    return { project, jobs: createdJobs };
  }

  private async onJobUpdated(updatedJob: VideoJob): Promise<void> {
    const project = this.projects.find((p) =>
      p.scenes.some((s) => s.linkedJobId === updatedJob.id)
    );
    if (!project) return;

    const linkedJobs = project.scenes
      .map((s) => (s.linkedJobId ? store.getJobById(s.linkedJobId) : undefined))
      .filter((j): j is VideoJob => Boolean(j));

    if (linkedJobs.length === 0) return;

    const completedCount = linkedJobs.filter((j) => j.status === 'completed').length;
    const failedCount = linkedJobs.filter(
      (j) => j.status === 'failed' || j.status === 'cancelled'
    ).length;
    const activeCount = linkedJobs.filter(
      (j) => j.status === 'queued' || j.status === 'running'
    ).length;

    if (activeCount > 0) {
      project.status = 'generating_clips';
      project.statusMessage = `Đã xong ${completedCount}/${project.scenes.length} phân cảnh 6s • Đang xử lý tiếp...`;
      project.updatedAt = new Date().toISOString();
      this.saveSoon();
      this.broadcastProject(project, 'scene_progress');
      return;
    }

    // All jobs finished! If at least 2 scenes completed and we haven't stitched yet, auto-stitch!
    if (completedCount >= 2 && !this.stitchingIds.has(project.id)) {
      try {
        await this.stitchCompletedScenes(project.id);
      } catch (err) {
        project.status = 'partial_failed';
        project.statusMessage =
          err instanceof Error ? err.message : 'Lỗi ghép nối video FFmpeg.';
        this.saveSoon();
        this.broadcastProject(project, 'stitch_failed');
      }
    } else if (failedCount > 0 && completedCount < 2) {
      project.status = 'partial_failed';
      project.statusMessage = `Có ${failedCount} phân cảnh bị lỗi. Bạn có thể bấm Retry ở Hàng Đợi rồi bấm Ghép Nối Lại.`;
      project.updatedAt = new Date().toISOString();
      this.saveSoon();
      this.broadcastProject(project, 'partial_failed');
    }
  }

  public async stitchCompletedScenes(projectId: string): Promise<FactoryProject> {
    const project = this.getProjectById(projectId);
    if (!project) throw new Error('Không tìm thấy dự án.');
    if (this.stitchingIds.has(projectId)) return project;

    const clipPaths: string[] = [];
    for (const scene of project.scenes) {
      if (!scene.linkedJobId) continue;
      const job = store.getJobById(scene.linkedJobId);
      if (job && job.status === 'completed' && job.outputs.length > 0) {
        const p = path.join(OUTPUTS_DIR, job.outputs[0].filename);
        if (fs.existsSync(p)) {
          clipPaths.push(p);
        }
      }
    }

    if (clipPaths.length === 0) {
      throw new Error('Chưa có phân cảnh video hoàn thành nào để ghép nối.');
    }

    this.stitchingIds.add(projectId);
    project.status = 'stitching';
    project.statusMessage = `Đang ghép nối ${clipPaths.length} phân cảnh thành 1 video Full HD 1080x1920 (30fps)...`;
    this.broadcastProject(project, 'stitching_started');

    try {
      const slug = project.productName
        .slice(0, 28)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();

      const outFilename = `factory_fullhd_${clipPaths.length}scenes_${slug || 'product'}_${Date.now()}.mp4`;
      const outFullPath = path.join(OUTPUTS_DIR, outFilename);

      const { totalDurationSec, sizeBytes } = await stitchClipsToFullHdMp4(
        clipPaths,
        outFullPath
      );

      const stitched: StitchedVideoOutput = {
        filename: outFilename,
        url: `/media/outputs/${outFilename}`,
        downloadUrl: `/api/factory/projects/${project.id}/download`,
        durationSeconds: totalDurationSec,
        sceneCount: clipPaths.length,
        resolution: '1080x1920 (Full HD 9:16 • 30fps)',
        sizeBytes,
        createdAt: new Date().toISOString(),
      };

      project.stitchedOutput = stitched;
      project.status = 'completed';
      project.statusMessage = `Hoàn tất! Đã ghép ${clipPaths.length} cảnh thành 1 video MP4 Full HD dài ${totalDurationSec}s sẵn sàng đăng TikTok / Shopee Video!`;
      project.updatedAt = new Date().toISOString();
      this.saveSoon();
      this.broadcastProject(project, 'stitching_completed');
      return project;
    } finally {
      this.stitchingIds.delete(projectId);
    }
  }
}

export const factoryStudio = new FactoryStudioEngine();
