import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Calendar,
  Clapperboard,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Flame,
  Gift,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import type {
  AffiliateProduct,
  AffiliateRadarSnapshot,
  EcommercePlatform,
  ScoringStrategy,
  SeasonId,
} from '../affiliateTypes';
import {
  importAffiliateProducts,
  scanLiveAffiliateTrends,
  triggerDailyTop10Analysis,
  triggerHourlyAffiliateSync,
  updateAffiliateConfig,
} from '../api';
import { AffiliateProductModal } from './AffiliateProductModal';
import { AffiliateImportModal } from './AffiliateImportModal';

interface AffiliateRadarDashboardProps {
  snapshot: AffiliateRadarSnapshot | null;
  hasGeminiApiKey: boolean;
  onSnapshotUpdated: (next: AffiliateRadarSnapshot) => void;
  onPushProductToVideo: (product: AffiliateProduct, customPrompt?: string) => void;
  onPushBatchToVideo: (items: Array<{ name: string; prompt: string }>) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type RadarSubTab = 'top10' | 'catalog' | 'both';
type SortField =
  | 'score'
  | 'soldLastHour'
  | 'hourlyGrowth'
  | 'soldToday'
  | 'commissionCash'
  | 'commissionPct'
  | 'sellerTrust';

function formatVnd(v: number): string {
  return `${v.toLocaleString('vi-VN')}đ`;
}

function formatTimeShort(iso: string): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function PlatformBadge({ platform }: { platform: EcommercePlatform }) {
  return platform === 'shopee' ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-orange-500/15 border border-orange-500/35 px-2 py-0.5 text-[10px] font-bold text-orange-300">
      🛍️ Shopee
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-pink-500/15 border border-pink-500/35 px-2 py-0.5 text-[10px] font-bold text-pink-300">
      🎵 TikTok Shop
    </span>
  );
}

export const AffiliateRadarDashboard: React.FC<AffiliateRadarDashboardProps> = ({
  snapshot,
  hasGeminiApiKey,
  onSnapshotUpdated,
  onPushProductToVideo,
  onPushBatchToVideo,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<RadarSubTab>('both');
  const [syncingHourly, setSyncingHourly] = useState(false);
  const [analyzingDaily, setAnalyzingDaily] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiKeyword, setAiKeyword] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<AffiliateProduct | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [countdownText, setCountdownText] = useState('');

  // Catalog Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | EcommercePlatform>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [onlyLowCompetition, setOnlyLowCompetition] = useState(false);
  const [onlyFreeSample, setOnlyFreeSample] = useState(false);
  const [onlyCurrentSeason, setOnlyCurrentSeason] = useState(true);
  const [sortBy, setSortBy] = useState<SortField>('score');

  useEffect(() => {
    if (!snapshot?.status.nextHourlySyncAt) return;
    const updateTimer = () => {
      const diffMs = Date.parse(snapshot.status.nextHourlySyncAt) - Date.now();
      if (diffMs <= 0) {
        setCountdownText('Đang cập nhật...');
        return;
      }
      const mins = Math.floor(diffMs / 60_000);
      const secs = Math.floor((diffMs % 60_000) / 1000);
      setCountdownText(`${mins}p ${String(secs).padStart(2, '0')}s`);
    };
    updateTimer();
    const t = setInterval(updateTimer, 1000);
    return () => clearInterval(t);
  }, [snapshot?.status.nextHourlySyncAt]);

  // Keep modal product synced when snapshot updates
  useEffect(() => {
    if (!selectedProduct || !snapshot) return;
    const fresh = snapshot.products.find((p) => p.id === selectedProduct.id);
    if (fresh) setSelectedProduct(fresh);
  }, [snapshot, selectedProduct]);

  const categories = useMemo(() => {
    if (!snapshot) return [];
    const set = new Set<string>();
    snapshot.products.forEach((p) => set.add(p.category));
    return Array.from(set);
  }, [snapshot]);

  const filteredProducts = useMemo(() => {
    if (!snapshot) return [];
    const activeSeasonId = snapshot.status.activeSeason.id;
    const q = searchQuery.trim().toLowerCase();

    return snapshot.products
      .filter((p) => {
        if (
          onlyCurrentSeason &&
          activeSeasonId !== 'all_year' &&
          !p.seasons.includes(activeSeasonId)
        ) {
          return false;
        }
        if (platformFilter !== 'all' && !p.platforms.includes(platformFilter)) {
          return false;
        }
        if (categoryFilter !== 'all' && p.category !== categoryFilter) {
          return false;
        }
        if (onlyLowCompetition && p.competitionLevel !== 'low') {
          return false;
        }
        if (onlyFreeSample && !p.freeSampleAvailable) {
          return false;
        }
        if (q) {
          const hay = `${p.name} ${p.category} ${p.subcategory} ${p.reputableSellers
            .map((s) => s.shopName)
            .join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'soldLastHour':
            return b.soldLastHour - a.soldLastHour;
          case 'hourlyGrowth':
            return b.hourlyGrowthPct - a.hourlyGrowthPct;
          case 'soldToday':
            return b.soldToday - a.soldToday;
          case 'commissionCash':
            return b.estimatedCommissionVnd - a.estimatedCommissionVnd;
          case 'commissionPct':
            return b.commissionRatePct - a.commissionRatePct;
          case 'sellerTrust':
            return (
              (b.reputableSellers[0]?.trustScore || 0) -
              (a.reputableSellers[0]?.trustScore || 0)
            );
          case 'score':
          default:
            return b.scoreBreakdown.totalScore - a.scoreBreakdown.totalScore;
        }
      });
  }, [
    snapshot,
    onlyCurrentSeason,
    platformFilter,
    categoryFilter,
    onlyLowCompetition,
    onlyFreeSample,
    searchQuery,
    sortBy,
  ]);

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center text-sm text-slate-400">
        Đang tải dữ liệu Săn Sản Phẩm Affiliate Theo Mùa...
      </div>
    );
  }

  const { status, seasons, dailyTop10 } = snapshot;

  const handleSeasonChange = async (seasonId: SeasonId) => {
    try {
      const next = await updateAffiliateConfig({ activeSeason: seasonId });
      onSnapshotUpdated(next);
      onNotify(
        `Đã chuyển sang mùa "${next.status.activeSeason.shortName}" & tự động chấm điểm lại Top 10!`,
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi đổi mùa vụ', 'error');
    }
  };

  const handleStrategyChange = async (strategy: ScoringStrategy) => {
    try {
      const next = await updateAffiliateConfig({ strategy });
      onSnapshotUpdated(next);
      onNotify('Đã cập nhật tiêu chí chấm điểm và xếp hạng lại Top 10 hôm nay!', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi đổi tiêu chí', 'error');
    }
  };

  const handleToggleAutoSync = async () => {
    try {
      const next = await updateAffiliateConfig({
        autoSyncEnabled: !status.autoSyncEnabled,
      });
      onSnapshotUpdated(next);
      onNotify(
        next.status.autoSyncEnabled
          ? 'Đã bật tự động cập nhật dữ liệu theo giờ & ngày.'
          : 'Đã tạm dừng tự động cập nhật theo giờ.',
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi cập nhật tự động', 'error');
    }
  };

  const handleManualHourlySync = async () => {
    setSyncingHourly(true);
    try {
      const next = await triggerHourlyAffiliateSync();
      onSnapshotUpdated(next);
      onNotify(
        'Đã cập nhật lượt mua theo giờ mới nhất trên Shopee & TikTok Shop!',
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi đồng bộ theo giờ', 'error');
    } finally {
      setSyncingHourly(false);
    }
  };

  const handleManualDailyAnalyze = async () => {
    setAnalyzingDaily(true);
    try {
      const next = await triggerDailyTop10Analysis();
      onSnapshotUpdated(next);
      onNotify('Đã phân tích & chốt lại danh sách Top 10 sản phẩm tốt nhất hôm nay!', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Lỗi phân tích Top 10', 'error');
    } finally {
      setAnalyzingDaily(false);
    }
  };

  const handleAiLiveScan = async () => {
    setAiScanning(true);
    try {
      const res = await scanLiveAffiliateTrends(aiKeyword, status.activeSeason.id);
      onSnapshotUpdated(res.snapshot);
      onNotify(
        `AI (${res.modelUsed}) đã phát hiện & chấm điểm thêm ${res.addedCount} sản phẩm hot theo mùa!`,
        'success'
      );
      setAiKeyword('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Quét AI thất bại', 'error');
    } finally {
      setAiScanning(false);
    }
  };

  const handlePushAllTop10ToVideo = () => {
    const items = dailyTop10.entries.map((e) => ({
      name: e.productName,
      prompt: e.videoPrompt916,
    }));
    onPushBatchToVideo(items);
  };

  const openProductById = (productId: string) => {
    const found = snapshot.products.find((p) => p.id === productId);
    if (found) setSelectedProduct(found);
  };

  return (
    <div className="space-y-5">
      {/* 1. Top Seasonal & Hourly/Daily Sync Command Center */}
      <div className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 px-3 py-1 text-xs font-bold text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                Radar Theo Giờ & Ngày
              </span>
              <span className="rounded-full bg-orange-500/15 border border-orange-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-orange-300">
                🛍️ Shopee ({status.shopeeCount})
              </span>
              <span className="rounded-full bg-pink-500/15 border border-pink-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-pink-300">
                🎵 TikTok Shop ({status.tiktokCount})
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white pt-1">
              Săn Sản Phẩm Affiliate Theo Mùa • Nhà Bán Uy Tín & Top 10 Mỗi Ngày
            </h2>
            <p className="text-xs text-slate-300 max-w-3xl">
              {status.activeSeason.description}
            </p>
          </div>

          {/* Sync Status & Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={syncingHourly}
              onClick={handleManualHourlySync}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/20 hover:bg-indigo-600/35 disabled:opacity-50 px-3.5 py-2 text-xs font-bold text-indigo-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingHourly ? 'animate-spin' : ''}`} />
              {syncingHourly ? 'Đang đồng bộ...' : 'Cập Nhật Theo Giờ'}
            </button>

            <button
              type="button"
              disabled={analyzingDaily}
              onClick={handleManualDailyAnalyze}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 px-3.5 py-2 text-xs font-extrabold text-slate-950 shadow transition"
            >
              <Trophy className="w-3.5 h-3.5" />
              {analyzingDaily ? 'Đang chấm...' : 'Chấm Lại Top 10 Hôm Nay'}
            </button>

            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Import CSV/JSON
            </button>
          </div>
        </div>

        {/* Season Selector Pills */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              Chọn Mùa Vụ / Chiến Dịch Săn Sản Phẩm:
            </span>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
              <span>
                Đồng bộ giờ gần nhất:{' '}
                <strong className="text-slate-200">
                  {formatTimeShort(status.lastHourlySyncAt)}
                </strong>{' '}
                ({status.hourlySyncCountToday} lần hôm nay)
              </span>
              <span>•</span>
              <button
                type="button"
                onClick={handleToggleAutoSync}
                className="inline-flex items-center gap-1 text-emerald-300 hover:underline font-semibold"
              >
                <Clock className="w-3 h-3" />
                {status.autoSyncEnabled
                  ? `Tự động sau: ${countdownText || '60p'}`
                  : 'Tự động cập nhật: TẮT'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {seasons.map((s) => {
              const active = s.id === status.activeSeason.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSeasonChange(s.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition border ${
                    active
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-600/25'
                      : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  {s.shortName}
                </button>
              );
            })}
          </div>

          {/* Hot Keywords of Current Season */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-slate-400 mr-1">Từ khoá đang bùng nổ mùa này:</span>
            {status.activeSeason.hotKeywords.map((kw) => (
              <button
                key={kw}
                type="button"
                onClick={() => setAiKeyword(kw)}
                className="rounded-lg bg-slate-800/80 hover:bg-indigo-500/20 border border-slate-700/80 hover:border-indigo-500/40 px-2 py-0.5 text-[11px] text-slate-300 hover:text-indigo-200 transition"
                title="Nhấn để điền vào ô AI Quét Xu Hướng"
              >
                #{kw}
              </button>
            ))}
          </div>
        </div>

        {/* AI Gemini Live Trend Scanner */}
        <div className="rounded-xl border border-violet-500/30 bg-slate-950/80 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-violet-300 shrink-0">
            <Sparkles className="w-4 h-4 text-violet-400" />
            AI Quét Sản Phẩm Mới:
          </div>
          <input
            type="text"
            value={aiKeyword}
            onChange={(e) => setAiKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !aiScanning) void handleAiLiveScan();
            }}
            placeholder="Nhập ngách muốn săn sâu (VD: đồ giữ ấm cho bé, quà Giáng Sinh dưới 200k, đồ dọn nhà Tết...) hoặc để trống quét toàn mùa"
            className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={aiScanning}
            onClick={handleAiLiveScan}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 px-4 py-2 text-xs font-bold text-white shadow transition shrink-0"
          >
            <Zap className={`w-3.5 h-3.5 ${aiScanning ? 'animate-bounce' : ''}`} />
            {aiScanning
              ? 'AI Gemini đang phân tích thị trường...'
              : hasGeminiApiKey
                ? 'AI Quét Xu Hướng Thực Tế'
                : 'AI Quét Xu Hướng (Cần Gemini Key)'}
          </button>
        </div>
      </div>

      {/* Sub-view Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => setSubTab('both')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              subTab === 'both'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Xem Đầy Đủ (Top 10 + Kho Mùa Vụ)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('top10')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              subTab === 'top10'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            Chỉ Xem Top 10 Mỗi Ngày
          </button>
          <button
            type="button"
            onClick={() => setSubTab('catalog')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              subTab === 'catalog'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Kho Sản Phẩm ({filteredProducts.length})
          </button>
        </div>

        {/* Scoring Strategy Selector */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">Tiêu chí chọn Top 10:</span>
          <select
            value={status.strategy}
            onChange={(e) => handleStrategyChange(e.target.value as ScoringStrategy)}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="balanced">
              ⚖️ Cân bằng toàn diện (Mùa vụ + Tốc độ bán + Hoa hồng + Shop Mall)
            </option>
            <option value="high_commission">
              💰 Ưu tiên Hoa hồng cao & Giá trị đơn lớn
            </option>
            <option value="viral_volume">
              🔥 Ưu tiên Viral giá mềm (&lt;300k), dễ nổ nghìn đơn
            </option>
          </select>
        </div>
      </div>

      {/* 2. DAILY TOP 10 BEST AFFILIATE PRODUCTS */}
      {(subTab === 'top10' || subTab === 'both') && (
        <section className="rounded-2xl border border-amber-500/30 bg-slate-900/80 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-slate-950 shadow-lg shadow-amber-500/20">
                <Trophy className="w-6 h-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base sm:text-lg font-extrabold text-white">
                    Top 10 Sản Phẩm Tốt Nhất Hôm Nay ({dailyTop10.date})
                  </h3>
                  <span className="rounded-full bg-amber-500/15 border border-amber-500/35 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                    Tự động phân tích mỗi ngày
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Mùa vụ: <strong className="text-slate-200">{dailyTop10.activeSeasonName}</strong> •
                  Cập nhật lúc {formatTimeShort(dailyTop10.generatedAt)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handlePushAllTop10ToVideo}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-indigo-600/25 transition"
            >
              <Clapperboard className="w-4 h-4" />
              Đẩy Cả Top 10 Sang Tạo Video AI (9:16)
            </button>
          </div>

          {/* AI Executive Summary Box */}
          <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/25 p-3.5 text-xs text-indigo-100 leading-relaxed flex items-start gap-2.5">
            <Award className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-amber-300">Nhận định tự động trong ngày: </strong>
              {dailyTop10.aiExecutiveSummary}
            </div>
          </div>

          {/* Top 10 Ranked Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {dailyTop10.entries.map((entry) => {
              const rankBadgeStyle =
                entry.rank === 1
                  ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 ring-2 ring-amber-300/60'
                  : entry.rank === 2
                    ? 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-950'
                    : entry.rank === 3
                      ? 'bg-gradient-to-br from-orange-300 to-amber-600 text-slate-950'
                      : 'bg-slate-800 text-slate-200 border border-slate-700';

              return (
                <div
                  key={entry.productId}
                  className={`rounded-2xl border p-4 transition flex flex-col justify-between gap-3 ${
                    entry.rank <= 3
                      ? 'border-amber-500/35 bg-gradient-to-br from-slate-950/95 to-amber-950/10 hover:border-amber-400/60'
                      : 'border-slate-800 bg-slate-950/75 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2.5">
                    {/* Top Row: Rank + Platforms + Score */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black shadow ${rankBadgeStyle}`}
                        >
                          #{entry.rank}
                        </span>
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${entry.thumbnailGradient} text-lg`}
                        >
                          {entry.thumbnailEmoji}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {entry.platforms.map((pf) => (
                            <PlatformBadge key={pf} platform={pf} />
                          ))}
                          <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                            {entry.scoreBreakdown.recommendationTag}
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-black text-amber-300">
                          {entry.scoreBreakdown.totalScore}
                          <span className="text-[10px] font-normal text-slate-400">/100</span>
                        </div>
                        <div className="text-[10px] text-slate-500">Điểm tổng hợp</div>
                      </div>
                    </div>

                    {/* Product Title */}
                    <h4
                      onClick={() => openProductById(entry.productId)}
                      className="text-sm font-bold text-white hover:text-indigo-300 cursor-pointer leading-snug line-clamp-2"
                    >
                      {entry.productName}
                    </h4>

                    {/* Key Metrics Grid */}
                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-900/90 border border-slate-800/80 p-2.5 text-xs">
                      <div>
                        <div className="text-[10px] text-slate-400">Giá & Hoa hồng</div>
                        <div className="font-bold text-white mt-0.5">
                          {formatVnd(entry.priceVnd)}
                        </div>
                        <div className="text-[11px] font-bold text-emerald-400">
                          {entry.commissionRatePct}% (~{formatVnd(entry.estimatedCommissionVnd)})
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-400">Tốc độ 1 giờ qua</div>
                        <div className="font-bold text-white mt-0.5">
                          {entry.soldLastHour} đơn/h
                        </div>
                        <div className="text-[11px] font-bold text-emerald-400">
                          +{entry.hourlyGrowthPct}% giờ qua
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-400">Tổng 24 giờ qua</div>
                        <div className="font-bold text-amber-300 mt-0.5">
                          {entry.soldToday.toLocaleString('vi-VN')} đơn
                        </div>
                        <div className="text-[11px] text-indigo-300">
                          +{entry.dailyGrowthPct}% hôm qua
                        </div>
                      </div>
                    </div>

                    {/* Reputable Seller Highlight */}
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/15 px-3 py-2 text-xs flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-[11px] text-slate-400">Shop uy tín #1:</span>
                          <strong className="text-emerald-200 truncate">
                            {entry.bestSeller.shopName}
                          </strong>
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-300">
                            {entry.bestSeller.badge}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Uy tín <strong className="text-emerald-300">{entry.bestSeller.trustScore}/100</strong> •
                          Giao đúng hạn {entry.bestSeller.onTimeShipPct}% • Giờ vàng đăng:{' '}
                          <span className="text-amber-300">{entry.goldenHourToPost}</span>
                        </div>
                      </div>

                      <a
                        href={entry.bestSeller.shopSearchUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Mở tìm gian hàng trên sàn"
                        className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 p-2 text-slate-200"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    {/* Suggested Hook */}
                    <div className="text-[11px] text-slate-300 bg-slate-900/60 rounded-lg px-2.5 py-1.5 border border-slate-800/70">
                      <span className="text-indigo-400 font-semibold">Hook 3s chốt đơn: </span>"
                      {entry.suggestedHook}"
                    </div>
                  </div>

                  {/* Card Footer Buttons */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/70">
                    <button
                      type="button"
                      onClick={() => openProductById(entry.productId)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition"
                    >
                      <Store className="w-3.5 h-3.5 text-emerald-400" />
                      Xem Dữ Kiện & Các Shop Uy Tín
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const fullProd = snapshot.products.find((p) => p.id === entry.productId);
                        if (fullProd) onPushProductToVideo(fullProd);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white transition"
                    >
                      <Clapperboard className="w-3.5 h-3.5" />
                      Tạo Video 9:16
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. FULL SEASONAL PRODUCT EXPLORER & FILTERABLE CATALOG */}
      {(subTab === 'catalog' || subTab === 'both') && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Flame className="w-5 h-5 text-orange-400" />
                Bảng Tổng Hợp Sản Phẩm Mua Nhiều Theo Giờ & Ngày ({filteredProducts.length} sản phẩm)
              </h3>
              <p className="text-xs text-slate-400">
                Bấm vào bất kỳ sản phẩm nào để xem biểu đồ 24 giờ, bằng chứng người mua và danh sách nhà bán hàng Mall / Yêu Thích+ uy tín.
              </p>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên sản phẩm, ngành hàng, tên shop..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {(
                [
                  { id: 'all', label: 'Tất cả sàn' },
                  { id: 'shopee', label: '🛍️ Shopee' },
                  { id: 'tiktok', label: '🎵 TikTok' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPlatformFilter(tab.id)}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                    platformFilter === tab.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">Tất cả ngành hàng</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortField)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="score">Sắp xếp: Điểm Affiliate cao nhất</option>
              <option value="soldLastHour">Sắp xếp: Lượt bán 1 giờ qua</option>
              <option value="hourlyGrowth">Sắp xếp: Tăng trưởng theo giờ (%)</option>
              <option value="soldToday">Sắp xếp: Tổng đơn 24 giờ qua</option>
              <option value="commissionCash">Sắp xếp: Tiền hoa hồng / đơn</option>
              <option value="commissionPct">Sắp xếp: % Hoa hồng cao nhất</option>
              <option value="sellerTrust">Sắp xếp: Độ uy tín Shop cao nhất</option>
            </select>
          </div>

          {/* Quick Filter Checkboxes */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Filter className="w-3.5 h-3.5" /> Bộ lọc nhanh KOC:
            </span>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyCurrentSeason}
                onChange={(e) => setOnlyCurrentSeason(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-indigo-600"
              />
              <span>Chỉ hiện sản phẩm thuộc mùa "{status.activeSeason.shortName}"</span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyLowCompetition}
                onChange={(e) => setOnlyLowCompetition(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-emerald-600"
              />
              <span className="text-emerald-300 font-medium">
                💎 Ngách vàng (Ít KOC cạnh tranh)
              </span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyFreeSample}
                onChange={(e) => setOnlyFreeSample(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-amber-500"
              />
              <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
                <Gift className="w-3.5 h-3.5" /> Có hỗ trợ Sản Phẩm Mẫu (Free Sample)
              </span>
            </label>
          </div>

          {/* Product Grid */}
          {filteredProducts.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-8 text-center text-xs text-slate-400">
              Không có sản phẩm nào khớp bộ lọc hiện tại. Hãy thử tắt lọc "Chỉ hiện sản phẩm thuộc mùa" hoặc bấm <strong>AI Quét Xu Hướng Thực Tế</strong>.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredProducts.map((p) => {
                const topSeller = p.reputableSellers[0];
                const last12Hours = p.hourlyHistory.slice(-12);
                const max12 = Math.max(1, ...last12Hours.map((h) => h.sold));

                return (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/85 hover:border-indigo-500/50 transition p-4 flex flex-col justify-between gap-3 shadow"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${p.thumbnailGradient} text-xl shadow`}
                          >
                            {p.thumbnailEmoji}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-1">
                              {p.platforms.map((pf) => (
                                <PlatformBadge key={pf} platform={pf} />
                              ))}
                              {p.source === 'gemini_live_scan' && (
                                <span className="rounded bg-violet-500/20 border border-violet-500/40 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
                                  ✨ AI Mới Quét
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {p.category} • ★ {p.rating} ({p.buyerEvidence.totalReviews.toLocaleString('vi-VN')})
                            </div>
                          </div>
                        </div>

                        <span className="rounded-xl bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-1 text-xs font-black text-indigo-300 shrink-0">
                          {p.scoreBreakdown.totalScore}đ
                        </span>
                      </div>

                      <h4
                        onClick={() => setSelectedProduct(p)}
                        className="text-sm font-bold text-white hover:text-indigo-300 cursor-pointer line-clamp-2 leading-snug"
                      >
                        {p.name}
                      </h4>

                      {/* Price & Commission */}
                      <div className="flex items-center justify-between rounded-xl bg-slate-900 border border-slate-800/90 px-3 py-2 text-xs">
                        <div>
                          <div className="text-[10px] text-slate-400">Giá khách mua</div>
                          <div className="font-extrabold text-white">
                            {formatVnd(p.priceVnd)}{' '}
                            <span className="text-[10px] text-rose-400 font-semibold">
                              -{p.discountPct}%
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">Hoa hồng Affiliate</div>
                          <div className="font-extrabold text-emerald-400">
                            {p.commissionRatePct}% (~{formatVnd(p.estimatedCommissionVnd)}/đơn)
                          </div>
                        </div>
                      </div>

                      {/* Hourly Sparkline & Velocity */}
                      <div className="flex items-center justify-between gap-3 px-1">
                        <div className="space-y-0.5 text-xs">
                          <div className="flex items-center gap-1.5">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="font-bold text-white">{p.soldLastHour} đơn/giờ</span>
                            <span className="text-[11px] font-bold text-emerald-400">
                              (+{p.hourlyGrowthPct}%)
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            24h: <strong className="text-slate-200">{p.soldToday.toLocaleString('vi-VN')} đơn</strong> •
                            CVR <strong className="text-amber-300">{p.conversionRatePct}%</strong>
                          </div>
                        </div>

                        {/* Mini 12h bars */}
                        <div
                          className="flex items-end gap-0.5 h-9 w-24 shrink-0"
                          title="Xu hướng lượt mua 12 giờ gần nhất"
                        >
                          {last12Hours.map((h, i) => (
                            <div
                              key={i}
                              className={`flex-1 rounded-t ${
                                i === last12Hours.length - 1 ? 'bg-emerald-400' : 'bg-indigo-500/70'
                              }`}
                              style={{ height: `${Math.max(15, Math.round((h.sold / max12) * 100))}%` }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Top Reputable Seller */}
                      {topSeller && (
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] flex items-center justify-between gap-2">
                          <div className="truncate">
                            <span className="text-emerald-400 font-bold">✓ {topSeller.badge}: </span>
                            <span className="text-slate-200 font-semibold">
                              {topSeller.shopName}
                            </span>
                          </div>
                          <span className="shrink-0 font-bold text-emerald-300">
                            {topSeller.trustScore}/100
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Action Row */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(p)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition"
                      >
                        <Star className="w-3.5 h-3.5 text-amber-400" />
                        Chi Tiết & {p.reputableSellers.length} Shop
                      </button>
                      <button
                        type="button"
                        onClick={() => onPushProductToVideo(p)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-bold text-white transition"
                      >
                        <Clapperboard className="w-3.5 h-3.5" />
                        Video AI
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Modals */}
      {selectedProduct && (
        <AffiliateProductModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onPushToVideoStudio={onPushProductToVideo}
        />
      )}

      {showImportModal && (
        <AffiliateImportModal
          onClose={() => setShowImportModal(false)}
          onImport={async (records) => {
            const res = await importAffiliateProducts(records);
            onSnapshotUpdated(res.snapshot);
            onNotify(
              `Đã import thành công ${res.importedCount} sản phẩm và cập nhật bảng xếp hạng Top 10!`,
              'success'
            );
          }}
        />
      )}
    </div>
  );
};
