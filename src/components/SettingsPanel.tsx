import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronUp,
  Chrome,
  Cpu,
  ExternalLink,
  Gauge,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Timer,
  XCircle,
} from 'lucide-react';
import {
  PROVIDER_MODE_OPTIONS,
  type FlowBrowserStatus,
  type ProviderMode,
  type PublicSystemSettings,
} from '../types';
import {
  closeFlowChrome,
  fetchFlowBrowserStatus,
  launchFlowChrome,
  resetProvidersCooldown,
  testGeminiApiKeyConnection,
  updateSystemSettings,
} from '../api';

interface SettingsPanelProps {
  settings: PublicSystemSettings;
  flowStatus: FlowBrowserStatus | null;
  onFlowStatusUpdated: (st: FlowBrowserStatus) => void;
  onUpdated: (next: PublicSystemSettings) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  flowStatus,
  onFlowStatusUpdated,
  onUpdated,
  onNotify,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [providerMode, setProviderMode] = useState<ProviderMode>(settings.providerMode);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [flowUrlInput, setFlowUrlInput] = useState(settings.flowProjectUrl);
  const [maxConcurrency, setMaxConcurrency] = useState(settings.maxConcurrency);
  const [maxJobsPerMinute, setMaxJobsPerMinute] = useState(settings.maxJobsPerMinute);
  const [mockDurationSec, setMockDurationSec] = useState(settings.mockDurationSec);
  const [mockFailureRate, setMockFailureRate] = useState(settings.mockFailureRate);
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestMessage, setKeyTestMessage] = useState('');
  const [launchingFlow, setLaunchingFlow] = useState(false);
  const [refreshingFlow, setRefreshingFlow] = useState(false);

  useEffect(() => {
    setProviderMode(settings.providerMode);
    setFlowUrlInput(settings.flowProjectUrl);
    setMaxConcurrency(settings.maxConcurrency);
    setMaxJobsPerMinute(settings.maxJobsPerMinute);
    setMockDurationSec(settings.mockDurationSec);
    setMockFailureRate(settings.mockFailureRate);
  }, [settings]);

  const health = settings.providerHealth;
  const geminiExhausted = Boolean(
    health?.geminiExhaustedUntil && health.geminiExhaustedUntil > Date.now()
  );
  const flowExhausted = Boolean(
    health?.flowExhaustedUntil && health.flowExhaustedUntil > Date.now()
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: Parameters<typeof updateSystemSettings>[0] = {
        providerMode,
        flowProjectUrl: flowUrlInput.trim(),
        maxConcurrency: Number(maxConcurrency),
        maxJobsPerMinute: Number(maxJobsPerMinute),
        mockDurationSec: Number(mockDurationSec),
        mockFailureRate: Number(mockFailureRate),
      };
      if (apiKeyInput.trim()) {
        patch.geminiApiKey = apiKeyInput.trim();
      }
      const res = await updateSystemSettings(patch);
      setApiKeyInput('');
      onUpdated(res.settings);
      onNotify('Đã lưu cấu hình đa phương án & cập nhật bộ điều phối tự động!', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi lưu cấu hình', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickModeChange = async (mode: ProviderMode) => {
    setProviderMode(mode);
    try {
      const res = await updateSystemSettings({ providerMode: mode });
      onUpdated(res.settings);
      const label = PROVIDER_MODE_OPTIONS.find((o) => o.value === mode)?.shortLabel || mode;
      onNotify(`Đã chuyển chế độ chạy sang: ${label}`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi chuyển chế độ', 'error');
    }
  };

  const handleTestGeminiKey = async () => {
    setTestingKey(true);
    setKeyTestMessage('');
    try {
      const candidateKey = apiKeyInput.trim();
      const res = await testGeminiApiKeyConnection(candidateKey || undefined);
      if (candidateKey) {
        const saved = await updateSystemSettings({ geminiApiKey: candidateKey });
        onUpdated(saved.settings);
        setApiKeyInput((current) => current.trim() === candidateKey ? '' : current);
      }
      const message = candidateKey ? `Đã lưu key. ${res.message}` : res.message;
      setKeyTestMessage(message);
      onNotify(message, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'API Key không hợp lệ', 'error');
    } finally {
      setTestingKey(false);
    }
  };

  const handleLaunchFlow = async () => {
    setLaunchingFlow(true);
    try {
      const res = await launchFlowChrome(flowUrlInput.trim() || undefined);
      onFlowStatusUpdated(res.flowStatus);
      onUpdated(res.settings);
      onNotify(
        'Đã mở cửa sổ Chrome Google Flow! Hãy đăng nhập tài khoản Gemini Ultra và mở sẵn 1 dự án Flow.',
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi mở Chrome Flow', 'error');
    } finally {
      setLaunchingFlow(false);
    }
  };

  const handleRefreshFlowStatus = async () => {
    setRefreshingFlow(true);
    try {
      const res = await fetchFlowBrowserStatus();
      onFlowStatusUpdated(res.flowStatus);
      onNotify(res.flowStatus.message, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể kiểm tra Flow', 'error');
    } finally {
      setRefreshingFlow(false);
    }
  };

  const handleCloseFlow = async () => {
    try {
      const res = await closeFlowChrome();
      onFlowStatusUpdated(res.flowStatus);
      onNotify('Đã đóng cửa sổ Chrome Google Flow.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi đóng Chrome', 'error');
    }
  };

  const handleResetHealth = async () => {
    try {
      const res = await resetProvidersCooldown();
      onUpdated(res.settings);
      onNotify('Đã đặt lại trạng thái hạn mức cho cả Gemini API và Google Flow!', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi khôi phục trạng thái', 'error');
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/85 backdrop-blur-md shadow-lg overflow-hidden">
      {/* Compact Top Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Quick Mode Dropdown right in top bar */}
          <div className="flex items-center gap-2 rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5">
            <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <select
              value={settings.providerMode}
              onChange={(e) => handleQuickModeChange(e.target.value as ProviderMode)}
              className="bg-slate-950 text-xs font-semibold text-white focus:outline-none cursor-pointer"
            >
              {PROVIDER_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.shortLabel}
                </option>
              ))}
            </select>
          </div>

          {/* Provider 1 Live Badge */}
          <span
            title={health?.geminiExhaustedReason || 'Trạng thái Phương án 1 (Google Gemini API)'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border ${
              geminiExhausted
                ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                : settings.hasGeminiApiKey
                  ? 'bg-emerald-950/50 border-emerald-600/40 text-emerald-300'
                  : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            P.Án 1 (API):{' '}
            <strong>
              {geminiExhausted
                ? 'Hết hạn mức (Đã chuyển dự phòng)'
                : settings.hasGeminiApiKey
                  ? 'Đã gắn Key'
                  : 'Chưa nhập Key'}
            </strong>
          </span>

          {/* Provider 2 Live Badge */}
          <span
            title={health?.flowExhaustedReason || flowStatus?.message || 'Trạng thái Phương án 2 (Google Flow)'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border ${
              flowExhausted
                ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                : flowStatus?.isProjectReady
                  ? 'bg-violet-950/60 border-violet-500/40 text-violet-200'
                  : flowStatus?.isBrowserOpen
                    ? 'bg-indigo-950/50 border-indigo-500/40 text-indigo-300'
                    : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
          >
            <Chrome className="w-3.5 h-3.5" />
            P.Án 2 (Flow Ultra):{' '}
            <strong>
              {flowExhausted
                ? 'Tạm chuyển dự phòng'
                : flowStatus?.isProjectReady
                  ? 'Sẵn sàng'
                  : flowStatus?.isBrowserOpen
                    ? 'Chờ mở dự án / Login'
                    : 'Chưa mở Chrome'}
            </strong>
          </span>

          {(geminiExhausted || flowExhausted) && (
            <button
              type="button"
              onClick={handleResetHealth}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition"
            >
              <RotateCcw className="w-3 h-3" />
              Khôi phục 2 nguồn
            </button>
          )}

          <span className="hidden xl:inline-flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-300 border border-slate-700/60">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Song song: <strong className="text-white">{settings.maxConcurrency}</strong>
          </span>

          <span className="hidden xl:inline-flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-300 border border-slate-700/60">
            <Gauge className="w-3.5 h-3.5 text-amber-400" />
            Tốc độ: <strong className="text-white">{settings.maxJobsPerMinute} jobs/phút</strong>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/20 hover:bg-indigo-600/30 px-3.5 py-1.5 text-xs font-semibold text-indigo-200 transition"
        >
          <Settings className="w-3.5 h-3.5 text-indigo-400" />
          Kết nối Tài khoản & Auto-Failover
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded Dual-Provider Setup Drawer */}
      {expanded && (
        <form
          onSubmit={handleSave}
          className="border-t border-slate-800 bg-slate-950/75 px-5 py-5 space-y-5"
        >
          {/* Strategy Selector */}
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-indigo-300 mb-2">
              Chiến lược điều phối & Tự động chuyển đổi dự phòng (Auto-Failover)
            </label>
            <select
              value={providerMode}
              onChange={(e) => setProviderMode(e.target.value as ProviderMode)}
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-sm font-medium text-white focus:outline-none focus:border-indigo-500"
            >
              {PROVIDER_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-300">
              {PROVIDER_MODE_OPTIONS.find((o) => o.value === providerMode)?.desc}
              {health?.totalFailovers > 0 && (
                <span className="ml-2 text-amber-300 font-semibold">
                  (Đã tự động chuyển đổi dự phòng thành công {health.totalFailovers} lần)
                </span>
              )}
            </p>
          </div>

          {/* Side-by-Side Cards: Phương án 1 (Gemini API) & Phương án 2 (Google Flow Chrome) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Card Phương án 1: Google Gemini API */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-sm font-bold text-white">
                    Phương án 1: Google Gemini API
                  </h4>
                </div>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:underline"
                >
                  Lấy API Key trong AI Studio
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <p className="text-xs text-slate-400">
                Dán key rồi bấm Kiểm tra & lưu Key. Key hợp lệ sẽ được lưu trên máy này.
                Quyền tạo video và hạn mức phụ thuộc project API của key.
              </p>
              <a
                href="https://aistudio.google.com/usage"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
              >
                Kiểm tra Usage, Rate limits và Billing trong AI Studio
                <ExternalLink className="w-3 h-3" />
              </a>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={
                    settings.hasGeminiApiKey
                      ? `Đã lưu Key: ${settings.maskedGeminiApiKey} (Nhập mới nếu muốn đổi)`
                      : 'Dán mã AIzaSy... vào đây'
                  }
                  className="flex-1 rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  disabled={testingKey || (!apiKeyInput.trim() && !settings.hasGeminiApiKey)}
                  onClick={handleTestGeminiKey}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 px-3 py-2 text-xs font-semibold text-emerald-200 transition shrink-0"
                >
                  {testingKey ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  {apiKeyInput.trim() ? 'Kiểm tra & lưu Key' : 'Kiểm tra Key đã lưu'}
                </button>
              </div>

              {keyTestMessage && (
                <p role="status" className="text-xs text-emerald-300 break-words">
                  {keyTestMessage}
                </p>
              )}

              {geminiExhausted && health.geminiExhaustedReason && (
                <div className="rounded-lg bg-amber-950/50 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-200">
                  Đang tạm chuyển dự phòng: {health.geminiExhaustedReason}
                </div>
              )}
            </div>

            {/* Card Phương án 2: Google Labs Flow Chrome */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Chrome className="w-4 h-4 text-violet-400" />
                  <h4 className="text-sm font-bold text-white">
                    Phương án 2: Google Labs Flow (Web Gemini Ultra)
                  </h4>
                </div>
                <span className="text-[11px] text-violet-300 font-medium">
                  Lưu phiên Chrome riêng
                </span>
              </div>

              <p className="text-xs text-slate-400">
                Nhấn <strong>Mở Chrome Đăng Nhập Flow</strong>, đăng nhập Google trong cửa sổ đó,
                mở dự án Flow rồi nhấn <strong>Kiểm tra phiên</strong>. Cửa sổ này dùng phiên đăng nhập
                riêng với Chrome thường ngày. Tạo video trên Flow sử dụng hạn mức của tài khoản Flow.
              </p>

              <div>
                <input
                  type="text"
                  value={flowUrlInput}
                  onChange={(e) => setFlowUrlInput(e.target.value)}
                  placeholder="https://labs.google/fx/tools/flow"
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={launchingFlow}
                  onClick={handleLaunchFlow}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-3.5 py-2 text-xs font-semibold text-white shadow transition"
                >
                  {launchingFlow ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Chrome className="w-3.5 h-3.5" />
                  )}
                  Mở Chrome Đăng Nhập Flow
                </button>

                <button
                  type="button"
                  disabled={refreshingFlow}
                  onClick={handleRefreshFlowStatus}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingFlow ? 'animate-spin' : ''}`} />
                  Kiểm tra phiên
                </button>

                {flowStatus?.isBrowserOpen && (
                  <button
                    type="button"
                    onClick={handleCloseFlow}
                    className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-950/40 hover:bg-rose-950/70 px-3 py-2 text-xs font-medium text-rose-300 transition"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Đóng Chrome
                  </button>
                )}
              </div>

              {flowStatus && (
                <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-[11px] text-slate-300">
                  Trạng thái Chrome Flow: <strong className="text-white">{flowStatus.message}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Queue Concurrency & Rate Limit Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-800">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Số job chạy song song tối đa (X)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(Number(e.target.value))}
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Giới hạn tối đa trong 1 phút (jobs/phút)
              </label>
              <input
                type="number"
                min={1}
                max={120}
                value={maxJobsPerMinute}
                onChange={(e) => setMaxJobsPerMinute(Number(e.target.value))}
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {providerMode === 'mock' && (
              <>
                <div>
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-300 mb-1">
                    <Timer className="w-3.5 h-3.5 text-indigo-400" />
                    Thời gian xử lý Demo: <strong className="text-indigo-300">{mockDurationSec}s</strong>
                  </label>
                  <input
                    type="range"
                    min={2}
                    max={30}
                    value={mockDurationSec}
                    onChange={(e) => setMockDurationSec(Number(e.target.value))}
                    className="w-full accent-indigo-500 mt-2"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-300 mb-1">
                    <Cpu className="w-3.5 h-3.5 text-rose-400" />
                    Tỉ lệ lỗi thử Retry: <strong className="text-rose-400">{mockFailureRate}%</strong>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={80}
                    step={5}
                    value={mockFailureRate}
                    onChange={(e) => setMockFailureRate(Number(e.target.value))}
                    className="w-full accent-rose-500 mt-2"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-xl px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition"
            >
              Thu gọn
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              {saving ? 'Đang lưu...' : 'Lưu Cấu Hình Hệ Thống'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
