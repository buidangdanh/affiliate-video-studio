import React from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Chrome,
  Clock,
  Download,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { INPUT_TYPE_OPTIONS, MODEL_OPTIONS, type VideoJob } from '../types';

interface JobQueueItemProps {
  job: VideoJob;
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onWatchVideo: (job: VideoJob, outputIndex?: number) => void;
}

export const JobQueueItem: React.FC<JobQueueItemProps> = ({
  job,
  onRetry,
  onCancel,
  onDelete,
  onWatchVideo,
}) => {
  const modelLabel =
    MODEL_OPTIONS.find((m) => m.value === job.model)?.label || job.model;
  const inputLabel =
    INPUT_TYPE_OPTIONS.find((i) => i.value === job.inputType)?.shortLabel || job.inputType;

  const statusBadge = () => {
    switch (job.status) {
      case 'queued':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Đang chờ lượt
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-950/90 border border-indigo-500/50 px-2.5 py-1 text-xs font-semibold text-indigo-300">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            Đang tạo ({job.progress}%)
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Hoàn thành ({job.outputs.length})
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-950/80 border border-rose-500/50 px-2.5 py-1 text-xs font-semibold text-rose-300">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            Thất bại
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 border border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-400">
            <Ban className="w-3.5 h-3.5" />
            Đã huỷ
          </span>
        );
    }
  };

  const executedBadge = () => {
    if (!job.executedProvider) return null;
    if (job.executedProvider === 'gemini') {
      return (
        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-950/70 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
          <Sparkles className="w-3 h-3" />
          P.Án 1: Gemini API
        </span>
      );
    }
    if (job.executedProvider === 'flow') {
      return (
        <span className="inline-flex items-center gap-1 rounded-lg bg-violet-950/70 border border-violet-500/30 px-2 py-0.5 text-[11px] font-semibold text-violet-300">
          <Chrome className="w-3 h-3" />
          P.Án 2: Google Flow
        </span>
      );
    }
    return (
      <span className="rounded-lg bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-400">
        Demo MP4
      </span>
    );
  };

  return (
    <div
      className={`rounded-2xl border p-4 transition shadow-sm ${
        job.status === 'running'
          ? 'border-indigo-500/50 bg-indigo-950/15'
          : job.status === 'failed'
            ? 'border-rose-500/40 bg-rose-950/10'
            : job.status === 'completed'
              ? 'border-emerald-500/30 bg-slate-900/90'
              : 'border-slate-800 bg-slate-900/70'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-slate-800 px-2 py-0.5 text-xs font-mono font-bold text-white">
              #{job.seq}
            </span>
            {statusBadge()}
            {executedBadge()}
            {job.failoverFrom && (
              <span
                title={job.failoverReason || 'Đã tự động chuyển đổi phương án dự phòng'}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 border border-amber-500/40 px-2 py-0.5 text-[11px] font-semibold text-amber-300"
              >
                <ArrowLeftRight className="w-3 h-3" />
                Tự chuyển từ {job.failoverFrom === 'gemini' ? 'Gemini API' : 'Google Flow'}
              </span>
            )}
            <span className="rounded-lg bg-slate-800/90 border border-slate-700/70 px-2 py-0.5 text-[11px] font-medium text-slate-300">
              {modelLabel}
            </span>
            <span className="rounded-lg bg-slate-800/90 border border-slate-700/70 px-2 py-0.5 text-[11px] font-medium text-slate-300">
              {inputLabel}
            </span>
            <span className="rounded-lg bg-slate-800/90 border border-slate-700/70 px-2 py-0.5 text-[11px] font-medium text-slate-300">
              {job.aspectRatio} • {job.durationSeconds || 8}s
            </span>
            <span className="rounded-lg bg-slate-800/90 border border-slate-700/70 px-2 py-0.5 text-[11px] font-medium text-slate-300">
              {job.outputCount} đầu ra
            </span>
            {job.retryCount > 0 && (
              <span className="rounded-lg bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                Retry #{job.retryCount}
              </span>
            )}
          </div>

          <div className="flex items-start gap-3">
            {(job.imageAsset || job.firstFrameAsset || job.lastFrameAsset) && (
              <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                {job.imageAsset && (
                  <img
                    src={job.imageAsset.url}
                    alt="Source"
                    title={`Ảnh đầu vào: ${job.imageAsset.originalName}`}
                    className="w-11 h-11 rounded-lg object-cover border border-slate-700"
                  />
                )}
                {job.firstFrameAsset && (
                  <img
                    src={job.firstFrameAsset.url}
                    alt="First Frame"
                    title={`Khung đầu: ${job.firstFrameAsset.originalName}`}
                    className="w-11 h-11 rounded-lg object-cover border border-slate-700"
                  />
                )}
                {job.lastFrameAsset && (
                  <img
                    src={job.lastFrameAsset.url}
                    alt="Last Frame"
                    title={`Khung cuối: ${job.lastFrameAsset.originalName}`}
                    className="w-11 h-11 rounded-lg object-cover border border-slate-700"
                  />
                )}
              </div>
            )}

            <p className="text-sm text-slate-100 leading-relaxed line-clamp-2">
              {job.prompt}
            </p>
          </div>

          {(job.status === 'running' || job.status === 'queued') && (
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{job.statusMessage || 'Đang xử lý...'}</span>
                {job.status === 'running' && (
                  <span className="font-mono font-semibold text-indigo-300">
                    {job.progress}%
                  </span>
                )}
              </div>
              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    job.status === 'running'
                      ? 'bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400'
                      : 'bg-slate-600'
                  }`}
                  style={{ width: `${job.status === 'running' ? Math.max(6, job.progress) : 0}%` }}
                />
              </div>
            </div>
          )}

          {job.status === 'failed' && job.error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{job.error}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {job.status === 'completed' && job.outputs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5">
              {job.outputs.map((out) => (
                <div
                  key={out.index}
                  className="group relative rounded-xl overflow-hidden border border-slate-700 bg-black w-36 h-22 flex items-center justify-center shadow"
                >
                  <video
                    src={out.url}
                    preload="metadata"
                    muted
                    loop
                    playsInline
                    onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = 0;
                    }}
                    onClick={() => onWatchVideo(job, out.index)}
                    className="w-full h-full object-cover cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => onWatchVideo(job, out.index)}
                    title="Xem video trên web"
                    className="absolute inset-0 flex items-center justify-center bg-black/35 group-hover:bg-black/15 transition cursor-pointer"
                  >
                    <span className="rounded-full bg-indigo-600/90 p-2 text-white shadow-lg group-hover:scale-110 transition">
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </span>
                  </button>
                  {job.outputs.length > 1 && (
                    <span className="absolute top-1 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      #{out.index}
                    </span>
                  )}
                  <a
                    href={out.downloadUrl}
                    download
                    onClick={(e) => e.stopPropagation()}
                    title={`Tải xuống Video #${out.index}`}
                    className="absolute bottom-1 right-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 p-1.5 text-white shadow transition"
                  >
                    <Download className="w-3 h-3" />
                  </a>
                </div>
              ))}

              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => onWatchVideo(job, 1)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white shadow transition cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Xem trên Web
                </button>
                <a
                  href={job.outputs[0].downloadUrl}
                  download
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white shadow transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download MP4
                </a>
              </div>
            </div>
          )}

          {(job.status === 'failed' || job.status === 'cancelled') && (
            <button
              type="button"
              onClick={() => onRetry(job.id)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-bold text-slate-950 shadow transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry (Thử lại)
            </button>
          )}

          {(job.status === 'queued' || job.status === 'running') && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 hover:bg-rose-950/60 hover:border-rose-500/40 px-3 py-2 text-xs font-medium text-slate-300 hover:text-rose-300 transition"
            >
              <Ban className="w-3.5 h-3.5" />
              Huỷ
            </button>
          )}

          {job.status !== 'running' && (
            <button
              type="button"
              onClick={() => onDelete(job.id)}
              title="Xoá khỏi danh sách"
              className="rounded-xl border border-slate-800 bg-slate-900 hover:bg-rose-950/60 p-2 text-slate-400 hover:text-rose-400 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
