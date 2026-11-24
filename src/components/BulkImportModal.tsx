import React, { useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Plus, X } from 'lucide-react';
import {
  ASPECT_RATIO_OPTIONS,
  DURATION_OPTIONS,
  INPUT_TYPE_OPTIONS,
  MODEL_OPTIONS,
  type AspectRatio,
  type DraftJob,
  type InputType,
} from '../types';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (jobs: DraftJob[], replaceExisting: boolean) => void;
  defaultSettings: {
    inputType: InputType;
    model: string;
    aspectRatio: AspectRatio;
    outputCount: number;
    durationSeconds: number;
  };
}

function makeLocalId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  defaultSettings,
}) => {
  const [rawText, setRawText] = useState('');
  const [inputType, setInputType] = useState<InputType>(defaultSettings.inputType);
  const [model, setModel] = useState<string>(defaultSettings.model);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(defaultSettings.aspectRatio);
  const [outputCount, setOutputCount] = useState<number>(defaultSettings.outputCount);
  const [durationSeconds, setDurationSeconds] = useState<number>(defaultSettings.durationSeconds || 8);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const parsedLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const handleAddFromText = () => {
    if (parsedLines.length === 0) return;
    const jobs: DraftJob[] = parsedLines.map((prompt) => ({
      localId: makeLocalId(),
      selected: false,
      prompt,
      inputType,
      model,
      aspectRatio,
      outputCount,
      durationSeconds,
      imageAsset: null,
      firstFrameAsset: null,
      lastFrameAsset: null,
    }));
    onImport(jobs, replaceExisting);
    setRawText('');
    onClose();
  };

  const handleCsvOrJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    e.target.value = '';

    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const arr = JSON.parse(text);
        if (Array.isArray(arr)) {
          const jobs: DraftJob[] = arr
            .filter((item) => item && typeof item.prompt === 'string' && item.prompt.trim())
            .map((item) => ({
              localId: makeLocalId(),
              selected: false,
              prompt: String(item.prompt).trim(),
              inputType: (item.inputType as InputType) || inputType,
              model: item.model || model,
              aspectRatio: (item.aspectRatio as AspectRatio) || aspectRatio,
              outputCount: Math.max(1, Math.min(8, Number(item.outputCount) || outputCount)),
              durationSeconds: Math.max(4, Math.min(12, Number(item.durationSeconds) || durationSeconds)),
              imageAsset: null,
              firstFrameAsset: null,
              lastFrameAsset: null,
            }));
          if (jobs.length > 0) {
            onImport(jobs, replaceExisting);
            onClose();
          }
        }
      } catch {
        alert('File JSON không hợp lệ.');
      }
      return;
    }

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    const jobs: DraftJob[] = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (i === 0 && cols[0]?.toLowerCase() === 'prompt') {
        continue;
      }
      const prompt = cols[0] || '';
      if (!prompt) continue;

      const rowInputType =
        cols[1] === 'text_to_video' ||
        cols[1] === 'image_to_video' ||
        cols[1] === 'frames_to_video'
          ? (cols[1] as InputType)
          : inputType;

      const rowModel = cols[2] || model;
      const rowRatio =
        cols[3] === '16:9' ||
        cols[3] === '9:16' ||
        cols[3] === '1:1' ||
        cols[3] === '4:3' ||
        cols[3] === '3:4'
          ? (cols[3] as AspectRatio)
          : aspectRatio;
      const rowCount = Math.max(1, Math.min(8, Number(cols[4]) || outputCount));
      const rowDur = Math.max(4, Math.min(12, Number(cols[5]) || durationSeconds));

      jobs.push({
        localId: makeLocalId(),
        selected: false,
        prompt,
        inputType: rowInputType,
        model: rowModel,
        aspectRatio: rowRatio,
        outputCount: rowCount,
        durationSeconds: rowDur,
        imageAsset: null,
        firstFrameAsset: null,
        lastFrameAsset: null,
      });
    }

    if (jobs.length > 0) {
      onImport(jobs, replaceExisting);
      onClose();
    }
  };

  const downloadCsvTemplate = () => {
    const csvContent = [
      'prompt,inputType,model,aspectRatio,outputCount,durationSeconds',
      '"Flycam vịnh Hạ Long buổi bình minh nắng vàng 4K",text_to_video,veo-3.0-fast-generate-001,16:9,1,8',
      '"Chú mèo phi hành gia dạo bước trên sao Hỏa",text_to_video,veo-3.0-fast-generate-001,9:16,2,8',
      '"Cận cảnh ly trà đào cam sả mát lạnh mùa hè",image_to_video,veo-2.0-generate-001,1:1,1,8',
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mau_danh_sach_jobs_veo.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-base font-semibold text-white">
                Nhập Nhanh Hàng Loạt (20 – 50+ Jobs)
              </h3>
              <p className="text-xs text-slate-400">
                Dán danh sách prompt (mỗi dòng 1 job) hoặc tải lên file CSV / JSON
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl bg-slate-950/80 border border-slate-800 p-3.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Loại Input
              </label>
              <select
                value={inputType}
                onChange={(e) => setInputType(e.target.value as InputType)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
              >
                {INPUT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.shortLabel}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Model mặc định
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Tỉ lệ khung hình
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
              >
                {ASPECT_RATIO_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Thời lượng
              </label>
              <select
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.value}s
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Số đầu ra (1-8)
              </label>
              <input
                type="number"
                min={1}
                max={8}
                value={outputCount}
                onChange={(e) =>
                  setOutputCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))
                }
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-200">
                Dán danh sách Prompt (Mỗi dòng tương ứng 1 Job)
              </label>
              <span className="text-xs font-semibold text-indigo-400">
                Đã nhận diện: {parsedLines.length} job
              </span>
            </div>
            <textarea
              rows={8}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`Ví dụ:\nCảnh bình minh trên đỉnh núi Tà Xùa biển mây bồng bềnh, quay flycam 4K\nChú chó Corgi chạy tung tăng trên bãi cỏ xanh dưới nắng chiều\nThành phố tương lai cyberpunk lúc nửa đêm rực rỡ ánh đèn neon...`}
              className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/50 px-4 py-3">
            <div className="flex items-center gap-2.5 text-xs text-slate-300">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Hoặc import trực tiếp từ file <strong>.CSV</strong> / <strong>.JSON</strong> có thông số riêng từng dòng
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadCsvTemplate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-200 transition"
              >
                <Download className="w-3.5 h-3.5" />
                Tải CSV mẫu
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                onChange={handleCsvOrJsonUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition"
              >
                Chọn file CSV / JSON
              </button>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-indigo-600"
            />
            Thay thế toàn bộ danh sách nháp hiện tại
          </label>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-800 bg-slate-950/60 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
          >
            Huỷ
          </button>
          <button
            type="button"
            disabled={parsedLines.length === 0}
            onClick={handleAddFromText}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-5 py-2 text-xs font-semibold text-white shadow-lg transition"
          >
            <Plus className="w-4 h-4" />
            Thêm {parsedLines.length} Jobs Vào Bảng Chỉnh Sửa
          </button>
        </div>
      </div>
    </div>
  );
};
