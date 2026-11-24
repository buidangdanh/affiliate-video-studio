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
  months: number[];
  badgeColor: string;
  description: string;
  hotKeywords: string[];
}

export interface HourlyDataPoint {
  hourLabel: string;
  timestamp: string;
  sold: number;
  revenueVnd: number;
  liveViewers: number;
}

export interface DailyDataPoint {
  date: string;
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
  rating: number;
  reviewCount: number;
  followers: number;
  yearsActive: number;
  responseRatePct: number;
  onTimeShipPct: number;
  returnRatePct: number;
  sellingPriceVnd: number;
  commissionRatePct: number;
  extraCommissionNote?: string;
  freeSampleAvailable: boolean;
  stockCount: number;
  trustScore: number;
  recommendedReason: string;
  shopSearchUrl: string;
}

export interface BuyerEvidence {
  totalReviews: number;
  positiveRatePct: number;
  repeatPurchaseRatePct: number;
  returnRatePct: number;
  peakBuyingHours: string;
  targetAudience: string;
  topPraiseKeywords: string[];
  cautionNotes: string[];
}

export interface AffiliateScoreBreakdown {
  totalScore: number;
  seasonalFitScore: number;
  velocityScore: number;
  commissionScore: number;
  sellerTrustScore: number;
  recommendationTag: string;
  whyPickSummary: string;
}

export interface AffiliateProduct {
  id: string;
  name: string;
  slug: string;
  category: string;
  subcategory: string;
  platforms: EcommercePlatform[];
  primaryPlatform: EcommercePlatform;
  seasons: SeasonId[];
  thumbnailEmoji: string;
  thumbnailGradient: string;
  imageUrl?: string;
  priceVnd: number;
  originalPriceVnd: number;
  discountPct: number;
  commissionRatePct: number;
  estimatedCommissionVnd: number;
  freeSampleAvailable: boolean;
  hasExtraBonus: boolean;
  soldLastHour: number;
  hourlyGrowthPct: number;
  soldToday: number;
  dailyGrowthPct: number;
  sold7d: number;
  sold30d: number;
  revenueTodayVnd: number;
  conversionRatePct: number;
  creatorCount7d: number;
  competitionLevel: CompetitionLevel;
  rating: number;
  buyerEvidence: BuyerEvidence;
  reputableSellers: ReputableSeller[];
  hourlyHistory: HourlyDataPoint[];
  dailyHistory: DailyDataPoint[];
  viralHooks: string[];
  videoPrompt916: string;
  productSearchUrlShopee: string;
  productSearchUrlTiktok: string;
  scoreBreakdown: AffiliateScoreBreakdown;
  source: 'seed_seasonal' | 'gemini_live_scan' | 'user_import';
  lastHourlySyncAt: string;
  lastDailySyncAt: string;
}

export interface Top10ProductEntry {
  rank: number;
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
  date: string;
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
