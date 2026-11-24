import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  Columns2,
  Flame,
  ListChecks,
  PlusSquare,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  DraftJob,
  FlowBrowserStatus,
  PublicSystemSettings,
  QueueStats,
  VideoJob,
} from './types';
import type { AffiliateProduct, AffiliateRadarSnapshot } from './affiliateTypes';
import {
  cancelSingleJob,
  clearQueueJobs,
  deleteSingleJob,
  fetchAffiliateSnapshot,
  fetchInitialState,
  retryAllFailedJobs,
  retrySingleJob,
  submitJobsBatch,
  updateSystemSettings,
} from './api';
import { SettingsPanel } from './components/SettingsPanel';
import { createEmptyDraft, DraftJobList } from './components/DraftJobList';
import { QueueDashboard } from './components/QueueDashboard';
import { AffiliateRadarDashboard } from './components/AffiliateRadarDashboard';

type ActiveView = 'affiliate' | 'composer' | 'queue' | 'both';

interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error';
}

const DEFAULT_SETTINGS: PublicSystemSettings = {
  providerMode: 'auto_flow_first',
  hasGeminiApiKey: false,
  maskedGeminiApiKey: '',
  flowProjectUrl: 'https://labs.google/fx/tools/flow',
  maxConcurrency: 4,
  maxJobsPerMinute: 4,
  mockDurationSec: 8,
  mockFailureRate: 0,
  isPaused: false,
  providerHealth: {
    geminiExhaustedUntil: null,
    geminiExhaustedReason: null,
    flowExhaustedUntil: null,
    flowExhaustedReason: null,
    totalFailovers: 0,
  },
};

const DEFAULT_STATS: QueueStats = {
  total: 0,
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  jobsStartedLastMinute: 0,
  maxJobsPerMinute: 4,
  maxConcurrency: 4,
  nextRateLimitSlotAt: null,
  isPaused: false,
  recentStartTimestamps: [],
};

export const App: React.FC = () => {
  const [drafts, setDrafts] = useState<DraftJob[]>(() => [
    createEmptyDraft(),
    createEmptyDraft({ aspectRatio: '9:16' }),
    createEmptyDraft({ model: 'veo-2.0-generate-001', aspectRatio: '1:1' }),
  ]);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [stats, setStats] = useState<QueueStats>(DEFAULT_STATS);
  const [settings, setSettings] = useState<PublicSystemSettings>(DEFAULT_SETTINGS);
  const [flowStatus, setFlowStatus] = useState<FlowBrowserStatus | null>(null);
  const [affiliateSnapshot, setAffiliateSnapshot] =
    useState<AffiliateRadarSnapshot | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('affiliate');
  const [submitting, setSubmitting] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [isCloudMode, setIsCloudMode] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connectSse = () => {
      if (unmounted) return;
      es = new EventSource('/api/events');

      es.onopen = () => {
        setSseConnected(true);
      };

      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'snapshot') {
            if (Array.isArray(data.jobs)) setJobs(data.jobs);
            if (data.stats) setStats(data.stats);
            if (data.settings) setSettings(data.settings);
            if (data.affiliate) setAffiliateSnapshot(data.affiliate);
          } else if (data.type === 'affiliate_updated' && data.snapshot) {
            setAffiliateSnapshot(data.snapshot);
          } else if (data.type === 'job_updated' && data.job) {
            const updated: VideoJob = data.job;
            setJobs((prev) => {
              const idx = prev.findIndex((j) => j.id === updated.id);
              if (idx === -1) return [...prev, updated];
              const next = [...prev];
              next[idx] = updated;
              return next;
            });
            if (data.stats) setStats(data.stats);
            if (data.settings) setSettings(data.settings);
          } else if (data.type === 'stats_updated' && data.stats) {
            setStats(data.stats);
          } else if (data.type === 'settings_updated' && data.settings) {
            setSettings(data.settings);
          }
        } catch (err) {
          console.error('[SSE parse error]', err);
        }
      };

      es.onerror = () => {
        setSseConnected(false);
        es?.close();
        reconnectTimer = setTimeout(connectSse, 2500);
      };
    };

    fetchInitialState()
      .then((data) => {
        if (unmounted) return;
        setJobs(data.jobs);
        setStats(data.stats);
        setSettings(data.settings);
        if (data.flowStatus) setFlowStatus(data.flowStatus);
        if (data.affiliate) {
          setAffiliateSnapshot(data.affiliate);
        } else {
          fetchAffiliateSnapshot()
            .then(setAffiliateSnapshot)
            .catch(console.error);
        }
        if (data.jobs.some((j) => j.status === 'running' || j.status === 'queued')) {
          setActiveView('queue');
        }
        if (data.isCloudMode) {
          setIsCloudMode(true);
        } else {
          connectSse();
        }
      })
      .catch((err) => {
        console.error(err);
      });

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  const handleSubmitBatch = async () => {
    const nonEmptyDrafts = drafts.filter(
      (d) =>
        d.prompt.trim().length > 0 ||
        d.imageAsset !== null ||
        d.firstFrameAsset !== null ||
        d.lastFrameAsset !== null
    );

    if (nonEmptyDrafts.length === 0) {
      notify('Vui lòng nhập ít nhất 1 Prompt hoặc upload ảnh trước khi Submit!', 'error');
      return;
    }

    for (let i = 0; i < nonEmptyDrafts.length; i++) {
      const row = nonEmptyDrafts[i];
      if (row.inputType === 'text_to_video' && !row.prompt.trim()) {
        notify(`Dòng job #${i + 1}: Vui lòng nhập nội dung mô tả (Prompt).`, 'error');
        return;
      }
      if (row.inputType === 'image_to_video' && !row.imageAsset) {
        notify(
          `Dòng job #${i + 1}: Đang chọn "Tạo video từ Hình ảnh" nhưng chưa upload file ảnh.`,
          'error'
        );
        return;
      }
      if (row.inputType === 'frames_to_video' && !row.firstFrameAsset) {
        notify(
          `Dòng job #${i + 1}: Đang chọn "Tạo video từ Khung hình" nhưng chưa upload Khung đầu.`,
          'error'
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await submitJobsBatch(nonEmptyDrafts);
      notify(
        `Đã gửi ${res.createdCount} jobs vào hàng đợi! Hệ thống đang tự động chạy tuần tự.`,
        'success'
      );
      setDrafts([createEmptyDraft()]);
      if (activeView === 'composer') {
        setActiveView('queue');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Submit thất bại', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await retrySingleJob(jobId);
      notify('Đã đưa job trở lại hàng đợi để chạy lại!', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi Retry job', 'error');
    }
  };

  const handleRetryAllFailed = async () => {
    try {
      const res = await retryAllFailedJobs();
      notify(`Đã đưa ${res.retriedCount} job lỗi vào hàng đợi chạy lại!`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi Retry hàng loạt', 'error');
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelSingleJob(jobId);
      notify('Đã huỷ job.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi huỷ job', 'error');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      await deleteSingleJob(jobId);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi xoá job', 'error');
    }
  };

  const handleTogglePause = async () => {
    try {
      const nextPaused = !stats.isPaused;
      const res = await updateSystemSettings({ isPaused: nextPaused });
      setSettings(res.settings);
      setStats(res.stats);
      notify(
        nextPaused
          ? 'Đã tạm dừng cấp phát job mới từ hàng đợi.'
          : 'Đã tiếp tục chạy hàng đợi tự động!',
        'success'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi thay đổi trạng thái hàng đợi', 'error');
    }
  };

  const handleClearFinished = async (mode: 'finished' | 'all') => {
    try {
      await clearQueueJobs(mode);
      notify('Đã dọn dẹp các job đã kết thúc!', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Lỗi dọn danh sách', 'error');
    }
  };

  const handlePushProductToVideo = useCallback(
    (product: AffiliateProduct, customPrompt?: string) => {
      const promptText = (customPrompt || product.videoPrompt916).trim();
      const newDraft = createEmptyDraft({
        prompt: promptText,
        aspectRatio: '9:16',
        inputType: 'text_to_video',
      });

      setDrafts((prev) => {
        const nonEmpty = prev.filter(
          (d) =>
            d.prompt.trim().length > 0 ||
            d.imageAsset !== null ||
            d.firstFrameAsset !== null
        );
        return [...nonEmpty, newDraft];
      });
      setActiveView('composer');
      notify(
        `Đã đẩy "${product.name.slice(0, 42)}..." sang trình Tạo Video AI (9:16)!`,
        'success'
      );
    },
    [notify]
  );

  const handlePushBatchToVideo = useCallback(
    (items: Array<{ name: string; prompt: string }>) => {
      if (items.length === 0) return;
      const newDrafts = items.map((it) =>
        createEmptyDraft({
          prompt: it.prompt.trim(),
          aspectRatio: '9:16',
          inputType: 'text_to_video',
        })
      );

      setDrafts((prev) => {
        const nonEmpty = prev.filter(
          (d) =>
            d.prompt.trim().length > 0 ||
            d.imageAsset !== null ||
            d.firstFrameAsset !== null
        );
        return [...nonEmpty, ...newDrafts];
      });
      setActiveView('composer');
      notify(
        `Đã đẩy ${newDrafts.length} sản phẩm Top 10 sang danh sách Tạo Video AI hàng loạt (khung 9:16)!`,
        'success'
      );
    },
    [notify]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
              <Clapperboard className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-white">
                  Affiliate Radar & Veo Studio
                </h1>
                <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  Shopee • TikTok • Video AI
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Săn sản phẩm mua nhiều theo mùa (cập nhật theo giờ/ngày) • Chấm Top 10 & Tạo Video Affiliate tự động
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap rounded-xl bg-slate-900 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveView('affiliate')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                  activeView === 'affiliate'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow'
                    : 'text-amber-300/90 hover:text-amber-200'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                Săn SP Affiliate & Top 10 ({affiliateSnapshot?.products.length ?? 0})
              </button>

              <button
                type="button"
                onClick={() => setActiveView('composer')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                  activeView === 'composer'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <PlusSquare className="w-3.5 h-3.5" />
                Tạo Video AI ({drafts.length})
              </button>

              <button
                type="button"
                onClick={() => setActiveView('queue')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                  activeView === 'queue'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ListChecks className="w-3.5 h-3.5" />
                Hàng Đợi & Kết Quả ({stats.total})
                {stats.running > 0 && (
                  <span className="ml-1 inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveView('both')}
                className={`hidden md:inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeView === 'both'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Columns2 className="w-3.5 h-3.5" />
                Xem Chung
              </button>
            </div>

            <span
              title={
                isCloudMode
                  ? 'Đang chạy trực tuyến độc lập trên Cloud / GitHub Pages'
                  : sseConnected
                    ? 'Kết nối thời gian thực đang hoạt động'
                    : 'Đang kết nối lại...'
              }
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium border ${
                isCloudMode
                  ? 'border-cyan-500/30 bg-cyan-950/40 text-cyan-300'
                  : sseConnected
                    ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300'
                    : 'border-rose-500/30 bg-rose-950/40 text-rose-300'
              }`}
            >
              {isCloudMode || sseConnected ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              {isCloudMode ? 'Web Online' : sseConnected ? 'Realtime' : 'Reconnecting'}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 sm:px-6 py-5 space-y-5">
        <SettingsPanel
          settings={settings}
          flowStatus={flowStatus}
          onFlowStatusUpdated={setFlowStatus}
          onUpdated={setSettings}
          onNotify={notify}
        />

        {activeView === 'affiliate' && (
          <AffiliateRadarDashboard
            snapshot={affiliateSnapshot}
            hasGeminiApiKey={settings.hasGeminiApiKey}
            onSnapshotUpdated={setAffiliateSnapshot}
            onPushProductToVideo={handlePushProductToVideo}
            onPushBatchToVideo={handlePushBatchToVideo}
            onNotify={notify}
          />
        )}

        {activeView === 'composer' && (
          <DraftJobList
            drafts={drafts}
            setDrafts={setDrafts}
            onSubmitBatch={handleSubmitBatch}
            submitting={submitting}
            onNotify={notify}
          />
        )}

        {activeView === 'queue' && (
          <QueueDashboard
            jobs={jobs}
            stats={stats}
            onRetryJob={handleRetryJob}
            onRetryAllFailed={handleRetryAllFailed}
            onCancelJob={handleCancelJob}
            onDeleteJob={handleDeleteJob}
            onTogglePause={handleTogglePause}
            onClearFinished={handleClearFinished}
          />
        )}

        {activeView === 'both' && (
          <div className="space-y-8">
            <DraftJobList
              drafts={drafts}
              setDrafts={setDrafts}
              onSubmitBatch={handleSubmitBatch}
              submitting={submitting}
              onNotify={notify}
            />
            <div className="border-t border-slate-800 pt-6">
              <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-indigo-400" />
                Tiến Độ Hàng Đợi & Kết Quả Video
              </h2>
              <QueueDashboard
                jobs={jobs}
                stats={stats}
                onRetryJob={handleRetryJob}
                onRetryAllFailed={handleRetryAllFailed}
                onCancelJob={handleCancelJob}
                onDeleteJob={handleDeleteJob}
                onTogglePause={handleTogglePause}
                onClearFinished={handleClearFinished}
              />
            </div>
          </div>
        )}
      </main>

      <div className="fixed bottom-5 left-5 z-50 flex flex-col gap-2 max-w-md pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs font-medium shadow-2xl backdrop-blur-md transition ${
              t.type === 'error'
                ? 'border-rose-500/50 bg-rose-950/90 text-rose-100'
                : 'border-emerald-500/40 bg-slate-900/95 text-emerald-200'
            }`}
          >
            {t.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
