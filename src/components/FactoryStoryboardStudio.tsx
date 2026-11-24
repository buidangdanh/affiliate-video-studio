import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clapperboard,
  Copy,
  Download,
  Factory,
  Film,
  FolderClock,
  ImagePlus,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { composeThreeBlockVideoPrompt6s } from '../../server/factoryPromptBuilder.ts';
import type { AffiliateProduct } from '../affiliateTypes';
import type {
  FactoryProject,
  FactorySceneItem,
  FactoryStylePreset,
  McOutfitPreset,
} from '../factoryTypes';
import {
  MODEL_OPTIONS,
  type DraftJob,
  type QueueStats,
  type UploadedAsset,
  type VideoJob,
} from '../types';
import {
  generateFactoryKeyframesApi,
  generateFactoryScriptApi,
  launchFactoryBatchApi,
  saveFactoryProjectApi,
  stitchFactoryProjectApi,
  uploadImageFile,
} from '../api';
import { createEmptyDraft } from './DraftJobList';

interface FactoryStoryboardStudioProps {
  affiliateProducts: AffiliateProduct[];
  projects: FactoryProject[];
  jobs: VideoJob[];
  isCloudMode: boolean;
  prefillProduct: AffiliateProduct | null;
  onClearPrefill: () => void;
  onProjectsUpdated: (next: FactoryProject[]) => void;
  onJobsLaunched: (newJobs: VideoJob[], stats: QueueStats) => void;
  onPushScenesToDrafts: (drafts: DraftJob[]) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const FactoryStoryboardStudio: React.FC<FactoryStoryboardStudioProps> = ({
  affiliateProducts,
  projects,
  jobs,
  isCloudMode,
  prefillProduct,
  onClearPrefill,
  onProjectsUpdated,
  onJobsLaunched,
  onPushScenesToDrafts,
  onNotify,
}) => {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => projects[0]?.id || null
  );
  const [productName, setProductName] = useState(
    'Ấm Siêu Tốc Inox 304 LEAMI 1.8L Công Suất 1500W Màu Kem Sang Trọng'
  );
  const [productHighlights, setProductHighlights] = useState(
    'Thiết kế vỏ màu kem sang trọng chống bỏng, ruột bình Inox 304 nguyên khối dễ vệ sinh, dung tích lớn 1.8L cho cả gia đình, công suất 1500W đun sôi siêu tốc tự ngắt an toàn'
  );
  const [stylePreset, setStylePreset] =
    useState<FactoryStylePreset>('factory_conveyor');
  const [mcOutfitPreset, setMcOutfitPreset] =
    useState<McOutfitPreset>('cream_polo');
  const [videoModel, setVideoModel] = useState<string>('gemini-omni-1.1-flash');
  const [productAssets, setProductAssets] = useState<UploadedAsset[]>([]);
  const [mcFaceAsset, setMcFaceAsset] = useState<UploadedAsset | null>(null);
  const [masterPromptUsed, setMasterPromptUsed] = useState('');
  const [scenes, setScenes] = useState<FactorySceneItem[]>([]);

  const [uploadingRef, setUploadingRef] = useState(false);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [launchingBatch, setLaunchingBatch] = useState(false);
  const [stitchingNow, setStitchingNow] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showMasterPrompt, setShowMasterPrompt] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  // Sync local scenes when activeProject updates from SSE (e.g. keyframes or stitched output ready)
  useEffect(() => {
    if (!activeProject) return;
    setScenes(activeProject.scenes);
    if (activeProject.masterPromptUsed) {
      setMasterPromptUsed(activeProject.masterPromptUsed);
    }
  }, [activeProject]);

  // Handle 1-click prefill from Affiliate Radar
  useEffect(() => {
    if (!prefillProduct) return;
    const praise = prefillProduct.buyerEvidence.topPraiseKeywords.join(', ');
    setActiveProjectId(null);
    setProductName(prefillProduct.name);
    setProductHighlights(
      `${praise}. Giá ưu đãi ${prefillProduct.priceVnd.toLocaleString('vi-VN')}đ, đánh giá ${prefillProduct.rating} sao.`
    );
    setStylePreset('factory_conveyor');
    setMcOutfitPreset('cream_polo');
    onClearPrefill();

    // Auto-generate the 5-scene script immediately for smooth UX!
    void (async () => {
      setGeneratingScript(true);
      try {
        const res = await generateFactoryScriptApi({
          productName: prefillProduct.name,
          productHighlights: praise,
          stylePreset: 'factory_conveyor',
          mcOutfitPreset: 'cream_polo',
          productAssets: [],
          mcFaceAsset: null,
        });
        setMasterPromptUsed(res.masterPromptUsed);
        setScenes(res.scenes);
        const saved = await saveFactoryProjectApi({
          productName: prefillProduct.name,
          productHighlights: praise,
          stylePreset: 'factory_conveyor',
          mcOutfitPreset: 'cream_polo',
          videoModel,
          productAssets: [],
          mcFaceAsset: null,
          masterPromptUsed: res.masterPromptUsed,
          scenes: res.scenes,
        });
        setActiveProjectId(saved.project.id);
        onProjectsUpdated([
          saved.project,
          ...projects.filter((p) => p.id !== saved.project.id),
        ]);
      } catch (err) {
        console.error(err);
      } finally {
        setGeneratingScript(false);
      }
    })();
  }, [prefillProduct]);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const handleSelectAffiliateProduct = (prodId: string) => {
    const found = affiliateProducts.find((p) => p.id === prodId);
    if (!found) return;
    setActiveProjectId(null);
    setProductName(found.name);
    setProductHighlights(
      `${found.buyerEvidence.topPraiseKeywords.join(', ')}. Gian hàng ${
        found.reputableSellers[0]?.shopName || 'chính hãng Mall'
      }.`
    );
    onNotify(`Đã điền thông tin sản phẩm "${found.name.slice(0, 38)}..."`, 'success');
  };

  const handleUploadProductPhotos = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    if (files.length === 0) return;
    setUploadingRef(true);
    try {
      const uploaded: UploadedAsset[] = [];
      for (const f of files) {
        const asset = await uploadImageFile(f);
        uploaded.push(asset);
      }
      setProductAssets((prev) => [...prev, ...uploaded].slice(0, 5));
      onNotify(`Đã tải lên ${uploaded.length} ảnh sản phẩm mẫu!`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi upload ảnh', 'error');
    } finally {
      setUploadingRef(false);
      e.target.value = '';
    }
  };

  const handleUploadMcPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingRef(true);
    try {
      const asset = await uploadImageFile(file);
      setMcFaceAsset(asset);
      onNotify('Đã tải lên ảnh gương mặt mẫu MC cố định!', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi upload ảnh MC', 'error');
    } finally {
      setUploadingRef(false);
      e.target.value = '';
    }
  };

  const handleUploadSceneFrame = async (
    sceneIdx: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const asset = await uploadImageFile(file);
      const nextScenes = scenes.map((s, idx) =>
        idx === sceneIdx ? { ...s, keyframeAsset: asset } : s
      );
      setScenes(nextScenes);
      if (activeProjectId) {
        const saved = await saveFactoryProjectApi({
          id: activeProjectId,
          productName,
          productHighlights,
          stylePreset,
          mcOutfitPreset,
          videoModel,
          productAssets,
          mcFaceAsset,
          masterPromptUsed,
          scenes: nextScenes,
        });
        onProjectsUpdated(
          projects.map((p) => (p.id === saved.project.id ? saved.project : p))
        );
      }
      onNotify(`Đã cập nhật ảnh khung đầu Cảnh ${sceneIdx + 1}!`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi tải ảnh cảnh', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleGenerate5SceneScript = async () => {
    if (!productName.trim()) {
      onNotify('Vui lòng nhập tên sản phẩm cần làm video!', 'error');
      return;
    }
    setGeneratingScript(true);
    try {
      const res = await generateFactoryScriptApi({
        productName,
        productHighlights,
        stylePreset,
        mcOutfitPreset,
        productAssets,
        mcFaceAsset,
      });
      setMasterPromptUsed(res.masterPromptUsed);
      setScenes(res.scenes);

      const saved = await saveFactoryProjectApi({
        id: activeProjectId || undefined,
        productName,
        productHighlights,
        stylePreset,
        mcOutfitPreset,
        videoModel,
        productAssets,
        mcFaceAsset,
        masterPromptUsed: res.masterPromptUsed,
        scenes: res.scenes,
      });

      setActiveProjectId(saved.project.id);
      const exists = projects.some((p) => p.id === saved.project.id);
      onProjectsUpdated(
        exists
          ? projects.map((p) => (p.id === saved.project.id ? saved.project : p))
          : [saved.project, ...projects]
      );

      onNotify(
        res.usedAiVision
          ? 'AI Gemini đã phân tích hình ảnh sản phẩm & sinh trọn bộ kịch bản 5 cảnh AIDA (30s)!'
          : 'Đã sinh trọn bộ kịch bản 5 cảnh AIDA chuẩn phong cách Kho Xưởng (30s)!',
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Lỗi tạo kịch bản 5 cảnh',
        'error'
      );
    } finally {
      setGeneratingScript(false);
    }
  };

  const updateSceneField = (
    idx: number,
    patch: Partial<FactorySceneItem>
  ) => {
    setScenes((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const updated = { ...s, ...patch };
        if (patch.spokenDialogueVi !== undefined && patch.videoPrompt6s === undefined) {
          const shortName = productName.split(' ').slice(0, 7).join(' ');
          updated.videoPrompt6s = composeThreeBlockVideoPrompt6s({
            productName: shortName,
            actionAndCameraVi:
              'MC cầm chắc sản phẩm thao tác giới thiệu tự nhiên cạnh dây chuyền sản xuất đang di chuyển chậm phía sau, camera push-in nhẹ.',
            spokenDialogueVi: patch.spokenDialogueVi,
          });
        }
        return updated;
      })
    );
  };

  const persistCurrentProject = async (): Promise<FactoryProject> => {
    const saved = await saveFactoryProjectApi({
      id: activeProjectId || undefined,
      productName,
      productHighlights,
      stylePreset,
      mcOutfitPreset,
      videoModel,
      productAssets,
      mcFaceAsset,
      masterPromptUsed,
      scenes,
    });
    setActiveProjectId(saved.project.id);
    const exists = projects.some((p) => p.id === saved.project.id);
    onProjectsUpdated(
      exists
        ? projects.map((p) => (p.id === saved.project.id ? saved.project : p))
        : [saved.project, ...projects]
    );
    return saved.project;
  };

  const handleGenerateKeyframes = async () => {
    if (scenes.length === 0) {
      onNotify('Hãy bấm Bước 1 để sinh kịch bản 5 cảnh trước!', 'error');
      return;
    }
    setGeneratingFrames(true);
    try {
      const proj = await persistCurrentProject();
      const res = await generateFactoryKeyframesApi(proj.id);
      setScenes(res.project.scenes);
      onProjectsUpdated(
        projects.map((p) => (p.id === res.project.id ? res.project : p))
      );
      onNotify(res.project.statusMessage, 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Lỗi tạo khung hình 9:16',
        'error'
      );
    } finally {
      setGeneratingFrames(false);
    }
  };

  const handleLaunchAutoRenderAndStitch = async () => {
    if (scenes.length === 0) {
      onNotify('Hãy bấm Bước 1 để sinh kịch bản 5 cảnh trước!', 'error');
      return;
    }
    if (isCloudMode) {
      const drafts: DraftJob[] = scenes.map((s) =>
        createEmptyDraft({
          prompt: s.videoPrompt6s,
          aspectRatio: '9:16',
          durationSeconds: 6,
          model: videoModel,
          inputType: s.keyframeAsset ? 'frames_to_video' : 'text_to_video',
          firstFrameAsset: s.keyframeAsset,
        })
      );
      onPushScenesToDrafts(drafts);
      return;
    }

    setLaunchingBatch(true);
    try {
      const proj = await persistCurrentProject();
      const res = await launchFactoryBatchApi(proj.id);
      setScenes(res.project.scenes);
      onProjectsUpdated(
        projects.some((p) => p.id === res.project.id)
          ? projects.map((p) => (p.id === res.project.id ? res.project : p))
          : [res.project, ...projects]
      );
      onJobsLaunched(res.jobs, res.stats);
      onNotify(
        'Đã đưa cả 5 phân cảnh (6s • 9:16) vào hàng đợi! Ngay khi tạo xong, FFmpeg sẽ tự động nối thành 1 video Full HD 30 giây.',
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi khởi chạy 5 cảnh', 'error');
    } finally {
      setLaunchingBatch(false);
    }
  };

  const handleManualStitch = async () => {
    if (!activeProjectId) return;
    setStitchingNow(true);
    try {
      const res = await stitchFactoryProjectApi(activeProjectId);
      onProjectsUpdated(
        projects.map((p) => (p.id === res.project.id ? res.project : p))
      );
      onNotify(
        `Đã nối thành công video hoàn chỉnh dài ${res.project.stitchedOutput?.durationSeconds}s Full HD!`,
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi ghép video', 'error');
    } finally {
      setStitchingNow(false);
    }
  };

  const handleLoadSavedProject = (p: FactoryProject) => {
    setActiveProjectId(p.id);
    setProductName(p.productName);
    setProductHighlights(p.productHighlights);
    setStylePreset(p.stylePreset);
    setMcOutfitPreset(p.mcOutfitPreset);
    setVideoModel(p.videoModel);
    setProductAssets(p.productAssets || []);
    setMcFaceAsset(p.mcFaceAsset || null);
    setMasterPromptUsed(p.masterPromptUsed || '');
    setScenes(p.scenes || []);
  };

  return (
    <div className="space-y-5">
      {/* Top Banner & Saved Projects Selector */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-slate-950 shadow-lg shadow-emerald-500/20">
              <Factory className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-extrabold text-white">
                  Xưởng Tạo Video Affiliate 5 Cảnh (Chuẩn Kho Xưởng AIDA 30s)
                </h2>
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/35 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                  5 Cảnh × 6s • Thoại Tiếng Việt • Tự Ghép Full HD
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-3xl">
                Tự động hoá 100% quy trình làm video bán hàng trực tiếp tại dây chuyền nhà máy: Phân tích ảnh sản phẩm → Viết kịch bản 5 cảnh AIDA kèm lời thoại tiếng Việt nhép môi → Khoá đồng nhất MC & sản phẩm 9:16 → Tự động nối FFmpeg thành 1 file MP4 `1080x1920` hoàn chỉnh không cần ghép tay trên CapCut.
              </p>
            </div>
          </div>

          {projects.length > 0 && (
            <div className="flex items-center gap-2">
              <FolderClock className="w-4 h-4 text-slate-400" />
              <select
                value={activeProjectId || ''}
                onChange={(e) => {
                  const found = projects.find((p) => p.id === e.target.value);
                  if (found) handleLoadSavedProject(found);
                }}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 max-w-[260px]"
              >
                <option value="">-- Tạo dự án 5 cảnh mới --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.status === 'completed' ? '✅ ' : '🎬 '}
                    {p.productName.slice(0, 36)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Completed or Active Stitched Master Video Showcase */}
        {activeProject &&
          (activeProject.status !== 'draft' || activeProject.stitchedOutput) && (
            <div className="rounded-2xl border border-emerald-500/40 bg-slate-950/90 p-4 flex flex-col md:flex-row items-center justify-between gap-5">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  {activeProject.status === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                  )}
                  <span className="text-sm font-extrabold text-white">
                    Trạng thái Xưởng Dựng Tự Động:
                  </span>
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-300">
                    {activeProject.statusMessage}
                  </span>
                </div>

                {activeProject.stitchedOutput && (
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <a
                      href={activeProject.stitchedOutput.downloadUrl}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg transition"
                    >
                      <Download className="w-4 h-4" />
                      Tải Video Hoàn Chỉnh ({activeProject.stitchedOutput.durationSeconds}s • Full HD MP4)
                    </a>

                    <button
                      type="button"
                      disabled={stitchingNow}
                      onClick={handleManualStitch}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${stitchingNow ? 'animate-spin' : ''}`}
                      />
                      Ghép Nối Lại (FFmpeg)
                    </button>

                    <span className="text-[11px] text-slate-400">
                      Định dạng: {activeProject.stitchedOutput.resolution} • Đã nối{' '}
                      {activeProject.stitchedOutput.sceneCount} cảnh liền mạch
                    </span>
                  </div>
                )}
              </div>

              {activeProject.stitchedOutput && (
                <div className="w-44 sm:w-48 shrink-0 rounded-xl overflow-hidden border border-emerald-500/40 bg-black shadow-2xl">
                  <video
                    key={activeProject.stitchedOutput.url}
                    src={activeProject.stitchedOutput.url}
                    controls
                    playsInline
                    className="w-full aspect-[9/16] object-cover"
                  />
                </div>
              )}
            </div>
          )}

        {/* Step 1 Form: Product + Reference Photos + Style */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-1">
          <div className="lg:col-span-7 space-y-3 rounded-xl border border-slate-800 bg-slate-950/75 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-indigo-300">
                1. Chọn hoặc Nhập Thông Tin Sản Phẩm Mẫu
              </label>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleSelectAffiliateProduct(e.target.value);
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-amber-300 font-semibold max-w-[260px]"
              >
                <option value="">⚡ Lấy nhanh từ Top Sản Phẩm Affiliate...</option>
                {affiliateProducts.map((ap) => (
                  <option key={ap.id} value={ap.id}>
                    {ap.thumbnailEmoji} {ap.name.slice(0, 45)} ({ap.commissionRatePct}%)
                  </option>
                ))}
              </select>
            </div>

            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Tên sản phẩm (VD: Ấm Siêu Tốc Inox 304 LEAMI 1.8L Công Suất 1500W)"
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
            />

            <textarea
              rows={2}
              value={productHighlights}
              onChange={(e) => setProductHighlights(e.target.value)}
              placeholder="Điểm mạnh cần nhấn mạnh trong 5 cảnh (VD: Màu kem sang trọng, lòng Inox 304 an toàn, dung tích 1.8L, công suất 1500W sôi siêu nhanh...)"
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Phong cách bối cảnh
                </label>
                <select
                  value={stylePreset}
                  onChange={(e) => setStylePreset(e.target.value as FactoryStylePreset)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                >
                  <option value="factory_conveyor">
                    🏭 Kho Xưởng & Băng Chuyền (Chuẩn Clip)
                  </option>
                  <option value="warehouse_flashsale">
                    📦 Tổng Kho Thùng Hàng Xả Sỉ
                  </option>
                  <option value="home_real_pov">
                    🏡 Trải Nghiệm Thực Tế Tại Nhà
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Trang phục MC nữ đồng nhất
                </label>
                <select
                  value={mcOutfitPreset}
                  onChange={(e) => setMcOutfitPreset(e.target.value as McOutfitPreset)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                >
                  <option value="cream_polo">👕 Áo Polo Kem + Quần Âu Đen</option>
                  <option value="navy_workwear">🧥 Áo Kỹ Thuật Xưởng Xanh Navy</option>
                  <option value="brand_shirt">👔 Áo Sơ Mi Trắng Thanh Lịch</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Model render 6s (Nhép môi Việt)
                </label>
                <select
                  value={videoModel}
                  onChange={(e) => setVideoModel(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-slate-100"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Reference Images Tray (5 Product Photos + 1 MC Face) */}
          <div className="lg:col-span-5 space-y-3 rounded-xl border border-slate-800 bg-slate-950/75 p-4 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <ImagePlus className="w-4 h-4" />
                  2. Khay Ảnh Mẫu Giữ Đồng Nhất 100%
                </span>
                {uploadingRef && (
                  <span className="text-[11px] text-amber-300 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Đang tải...
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Tải <strong>1–5 ảnh sản phẩm chụp từ Shopee/TikTok</strong> (mặt trước, lòng trong, cầm tay) và <strong>1 ảnh mặt MC nữ</strong> nếu muốn khoá gương mặt xuyên suốt 5 cảnh.
              </p>

              <div className="flex flex-wrap gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-2 text-xs font-bold text-indigo-200 transition">
                  <Upload className="w-3.5 h-3.5" />
                  Ảnh Sản Phẩm ({productAssets.length}/5)
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleUploadProductPhotos}
                    className="hidden"
                  />
                </label>

                <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-pink-500/40 bg-pink-500/10 hover:bg-pink-500/20 px-3 py-2 text-xs font-bold text-pink-200 transition">
                  <UserCheck className="w-3.5 h-3.5" />
                  {mcFaceAsset ? 'Đổi Ảnh Mặt MC' : 'Ảnh Mặt MC Nữ'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadMcPhoto}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Thumbnails Preview */}
              {(productAssets.length > 0 || mcFaceAsset) && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {productAssets.map((a, i) => (
                    <div
                      key={a.id}
                      className="relative group h-14 w-14 rounded-lg overflow-hidden border border-slate-700 bg-slate-900"
                    >
                      <img
                        src={a.url}
                        alt={a.originalName}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setProductAssets((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        className="opacity-0 group-hover:opacity-100 absolute top-0.5 right-0.5 rounded bg-rose-600 p-0.5 text-white"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}

                  {mcFaceAsset && (
                    <div className="relative group h-14 w-14 rounded-lg overflow-hidden border-2 border-pink-500 bg-slate-900">
                      <img
                        src={mcFaceAsset.url}
                        alt="MC Reference"
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute bottom-0 inset-x-0 bg-pink-600/90 text-[9px] text-center font-bold text-white">
                        MC Mẫu
                      </span>
                      <button
                        type="button"
                        onClick={() => setMcFaceAsset(null)}
                        className="opacity-0 group-hover:opacity-100 absolute top-0.5 right-0.5 rounded bg-rose-600 p-0.5 text-white"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={generatingScript}
              onClick={handleGenerate5SceneScript}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 px-4 py-3 text-xs font-extrabold text-slate-950 shadow-lg shadow-emerald-500/20 transition"
            >
              {generatingScript ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang phân tích sản phẩm & viết 5 phân cảnh AIDA...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Bước 1: Sinh Kịch Bản 5 Cảnh AIDA + Thoại Tiếng Việt (30s)
                </>
              )}
            </button>
          </div>
        </div>

        {/* Optional Master Prompt Inspector */}
        {masterPromptUsed && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowMasterPrompt((v) => !v)}
              className="text-[11px] font-semibold text-slate-400 hover:text-indigo-300 underline"
            >
              {showMasterPrompt
                ? 'Ẩn Câu Lệnh Master Gốc (Chuẩn Xuân Chiến AI)'
                : 'Xem Câu Lệnh Master Gốc Đã Dùng Để Tạo Kịch Bản'}
            </button>
            {showMasterPrompt && (
              <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950 p-3 flex items-start justify-between gap-3">
                <p className="text-[11px] text-slate-300 font-mono leading-relaxed">
                  {masterPromptUsed}
                </p>
                <button
                  type="button"
                  onClick={() => copyText(masterPromptUsed, 'master')}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200"
                >
                  {copiedKey === 'master' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" /> Đã chép
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 2 & Step 3: 5-Scene Storyboard Editor & One-Click Auto-Stitch Launcher */}
      {scenes.length > 0 && (
        <div className="space-y-4">
          {/* Action Bar */}
          <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/90 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
                <Film className="w-5 h-5 text-indigo-400" />
                Bảng Phân Cảnh Chi Tiết ({scenes.length} Cảnh × 6 Giây ={' '}
                {scenes.length * 6} Giây Full HD)
              </h3>
              <p className="text-xs text-slate-400">
                Bạn có thể chỉnh sửa trực tiếp lời thoại tiếng Việt từng cảnh bên dưới trước khi bấm chạy tự động.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {!isCloudMode && (
                <button
                  type="button"
                  disabled={generatingFrames}
                  onClick={handleGenerateKeyframes}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 px-3.5 py-2.5 text-xs font-bold text-amber-200 transition"
                >
                  {generatingFrames ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Đang tạo 5 ảnh 9:16...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      Bước 2: Tạo 5 Ảnh Gốc 9:16 Đồng Nhất
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                disabled={launchingBatch}
                onClick={handleLaunchAutoRenderAndStitch}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-indigo-600/25 transition"
              >
                {launchingBatch ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang đưa vào hàng đợi...
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" />
                    {isCloudMode
                      ? 'Đẩy Cả 5 Cảnh (6s • 9:16) Sang Trình Tạo Video'
                      : 'Bước 3: Tự Động Tạo 5 Cảnh & Ghép MP4 30s Full HD'}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 5 Scene Cards */}
          <div className="grid grid-cols-1 gap-4">
            {scenes.map((scene, idx) => {
              const linkedJob = scene.linkedJobId
                ? jobs.find((j) => j.id === scene.linkedJobId)
                : undefined;
              const finishedVideoUrl =
                linkedJob?.status === 'completed' && linkedJob.outputs[0]
                  ? linkedJob.outputs[0].url
                  : null;

              return (
                <div
                  key={scene.sceneNumber}
                  className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4"
                >
                  {/* Left column: Visual 9:16 Keyframe or Rendered 6s Clip */}
                  <div className="lg:col-span-3 flex flex-col items-center justify-between gap-2.5 rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="w-full flex items-center justify-between">
                      <span className="rounded-lg bg-indigo-600 px-2.5 py-0.5 text-xs font-black text-white">
                        Cảnh #{scene.sceneNumber} (6s)
                      </span>
                      {idx > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                          <Link2 className="w-3 h-3" /> Neo Cảnh 1
                        </span>
                      )}
                    </div>

                    {finishedVideoUrl ? (
                      <video
                        src={finishedVideoUrl}
                        controls
                        playsInline
                        className="w-36 aspect-[9/16] rounded-lg object-cover border border-emerald-500/40 bg-black"
                      />
                    ) : scene.keyframeAsset ? (
                      <img
                        src={scene.keyframeAsset.url}
                        alt={scene.title}
                        className="w-36 aspect-[9/16] rounded-lg object-cover border border-slate-700"
                      />
                    ) : (
                      <div className="w-36 aspect-[9/16] rounded-lg border border-dashed border-slate-700 bg-slate-900/70 flex flex-col items-center justify-center p-3 text-center text-[11px] text-slate-500">
                        <Clapperboard className="w-6 h-6 mb-1.5 text-slate-600" />
                        Khung đầu 9:16
                        <span className="text-[10px] mt-1">
                          (Bấm Bước 2 hoặc tải ảnh riêng)
                        </span>
                      </div>
                    )}

                    <div className="w-full space-y-1.5">
                      {linkedJob && (
                        <div className="text-center text-[11px] font-semibold text-amber-300 truncate">
                          {linkedJob.status === 'completed' ? (
                            <span className="text-emerald-400 flex items-center justify-center gap-1">
                              <Play className="w-3 h-3" /> Đã render xong 6s
                            </span>
                          ) : (
                            `${linkedJob.statusMessage || linkedJob.status} (${linkedJob.progress}%)`
                          )}
                        </div>
                      )}

                      <label className="w-full cursor-pointer inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition">
                        <Upload className="w-3 h-3" />
                        Tải ảnh khung đầu riêng
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleUploadSceneFrame(idx, e)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Right column: AIDA Role, Dialogue, Image Prompt & 3-Block Video Prompt */}
                  <div className="lg:col-span-9 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400">
                          {scene.aidaStage}
                        </span>
                        <h4 className="text-sm font-bold text-white">{scene.title}</h4>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        🎥 {scene.cameraAngle}
                      </span>
                    </div>

                    {/* Spoken Vietnamese 6s Dialogue */}
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold text-emerald-300">
                          🗣️ Lời thoại MC nữ nói tiếng Việt (Nhép môi tự nhiên 6 giây):
                        </label>
                        <span className="text-[10px] text-slate-400">
                          {scene.spokenDialogueVi.trim().split(/\s+/).filter(Boolean).length} chữ
                          (Chuẩn 14–20 chữ / 6s)
                        </span>
                      </div>
                      <input
                        type="text"
                        value={scene.spokenDialogueVi}
                        onChange={(e) =>
                          updateSceneField(idx, { spokenDialogueVi: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-emerald-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Nano Banana Pro 9:16 Image Prompt */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-300">
                            🖼️ Câu lệnh Tạo Ảnh 9:16 (Nano Banana Pro):
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(scene.imagePrompt916, `img-${scene.sceneNumber}`)
                            }
                            className="inline-flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-200"
                          >
                            {copiedKey === `img-${scene.sceneNumber}` ? (
                              <>
                                <Check className="w-2.5 h-2.5 text-emerald-400" /> Đã chép
                              </>
                            ) : (
                              <>
                                <Copy className="w-2.5 h-2.5" /> Copy
                              </>
                            )}
                          </button>
                        </div>
                        <textarea
                          rows={4}
                          value={scene.imagePrompt916}
                          onChange={(e) =>
                            updateSceneField(idx, { imagePrompt916: e.target.value })
                          }
                          className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-[11px] text-slate-300 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      {/* 3-Block 6s Omni/Flow Video Prompt */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-indigo-300">
                            🎬 Câu lệnh Tạo Video 6s (3 Khối Chuẩn Omni/Flow):
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(scene.videoPrompt6s, `vid-${scene.sceneNumber}`)
                            }
                            className="inline-flex items-center gap-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 px-2 py-0.5 text-[10px] font-semibold text-indigo-200"
                          >
                            {copiedKey === `vid-${scene.sceneNumber}` ? (
                              <>
                                <Check className="w-2.5 h-2.5 text-emerald-400" /> Đã chép
                              </>
                            ) : (
                              <>
                                <Copy className="w-2.5 h-2.5" /> Copy
                              </>
                            )}
                          </button>
                        </div>
                        <textarea
                          rows={4}
                          value={scene.videoPrompt6s}
                          onChange={(e) =>
                            updateSceneField(idx, { videoPrompt6s: e.target.value })
                          }
                          className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
