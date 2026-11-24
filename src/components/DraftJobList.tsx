import React, { useRef, useState } from 'react';
import {
  Copy,
  FilePlus2,
  Film,
  ImagePlus,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  ASPECT_RATIO_OPTIONS,
  DURATION_OPTIONS,
  INPUT_TYPE_OPTIONS,
  MODEL_OPTIONS,
  SAMPLE_PROMPTS,
  type AspectRatio,
  type DraftJob,
  type InputType,
  type UploadedAsset,
} from '../types';
import { uploadImageFile } from '../api';
import { BulkImportModal } from './BulkImportModal';

interface DraftJobListProps {
  drafts: DraftJob[];
  setDrafts: React.Dispatch<React.SetStateAction<DraftJob[]>>;
  onSubmitBatch: () => Promise<void>;
  submitting: boolean;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function createEmptyDraft(
  overrides?: Partial<Omit<DraftJob, 'localId'>>
): DraftJob {
  return {
    localId: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    selected: false,
    prompt: '',
    inputType: 'text_to_video',
    model: 'veo-3.0-fast-generate-001',
    aspectRatio: '16:9',
    outputCount: 1,
    durationSeconds: 8,
    imageAsset: null,
    firstFrameAsset: null,
    lastFrameAsset: null,
    ...overrides,
  };
}

export const DraftJobList: React.FC<DraftJobListProps> = ({
  drafts,
  setDrafts,
  onSubmitBatch,
  submitting,
  onNotify,
}) => {
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkInputType, setBulkInputType] = useState<InputType>('text_to_video');
  const [bulkModel, setBulkModel] = useState<string>('veo-3.0-fast-generate-001');
  const [bulkRatio, setBulkRatio] = useState<AspectRatio>('16:9');
  const [bulkDuration, setBulkDuration] = useState<number>(8);
  const [bulkCount, setBulkCount] = useState<number>(1);
  const [uploadingBatchImages, setUploadingBatchImages] = useState(false);
  const multiImageInputRef = useRef<HTMLInputElement | null>(null);

  const selectedCount = drafts.filter((d) => d.selected).length;
  const totalOutputs = drafts.reduce((acc, d) => acc + (Number(d.outputCount) || 1), 0);

  const updateDraft = (localId: string, patch: Partial<DraftJob>) => {
    setDrafts((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item))
    );
  };

  const addSingleRow = () => {
    setDrafts((prev) => [
      ...prev,
      createEmptyDraft({
        inputType: bulkInputType,
        model: bulkModel,
        aspectRatio: bulkRatio,
        durationSeconds: bulkDuration,
        outputCount: bulkCount,
      }),
    ]);
  };

  const duplicateRow = (index: number) => {
    setDrafts((prev) => {
      const target = prev[index];
      if (!target) return prev;
      const copy: DraftJob = {
        ...target,
        localId: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        selected: false,
      };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  };

  const removeRow = (localId: string) => {
    setDrafts((prev) => {
      const next = prev.filter((d) => d.localId !== localId);
      return next.length > 0 ? next : [createEmptyDraft()];
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setDrafts((prev) => prev.map((d) => ({ ...d, selected: checked })));
  };

  const applyBulkSettings = () => {
    const applyToSelectedOnly = selectedCount > 0;
    setDrafts((prev) =>
      prev.map((d) => {
        if (applyToSelectedOnly && !d.selected) return d;
        return {
          ...d,
          inputType: bulkInputType,
          model: bulkModel,
          aspectRatio: bulkRatio,
          durationSeconds: bulkDuration,
          outputCount: bulkCount,
        };
      })
    );
    onNotify(
      applyToSelectedOnly
        ? `Đã áp dụng thông số cho ${selectedCount} job đang chọn!`
        : `Đã áp dụng thông số mặc định cho toàn bộ ${drafts.length} job!`,
      'success'
    );
  };

  const generateSampleBatch = (count = 10) => {
    const ratios: AspectRatio[] = ['16:9', '9:16', '1:1'];
    const models = ['veo-3.0-fast-generate-001', 'veo-2.0-generate-001', 'veo-3.1-fast-generate-preview'];
    const sampleJobs: DraftJob[] = Array.from({ length: count }, (_, idx) =>
      createEmptyDraft({
        prompt: SAMPLE_PROMPTS[idx % SAMPLE_PROMPTS.length],
        inputType: 'text_to_video',
        model: models[idx % models.length],
        aspectRatio: ratios[idx % ratios.length],
        durationSeconds: 8,
        outputCount: idx % 4 === 0 ? 2 : 1,
      })
    );

    setDrafts((prev) => {
      const allBlank = prev.every(
        (r) => !r.prompt.trim() && !r.imageAsset && !r.firstFrameAsset && !r.lastFrameAsset
      );
      return allBlank ? sampleJobs : [...prev, ...sampleJobs];
    });
    onNotify(`Đã tạo nhanh ${count} job mẫu (8 giây/video)! Nhấn Submit để chạy ngay.`, 'success');
  };

  const handleSingleAssetUpload = async (
    localId: string,
    field: 'image' | 'firstFrame' | 'lastFrame',
    file: File
  ) => {
    updateDraft(localId, { uploadingField: field });
    try {
      const asset: UploadedAsset = await uploadImageFile(file);
      if (field === 'image') {
        updateDraft(localId, { imageAsset: asset, uploadingField: null });
      } else if (field === 'firstFrame') {
        updateDraft(localId, { firstFrameAsset: asset, uploadingField: null });
      } else {
        updateDraft(localId, { lastFrameAsset: asset, uploadingField: null });
      }
    } catch (err) {
      updateDraft(localId, { uploadingField: null });
      onNotify(err instanceof Error ? err.message : 'Lỗi upload ảnh', 'error');
    }
  };

  const handleBatchImagesToJobs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    setUploadingBatchImages(true);
    try {
      const createdDrafts: DraftJob[] = [];
      for (const file of files) {
        const asset = await uploadImageFile(file);
        const cleanTitle = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        createdDrafts.push(
          createEmptyDraft({
            prompt: `Chuyển động điện ảnh mượt mà tự nhiên cho cảnh: ${cleanTitle}`,
            inputType: 'image_to_video',
            model: bulkModel,
            aspectRatio: bulkRatio,
            durationSeconds: bulkDuration,
            outputCount: bulkCount,
            imageAsset: asset,
          })
        );
      }

      setDrafts((prev) => {
        const allBlank = prev.every(
          (r) => !r.prompt.trim() && !r.imageAsset && !r.firstFrameAsset && !r.lastFrameAsset
        );
        return allBlank ? createdDrafts : [...prev, ...createdDrafts];
      });
      onNotify(`Đã upload ${files.length} ảnh và tạo ${files.length} job Tạo video từ Hình ảnh!`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi upload hàng loạt ảnh', 'error');
    } finally {
      setUploadingBatchImages(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Action & Bulk Defaults Bar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Film className="w-5 h-5 text-indigo-400" />
              Danh Sách Job Chuẩn Bị Submit ({drafts.length} job)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Hỗ trợ nhập hàng loạt 20–50+ jobs cùng lúc, tuỳ chỉnh riêng từng dòng và chỉ cần nhấn Submit một lần duy nhất.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 px-3.5 py-2 text-xs font-semibold text-indigo-200 transition"
            >
              <FilePlus2 className="w-4 h-4 text-indigo-400" />
              Nhập hàng loạt (Prompts / CSV)
            </button>

            <input
              ref={multiImageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleBatchImagesToJobs}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploadingBatchImages}
              onClick={() => multiImageInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 transition disabled:opacity-50"
            >
              {uploadingBatchImages ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              ) : (
                <ImagePlus className="w-4 h-4 text-emerald-400" />
              )}
              Upload nhiều ảnh → N Jobs
            </button>

            <button
              type="button"
              onClick={() => generateSampleBatch(10)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-3.5 py-2 text-xs font-medium text-amber-200 transition"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              +10 Job mẫu thử nhanh
            </button>

            {drafts.length > 1 && (
              <button
                type="button"
                onClick={() => setDrafts([createEmptyDraft()])}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-2 text-xs font-medium text-rose-300 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Làm mới bảng
              </button>
            )}
          </div>
        </div>

        {/* Global / Selected Bulk Parameter Bar */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-950/70 border border-slate-800/90 p-3">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Loại Input chung
            </label>
            <select
              value={bulkInputType}
              onChange={(e) => setBulkInputType(e.target.value as InputType)}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100"
            >
              {INPUT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[150px]">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Model chung
            </label>
            <select
              value={bulkModel}
              onChange={(e) => setBulkModel(e.target.value)}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-32">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Tỉ lệ khung hình
            </label>
            <select
              value={bulkRatio}
              onChange={(e) => setBulkRatio(e.target.value as AspectRatio)}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100"
            >
              {ASPECT_RATIO_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-32">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Thời lượng
            </label>
            <select
              value={bulkDuration}
              onChange={(e) => setBulkDuration(Number(e.target.value))}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-24">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Số đầu ra
            </label>
            <input
              type="number"
              min={1}
              max={8}
              value={bulkCount}
              onChange={(e) => setBulkCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100"
            />
          </div>

          <button
            type="button"
            onClick={applyBulkSettings}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 border border-slate-700 hover:border-indigo-500 px-3.5 py-1.5 text-xs font-medium text-slate-100 transition"
          >
            <Wand2 className="w-3.5 h-3.5" />
            {selectedCount > 0
              ? `Áp dụng cho ${selectedCount} job đã chọn`
              : `Áp dụng cho tất cả (${drafts.length})`}
          </button>
        </div>
      </div>

      {/* Interactive Job Rows Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 shadow-lg overflow-hidden">
        {/* Table Header */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-2.5 items-center bg-slate-950/90 border-b border-slate-800 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <div className="col-span-1 flex items-center gap-2">
            <input
              type="checkbox"
              checked={drafts.length > 0 && selectedCount === drafts.length}
              onChange={(e) => toggleSelectAll(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-indigo-600"
            />
            <span>#</span>
          </div>
          <div className="col-span-4">Prompt (Nội dung mô tả)</div>
          <div className="col-span-2">Loại Input & Ảnh</div>
          <div className="col-span-2">Model AI</div>
          <div className="col-span-1">Tỉ lệ & Giây</div>
          <div className="col-span-1 text-center">Đầu ra</div>
          <div className="col-span-1 text-right">Thao tác</div>
        </div>

        {/* Rows List */}
        <div className="divide-y divide-slate-800/80 max-h-[58vh] overflow-y-auto">
          {drafts.map((job, idx) => (
            <div
              key={job.localId}
              className={`p-4 transition ${
                job.selected ? 'bg-indigo-950/20' : 'hover:bg-slate-800/30'
              }`}
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-start">
                <div className="lg:col-span-1 flex items-center gap-2 pt-1.5">
                  <input
                    type="checkbox"
                    checked={job.selected}
                    onChange={(e) => updateDraft(job.localId, { selected: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-600"
                  />
                  <span className="inline-flex items-center justify-center rounded-md bg-slate-800 px-2 py-0.5 text-xs font-mono font-semibold text-slate-300">
                    #{idx + 1}
                  </span>
                </div>

                <div className="lg:col-span-4">
                  <textarea
                    rows={2}
                    value={job.prompt}
                    onChange={(e) => updateDraft(job.localId, { prompt: e.target.value })}
                    placeholder={
                      job.inputType === 'text_to_video'
                        ? 'Nhập mô tả cảnh quay chi tiết (ánh sáng, góc máy, chuyển động)...'
                        : 'Mô tả chuyển động mong muốn cho hình ảnh / khung hình...'
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700/90 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 resize-y"
                  />
                </div>

                <div className="lg:col-span-2 space-y-2">
                  <select
                    value={job.inputType}
                    onChange={(e) =>
                      updateDraft(job.localId, { inputType: e.target.value as InputType })
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700/90 px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    {INPUT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {job.inputType === 'image_to_video' && (
                    <AssetUploadBox
                      label="Upload ảnh gốc"
                      asset={job.imageAsset}
                      loading={job.uploadingField === 'image'}
                      onSelectFile={(file) => handleSingleAssetUpload(job.localId, 'image', file)}
                      onClear={() => updateDraft(job.localId, { imageAsset: null })}
                    />
                  )}

                  {job.inputType === 'frames_to_video' && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <AssetUploadBox
                        label="Khung đầu"
                        asset={job.firstFrameAsset}
                        loading={job.uploadingField === 'firstFrame'}
                        onSelectFile={(file) =>
                          handleSingleAssetUpload(job.localId, 'firstFrame', file)
                        }
                        onClear={() => updateDraft(job.localId, { firstFrameAsset: null })}
                      />
                      <AssetUploadBox
                        label="Khung cuối"
                        asset={job.lastFrameAsset}
                        loading={job.uploadingField === 'lastFrame'}
                        onSelectFile={(file) =>
                          handleSingleAssetUpload(job.localId, 'lastFrame', file)
                        }
                        onClear={() => updateDraft(job.localId, { lastFrameAsset: null })}
                      />
                    </div>
                  )}
                </div>

                <div className="lg:col-span-2">
                  <select
                    value={job.model}
                    onChange={(e) => updateDraft(job.localId, { model: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700/90 px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                    {!MODEL_OPTIONS.some((m) => m.value === job.model) && (
                      <option value={job.model}>{job.model}</option>
                    )}
                  </select>
                </div>

                {/* Aspect Ratio + Duration stacked cleanly */}
                <div className="lg:col-span-1 flex lg:flex-col gap-1.5">
                  <select
                    value={job.aspectRatio}
                    onChange={(e) =>
                      updateDraft(job.localId, { aspectRatio: e.target.value as AspectRatio })
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700/90 px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    {ASPECT_RATIO_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.value}
                      </option>
                    ))}
                  </select>

                  <select
                    value={job.durationSeconds || 8}
                    onChange={(e) =>
                      updateDraft(job.localId, { durationSeconds: Number(e.target.value) })
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700/90 px-2 py-1 text-[11px] text-indigo-300 focus:outline-none focus:border-indigo-500"
                  >
                    {DURATION_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.value}s
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lg:col-span-1">
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={job.outputCount}
                    onChange={(e) =>
                      updateDraft(job.localId, {
                        outputCount: Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700/90 px-2.5 py-2 text-center text-xs font-semibold text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="lg:col-span-1 flex items-center justify-end gap-1 pt-1">
                  <button
                    type="button"
                    title="Nhân bản dòng này"
                    onClick={() => duplicateRow(idx)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-indigo-300 transition"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title="Xoá dòng này"
                    onClick={() => removeRow(job.localId)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer Add Row & Submit Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 bg-slate-950/90 px-5 py-4">
          <button
            type="button"
            onClick={addSingleRow}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-600 hover:border-indigo-400 bg-slate-900 hover:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition"
          >
            <Plus className="w-4 h-4 text-indigo-400" />
            Thêm 1 dòng Job mới
          </button>

          <div className="flex flex-wrap items-center gap-4">
            <div className="text-right text-xs text-slate-400">
              <div>
                Tổng cộng: <strong className="text-white">{drafts.length} jobs</strong> •{' '}
                <strong className="text-indigo-300">{totalOutputs} video đầu ra</strong>
              </div>
              <div className="text-[11px] text-slate-500">
                Tự động điều phối tuần tự & tự chuyển đổi dự phòng khi hết hạn mức
              </div>
            </div>

            <button
              type="button"
              disabled={submitting || drafts.length === 0}
              onClick={onSubmitBatch}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitting
                ? 'Đang gửi vào hàng đợi...'
                : `Submit ${drafts.length} Jobs Vào Hàng Đợi`}
            </button>
          </div>
        </div>
      </div>

      <BulkImportModal
        isOpen={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        onImport={(imported, replace) => {
          setDrafts((prev) => {
            if (replace) return imported;
            const allBlank = prev.every(
              (r) => !r.prompt.trim() && !r.imageAsset && !r.firstFrameAsset && !r.lastFrameAsset
            );
            return allBlank ? imported : [...prev, ...imported];
          });
          onNotify(`Đã nhập thành công ${imported.length} jobs vào danh sách!`, 'success');
        }}
        defaultSettings={{
          inputType: bulkInputType,
          model: bulkModel,
          aspectRatio: bulkRatio,
          outputCount: bulkCount,
          durationSeconds: bulkDuration,
        }}
      />
    </div>
  );
};

interface AssetUploadBoxProps {
  label: string;
  asset: UploadedAsset | null;
  loading: boolean;
  onSelectFile: (file: File) => void;
  onClear: () => void;
}

const AssetUploadBox: React.FC<AssetUploadBoxProps> = ({
  label,
  asset,
  loading,
  onSelectFile,
  onClear,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (asset) {
    return (
      <div className="relative group rounded-lg border border-slate-700 bg-slate-950 overflow-hidden flex items-center gap-2 p-1.5">
        <img
          src={asset.url}
          alt={asset.originalName}
          className="w-9 h-9 rounded object-cover shrink-0 bg-slate-900"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium text-emerald-400 truncate">{label}</div>
          <div className="text-[10px] text-slate-400 truncate" title={asset.originalName}>
            {asset.originalName}
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          title="Xoá ảnh"
          className="rounded-md p-1 text-slate-400 hover:bg-rose-950 hover:text-rose-400 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onSelectFile(f);
        }}
        className="hidden"
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 hover:border-indigo-400 bg-slate-950/70 hover:bg-slate-900 px-2 py-2 text-[11px] font-medium text-slate-300 transition"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        ) : (
          <Upload className="w-3.5 h-3.5 text-indigo-400" />
        )}
        <span className="truncate">{loading ? 'Đang tải...' : label}</span>
      </button>
    </div>
  );
};
