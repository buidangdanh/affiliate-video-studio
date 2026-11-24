import {
  buildInitialAffiliateCatalog,
  computeSellerTrustScore,
  detectSeasonForDate,
  generateDailySeries,
  generateHourlySeries,
  SEASON_DEFINITIONS,
} from '../server/affiliateSeedData.ts';
import {
  buildFallback5SceneStoryboard,
  buildMasterPromptVerbatim,
  composeThreeBlockVideoPrompt6s,
} from '../server/factoryPromptBuilder.ts';
import type {
  AidaStage,
  FactoryProject,
  FactorySceneItem,
  FactoryStylePreset,
  McOutfitPreset,
} from './factoryTypes';
import type {
  AffiliateProduct,
  AffiliateRadarSnapshot,
  AffiliateScoreBreakdown,
  DailyTop10Report,
  EcommercePlatform,
  ReputableSeller,
  ScoringStrategy,
  SeasonDefinition,
  SeasonId,
  SellerBadge,
  Top10ProductEntry,
} from './affiliateTypes';
import type {
  DraftJob,
  FlowBrowserStatus,
  ProviderMode,
  PublicSystemSettings,
  QueueStats,
  VideoJob,
} from './types';

const LS_AFFILIATE_KEY = 'tao_affiliate_cloud_state_v1';
const LS_SETTINGS_KEY = 'tao_video_cloud_settings_v1';
const LS_JOBS_KEY = 'tao_video_cloud_jobs_v1';
const LS_FACTORY_KEY = 'tao_factory_cloud_projects_v1';

function getVietnamDateString(date = new Date()): string {
  const vnTime = new Date(date.getTime() + 7 * 3600_000);
  return vnTime.toISOString().slice(0, 10);
}

function formatVndShort(amount: number): string {
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(2).replace(/\.00$/, '')}tr`;
  }
  if (amount >= 1_000) {
    return `${Math.round(amount / 1_000)}k`;
  }
  return `${amount}đ`;
}

function getSeasonDef(seasonId: SeasonId): SeasonDefinition {
  return SEASON_DEFINITIONS.find((s) => s.id === seasonId) || SEASON_DEFINITIONS[0];
}

export function scoreProductClient(
  product: Omit<AffiliateProduct, 'scoreBreakdown'>,
  activeSeason: SeasonId,
  strategy: ScoringStrategy
): AffiliateScoreBreakdown {
  let rawSeasonal = 10;
  if (activeSeason === 'all_year') {
    rawSeasonal = product.seasons.includes(detectSeasonForDate()) ? 23 : 18;
  } else if (product.seasons.includes(activeSeason)) {
    rawSeasonal = 24.5;
  } else if (product.seasons.includes('all_year')) {
    rawSeasonal = 16;
  } else {
    rawSeasonal = 8.5;
  }

  const hourlyVolumeNorm = Math.min(1, product.soldLastHour / 170);
  const hourlyGrowthNorm = Math.min(1, Math.max(0, product.hourlyGrowthPct / 48));
  const dailyGrowthNorm = Math.min(1, Math.max(0, product.dailyGrowthPct / 42));
  const convNorm = Math.min(1, product.conversionRatePct / 8.5);
  const rawVelocity =
    (hourlyVolumeNorm * 0.34 +
      hourlyGrowthNorm * 0.28 +
      dailyGrowthNorm * 0.2 +
      convNorm * 0.18) *
    30;

  const commRateNorm = Math.min(1, product.commissionRatePct / 22);
  const commCashNorm = Math.min(1, product.estimatedCommissionVnd / 95_000);
  const compBonus =
    product.competitionLevel === 'low'
      ? 1.0
      : product.competitionLevel === 'medium'
        ? 0.65
        : 0.3;
  const perkBonus =
    (product.freeSampleAvailable ? 0.55 : 0) + (product.hasExtraBonus ? 0.45 : 0);
  const rawCommission =
    (commRateNorm * 0.35 +
      commCashNorm * 0.35 +
      compBonus * 0.18 +
      perkBonus * 0.12) *
    25;

  const bestSellerTrust = product.reputableSellers[0]?.trustScore ?? 78;
  const sellerNorm = Math.min(1, Math.max(0, (bestSellerTrust - 65) / 33));
  const ratingNorm = Math.min(1, Math.max(0, (product.rating - 4.4) / 0.55));
  const lowReturnNorm = Math.min(
    1,
    Math.max(0, (3.5 - product.buyerEvidence.returnRatePct) / 3.0)
  );
  const rawTrust = (sellerNorm * 0.5 + ratingNorm * 0.3 + lowReturnNorm * 0.2) * 20;

  let seasonalFitScore = rawSeasonal;
  let velocityScore = rawVelocity;
  let commissionScore = rawCommission;
  const sellerTrustScore = Number(Math.min(20, Math.max(0, rawTrust)).toFixed(1));

  if (strategy === 'high_commission') {
    commissionScore = Math.min(
      25,
      rawCommission * 1.18 + (product.estimatedCommissionVnd >= 60_000 ? 2.2 : 0)
    );
    velocityScore = rawVelocity * 0.92;
  } else if (strategy === 'viral_volume') {
    const easyPriceBonus = product.priceVnd <= 300_000 ? 2.6 : 0;
    velocityScore = Math.min(30, rawVelocity * 1.15 + easyPriceBonus);
    commissionScore = rawCommission * 0.92;
  }

  seasonalFitScore = Number(Math.min(25, Math.max(0, seasonalFitScore)).toFixed(1));
  velocityScore = Number(Math.min(30, Math.max(0, velocityScore)).toFixed(1));
  commissionScore = Number(Math.min(25, Math.max(0, commissionScore)).toFixed(1));

  const totalScore = Number(
    Math.min(99.5, seasonalFitScore + velocityScore + commissionScore + sellerTrustScore).toFixed(1)
  );

  let recommendationTag = 'Đáng Làm Affiliate';
  if (product.competitionLevel === 'low' && product.hourlyGrowthPct >= 30) {
    recommendationTag = 'Ngách Vàng Đang Bùng Nổ';
  } else if (product.estimatedCommissionVnd >= 70_000) {
    recommendationTag = 'Hoa Hồng Cao Trên Đơn';
  } else if (product.conversionRatePct >= 7.0 && product.priceVnd <= 250_000) {
    recommendationTag = 'Siêu Dễ Chốt Nghìn Đơn';
  } else if (seasonalFitScore >= 23) {
    recommendationTag = 'Đúng Đỉnh Mùa Vụ';
  }

  const topSeller = product.reputableSellers[0];
  const whyPickSummary = `Tăng +${product.hourlyGrowthPct.toFixed(0)}%/giờ (${product.soldToday.toLocaleString('vi-VN')} đơn/24h), hoa hồng ${product.commissionRatePct}% (~${formatVndShort(product.estimatedCommissionVnd)}/đơn), CVR ${product.conversionRatePct}%${
    topSeller ? `, gắn giỏ ${topSeller.shopName} (${topSeller.badge}, uy tín ${topSeller.trustScore}/100)` : ''
  }.`;

  return {
    totalScore,
    seasonalFitScore,
    velocityScore,
    commissionScore,
    sellerTrustScore,
    recommendationTag,
    whyPickSummary,
  };
}

interface CloudAffiliatePersisted {
  activeSeason: SeasonId;
  strategy: ScoringStrategy;
  autoSyncEnabled: boolean;
  hourlyIntervalMinutes: number;
  lastHourlySyncAt: string;
  nextHourlySyncAt: string;
  lastDailyAnalysisAt: string;
  lastAiLiveScanAt: string | null;
  hourlySyncCountToday: number;
  products: AffiliateProduct[];
  dailyTop10: DailyTop10Report;
}

interface CloudSettingsPersisted {
  providerMode: ProviderMode;
  geminiApiKey: string;
  flowProjectUrl: string;
  maxConcurrency: number;
  maxJobsPerMinute: number;
  mockDurationSec: number;
  mockFailureRate: number;
  isPaused: boolean;
}

function buildDailyReport(
  products: AffiliateProduct[],
  activeSeason: SeasonId,
  strategy: ScoringStrategy,
  customSummary?: string
): DailyTop10Report {
  const now = new Date();
  const todayStr = getVietnamDateString(now);
  const seasonDef = getSeasonDef(activeSeason);
  const sorted = [...products]
    .map((p) => ({
      ...p,
      scoreBreakdown: scoreProductClient(p, activeSeason, strategy),
    }))
    .sort((a, b) => b.scoreBreakdown.totalScore - a.scoreBreakdown.totalScore);

  const entries: Top10ProductEntry[] = sorted.slice(0, 10).map((p, idx) => ({
    rank: idx + 1,
    productId: p.id,
    productName: p.name,
    category: p.category,
    primaryPlatform: p.primaryPlatform,
    platforms: p.platforms,
    thumbnailEmoji: p.thumbnailEmoji,
    thumbnailGradient: p.thumbnailGradient,
    priceVnd: p.priceVnd,
    commissionRatePct: p.commissionRatePct,
    estimatedCommissionVnd: p.estimatedCommissionVnd,
    soldLastHour: p.soldLastHour,
    soldToday: p.soldToday,
    hourlyGrowthPct: p.hourlyGrowthPct,
    dailyGrowthPct: p.dailyGrowthPct,
    bestSeller: p.reputableSellers[0],
    scoreBreakdown: p.scoreBreakdown,
    goldenHourToPost: p.buyerEvidence.peakBuyingHours,
    suggestedHook: p.viralHooks[0] || `Review thực tế ${p.name}!`,
    videoPrompt916: p.videoPrompt916,
  }));

  const avgComm =
    entries.length > 0
      ? (entries.reduce((s, e) => s + e.commissionRatePct, 0) / entries.length).toFixed(1)
      : '16.5';
  const totalOrders = entries.reduce((s, e) => s + e.soldToday, 0);

  return {
    date: todayStr,
    generatedAt: now.toISOString(),
    activeSeason,
    activeSeasonName: seasonDef.name,
    strategy,
    aiExecutiveSummary:
      customSummary ||
      `Báo cáo ngày ${todayStr} (${seasonDef.shortName}): Đã chấm điểm tự động ${products.length} sản phẩm trên Shopee & TikTok Shop, chọn ra Top 10 đạt tổng ${totalOrders.toLocaleString('vi-VN')} đơn/24h với hoa hồng trung bình ${avgComm}% và 100% có gian hàng Mall / Yêu Thích+ uy tín >= 90/100.`,
    entries,
  };
}

class StandaloneClientEngine {
  private loadAffiliate(): CloudAffiliatePersisted {
    try {
      const raw = localStorage.getItem(LS_AFFILIATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CloudAffiliatePersisted;
        if (Array.isArray(parsed.products) && parsed.products.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage error
    }

    const now = new Date();
    const activeSeason = detectSeasonForDate(now);
    const strategy: ScoringStrategy = 'balanced';
    const rawCatalog = buildInitialAffiliateCatalog(now);
    const products: AffiliateProduct[] = rawCatalog.map((item) => ({
      ...item,
      scoreBreakdown: scoreProductClient(item, activeSeason, strategy),
    }));
    const dailyTop10 = buildDailyReport(products, activeSeason, strategy);

    const init: CloudAffiliatePersisted = {
      activeSeason,
      strategy,
      autoSyncEnabled: true,
      hourlyIntervalMinutes: 60,
      lastHourlySyncAt: now.toISOString(),
      nextHourlySyncAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      lastDailyAnalysisAt: now.toISOString(),
      lastAiLiveScanAt: null,
      hourlySyncCountToday: 1,
      products,
      dailyTop10,
    };
    this.saveAffiliate(init);
    return init;
  }

  private saveAffiliate(st: CloudAffiliatePersisted): void {
    try {
      localStorage.setItem(LS_AFFILIATE_KEY, JSON.stringify(st));
    } catch {
      // Ignore quota errors
    }
  }

  public loadSettings(): CloudSettingsPersisted {
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY);
      if (raw) return JSON.parse(raw) as CloudSettingsPersisted;
    } catch {
      // Ignore
    }
    return {
      providerMode: 'mock',
      geminiApiKey: '',
      flowProjectUrl: 'https://labs.google/fx/tools/flow',
      maxConcurrency: 4,
      maxJobsPerMinute: 4,
      mockDurationSec: 8,
      mockFailureRate: 0,
      isPaused: false,
    };
  }

  public saveSettings(s: CloudSettingsPersisted): void {
    try {
      localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // Ignore
    }
  }

  public getPublicSettings(): PublicSystemSettings {
    const s = this.loadSettings();
    const key = (s.geminiApiKey || '').trim();
    const masked =
      key.length > 8
        ? `${key.slice(0, 4)}${'•'.repeat(10)}${key.slice(-4)}`
        : key.length > 0
          ? '••••••••'
          : '';
    return {
      providerMode: s.providerMode,
      hasGeminiApiKey: key.length > 0,
      maskedGeminiApiKey: masked,
      flowProjectUrl: s.flowProjectUrl,
      maxConcurrency: s.maxConcurrency,
      maxJobsPerMinute: s.maxJobsPerMinute,
      mockDurationSec: s.mockDurationSec,
      mockFailureRate: s.mockFailureRate,
      isPaused: s.isPaused,
      providerHealth: {
        geminiExhaustedUntil: null,
        geminiExhaustedReason: null,
        flowExhaustedUntil: null,
        flowExhaustedReason: null,
        totalFailovers: 0,
      },
    };
  }

  public getJobs(): VideoJob[] {
    try {
      const raw = localStorage.getItem(LS_JOBS_KEY);
      if (raw) return JSON.parse(raw) as VideoJob[];
    } catch {
      // Ignore
    }
    return [];
  }

  private saveJobs(jobs: VideoJob[]): void {
    try {
      localStorage.setItem(LS_JOBS_KEY, JSON.stringify(jobs));
    } catch {
      // Ignore
    }
  }

  public getStats(): QueueStats {
    const jobs = this.getJobs();
    const s = this.loadSettings();
    return {
      total: jobs.length,
      queued: jobs.filter((j) => j.status === 'queued').length,
      running: jobs.filter((j) => j.status === 'running').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      cancelled: jobs.filter((j) => j.status === 'cancelled').length,
      jobsStartedLastMinute: 0,
      maxJobsPerMinute: s.maxJobsPerMinute,
      maxConcurrency: s.maxConcurrency,
      nextRateLimitSlotAt: null,
      isPaused: s.isPaused,
      recentStartTimestamps: [],
    };
  }

  public getFlowStatus(): FlowBrowserStatus {
    return {
      isBrowserOpen: false,
      isLoggedIn: false,
      isProjectReady: false,
      currentUrl: '',
      browserExecutable: null,
      message: 'Đang xem trên phiên bản Web Online (GitHub Pages). Chạy local (npm run dev) để điều khiển Chrome Flow & render MP4.',
    };
  }

  public getAffiliateSnapshot(): AffiliateRadarSnapshot {
    const st = this.loadAffiliate();
    const sorted = [...st.products].sort(
      (a, b) => b.scoreBreakdown.totalScore - a.scoreBreakdown.totalScore
    );
    const shopeeCount = sorted.filter((p) => p.platforms.includes('shopee')).length;
    const tiktokCount = sorted.filter((p) => p.platforms.includes('tiktok')).length;

    return {
      status: {
        activeSeason: getSeasonDef(st.activeSeason),
        strategy: st.strategy,
        autoSyncEnabled: st.autoSyncEnabled,
        hourlyIntervalMinutes: st.hourlyIntervalMinutes,
        lastHourlySyncAt: st.lastHourlySyncAt,
        nextHourlySyncAt: st.nextHourlySyncAt,
        lastDailyAnalysisAt: st.lastDailyAnalysisAt,
        lastAiLiveScanAt: st.lastAiLiveScanAt,
        totalProductsTracked: sorted.length,
        shopeeCount,
        tiktokCount,
        hourlySyncCountToday: st.hourlySyncCountToday,
      },
      seasons: SEASON_DEFINITIONS,
      products: sorted,
      dailyTop10: st.dailyTop10,
      reportHistoryDates: [st.dailyTop10.date],
    };
  }

  public updateAffiliateConfig(patch: {
    activeSeason?: SeasonId;
    strategy?: ScoringStrategy;
    autoSyncEnabled?: boolean;
    hourlyIntervalMinutes?: number;
  }): AffiliateRadarSnapshot {
    const st = this.loadAffiliate();
    if (patch.activeSeason) st.activeSeason = patch.activeSeason;
    if (patch.strategy) st.strategy = patch.strategy;
    if (patch.autoSyncEnabled !== undefined) st.autoSyncEnabled = patch.autoSyncEnabled;
    if (patch.hourlyIntervalMinutes !== undefined) {
      st.hourlyIntervalMinutes = patch.hourlyIntervalMinutes;
    }

    st.products = st.products.map((p) => ({
      ...p,
      scoreBreakdown: scoreProductClient(p, st.activeSeason, st.strategy),
    }));
    st.dailyTop10 = buildDailyReport(st.products, st.activeSeason, st.strategy);
    st.lastDailyAnalysisAt = new Date().toISOString();
    this.saveAffiliate(st);
    return this.getAffiliateSnapshot();
  }

  public runHourlySync(): AffiliateRadarSnapshot {
    const st = this.loadAffiliate();
    const now = new Date();
    const nowIso = now.toISOString();
    const todayStr = getVietnamDateString(now);
    const hourLabel = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    st.products = st.products.map((p) => {
      const wave = 0.92 + Math.random() * 0.22;
      const nextSold = Math.max(5, Math.round(p.soldLastHour * wave));
      const delta = ((nextSold - p.soldLastHour) / Math.max(1, p.soldLastHour)) * 100;
      const nextGrowth = Number(
        Math.max(-15, Math.min(85, p.hourlyGrowthPct * 0.65 + delta * 0.35)).toFixed(1)
      );
      const nextHourlyHistory = [
        ...p.hourlyHistory.slice(-23),
        {
          hourLabel,
          timestamp: nowIso,
          sold: nextSold,
          revenueVnd: nextSold * p.priceVnd,
          liveViewers: Math.round(nextSold * 6),
        },
      ];
      const nextSoldToday = nextHourlyHistory.reduce((s, h) => s + h.sold, 0);
      const base = {
        ...p,
        soldLastHour: nextSold,
        hourlyGrowthPct: nextGrowth,
        soldToday: nextSoldToday,
        revenueTodayVnd: nextSoldToday * p.priceVnd,
        hourlyHistory: nextHourlyHistory,
        lastHourlySyncAt: nowIso,
      };
      return {
        ...base,
        scoreBreakdown: scoreProductClient(base, st.activeSeason, st.strategy),
      };
    });

    st.hourlySyncCountToday += 1;
    st.lastHourlySyncAt = nowIso;
    st.nextHourlySyncAt = new Date(
      now.getTime() + st.hourlyIntervalMinutes * 60_000
    ).toISOString();
    st.dailyTop10 = buildDailyReport(
      st.products,
      st.activeSeason,
      st.strategy,
      st.dailyTop10.date === todayStr ? st.dailyTop10.aiExecutiveSummary : undefined
    );
    this.saveAffiliate(st);
    return this.getAffiliateSnapshot();
  }

  public runDailyAnalysis(): AffiliateRadarSnapshot {
    const st = this.loadAffiliate();
    st.products = st.products.map((p) => ({
      ...p,
      scoreBreakdown: scoreProductClient(p, st.activeSeason, st.strategy),
    }));
    st.dailyTop10 = buildDailyReport(st.products, st.activeSeason, st.strategy);
    st.lastDailyAnalysisAt = new Date().toISOString();
    this.saveAffiliate(st);
    return this.getAffiliateSnapshot();
  }

  public importProducts(
    records: Array<{
      name: string;
      platform?: EcommercePlatform;
      category?: string;
      priceVnd?: number;
      commissionRatePct?: number;
      soldToday?: number;
      shopName?: string;
      shopBadge?: SellerBadge;
      rating?: number;
    }>
  ): { importedCount: number; snapshot: AffiliateRadarSnapshot } {
    const st = this.loadAffiliate();
    const now = new Date();
    const nowIso = now.toISOString();
    let importedCount = 0;

    records.forEach((r, idx) => {
      const name = (r.name || '').trim();
      if (!name) return;
      const primaryPlatform: EcommercePlatform = r.platform === 'shopee' ? 'shopee' : 'tiktok';
      const priceVnd = Math.max(10_000, Number(r.priceVnd) || 199_000);
      const commissionRatePct = Math.min(40, Math.max(3, Number(r.commissionRatePct) || 15));
      const baseHourly = Math.max(5, Math.round((Number(r.soldToday) || 1200) / 24));
      const hourlyHistory = generateHourlySeries(baseHourly, priceVnd, now);
      const soldToday = hourlyHistory.reduce((s, h) => s + h.sold, 0);
      const dailyHistory = generateDailySeries(soldToday, priceVnd, 1.06, now);
      const shortKw = name.split(' ').slice(0, 6).join(' ');
      const badge: SellerBadge =
        r.shopBadge || (primaryPlatform === 'shopee' ? 'Shopee Mall' : 'TikTok Shop Mall');

      const sellerRaw = {
        id: `cloud-imp-sel-${Date.now()}-${idx}`,
        shopName: r.shopName || 'Gian Hàng Chính Hãng',
        platform: primaryPlatform,
        badge,
        location: 'Việt Nam',
        rating: Number(r.rating) || 4.9,
        reviewCount: 8200,
        followers: 135000,
        yearsActive: 4,
        responseRatePct: 98,
        onTimeShipPct: 99.1,
        returnRatePct: 0.9,
        sellingPriceVnd: priceVnd,
        commissionRatePct,
        extraCommissionNote: 'Dữ liệu Import trực tuyến',
        freeSampleAvailable: true,
        stockCount: 3000,
        recommendedReason: 'Gian hàng có chỉ số uy tín cao từ dữ liệu import.',
        shopSearchUrl:
          primaryPlatform === 'shopee'
            ? `https://shopee.vn/search?keyword=${encodeURIComponent(shortKw)}`
            : `https://www.tiktok.com/search?q=${encodeURIComponent(shortKw + ' TikTok Shop')}`,
      };

      const prodBase: Omit<AffiliateProduct, 'scoreBreakdown'> = {
        id: `cloud-imp-${Date.now()}-${idx}`,
        name,
        slug: `cloud-imp-${Date.now()}-${idx}`,
        category: r.category || 'Sản Phẩm Import',
        subcategory: 'Dữ liệu nhập ngoài',
        platforms: [primaryPlatform],
        primaryPlatform,
        seasons: [st.activeSeason],
        thumbnailEmoji: '📦',
        thumbnailGradient: 'from-indigo-500 to-cyan-600',
        priceVnd,
        originalPriceVnd: Math.round(priceVnd * 1.35),
        discountPct: 26,
        commissionRatePct,
        estimatedCommissionVnd: Math.round((priceVnd * commissionRatePct) / 100),
        freeSampleAvailable: true,
        hasExtraBonus: false,
        soldLastHour: hourlyHistory[hourlyHistory.length - 1]?.sold || baseHourly,
        hourlyGrowthPct: 25.0,
        soldToday,
        dailyGrowthPct: 21.0,
        sold7d: dailyHistory.reduce((s, d) => s + d.sold, 0),
        sold30d: soldToday * 24,
        revenueTodayVnd: soldToday * priceVnd,
        conversionRatePct: 6.1,
        creatorCount7d: 90,
        competitionLevel: 'low',
        rating: Number(r.rating) || 4.9,
        buyerEvidence: {
          totalReviews: 4500,
          positiveRatePct: 97.2,
          repeatPurchaseRatePct: 19.0,
          returnRatePct: 1.0,
          peakBuyingHours: '12:00 - 13:30 & 20:00 - 23:00',
          targetAudience: 'Người tiêu dùng mua sắm trực tuyến',
          topPraiseKeywords: ['Đúng mô tả', 'Giao nhanh', 'Đáng tiền'],
          cautionNotes: ['Kiểm tra tồn kho trước khi lên video'],
        },
        reputableSellers: [
          {
            ...sellerRaw,
            trustScore: computeSellerTrustScore(sellerRaw),
          },
        ],
        hourlyHistory,
        dailyHistory,
        viralHooks: [`Review chi tiết ${name} đang bán cực chạy hôm nay!`],
        videoPrompt916: `Vertical 9:16 commercial product video showcasing ${name}, modern studio lighting, 4K`,
        productSearchUrlShopee: `https://shopee.vn/search?keyword=${encodeURIComponent(shortKw)}`,
        productSearchUrlTiktok: `https://www.tiktok.com/search?q=${encodeURIComponent(shortKw + ' TikTok Shop')}`,
        source: 'user_import',
        lastHourlySyncAt: nowIso,
        lastDailySyncAt: nowIso,
      };

      st.products.unshift({
        ...prodBase,
        scoreBreakdown: scoreProductClient(prodBase, st.activeSeason, st.strategy),
      });
      importedCount += 1;
    });

    st.dailyTop10 = buildDailyReport(st.products, st.activeSeason, st.strategy);
    this.saveAffiliate(st);
    return { importedCount, snapshot: this.getAffiliateSnapshot() };
  }

  public async scanTrendsDirectWithGemini(
    customKeyword?: string,
    seasonId?: SeasonId
  ): Promise<{
    addedCount: number;
    usedSearchGrounding: boolean;
    modelUsed: string;
    aiSummary: string;
    snapshot: AffiliateRadarSnapshot;
  }> {
    const apiKey = this.loadSettings().geminiApiKey.trim();
    if (!apiKey) {
      throw new Error(
        'Vui lòng nhập và lưu Gemini API Key ở mục Cấu Hình phía trên để quét sản phẩm mới bằng AI trực tiếp trên trình duyệt!'
      );
    }

    const st = this.loadAffiliate();
    const targetSeason = seasonId || st.activeSeason;
    const seasonDef = getSeasonDef(targetSeason);
    const todayStr = getVietnamDateString();

    // Discover best available flash text model
    let modelUsed = 'gemini-2.5-flash';
    try {
      const mRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
        { headers: { 'x-goog-api-key': apiKey } }
      );
      if (mRes.ok) {
        const mData = (await mRes.json()) as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
        };
        const names = (mData.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => String(m.name || '').replace(/^models\//, ''))
          .filter((n) => !/tts|image|embedding|veo|aqa/i.test(n));
        const flash = names.find((n) => /2\.5-flash|3-flash|2\.0-flash|flash/i.test(n));
        if (flash) modelUsed = flash;
      }
    } catch {
      // Keep default
    }

    const prompt = `Bạn là chuyên gia phân tích sản phẩm Affiliate Shopee & TikTok Shop tại Việt Nam.
Ngày: ${todayStr}. Mùa vụ: "${seasonDef.name}". ${customKeyword ? `Từ khoá trọng tâm: "${customKeyword}".` : ''}
Hãy gợi ý 4 sản phẩm đang được mua nhiều theo mùa này tại Việt Nam kèm gian hàng Mall uy tín.
Chỉ trả về JSON hợp lệ theo mẫu:
{
  "executiveSummary": "Nhận định xu hướng 2 câu ngắn gọn.",
  "products": [
    {
      "name": "Tên sản phẩm chuẩn TMĐT",
      "category": "Ngành hàng",
      "primaryPlatform": "tiktok",
      "emoji": "🔥",
      "priceVnd": 249000,
      "originalPriceVnd": 360000,
      "commissionRatePct": 18,
      "soldLastHour": 95,
      "hourlyGrowthPct": 35,
      "dailyGrowthPct": 28,
      "conversionRatePct": 6.8,
      "viralHooks": ["Câu hook 3s thu hút người xem"],
      "videoPrompt916": "Vertical 9:16 commercial product showcase video, 4K",
      "seller": {
        "shopName": "Tên Shop Mall Uy Tín",
        "platform": "tiktok",
        "badge": "TikTok Shop Mall",
        "location": "Hà Nội",
        "rating": 4.9,
        "recommendedReason": "Lý do nên chọn shop này"
      }
    }
  ]
}`;

    const callEndpoint = async (withSearch: boolean) => {
      const body: Record<string, unknown> = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: withSearch
          ? { temperature: 0.4 }
          : { temperature: 0.5, responseMimeType: 'application/json' },
      };
      if (withSearch) {
        body.tools = [{ google_search: {} }];
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelUsed}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Gemini request failed');
      const text =
        data.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text || '')
          .join('') || '';
      return text;
    };

    let rawText = '';
    let usedSearchGrounding = false;
    try {
      rawText = await callEndpoint(true);
      usedSearchGrounding = true;
    } catch {
      rawText = await callEndpoint(false);
      usedSearchGrounding = false;
    }

    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Không đọc được JSON từ phản hồi AI.');
    const parsed = JSON.parse(match[0]) as {
      executiveSummary?: string;
      products?: Array<Record<string, unknown>>;
    };

    const list = Array.isArray(parsed.products) ? parsed.products : [];
    const now = new Date();
    const nowIso = now.toISOString();
    let addedCount = 0;

    list.forEach((item, idx) => {
      const name = String(item.name || '').trim();
      if (!name) return;
      const priceVnd = Math.max(29_000, Number(item.priceVnd) || 239_000);
      const originalPriceVnd = Math.max(priceVnd, Number(item.originalPriceVnd) || Math.round(priceVnd * 1.4));
      const commissionRatePct = Math.min(35, Math.max(6, Number(item.commissionRatePct) || 17));
      const baseHourly = Math.max(15, Number(item.soldLastHour) || 85);
      const primaryPlatform: EcommercePlatform =
        item.primaryPlatform === 'shopee' ? 'shopee' : 'tiktok';
      const hourlyHistory = generateHourlySeries(baseHourly, priceVnd, now);
      const soldToday = hourlyHistory.reduce((s, h) => s + h.sold, 0);
      const dailyHistory = generateDailySeries(soldToday, priceVnd, 1.07, now);
      const shortKw = name.split(' ').slice(0, 6).join(' ');
      const sObj = (item.seller || {}) as Record<string, unknown>;
      const sellerBase: Omit<ReputableSeller, 'trustScore'> = {
        id: `cloud-ai-sel-${Date.now()}-${idx}`,
        shopName: String(sObj.shopName || 'Official Mall Store VN'),
        platform: sObj.platform === 'shopee' ? 'shopee' : primaryPlatform,
        badge: primaryPlatform === 'shopee' ? 'Shopee Mall' : 'TikTok Shop Mall',
        location: String(sObj.location || 'Hà Nội'),
        rating: 4.9,
        reviewCount: 16400,
        followers: 185000,
        yearsActive: 4,
        responseRatePct: 98,
        onTimeShipPct: 99.2,
        returnRatePct: 0.9,
        sellingPriceVnd: priceVnd,
        commissionRatePct,
        extraCommissionNote: 'Phát hiện trực tiếp qua AI Gemini',
        freeSampleAvailable: true,
        stockCount: 3500,
        recommendedReason: String(sObj.recommendedReason || 'Gian hàng Mall chính hãng uy tín cao.'),
        shopSearchUrl:
          primaryPlatform === 'shopee'
            ? `https://shopee.vn/search?keyword=${encodeURIComponent(shortKw)}`
            : `https://www.tiktok.com/search?q=${encodeURIComponent(shortKw + ' TikTok Shop')}`,
      };

      const prodBase: Omit<AffiliateProduct, 'scoreBreakdown'> = {
        id: `cloud-ai-${Date.now()}-${idx}`,
        name,
        slug: `cloud-ai-${Date.now()}-${idx}`,
        category: String(item.category || 'Xu Hướng AI Mới'),
        subcategory: seasonDef.shortName,
        platforms: ['shopee', 'tiktok'],
        primaryPlatform,
        seasons: targetSeason === 'all_year' ? [detectSeasonForDate(now)] : [targetSeason],
        thumbnailEmoji: String(item.emoji || '✨').slice(0, 4),
        thumbnailGradient: 'from-violet-500 to-indigo-600',
        priceVnd,
        originalPriceVnd,
        discountPct: Math.round(((originalPriceVnd - priceVnd) / originalPriceVnd) * 100),
        commissionRatePct,
        estimatedCommissionVnd: Math.round((priceVnd * commissionRatePct) / 100),
        freeSampleAvailable: true,
        hasExtraBonus: true,
        soldLastHour: hourlyHistory[hourlyHistory.length - 1]?.sold || baseHourly,
        hourlyGrowthPct: Number(item.hourlyGrowthPct) || 33,
        soldToday,
        dailyGrowthPct: Number(item.dailyGrowthPct) || 27,
        sold7d: dailyHistory.reduce((s, d) => s + d.sold, 0),
        sold30d: soldToday * 25,
        revenueTodayVnd: soldToday * priceVnd,
        conversionRatePct: Number(item.conversionRatePct) || 6.5,
        creatorCount7d: 82,
        competitionLevel: 'low',
        rating: 4.9,
        buyerEvidence: {
          totalReviews: 5800,
          positiveRatePct: 97.5,
          repeatPurchaseRatePct: 22,
          returnRatePct: 0.9,
          peakBuyingHours: '12:00 - 13:30 & 20:00 - 23:00',
          targetAudience: 'Khách hàng mua sắm theo mùa trên Shopee & TikTok Shop',
          topPraiseKeywords: ['Đúng xu hướng mùa vụ', 'Shop Mall giao nhanh', 'Chất lượng tốt'],
          cautionNotes: ['Kiểm tra kỹ phân loại trước khi gắn link'],
        },
        reputableSellers: [
          {
            ...sellerBase,
            trustScore: computeSellerTrustScore(sellerBase),
          },
        ],
        hourlyHistory,
        dailyHistory,
        viralHooks: Array.isArray(item.viralHooks)
          ? item.viralHooks.map(String)
          : [`Review thực tế ${name}!`],
        videoPrompt916: String(
          item.videoPrompt916 ||
            `Vertical 9:16 commercial product showcase video of ${name}, 4K`
        ),
        productSearchUrlShopee: `https://shopee.vn/search?keyword=${encodeURIComponent(shortKw)}`,
        productSearchUrlTiktok: `https://www.tiktok.com/search?q=${encodeURIComponent(shortKw + ' TikTok Shop')}`,
        source: 'gemini_live_scan',
        lastHourlySyncAt: nowIso,
        lastDailySyncAt: nowIso,
      };

      st.products.unshift({
        ...prodBase,
        scoreBreakdown: scoreProductClient(prodBase, st.activeSeason, st.strategy),
      });
      addedCount += 1;
    });

    st.lastAiLiveScanAt = nowIso;
    const aiSummary =
      parsed.executiveSummary ||
      `AI Gemini (${modelUsed}) đã bổ sung ${addedCount} sản phẩm tiềm năng mùa ${seasonDef.shortName}.`;
    st.dailyTop10 = buildDailyReport(st.products, st.activeSeason, st.strategy, aiSummary);
    this.saveAffiliate(st);

    return {
      addedCount,
      usedSearchGrounding,
      modelUsed,
      aiSummary,
      snapshot: this.getAffiliateSnapshot(),
    };
  }

  public enqueueCloudDrafts(drafts: DraftJob[]): {
    createdCount: number;
    jobs: VideoJob[];
    stats: QueueStats;
  } {
    const existing = this.getJobs();
    const s = this.loadSettings();
    const nowIso = new Date().toISOString();
    const created: VideoJob[] = drafts.map((d, idx) => ({
      id: `cloud-job-${Date.now()}-${idx}`,
      seq: existing.length + idx + 1,
      prompt: d.prompt,
      inputType: d.inputType,
      model: d.model,
      aspectRatio: d.aspectRatio,
      outputCount: d.outputCount,
      durationSeconds: d.durationSeconds || 8,
      status: 'queued',
      progress: 0,
      statusMessage:
        'Đã lưu vào danh sách chờ trên Web Online (Chạy bản Local Server để xuất file video MP4 thực tế)',
      retryCount: 0,
      providerMode: s.providerMode,
      outputs: [],
      createdAt: nowIso,
    }));

    const next = [...existing, ...created];
    this.saveJobs(next);
    return {
      createdCount: created.length,
      jobs: created,
      stats: this.getStats(),
    };
  }

  // ==========================================
  // Factory 5-Scene Storyboard (Cloud Mode)
  // ==========================================

  public getFactoryProjects(): FactoryProject[] {
    try {
      const raw = localStorage.getItem(LS_FACTORY_KEY);
      if (raw) return JSON.parse(raw) as FactoryProject[];
    } catch {
      // Ignore
    }
    return [];
  }

  private saveFactoryProjects(projects: FactoryProject[]): void {
    try {
      localStorage.setItem(LS_FACTORY_KEY, JSON.stringify(projects.slice(0, 20)));
    } catch {
      // Ignore
    }
  }

  public async generateFactoryScriptCloud(input: {
    productName: string;
    productHighlights?: string;
    stylePreset?: FactoryStylePreset;
    mcOutfitPreset?: McOutfitPreset;
  }): Promise<{
    usedAiVision: boolean;
    masterPromptUsed: string;
    scenes: FactorySceneItem[];
  }> {
    const productName = (input.productName || '').trim() || 'Sản Phẩm Gia Dụng Thông Minh';
    const productHighlights = (input.productHighlights || '').trim();
    const stylePreset = input.stylePreset || 'factory_conveyor';
    const mcOutfitPreset = input.mcOutfitPreset || 'cream_polo';

    const apiKey = this.loadSettings().geminiApiKey.trim();
    if (!apiKey) {
      return {
        usedAiVision: false,
        ...buildFallback5SceneStoryboard({
          productName,
          productHighlights,
          stylePreset,
          mcOutfitPreset,
        }),
      };
    }

    try {
      const masterPromptUsed = buildMasterPromptVerbatim(
        productName,
        productHighlights,
        stylePreset,
        mcOutfitPreset
      );
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `${masterPromptUsed}
Trả về DUY NHẤT một JSON gồm 5 phân cảnh theo cấu trúc:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "Tiêu đề ngắn",
      "cameraAngle": "Góc máy dọc 9:16",
      "imagePrompt916": "Câu lệnh tiếng Việt tạo ảnh dọc 9:16 chân thực tại nhà xưởng...",
      "actionAndCameraVi": "Mô tả hành động 6 giây của MC và camera...",
      "spokenDialogueVi": "Đúng 1 câu thoại tiếng Việt khoảng 15-18 chữ vừa khít 6 giây"
    }
  ]
}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.45,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      const data = await res.json();
      const text =
        data.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text || '')
          .join('') || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Invalid JSON');
      const parsed = JSON.parse(jsonMatch[0]) as {
        scenes?: Array<{
          title?: string;
          cameraAngle?: string;
          imagePrompt916?: string;
          actionAndCameraVi?: string;
          spokenDialogueVi?: string;
        }>;
      };
      if (!Array.isArray(parsed.scenes) || parsed.scenes.length < 3) {
        throw new Error('Insufficient scenes');
      }

      const aidaStages: AidaStage[] = [
        'Attention (Thu hút tại xưởng)',
        'Interest (Chất liệu & Thiết kế)',
        'Interest (Dung tích & Thông số)',
        'Desire (Test thực tế)',
        'Action (Kho hàng & Chốt giỏ)',
      ];
      const shortName = productName.split(' ').slice(0, 7).join(' ');

      const scenes: FactorySceneItem[] = parsed.scenes.slice(0, 5).map((s, idx) => {
        const spokenDialogueVi = s.spokenDialogueVi || `Tham khảo ngay ${shortName} tại giỏ hàng nhé!`;
        return {
          sceneNumber: idx + 1,
          aidaStage: aidaStages[idx] || 'Interest (Chất liệu & Thiết kế)',
          title: s.title || `Cảnh ${idx + 1}`,
          cameraAngle: s.cameraAngle || 'Góc dọc 9:16 nhà xưởng',
          imagePrompt916: s.imagePrompt916 || '',
          spokenDialogueVi,
          videoPrompt6s: composeThreeBlockVideoPrompt6s({
            productName: shortName,
            actionAndCameraVi: s.actionAndCameraVi || 'MC cầm sản phẩm giới thiệu tự nhiên.',
            spokenDialogueVi,
          }),
          durationSeconds: 6,
          keyframeAsset: null,
          linkedJobId: null,
        };
      });

      return { usedAiVision: true, masterPromptUsed, scenes };
    } catch {
      return {
        usedAiVision: false,
        ...buildFallback5SceneStoryboard({
          productName,
          productHighlights,
          stylePreset,
          mcOutfitPreset,
        }),
      };
    }
  }

  public saveFactoryProjectCloud(payload: {
    id?: string;
    productName: string;
    productHighlights?: string;
    stylePreset?: FactoryStylePreset;
    mcOutfitPreset?: McOutfitPreset;
    videoModel?: string;
    masterPromptUsed?: string;
    scenes: FactorySceneItem[];
  }): FactoryProject {
    const list = this.getFactoryProjects();
    const nowIso = new Date().toISOString();
    const existingIdx = payload.id ? list.findIndex((p) => p.id === payload.id) : -1;

    if (existingIdx >= 0) {
      const updated: FactoryProject = {
        ...list[existingIdx],
        productName: payload.productName,
        productHighlights: payload.productHighlights || '',
        stylePreset: payload.stylePreset || list[existingIdx].stylePreset,
        mcOutfitPreset: payload.mcOutfitPreset || list[existingIdx].mcOutfitPreset,
        videoModel: payload.videoModel || list[existingIdx].videoModel,
        masterPromptUsed: payload.masterPromptUsed || list[existingIdx].masterPromptUsed,
        scenes: payload.scenes,
        updatedAt: nowIso,
      };
      list[existingIdx] = updated;
      this.saveFactoryProjects(list);
      return updated;
    }

    const created: FactoryProject = {
      id: `cloud-factory-${Date.now()}`,
      productName: payload.productName,
      productHighlights: payload.productHighlights || '',
      stylePreset: payload.stylePreset || 'factory_conveyor',
      mcOutfitPreset: payload.mcOutfitPreset || 'cream_polo',
      videoModel: payload.videoModel || 'gemini-omni-1.1-flash',
      productAssets: [],
      mcFaceAsset: null,
      masterPromptUsed: payload.masterPromptUsed || '',
      scenes: payload.scenes,
      status: 'draft',
      statusMessage:
        'Đã sinh trọn bộ 5 phân cảnh AIDA Kho Xưởng. Bạn có thể copy từng câu lệnh sang Google Flow hoặc chạy bản Local để tự động render & ghép MP4 30s!',
      stitchedOutput: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    list.unshift(created);
    this.saveFactoryProjects(list);
    return created;
  }
}

export const standaloneClient = new StandaloneClientEngine();
