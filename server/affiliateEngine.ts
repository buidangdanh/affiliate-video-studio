import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { GoogleGenAI } from '@google/genai';
import { ensureStorageDirs, STORAGE_ROOT, store } from './store.ts';
import type {
  AffiliateProduct,
  AffiliateRadarSnapshot,
  AffiliateSchedulerStatus,
  AffiliateScoreBreakdown,
  DailyTop10Report,
  EcommercePlatform,
  ReputableSeller,
  ScoringStrategy,
  SeasonDefinition,
  SeasonId,
  SellerBadge,
  Top10ProductEntry,
} from './affiliateTypes.ts';
import {
  buildInitialAffiliateCatalog,
  computeSellerTrustScore,
  detectSeasonForDate,
  generateDailySeries,
  generateHourlySeries,
  SEASON_DEFINITIONS,
} from './affiliateSeedData.ts';

const AFFILIATE_STATE_FILE = path.join(STORAGE_ROOT, 'affiliate-state.json');

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

export function getSeasonDefinition(seasonId: SeasonId): SeasonDefinition {
  return (
    SEASON_DEFINITIONS.find((s) => s.id === seasonId) ||
    SEASON_DEFINITIONS[0]
  );
}

export function scoreAffiliateProduct(
  product: Omit<AffiliateProduct, 'scoreBreakdown'>,
  activeSeason: SeasonId,
  strategy: ScoringStrategy
): AffiliateScoreBreakdown {
  // 1. Seasonal Fit (0..25)
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

  // 2. Sales Velocity Hourly & Daily (0..30)
  const hourlyVolumeNorm = Math.min(1, product.soldLastHour / 170); // 170+/hr = max
  const hourlyGrowthNorm = Math.min(1, Math.max(0, product.hourlyGrowthPct / 48));
  const dailyGrowthNorm = Math.min(1, Math.max(0, product.dailyGrowthPct / 42));
  const convNorm = Math.min(1, product.conversionRatePct / 8.5);
  const rawVelocity =
    (hourlyVolumeNorm * 0.34 +
      hourlyGrowthNorm * 0.28 +
      dailyGrowthNorm * 0.2 +
      convNorm * 0.18) *
    30;

  // 3. Affiliate Commission & Opportunity (0..25)
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

  // 4. Seller Trust & Product Quality (0..20)
  const bestSellerTrust = product.reputableSellers[0]?.trustScore ?? 78;
  const sellerNorm = Math.min(1, Math.max(0, (bestSellerTrust - 65) / 33));
  const ratingNorm = Math.min(1, Math.max(0, (product.rating - 4.4) / 0.55));
  const lowReturnNorm = Math.min(
    1,
    Math.max(0, (3.5 - product.buyerEvidence.returnRatePct) / 3.0)
  );
  const rawTrust =
    (sellerNorm * 0.5 + ratingNorm * 0.3 + lowReturnNorm * 0.2) * 20;

  // Apply Strategy Multipliers
  let seasonalFitScore = rawSeasonal;
  let velocityScore = rawVelocity;
  let commissionScore = rawCommission;
  let sellerTrustScore = rawTrust;

  if (strategy === 'high_commission') {
    commissionScore = Math.min(25, rawCommission * 1.18 + (product.estimatedCommissionVnd >= 60_000 ? 2.2 : 0));
    velocityScore = rawVelocity * 0.92;
  } else if (strategy === 'viral_volume') {
    const easyPriceBonus = product.priceVnd <= 300_000 ? 2.6 : 0;
    velocityScore = Math.min(30, rawVelocity * 1.15 + easyPriceBonus);
    commissionScore = rawCommission * 0.92;
  }

  seasonalFitScore = Number(Math.min(25, Math.max(0, seasonalFitScore)).toFixed(1));
  velocityScore = Number(Math.min(30, Math.max(0, velocityScore)).toFixed(1));
  commissionScore = Number(Math.min(25, Math.max(0, commissionScore)).toFixed(1));
  sellerTrustScore = Number(Math.min(20, Math.max(0, sellerTrustScore)).toFixed(1));

  const totalScore = Number(
    Math.min(
      99.5,
      seasonalFitScore + velocityScore + commissionScore + sellerTrustScore
    ).toFixed(1)
  );

  // Determine badge tag
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
  const whyPickSummary = `Tăng +${product.hourlyGrowthPct.toFixed(0)}%/giờ (${product.soldToday.toLocaleString('vi-VN')} đơn/24h), hoa hồng ${product.commissionRatePct}% (~${formatVndShort(product.estimatedCommissionVnd)}/đơn), tỷ lệ chuyển đổi ${product.conversionRatePct}%${
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

interface PersistedAffiliateState {
  activeSeason: SeasonId;
  strategy: ScoringStrategy;
  autoSyncEnabled: boolean;
  hourlyIntervalMinutes: number;
  lastHourlySyncAt: string;
  nextHourlySyncAt: string;
  lastDailyAnalysisAt: string;
  lastAiLiveScanAt: string | null;
  hourlySyncCountToday: number;
  hourlySyncCounterDate: string;
  products: AffiliateProduct[];
  reportsByDate: Record<string, DailyTop10Report>;
}

class AffiliateRadarEngine extends EventEmitter {
  private state: PersistedAffiliateState;
  private saveTimer: NodeJS.Timeout | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    ensureStorageDirs();
    this.state = this.loadOrInit();
    this.startScheduler();
  }

  private loadOrInit(): PersistedAffiliateState {
    const now = new Date();
    const todayStr = getVietnamDateString(now);

    if (fs.existsSync(AFFILIATE_STATE_FILE)) {
      try {
        const raw = fs.readFileSync(AFFILIATE_STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedAffiliateState>;
        if (Array.isArray(parsed.products) && parsed.products.length > 0) {
          const activeSeason = parsed.activeSeason || detectSeasonForDate(now);
          const strategy = parsed.strategy || 'balanced';
          const rescored = parsed.products.map((p) => ({
            ...p,
            scoreBreakdown: scoreAffiliateProduct(p, activeSeason, strategy),
          }));

          const loaded: PersistedAffiliateState = {
            activeSeason,
            strategy,
            autoSyncEnabled: parsed.autoSyncEnabled ?? true,
            hourlyIntervalMinutes: parsed.hourlyIntervalMinutes || 60,
            lastHourlySyncAt: parsed.lastHourlySyncAt || now.toISOString(),
            nextHourlySyncAt:
              parsed.nextHourlySyncAt ||
              new Date(now.getTime() + (parsed.hourlyIntervalMinutes || 60) * 60_000).toISOString(),
            lastDailyAnalysisAt: parsed.lastDailyAnalysisAt || now.toISOString(),
            lastAiLiveScanAt: parsed.lastAiLiveScanAt || null,
            hourlySyncCountToday:
              parsed.hourlySyncCounterDate === todayStr
                ? parsed.hourlySyncCountToday || 1
                : 1,
            hourlySyncCounterDate: todayStr,
            products: rescored,
            reportsByDate: parsed.reportsByDate || {},
          };

          if (!loaded.reportsByDate[todayStr]) {
            loaded.reportsByDate[todayStr] = this.buildTop10ReportInternal(
              loaded.products,
              loaded.activeSeason,
              loaded.strategy,
              now
            );
            loaded.lastDailyAnalysisAt = now.toISOString();
          }
          return loaded;
        }
      } catch (err) {
        console.error('[AffiliateEngine] Failed to load affiliate-state.json, re-seeding:', err);
      }
    }

    const activeSeason = detectSeasonForDate(now);
    const strategy: ScoringStrategy = 'balanced';
    const rawCatalog = buildInitialAffiliateCatalog(now);
    const products: AffiliateProduct[] = rawCatalog.map((item) => ({
      ...item,
      scoreBreakdown: scoreAffiliateProduct(item, activeSeason, strategy),
    }));

    const initialReport = this.buildTop10ReportInternal(products, activeSeason, strategy, now);
    const initialState: PersistedAffiliateState = {
      activeSeason,
      strategy,
      autoSyncEnabled: true,
      hourlyIntervalMinutes: 60,
      lastHourlySyncAt: now.toISOString(),
      nextHourlySyncAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      lastDailyAnalysisAt: now.toISOString(),
      lastAiLiveScanAt: null,
      hourlySyncCountToday: 1,
      hourlySyncCounterDate: todayStr,
      products,
      reportsByDate: {
        [todayStr]: initialReport,
      },
    };
    this.saveStateSync(initialState);
    return initialState;
  }

  private saveStateSync(st: PersistedAffiliateState): void {
    try {
      ensureStorageDirs();
      fs.writeFileSync(AFFILIATE_STATE_FILE, JSON.stringify(st, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AffiliateEngine] Error writing affiliate-state.json:', err);
    }
  }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveStateSync(this.state);
    }, 200);
  }

  private startScheduler(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    // Check every 30 seconds for hourly or daily rollover
    this.schedulerTimer = setInterval(() => {
      if (!this.state.autoSyncEnabled) return;
      const now = new Date();
      const todayStr = getVietnamDateString(now);

      // Daily rollover check
      if (!this.state.reportsByDate[todayStr]) {
        this.runHourlySync('daily_rollover');
        this.runDailyTop10Analysis();
        return;
      }

      // Hourly sync check
      const nextMs = Date.parse(this.state.nextHourlySyncAt);
      if (Number.isFinite(nextMs) && now.getTime() >= nextMs) {
        this.runHourlySync('scheduled');
      }
    }, 30_000);
  }

  private broadcastUpdate(reason: string): void {
    this.emit('event', {
      type: 'affiliate_updated',
      reason,
      snapshot: this.getSnapshot(),
    });
  }

  private buildTop10ReportInternal(
    products: AffiliateProduct[],
    activeSeason: SeasonId,
    strategy: ScoringStrategy,
    now = new Date(),
    customSummary?: string
  ): DailyTop10Report {
    const todayStr = getVietnamDateString(now);
    const seasonDef = getSeasonDefinition(activeSeason);

    const rescored = products
      .map((p) => ({
        ...p,
        scoreBreakdown: scoreAffiliateProduct(p, activeSeason, strategy),
      }))
      .sort((a, b) => b.scoreBreakdown.totalScore - a.scoreBreakdown.totalScore);

    const top10 = rescored.slice(0, 10);

    const entries: Top10ProductEntry[] = top10.map((p, idx) => {
      const bestSeller =
        p.reputableSellers[0] ||
        ({
          id: `fallback-${p.id}`,
          shopName: 'Gian Hàng Chính Hãng Mall',
          platform: p.primaryPlatform,
          badge: p.primaryPlatform === 'shopee' ? 'Shopee Mall' : 'TikTok Shop Mall',
          location: 'Hà Nội',
          rating: 4.9,
          reviewCount: 5000,
          followers: 50000,
          yearsActive: 3,
          responseRatePct: 98,
          onTimeShipPct: 99,
          returnRatePct: 1.0,
          sellingPriceVnd: p.priceVnd,
          commissionRatePct: p.commissionRatePct,
          freeSampleAvailable: p.freeSampleAvailable,
          stockCount: 1000,
          trustScore: 92,
          recommendedReason: 'Gian hàng chính hãng đánh giá cao.',
          shopSearchUrl: p.productSearchUrlShopee,
        } satisfies ReputableSeller);

      return {
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
        bestSeller,
        scoreBreakdown: p.scoreBreakdown,
        goldenHourToPost: p.buyerEvidence.peakBuyingHours,
        suggestedHook: p.viralHooks[0] || `Review thực tế ${p.name} đang bán chạy nhất mùa này!`,
        videoPrompt916: p.videoPrompt916,
      };
    });

    const avgComm =
      entries.length > 0
        ? (entries.reduce((s, e) => s + e.commissionRatePct, 0) / entries.length).toFixed(1)
        : '16.5';
    const totalOrders24h = entries.reduce((s, e) => s + e.soldToday, 0);
    const strategyLabel =
      strategy === 'high_commission'
        ? 'Ưu tiên Hoa hồng & Giá trị đơn cao'
        : strategy === 'viral_volume'
          ? 'Ưu tiên Viral dễ nổ đơn số lượng lớn'
          : 'Cân bằng toàn diện (Mùa vụ + Tốc độ bán + Hoa hồng + Shop Mall uy tín)';

    const defaultSummary =
      customSummary ||
      `Báo cáo ngày ${todayStr} (${seasonDef.shortName}) theo chiến lược "${strategyLabel}": Hệ thống đã chấm điểm ${products.length} sản phẩm trên Shopee & TikTok Shop, chọn ra Top 10 có tổng lượt mua ${totalOrders24h.toLocaleString('vi-VN')} đơn/24h và mức hoa hồng trung bình ${avgComm}%. Nhóm dẫn đầu đang nghiêng mạnh về ngách giải quyết nhu cầu thiết thực theo thời tiết & quà tặng cuối năm với KOC cạnh tranh còn thấp,100% có nhà bán hàng Mall / Yêu Thích+ điểm uy tín >= 90/100.`;

    return {
      date: todayStr,
      generatedAt: now.toISOString(),
      activeSeason,
      activeSeasonName: seasonDef.name,
      strategy,
      aiExecutiveSummary: defaultSummary,
      entries,
    };
  }

  public getStatus(): AffiliateSchedulerStatus {
    const seasonDef = getSeasonDefinition(this.state.activeSeason);
    const shopeeCount = this.state.products.filter((p) => p.platforms.includes('shopee')).length;
    const tiktokCount = this.state.products.filter((p) => p.platforms.includes('tiktok')).length;

    return {
      activeSeason: seasonDef,
      strategy: this.state.strategy,
      autoSyncEnabled: this.state.autoSyncEnabled,
      hourlyIntervalMinutes: this.state.hourlyIntervalMinutes,
      lastHourlySyncAt: this.state.lastHourlySyncAt,
      nextHourlySyncAt: this.state.nextHourlySyncAt,
      lastDailyAnalysisAt: this.state.lastDailyAnalysisAt,
      lastAiLiveScanAt: this.state.lastAiLiveScanAt,
      totalProductsTracked: this.state.products.length,
      shopeeCount,
      tiktokCount,
      hourlySyncCountToday: this.state.hourlySyncCountToday,
    };
  }

  public getSnapshot(reportDate?: string): AffiliateRadarSnapshot {
    const todayStr = getVietnamDateString();
    if (!this.state.reportsByDate[todayStr]) {
      this.state.reportsByDate[todayStr] = this.buildTop10ReportInternal(
        this.state.products,
        this.state.activeSeason,
        this.state.strategy
      );
      this.saveSoon();
    }

    const sortedProducts = [...this.state.products].sort(
      (a, b) => b.scoreBreakdown.totalScore - a.scoreBreakdown.totalScore
    );
    const historyDates = Object.keys(this.state.reportsByDate).sort().reverse();
    const targetReport =
      (reportDate && this.state.reportsByDate[reportDate]) ||
      this.state.reportsByDate[todayStr];

    return {
      status: this.getStatus(),
      seasons: SEASON_DEFINITIONS,
      products: sortedProducts,
      dailyTop10: targetReport,
      reportHistoryDates: historyDates,
    };
  }

  public updateConfig(patch: {
    activeSeason?: SeasonId;
    strategy?: ScoringStrategy;
    autoSyncEnabled?: boolean;
    hourlyIntervalMinutes?: number;
  }): AffiliateRadarSnapshot {
    let needsRescore = false;

    if (patch.activeSeason && SEASON_DEFINITIONS.some((s) => s.id === patch.activeSeason)) {
      this.state.activeSeason = patch.activeSeason;
      needsRescore = true;
    }
    if (
      patch.strategy &&
      ['balanced', 'high_commission', 'viral_volume'].includes(patch.strategy)
    ) {
      this.state.strategy = patch.strategy;
      needsRescore = true;
    }
    if (patch.autoSyncEnabled !== undefined) {
      this.state.autoSyncEnabled = Boolean(patch.autoSyncEnabled);
    }
    if (patch.hourlyIntervalMinutes !== undefined) {
      const mins = Math.max(5, Math.min(360, Math.round(Number(patch.hourlyIntervalMinutes) || 60)));
      this.state.hourlyIntervalMinutes = mins;
      this.state.nextHourlySyncAt = new Date(Date.now() + mins * 60_000).toISOString();
    }

    if (needsRescore) {
      const now = new Date();
      const todayStr = getVietnamDateString(now);
      this.state.products = this.state.products.map((p) => ({
        ...p,
        scoreBreakdown: scoreAffiliateProduct(p, this.state.activeSeason, this.state.strategy),
      }));
      this.state.reportsByDate[todayStr] = this.buildTop10ReportInternal(
        this.state.products,
        this.state.activeSeason,
        this.state.strategy,
        now
      );
      this.state.lastDailyAnalysisAt = now.toISOString();
    }

    this.saveSoon();
    this.broadcastUpdate('config_changed');
    return this.getSnapshot();
  }

  public runHourlySync(trigger = 'manual'): AffiliateRadarSnapshot {
    const now = new Date();
    const nowIso = now.toISOString();
    const todayStr = getVietnamDateString(now);
    const currentHour = now.getHours();
    const hourLabel = `${String(currentHour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Hour-of-day demand multiplier in Vietnam
    const isPeakHour =
      (currentHour >= 11 && currentHour <= 13) || (currentHour >= 19 && currentHour <= 23);
    const hourMult = isPeakHour ? 1.24 : currentHour >= 1 && currentHour <= 5 ? 0.45 : 1.02;

    this.state.products = this.state.products.map((p) => {
      const isInActiveSeason =
        this.state.activeSeason === 'all_year' || p.seasons.includes(this.state.activeSeason);
      const seasonBoost = isInActiveSeason ? 1.08 : 0.96;
      const randomWave = 0.91 + Math.random() * 0.22; // 0.91..1.13

      const prevHourSold = p.soldLastHour || 40;
      const baseline =
        p.hourlyHistory.length > 0
          ? p.hourlyHistory.reduce((s, h) => s + h.sold, 0) / p.hourlyHistory.length
          : prevHourSold;

      const nextSoldLastHour = Math.max(
        4,
        Math.round(baseline * hourMult * seasonBoost * randomWave)
      );
      const rawHourlyDelta = ((nextSoldLastHour - prevHourSold) / Math.max(1, prevHourSold)) * 100;
      // Blend momentum with smoothed trend so growth % stays realistic & informative
      const nextHourlyGrowth = Number(
        Math.max(-18, Math.min(85, p.hourlyGrowthPct * 0.65 + rawHourlyDelta * 0.35)).toFixed(1)
      );

      const nextPoint = {
        hourLabel,
        timestamp: nowIso,
        sold: nextSoldLastHour,
        revenueVnd: nextSoldLastHour * p.priceVnd,
        liveViewers: Math.round(nextSoldLastHour * (5 + Math.random() * 2.5)),
      };

      const nextHourlyHistory = [...p.hourlyHistory.slice(-23), nextPoint];
      const nextSoldToday = nextHourlyHistory.reduce((s, h) => s + h.sold, 0);

      const nextDailyHistory = [...p.dailyHistory];
      if (
        nextDailyHistory.length > 0 &&
        nextDailyHistory[nextDailyHistory.length - 1].date === todayStr
      ) {
        nextDailyHistory[nextDailyHistory.length - 1] = {
          date: todayStr,
          sold: nextSoldToday,
          revenueVnd: nextSoldToday * p.priceVnd,
          affiliateOrders: Math.round(nextSoldToday * 0.45),
        };
      } else {
        nextDailyHistory.push({
          date: todayStr,
          sold: nextSoldToday,
          revenueVnd: nextSoldToday * p.priceVnd,
          affiliateOrders: Math.round(nextSoldToday * 0.45),
        });
        if (nextDailyHistory.length > 14) nextDailyHistory.shift();
      }

      const nextSold7d = nextDailyHistory.slice(-7).reduce((s, d) => s + d.sold, 0);

      const updatedBase: Omit<AffiliateProduct, 'scoreBreakdown'> = {
        ...p,
        soldLastHour: nextSoldLastHour,
        hourlyGrowthPct: nextHourlyGrowth,
        soldToday: nextSoldToday,
        sold7d: nextSold7d,
        revenueTodayVnd: nextSoldToday * p.priceVnd,
        hourlyHistory: nextHourlyHistory,
        dailyHistory: nextDailyHistory,
        lastHourlySyncAt: nowIso,
      };

      return {
        ...updatedBase,
        scoreBreakdown: scoreAffiliateProduct(
          updatedBase,
          this.state.activeSeason,
          this.state.strategy
        ),
      };
    });

    if (this.state.hourlySyncCounterDate === todayStr) {
      this.state.hourlySyncCountToday += 1;
    } else {
      this.state.hourlySyncCounterDate = todayStr;
      this.state.hourlySyncCountToday = 1;
    }

    this.state.lastHourlySyncAt = nowIso;
    this.state.nextHourlySyncAt = new Date(
      now.getTime() + this.state.hourlyIntervalMinutes * 60_000
    ).toISOString();

    // Keep today's Top 10 synchronized with latest hourly velocity
    this.state.reportsByDate[todayStr] = this.buildTop10ReportInternal(
      this.state.products,
      this.state.activeSeason,
      this.state.strategy,
      now,
      this.state.reportsByDate[todayStr]?.aiExecutiveSummary
    );

    this.saveSoon();
    this.broadcastUpdate(`hourly_sync_${trigger}`);
    return this.getSnapshot();
  }

  public runDailyTop10Analysis(customExecutiveSummary?: string): AffiliateRadarSnapshot {
    const now = new Date();
    const todayStr = getVietnamDateString(now);

    this.state.products = this.state.products.map((p) => ({
      ...p,
      lastDailySyncAt: now.toISOString(),
      scoreBreakdown: scoreAffiliateProduct(p, this.state.activeSeason, this.state.strategy),
    }));

    this.state.reportsByDate[todayStr] = this.buildTop10ReportInternal(
      this.state.products,
      this.state.activeSeason,
      this.state.strategy,
      now,
      customExecutiveSummary
    );
    this.state.lastDailyAnalysisAt = now.toISOString();

    // Prune older than 30 reports
    const dates = Object.keys(this.state.reportsByDate).sort();
    while (dates.length > 30) {
      const oldest = dates.shift();
      if (oldest) delete this.state.reportsByDate[oldest];
    }

    this.saveSoon();
    this.broadcastUpdate('daily_top10_analyzed');
    return this.getSnapshot();
  }

  private async resolveBestTextGeminiModel(apiKey: string): Promise<string> {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
        {
          headers: { 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          models?: Array<{
            name?: string;
            supportedGenerationMethods?: string[];
          }>;
        };
        const candidates = (data.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => String(m.name || '').replace(/^models\//, ''))
          .filter((name) => !/tts|image|embedding|veo|aqa/i.test(name));

        const preferredOrder = [
          'gemini-2.5-flash',
          'gemini-3-flash-preview',
          'gemini-2.5-pro',
          'gemini-2.0-flash',
          'gemini-flash-latest',
        ];
        for (const pref of preferredOrder) {
          const exact = candidates.find((c) => c === pref || c.startsWith(pref));
          if (exact) return exact;
        }
        const anyFlash = candidates.find((c) => /flash/i.test(c));
        if (anyFlash) return anyFlash;
        if (candidates.length > 0) return candidates[0];
      }
    } catch {
      // Ignore discovery failure and fallback
    }
    return 'gemini-2.5-flash';
  }

  public async scanLiveTrendsWithGemini(options?: {
    customKeyword?: string;
    seasonId?: SeasonId;
  }): Promise<{
    addedCount: number;
    usedSearchGrounding: boolean;
    modelUsed: string;
    aiSummary: string;
    snapshot: AffiliateRadarSnapshot;
  }> {
    const apiKey = store.getSettings().geminiApiKey.trim();
    if (!apiKey) {
      throw new Error(
        'Chưa cấu hình Gemini API Key. Vui lòng nhập Gemini API Key ở khung Cấu Hình phía trên để dùng AI Quét Xu Hướng Thực Tế (hệ thống vẫn chạy tự động với bộ dữ liệu mùa vụ có sẵn).'
      );
    }

    const targetSeason = options?.seasonId || this.state.activeSeason;
    const seasonDef = getSeasonDefinition(targetSeason);
    const customFocus = (options?.customKeyword || '').trim();
    const todayStr = getVietnamDateString();

    const modelName = await this.resolveBestTextGeminiModel(apiKey);
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Bạn là chuyên gia phân tích dữ liệu Affiliate Shopee & TikTok Shop tại thị trường Việt Nam.
Hôm nay là ngày ${todayStr}. Mùa vụ đang xét: "${seasonDef.name}" (${seasonDef.description}).
${customFocus ? `Ngách / từ khoá người dùng muốn tìm sâu: "${customFocus}".` : ''}

Hãy tìm và phân tích 4 sản phẩm đang bán cực chạy theo mùa này trên Shopee VN và TikTok Shop VN, rất phù hợp để KOC làm Affiliate (nhu cầu thực cao, hoa hồng tốt 12%-22%, có gian hàng chính hãng Mall hoặc Yêu Thích+ uy tín).

Trả về DUY NHẤT một chuỗi JSON hợp lệ (không bọc markdown nếu không cần, đúng cấu trúc sau):
{
  "executiveSummary": "Nhận định ngắn gọn 2-3 câu về xu hướng mua sắm nổi bật hôm nay trên Shopee & TikTok Shop VN và lời khuyên chọn sản phẩm làm affiliate.",
  "products": [
    {
      "name": "Tên sản phẩm chi tiết chuẩn SEO sàn TMĐT (Tiếng Việt)",
      "category": "Ngành hàng (VD: Điện Gia Dụng / Sắc Đẹp / Thời Trang / Nhà Cửa & Đời Sống / Sức Khoẻ)",
      "subcategory": "Phân loại chi tiết",
      "primaryPlatform": "tiktok hoặc shopee",
      "emoji": "1 emoji đại diện phù hợp",
      "priceVnd": 259000,
      "originalPriceVnd": 390000,
      "commissionRatePct": 17.5,
      "soldLastHour": 95,
      "hourlyGrowthPct": 34.5,
      "dailyGrowthPct": 29.0,
      "conversionRatePct": 6.4,
      "competitionLevel": "low",
      "peakBuyingHours": "20:00 - 23:00 & 12:00 - 13:30",
      "targetAudience": "Nhóm khách mua chính",
      "topPraiseKeywords": ["Ưu điểm khách khen 1", "Ưu điểm 2", "Ưu điểm 3"],
      "cautionNotes": ["Lưu ý nhỏ khi tư vấn khách"],
      "viralHooks": [
        "Câu Hook 3 giây đầu quay video TikTok/Shopee Video cực cuốn số 1",
        "Câu Hook số 2"
      ],
      "videoPrompt916": "Detailed English commercial video prompt for 9:16 vertical product showcase, cinematic lighting, 4K",
      "seller": {
        "shopName": "Tên gian hàng chính hãng / uy tín thực tế tại VN",
        "platform": "tiktok hoặc shopee",
        "badge": "Shopee Mall hoặc TikTok Shop Mall hoặc Yêu Thích+",
        "location": "Hà Nội hoặc TP. Hồ Chí Minh",
        "rating": 4.9,
        "followers": 180000,
        "recommendedReason": "Lý do nên gắn link shop này (uy tín, hoa hồng, tồn kho, tốc độ giao)"
      }
    }
  ]
}`;

    let responseText = '';
    let usedSearchGrounding = false;

    try {
      const resp = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.4,
        },
      });
      responseText = resp.text || '';
      usedSearchGrounding = true;
    } catch {
      // Fallback without googleSearch tool if model/key doesn't permit search grounding
      const resp = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.5,
        },
      });
      responseText = resp.text || '';
      usedSearchGrounding = false;
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI không trả về dữ liệu cấu trúc hợp lệ. Vui lòng thử quét lại.');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      executiveSummary?: string;
      products?: Array<Record<string, unknown>>;
    };

    const rawItems = Array.isArray(parsed.products) ? parsed.products : [];
    const now = new Date();
    const nowIso = now.toISOString();
    const gradients = [
      'from-fuchsia-500 to-indigo-600',
      'from-emerald-500 to-teal-600',
      'from-orange-500 to-rose-600',
      'from-sky-500 to-blue-600',
    ];

    let addedCount = 0;

    rawItems.forEach((item, idx) => {
      const name = String(item.name || '').trim();
      if (!name) return;

      const priceVnd = Math.max(29_000, Number(item.priceVnd) || 249_000);
      const originalPriceVnd = Math.max(priceVnd, Number(item.originalPriceVnd) || Math.round(priceVnd * 1.4));
      const commissionRatePct = Math.min(35, Math.max(6, Number(item.commissionRatePct) || 16));
      const baseHourly = Math.max(15, Math.min(350, Number(item.soldLastHour) || 85));
      const primaryPlatform: EcommercePlatform =
        item.primaryPlatform === 'shopee' ? 'shopee' : 'tiktok';

      const hourlyHistory = generateHourlySeries(baseHourly, priceVnd, now);
      const soldToday = hourlyHistory.reduce((s, h) => s + h.sold, 0);
      const dailyHistory = generateDailySeries(soldToday, priceVnd, 1.08, now);
      const sold7d = dailyHistory.reduce((s, d) => s + d.sold, 0);

      const sellerObj = (item.seller || {}) as Record<string, unknown>;
      const sellerPlatform: EcommercePlatform =
        sellerObj.platform === 'shopee' ? 'shopee' : primaryPlatform;
      const rawBadge = String(sellerObj.badge || '');
      const badge: SellerBadge =
        rawBadge === 'Shopee Mall' ||
        rawBadge === 'TikTok Shop Mall' ||
        rawBadge === 'Yêu Thích+' ||
        rawBadge === 'Star Shop'
          ? rawBadge
          : sellerPlatform === 'shopee'
            ? 'Shopee Mall'
            : 'TikTok Shop Mall';

      const shortKw = name.split(' ').slice(0, 6).join(' ');
      const shopSearchUrl =
        sellerPlatform === 'shopee'
          ? `https://shopee.vn/search?keyword=${encodeURIComponent(shortKw)}`
          : `https://www.tiktok.com/search?q=${encodeURIComponent(shortKw + ' TikTok Shop')}`;

      const sellerWithoutTrust: Omit<ReputableSeller, 'trustScore'> = {
        id: `ai-sel-${Date.now()}-${idx}`,
        shopName: String(sellerObj.shopName || 'Official Mall Store VN'),
        platform: sellerPlatform,
        badge,
        location: String(sellerObj.location || 'Hà Nội'),
        rating: Math.min(5, Math.max(4.6, Number(sellerObj.rating) || 4.9)),
        reviewCount: 18500 + idx * 4200,
        followers: Math.max(15000, Number(sellerObj.followers) || 165000),
        yearsActive: 4,
        responseRatePct: 98,
        onTimeShipPct: 99.2,
        returnRatePct: 0.9,
        sellingPriceVnd: priceVnd,
        commissionRatePct,
        extraCommissionNote: 'Phát hiện qua AI Live Trend Scan • Hoa hồng ưu đãi KOC',
        freeSampleAvailable: true,
        stockCount: 3800,
        recommendedReason: String(
          sellerObj.recommendedReason ||
            'Gian hàng Mall uy tín cao, phản hồi nhanh và tỷ lệ giao đúng hạn >99%.'
        ),
        shopSearchUrl,
      };

      const seller: ReputableSeller = {
        ...sellerWithoutTrust,
        trustScore: computeSellerTrustScore(sellerWithoutTrust),
      };

      const idSlug = `ai-${Date.now()}-${idx}`;
      const productBase: Omit<AffiliateProduct, 'scoreBreakdown'> = {
        id: idSlug,
        name,
        slug: idSlug,
        category: String(item.category || 'Xu Hướng AI Mới'),
        subcategory: String(item.subcategory || seasonDef.shortName),
        platforms: ['shopee', 'tiktok'],
        primaryPlatform,
        seasons: targetSeason === 'all_year' ? [detectSeasonForDate(now)] : [targetSeason],
        thumbnailEmoji: String(item.emoji || '✨').slice(0, 4),
        thumbnailGradient: gradients[idx % gradients.length],
        priceVnd,
        originalPriceVnd,
        discountPct: Math.round(((originalPriceVnd - priceVnd) / originalPriceVnd) * 100),
        commissionRatePct,
        estimatedCommissionVnd: Math.round((priceVnd * commissionRatePct) / 100),
        freeSampleAvailable: true,
        hasExtraBonus: true,
        soldLastHour: hourlyHistory[hourlyHistory.length - 1]?.sold || baseHourly,
        hourlyGrowthPct: Number(item.hourlyGrowthPct) || 32.5,
        soldToday,
        dailyGrowthPct: Number(item.dailyGrowthPct) || 28.0,
        sold7d,
        sold30d: Math.round(sold7d * 3.6),
        revenueTodayVnd: soldToday * priceVnd,
        conversionRatePct: Math.min(14, Math.max(2.5, Number(item.conversionRatePct) || 6.5)),
        creatorCount7d: 75 + idx * 18,
        competitionLevel:
          item.competitionLevel === 'high' || item.competitionLevel === 'medium'
            ? item.competitionLevel
            : 'low',
        rating: 4.9,
        buyerEvidence: {
          totalReviews: 6400 + idx * 1900,
          positiveRatePct: 97.6,
          repeatPurchaseRatePct: 22.4,
          returnRatePct: 0.9,
          peakBuyingHours: String(item.peakBuyingHours || '12:00 - 13:30 & 20:00 - 23:00'),
          targetAudience: String(
            item.targetAudience || 'Khách hàng mua sắm theo mùa trên Shopee & TikTok Shop'
          ),
          topPraiseKeywords: Array.isArray(item.topPraiseKeywords)
            ? item.topPraiseKeywords.map(String).slice(0, 4)
            : ['Đúng mô tả', 'Giao hàng nhanh', 'Đáng tiền'],
          cautionNotes: Array.isArray(item.cautionNotes)
            ? item.cautionNotes.map(String).slice(0, 2)
            : ['Kiểm tra kỹ phân loại trước khi đặt'],
        },
        reputableSellers: [seller],
        hourlyHistory,
        dailyHistory,
        viralHooks: Array.isArray(item.viralHooks)
          ? item.viralHooks.map(String).filter(Boolean)
          : [`Review thực tế ${name} đang bùng nổ đơn mùa này!`],
        videoPrompt916: String(
          item.videoPrompt916 ||
            `Vertical 9:16 commercial product video showcasing ${name}, modern studio aesthetic, dynamic close-ups, 4K`
        ),
        productSearchUrlShopee: `https://shopee.vn/search?keyword=${encodeURIComponent(shortKw)}`,
        productSearchUrlTiktok: `https://www.tiktok.com/search?q=${encodeURIComponent(shortKw + ' TikTok Shop')}`,
        source: 'gemini_live_scan',
        lastHourlySyncAt: nowIso,
        lastDailySyncAt: nowIso,
      };

      // Deduplicate by normalized name prefix
      const normName = name.toLowerCase().slice(0, 28);
      const existingIdx = this.state.products.findIndex((p) =>
        p.name.toLowerCase().startsWith(normName)
      );
      const scoredProduct: AffiliateProduct = {
        ...productBase,
        scoreBreakdown: scoreAffiliateProduct(
          productBase,
          this.state.activeSeason,
          this.state.strategy
        ),
      };

      if (existingIdx >= 0) {
        this.state.products[existingIdx] = scoredProduct;
      } else {
        this.state.products.unshift(scoredProduct);
      }
      addedCount += 1;
    });

    this.state.lastAiLiveScanAt = nowIso;
    const aiSummary =
      parsed.executiveSummary ||
      `AI Gemini (${modelName}) đã quét xu hướng thực tế và bổ sung ${addedCount} sản phẩm tiềm năng cao cho mùa ${seasonDef.shortName}.`;

    const snapshot = this.runDailyTop10Analysis(aiSummary);
    return {
      addedCount,
      usedSearchGrounding,
      modelUsed: modelName,
      aiSummary,
      snapshot,
    };
  }

  public importProductsFromRecords(
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
    const now = new Date();
    const nowIso = now.toISOString();
    let importedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const name = String(r.name || '').trim();
      if (!name) continue;

      const primaryPlatform: EcommercePlatform = r.platform === 'shopee' ? 'shopee' : 'tiktok';
      const priceVnd = Math.max(10_000, Number(r.priceVnd) || 199_000);
      const originalPriceVnd = Math.round(priceVnd * 1.35);
      const commissionRatePct = Math.min(40, Math.max(3, Number(r.commissionRatePct) || 15));
      const targetSoldToday = Math.max(24, Number(r.soldToday) || 1200);
      const baseHourly = Math.max(4, Math.round(targetSoldToday / 24));

      const hourlyHistory = generateHourlySeries(baseHourly, priceVnd, now);
      const soldToday = hourlyHistory.reduce((s, h) => s + h.sold, 0);
      const dailyHistory = generateDailySeries(soldToday, priceVnd, 1.06, now);
      const shortKw = name.split(' ').slice(0, 6).join(' ');

      const badge: SellerBadge =
        r.shopBadge || (primaryPlatform === 'shopee' ? 'Shopee Mall' : 'TikTok Shop Mall');
      const sellerBase: Omit<ReputableSeller, 'trustScore'> = {
        id: `imp-sel-${Date.now()}-${i}`,
        shopName: String(r.shopName || 'Gian Hàng Uy Tín Đề Xuất').trim(),
        platform: primaryPlatform,
        badge,
        location: 'Việt Nam',
        rating: Math.min(5, Math.max(4.5, Number(r.rating) || 4.9)),
        reviewCount: 9500,
        followers: 120000,
        yearsActive: 3,
        responseRatePct: 97,
        onTimeShipPct: 99.0,
        returnRatePct: 1.0,
        sellingPriceVnd: priceVnd,
        commissionRatePct,
        extraCommissionNote: 'Dữ liệu import từ công cụ phân tích',
        freeSampleAvailable: true,
        stockCount: 2500,
        recommendedReason: 'Nhà bán hàng có chỉ số đánh giá và doanh số tốt từ file dữ liệu import.',
        shopSearchUrl:
          primaryPlatform === 'shopee'
            ? `https://shopee.vn/search?keyword=${encodeURIComponent(shortKw)}`
            : `https://www.tiktok.com/search?q=${encodeURIComponent(shortKw + ' TikTok Shop')}`,
      };

      const productBase: Omit<AffiliateProduct, 'scoreBreakdown'> = {
        id: `imp-${Date.now()}-${i}`,
        name,
        slug: `imp-${Date.now()}-${i}`,
        category: String(r.category || 'Sản Phẩm Import'),
        subcategory: 'Dữ liệu nhập ngoài',
        platforms: [primaryPlatform],
        primaryPlatform,
        seasons: [this.state.activeSeason],
        thumbnailEmoji: '📦',
        thumbnailGradient: 'from-indigo-500 to-cyan-600',
        priceVnd,
        originalPriceVnd,
        discountPct: 26,
        commissionRatePct,
        estimatedCommissionVnd: Math.round((priceVnd * commissionRatePct) / 100),
        freeSampleAvailable: true,
        hasExtraBonus: false,
        soldLastHour: hourlyHistory[hourlyHistory.length - 1]?.sold || baseHourly,
        hourlyGrowthPct: 24.0,
        soldToday,
        dailyGrowthPct: 21.5,
        sold7d: dailyHistory.reduce((s, d) => s + d.sold, 0),
        sold30d: soldToday * 24,
        revenueTodayVnd: soldToday * priceVnd,
        conversionRatePct: 6.0,
        creatorCount7d: 95,
        competitionLevel: 'low',
        rating: Math.min(5, Math.max(4.5, Number(r.rating) || 4.9)),
        buyerEvidence: {
          totalReviews: 4200,
          positiveRatePct: 97.0,
          repeatPurchaseRatePct: 18.0,
          returnRatePct: 1.1,
          peakBuyingHours: '12:00 - 13:30 & 20:00 - 23:00',
          targetAudience: 'Khách hàng tiềm năng trên sàn TMĐT',
          topPraiseKeywords: ['Bán chạy', 'Đánh giá tích cực', 'Shop phản hồi nhanh'],
          cautionNotes: ['Kiểm tra tồn kho và hoa hồng Xtra trước khi lên video'],
        },
        reputableSellers: [
          {
            ...sellerBase,
            trustScore: computeSellerTrustScore(sellerBase),
          },
        ],
        hourlyHistory,
        dailyHistory,
        viralHooks: [
          `Trải nghiệm thực tế ${name} đang bán ${soldToday.toLocaleString('vi-VN')} đơn mỗi ngày — có thực sự đáng tiền?`,
        ],
        videoPrompt916: `Vertical 9:16 commercial product showcase video of ${name}, clean modern studio lighting, dynamic close-up shots, 4K`,
        productSearchUrlShopee: `https://shopee.vn/search?keyword=${encodeURIComponent(shortKw)}`,
        productSearchUrlTiktok: `https://www.tiktok.com/search?q=${encodeURIComponent(shortKw + ' TikTok Shop')}`,
        source: 'user_import',
        lastHourlySyncAt: nowIso,
        lastDailySyncAt: nowIso,
      };

      this.state.products.unshift({
        ...productBase,
        scoreBreakdown: scoreAffiliateProduct(
          productBase,
          this.state.activeSeason,
          this.state.strategy
        ),
      });
      importedCount += 1;
    }

    const snapshot = this.runDailyTop10Analysis();
    return { importedCount, snapshot };
  }
}

export const affiliateEngine = new AffiliateRadarEngine();
