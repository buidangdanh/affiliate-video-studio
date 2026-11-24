import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  CheckCircle2,
  Clock,
  Gauge,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { JobStatus, QueueStats, VideoJob } from '../types';
import { JobQueueItem } from './JobQueueItem';
import { VideoModal } from './VideoModal';

interface QueueDashboardProps {
  jobs: VideoJob[];
  stats: QueueStats;
  onRetryJob: (id: string) => void;
  onRetryAllFailed: () => void;
  onCancelJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
  onTogglePause: () => void;
  onClearFinished: (mode: 'finished' | 'all') => void;
}

type FilterTab = 'all' | JobStatus;

export const QueueDashboard: React.FC<QueueDashboardProps> = ({
  jobs,
  stats,
  onRetryJob,
  onRetryAllFailed,
  onCancelJob,
  onDeleteJob,
  onTogglePause,
  onClearFinished,
}) => {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [modalState, setModalState] = useState<{
    jobId: string;
    outputIndex: number;
  } | null>(null);

  // Live 250ms ticker when rate-limit countdown or active jobs exist
  useEffect(() => {
    if (!stats.nextRateLimitSlotAt && stats.running === 0 && stats.jobsStartedLastMinute === 0) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(timer);
  }, [stats.nextRateLimitSlotAt, stats.running, stats.jobsStartedLastMinute]);

  const waitSecondsLeft = stats.nextRateLimitSlotAt
    ? Math.max(0, Math.ceil((stats.nextRateLimitSlotAt - nowMs) / 1000))
    : 0;

  const overallPercent =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  // Sort newest batches / active items clearly (in-order #1 -> #N so user watches sequential queue progression)
  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return jobs.filter((j) => {
      if (filter !== 'all' && j.status !== filter) return false;
      if (q) {
        return (
          j.prompt.toLowerCase().includes(q) ||
          j.model.toLowerCase().includes(q) ||
          `#${j.seq}`.includes(q)
        );
      }
      return true;
    });
  }, [jobs, filter, searchQuery]);

  const completedJobs = useMemo(
    () => jobs.filter((j) => j.status === 'completed' && j.outputs.length > 0),
    [jobs]
  );

  const activeModalJob = useMemo(
    () => (modalState ? jobs.find((j) => j.id === modalState.jobId) || null : null),
    [jobs, modalState]
  );

  const completedIdx = activeModalJob
    ? completedJobs.findIndex((j) => j.id === activeModalJob.id)
    : -1;

  const totalCompletedVideoFiles = useMemo(
    () => completedJobs.reduce((sum, j) => sum + j.outputs.length, 0),
    [completedJobs]
  );

  return (
    <div className="space-y-4">
      {/* Live Queue Metrics & Rate Limiter Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Overall Batch Progress */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Tiến độ hoàn thành
            </span>
            <span className="font-mono font-bold text-emerald-300">{overallPercent}%</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.completed}{' '}
            <span className="text-sm font-normal text-slate-400">/ {stats.total} jobs</span>
          </div>
          <div className="mt-2.5 h-2 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${overallPercent}%` }}
            />
          </div>
        </div>

        {/* Card 2: Parallel Concurrency Slot Usage */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="flex items-center gap-1.5 font-medium">
              <Layers className="w-4 h-4 text-indigo-400" />
              Đang chạy song song
            </span>
            <span className="text-[11px] text-indigo-300">Tối đa {stats.maxConcurrency} cùng lúc</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.running}{' '}
            <span className="text-sm font-normal text-slate-400">
              / {stats.maxConcurrency} luồng
            </span>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {Array.from({ length: Math.min(10, stats.maxConcurrency) }, (_, idx) => (
              <div
                key={idx}
                className={`h-2 flex-1 rounded-full transition ${
                  idx < stats.running ? 'bg-indigo-500 animate-pulse' : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Card 3: 1-Minute Rate Limit Window */}
        <div
          className={`rounded-2xl border p-4 shadow transition ${
            waitSecondsLeft > 0
              ? 'border-amber-500/50 bg-amber-950/20'
              : 'border-slate-800 bg-slate-900/90'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="flex items-center gap-1.5 font-medium">
              <Gauge className="w-4 h-4 text-amber-400" />
              Giới hạn trong 1 phút
            </span>
            <span className="text-[11px] text-amber-300">
              Tối đa {stats.maxJobsPerMinute} jobs/phút
            </span>
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.jobsStartedLastMinute}{' '}
            <span className="text-sm font-normal text-slate-400">
              / {stats.maxJobsPerMinute} lượt
            </span>
          </div>
          <div className="mt-2 text-[11px]">
            {waitSecondsLeft > 0 ? (
              <span className="text-amber-300 font-semibold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 animate-spin" />
                Mở lượt gửi tiếp theo sau {waitSecondsLeft}s...
              </span>
            ) : (
              <span className="text-slate-400">Sẵn sàng cấp phát ngay khi có job chờ</span>
            )}
          </div>
        </div>

        {/* Card 4: Waiting & Failed Summary */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="flex items-center gap-1.5 font-medium">
              <Activity className="w-4 h-4 text-cyan-400" />
              Trạng thái hàng đợi
            </span>
            {stats.isPaused && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                ĐANG TẠM DỪNG
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-4">
            <div>
              <span className="text-2xl font-bold text-white">{stats.queued}</span>{' '}
              <span className="text-xs text-slate-400">đang chờ</span>
            </div>
            <div>
              <span
                className={`text-2xl font-bold ${
                  stats.failed > 0 ? 'text-rose-400' : 'text-slate-400'
                }`}
              >
                {stats.failed}
              </span>{' '}
              <span className="text-xs text-slate-400">thất bại</span>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            {stats.running > 0 || stats.queued > 0
              ? 'Hệ thống đang xử lý tự động tuần tự...'
              : stats.total > 0
                ? 'Đã xử lý xong toàn bộ hàng đợi!'
                : 'Chưa có job nào trong hàng đợi'}
          </div>
        </div>
      </div>

      {/* Rate-Limit Active Notice Banner */}
      {waitSecondsLeft > 0 && stats.queued > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Đang bảo vệ giới hạn tốc độ ({stats.maxJobsPerMinute} jobs / 1 phút):</strong>{' '}
              Đã chạy đủ {stats.maxJobsPerMinute} jobs trong 60 giây gần nhất. Hệ thống sẽ tự động gửi job tiếp theo vào lúc mở lượt sau{' '}
              <strong className="text-white underline">{waitSecondsLeft} giây</strong> mà bạn không cần thao tác gì thêm!
            </span>
          </div>
        </div>
      )}

      {/* Toolbar: Filter Tabs, Search, Retry All Failed, Download All ZIP */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `Tất cả (${stats.total})` },
                { id: 'running', label: `Đang chạy (${stats.running})` },
                { id: 'queued', label: `Chờ lượt (${stats.queued})` },
                { id: 'completed', label: `Hoàn thành (${stats.completed})` },
                { id: 'failed', label: `Lỗi (${stats.failed})` },
              ] as Array<{ id: FilterTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  filter === tab.id
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Global Queue Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Pause / Resume */}
            {stats.total > 0 && (stats.queued > 0 || stats.isPaused) && (
              <button
                type="button"
                onClick={onTogglePause}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  stats.isPaused
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    : 'border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                {stats.isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Tiếp tục chạy hàng đợi
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Tạm dừng cấp job mới
                  </>
                )}
              </button>
            )}

            {/* Retry All Failed */}
            {stats.failed + stats.cancelled > 0 && (
              <button
                type="button"
                onClick={onRetryAllFailed}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-bold text-slate-950 shadow transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry tất cả lỗi ({stats.failed + stats.cancelled})
              </button>
            )}

            {/* Download All Completed Videos (.ZIP) */}
            {totalCompletedVideoFiles > 0 && (
              <a
                href="/api/jobs/download-all"
                download
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition"
              >
                <Archive className="w-4 h-4" />
                Download All ({totalCompletedVideoFiles} Video .ZIP)
              </a>
            )}

            {/* Clear Finished */}
            {stats.completed + stats.failed + stats.cancelled > 0 && (
              <button
                type="button"
                onClick={() => onClearFinished('finished')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-rose-950/50 hover:border-rose-500/40 px-3 py-2 text-xs font-medium text-slate-300 hover:text-rose-300 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Dọn job đã xong
              </button>
            )}
          </div>
        </div>

        {/* Search Input */}
        {stats.total > 3 && (
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo nội dung prompt, mã #job hoặc tên model..."
              className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-9 pr-4 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}
      </div>

      {/* Queue Job Cards List */}
      {filteredJobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-16 text-center space-y-2">
          <p className="text-sm font-medium text-slate-300">
            {stats.total === 0
              ? 'Chưa có job nào trong hàng đợi.'
              : 'Không có job nào khớp với bộ lọc hiện tại.'}
          </p>
          <p className="text-xs text-slate-500">
            {stats.total === 0
              ? 'Hãy nhập danh sách job ở mục "Nhập Job Hàng Loạt" rồi nhấn Submit để hệ thống tự động chạy!'
              : 'Hãy thử chọn tab "Tất cả" hoặc xoá từ khoá tìm kiếm.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredJobs.map((job) => (
            <JobQueueItem
              key={job.id}
              job={job}
              onRetry={onRetryJob}
              onCancel={onCancelJob}
              onDelete={onDeleteJob}
              onWatchVideo={(targetJob, outIdx = 1) =>
                setModalState({ jobId: targetJob.id, outputIndex: outIdx })
              }
            />
          ))}
        </div>
      )}

      {/* Cinema Web Video Player Modal */}
      <VideoModal
        job={activeModalJob}
        initialOutputIndex={modalState?.outputIndex || 1}
        onClose={() => setModalState(null)}
        hasPrev={completedIdx > 0}
        hasNext={completedIdx >= 0 && completedIdx < completedJobs.length - 1}
        onNavigateJob={(dir) => {
          if (completedIdx < 0) return;
          const nextIdx = dir === 'prev' ? completedIdx - 1 : completedIdx + 1;
          const target = completedJobs[nextIdx];
          if (target) {
            setModalState({ jobId: target.id, outputIndex: 1 });
          }
        }}
      />
    </div>
  );
};
