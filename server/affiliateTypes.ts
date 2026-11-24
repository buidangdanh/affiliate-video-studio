export type EcommercePlatform = 'shopee' | 'tiktok';

export type SeasonId =
  | 'winter_festival'
  | 'mega_sale_year_end'
  | 'tet_holiday'
  | 'rainy_humid'
  | 'summer_travel'
  | 'back_to_school'
  | 'all_year';

export type ScoringStrategy = 'balanced' | 'high_commission' | 'viral_volume';

export type SellerBadge =
  | 'Shopee Mall'
  | 'Yêu Thích+'
  | 'Yêu Thích'
  | 'TikTok Shop Mall'
  | 'Star Shop'
  | 'Shop Uy Tín';

export type CompetitionLevel = 'low' | 'medium' | 'high';

export interface SeasonDefinition {
  id: SeasonId;
  name: string;
  shortName: string;
  months: number[]; // 1..12
  badgeColor: string;
  description: string;
  hotKeywords: string[];
}

export interface HourlyDataPoint {
  hourLabel: string; // e.g. "14:00"
  timestamp: string;
  sold: number;
  revenueVnd: number;
  liveViewers: number;
}

export interface DailyDataPoint {
  date: string; // YYYY-MM-DD
  sold: number;
  revenueVnd: number;
  affiliateOrders: number;
}

export interface ReputableSeller {
  id: string;
  shopName: string;
  platform: EcommercePlatform;
  badge: SellerBadge;
  location: string;
  rating: number; // e.g. 4.9
  reviewCount: number;
  followers: number;
  yearsActive: number;
  responseRatePct: number; // e.g. 98
  onTimeShipPct: number; // e.g. 99.1
  returnRatePct: number; // e.g. 1.2 (lower is better)
  sellingPriceVnd: number;
  commissionRatePct: number; // e.g. 15
  extraCommissionNote?: string; // e.g. "Hoa hồng Xtra +4%" or "Hỗ trợ Free Sample"
  freeSampleAvailable: boolean;
  stockCount: number;
  trustScore: number; // 0..100
  recommendedReason: string;
  shopSearchUrl: string;
}

export interface BuyerEvidence {
  totalReviews: number;
  positiveRatePct: number;
  repeatPurchaseRatePct: number;
  returnRatePct: number;
  peakBuyingHours: string; // e.g. "11:30 - 13:30 & 20:00 - 23:00"
  targetAudience: string;
  topPraiseKeywords: string[];
  cautionNotes: string[];
}

export interface AffiliateScoreBreakdown {
  totalScore: number; // 0..100
  seasonalFitScore: number; // 0..25 (or normalized 0..100 raw weighted)
  velocityScore: number; // 0..30
  commissionScore: number; // 0..25
  sellerTrustScore: number; // 0..20
  recommendationTag: string; // e.g. "Ngách Vàng Đang Lên", "Siêu Bão Đơn", "Hoa Hồng Cao Mall"
  whyPickSummary: string;
}

export interface AffiliateProduct {
  id: string;
  name: string;
  slug: string;
  category: string;
  subcategory: string;
  platforms: EcommercePlatform[]; // Available on Shopee, TikTok Shop, or both
  primaryPlatform: EcommercePlatform;
  seasons: SeasonId[];
  thumbnailEmoji: string;
  thumbnailGradient: string;
  imageUrl?: string;

  // Pricing & Commission
  priceVnd: number;
  originalPriceVnd: number;
  discountPct: number;
  commissionRatePct: number; // Best/featured commission %
  estimatedCommissionVnd: number; // Vnd per order
  freeSampleAvailable: boolean;
  hasExtraBonus: boolean;

  // Sales Velocity (Hourly & Daily)
  soldLastHour: number;
  hourlyGrowthPct: number; // vs previous hour
  soldToday: number;
  dailyGrowthPct: number; // vs yesterday
  sold7d: number;
  sold30d: number;
  revenueTodayVnd: number;
  conversionRatePct: number; // e.g. 5.4%
  creatorCount7d: number; // KOCs promoting in last 7 days
  competitionLevel: CompetitionLevel;

  // Quality & Evidence
  rating: number;
  buyerEvidence: BuyerEvidence;
  reputableSellers: ReputableSeller[];

  // Time series
  hourlyHistory: HourlyDataPoint[];
  dailyHistory: DailyDataPoint[];

  // Content & Video AI Prompts
  viralHooks: string[];
  videoPrompt916: string;
  productSearchUrlShopee: string;
  productSearchUrlTiktok: string;

  // Computed Score
  scoreBreakdown: AffiliateScoreBreakdown;
  source: 'seed_seasonal' | 'gemini_live_scan' | 'user_import';
  lastHourlySyncAt: string;
  lastDailySyncAt: string;
}

export interface Top10ProductEntry {
  rank: number; // 1..10
  productId: string;
  productName: string;
  category: string;
  primaryPlatform: EcommercePlatform;
  platforms: EcommercePlatform[];
  thumbnailEmoji: string;
  thumbnailGradient: string;
  priceVnd: number;
  commissionRatePct: number;
  estimatedCommissionVnd: number;
  soldLastHour: number;
  soldToday: number;
  hourlyGrowthPct: number;
  dailyGrowthPct: number;
  bestSeller: ReputableSeller;
  scoreBreakdown: AffiliateScoreBreakdown;
  goldenHourToPost: string;
  suggestedHook: string;
  videoPrompt916: string;
}

export interface DailyTop10Report {
  date: string; // YYYY-MM-DD
  generatedAt: string;
  activeSeason: SeasonId;
  activeSeasonName: string;
  strategy: ScoringStrategy;
  aiExecutiveSummary: string;
  entries: Top10ProductEntry[];
}

export interface AffiliateSchedulerStatus {
  activeSeason: SeasonDefinition;
  strategy: ScoringStrategy;
  autoSyncEnabled: boolean;
  hourlyIntervalMinutes: number;
  lastHourlySyncAt: string;
  nextHourlySyncAt: string;
  lastDailyAnalysisAt: string;
  lastAiLiveScanAt: string | null;
  totalProductsTracked: number;
  shopeeCount: number;
  tiktokCount: number;
  hourlySyncCountToday: number;
}

export interface AffiliateRadarSnapshot {
  status: AffiliateSchedulerStatus;
  seasons: SeasonDefinition[];
  products: AffiliateProduct[];
  dailyTop10: DailyTop10Report;
  reportHistoryDates: string[];
}
