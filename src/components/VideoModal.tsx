import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Maximize2,
  X,
} from 'lucide-react';
import { INPUT_TYPE_OPTIONS, MODEL_OPTIONS, type VideoJob } from '../types';

interface VideoModalProps {
  job: VideoJob | null;
  initialOutputIndex?: number;
  onClose: () => void;
  onNavigateJob?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export const VideoModal: React.FC<VideoModalProps> = ({
  job,
  initialOutputIndex = 1,
  onClose,
  onNavigateJob,
  hasPrev = false,
  hasNext = false,
}) => {
  const [activeIndex, setActiveIndex] = useState(initialOutputIndex);

  useEffect(() => {
    setActiveIndex(initialOutputIndex);
  }, [job?.id, initialOutputIndex]);

  useEffect(() => {
    if (!job) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev && onNavigateJob) onNavigateJob('prev');
      if (e.key === 'ArrowRight' && hasNext && onNavigateJob) onNavigateJob('next');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [job, hasPrev, hasNext, onClose, onNavigateJob]);

  if (!job || job.outputs.length === 0) return null;

  const currentOut =
    job.outputs.find((o) => o.index === activeIndex) || job.outputs[0];

  const modelLabel =
    MODEL_OPTIONS.find((m) => m.value === job.model)?.label || job.model;
  const inputTypeLabel =
    INPUT_TYPE_OPTIONS.find((i) => i.value === job.inputType)?.label || job.inputType;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-4 bg-slate-950/80">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 px-2.5 py-1 text-xs font-mono font-bold text-indigo-300 shrink-0">
              <Film className="w-3.5 h-3.5" />
              Job #{job.seq}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">
                {modelLabel} • Tỉ lệ {job.aspectRatio} • {inputTypeLabel}
              </h3>
              <p className="text-xs text-slate-400 truncate">{job.prompt}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={currentOut.downloadUrl}
              download
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white shadow transition"
            >
              <Download className="w-3.5 h-3.5" />
              Tải Video #{currentOut.index}
            </a>
            <a
              href={currentOut.url}
              target="_blank"
              rel="noreferrer"
              title="Mở tab mới"
              className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 p-2 text-slate-300 transition"
            >
              <Maximize2 className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-rose-600 p-2 text-slate-300 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Stage */}
        <div className="relative flex-1 bg-black flex items-center justify-center min-h-[320px] max-h-[65vh] p-4">
          {hasPrev && onNavigateJob && (
            <button
              type="button"
              onClick={() => onNavigateJob('prev')}
              title="Job hoàn thành trước đó"
              className="absolute left-4 z-10 rounded-full bg-slate-900/80 hover:bg-indigo-600 border border-slate-700 p-2.5 text-white shadow-lg transition"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          <video
            key={currentOut.url}
            src={currentOut.url}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-[60vh] max-w-full rounded-xl shadow-2xl border border-slate-800"
          />

          {hasNext && onNavigateJob && (
            <button
              type="button"
              onClick={() => onNavigateJob('next')}
              title="Job hoàn thành tiếp theo"
              className="absolute right-4 z-10 rounded-full bg-slate-900/80 hover:bg-indigo-600 border border-slate-700 p-2.5 text-white shadow-lg transition"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Multiple Output Switcher & Full Prompt Details */}
        <div className="border-t border-slate-800 bg-slate-950/90 px-6 py-4 space-y-3">
          {job.outputs.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-400 mr-1">
                Chọn đầu ra ({job.outputs.length} video):
              </span>
              {job.outputs.map((o) => (
                <button
                  key={o.index}
                  type="button"
                  onClick={() => setActiveIndex(o.index)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    o.index === currentOut.index
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Video #{o.index}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1 flex-1 min-w-[240px]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Prompt đầy đủ
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">{job.prompt}</p>
            </div>

            {(job.imageAsset || job.firstFrameAsset || job.lastFrameAsset) && (
              <div className="flex items-center gap-2 shrink-0">
                {job.imageAsset && (
                  <div className="text-center">
                    <img
                      src={job.imageAsset.url}
                      alt="Input"
                      className="w-12 h-12 rounded-lg object-cover border border-slate-700"
                    />
                    <span className="text-[10px] text-slate-400">Ảnh gốc</span>
                  </div>
                )}
                {job.firstFrameAsset && (
                  <div className="text-center">
                    <img
                      src={job.firstFrameAsset.url}
                      alt="First frame"
                      className="w-12 h-12 rounded-lg object-cover border border-slate-700"
                    />
                    <span className="text-[10px] text-slate-400">Khung đầu</span>
                  </div>
                )}
                {job.lastFrameAsset && (
                  <div className="text-center">
                    <img
                      src={job.lastFrameAsset.url}
                      alt="Last frame"
                      className="w-12 h-12 rounded-lg object-cover border border-slate-700"
                    />
                    <span className="text-[10px] text-slate-400">Khung cuối</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
