import React, { useState } from 'react';
import {
  Award,
  BarChart3,
  Check,
  Clapperboard,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Gift,
  MessageCircle,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import type { AffiliateProduct, EcommercePlatform } from '../affiliateTypes';

interface AffiliateProductModalProps {
  product: AffiliateProduct;
  onClose: () => void;
  onPushToVideoStudio: (product: AffiliateProduct, customPrompt?: string) => void;
}

function formatVnd(v: number): string {
  return `${v.toLocaleString('vi-VN')}đ`;
}

function PlatformPill({ platform }: { platform: EcommercePlatform }) {
  if (platform === 'shopee') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-orange-500/15 border border-orange-500/35 px-2 py-0.5 text-[11px] font-bold text-orange-300">
        🛍️ Shopee
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-pink-500/15 border border-pink-500/35 px-2 py-0.5 text-[11px] font-bold text-pink-300">
      🎵 TikTok Shop
    </span>
  );
}

export const AffiliateProductModal: React.FC<AffiliateProductModalProps> = ({
  product,
  onClose,
  onPushToVideoStudio,
}) => {
  const [activeTab, setActiveTab] = useState<'evidence' | 'sellers' | 'content'>('evidence');
  const [editablePrompt, setEditablePrompt] = useState(product.videoPrompt916);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const maxHourlySold = Math.max(1, ...product.hourlyHistory.map((h) => h.sold));
  const maxDailySold = Math.max(1, ...product.dailyHistory.map((d) => d.sold));

  const handleCopyText = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-4 sm:p-5 bg-slate-900/95">
          <div className="flex items-start gap-3.5">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${product.thumbnailGradient} text-2xl shadow-lg`}
            >
              {product.thumbnailEmoji}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {product.platforms.map((pf) => (
                  <PlatformPill key={pf} platform={pf} />
                ))}
                <span className="rounded-md bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
                  {product.category}
                </span>
                <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                  Điểm Affiliate: {product.scoreBreakdown.totalScore}/100
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white leading-snug">
                {product.name}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-4 text-xs text-slate-300">
                <span>
                  Giá bán:{' '}
                  <strong className="text-amber-300 text-sm">{formatVnd(product.priceVnd)}</strong>{' '}
                  <span className="line-through text-slate-500 text-[11px]">
                    {formatVnd(product.originalPriceVnd)}
                  </span>
                </span>
                <span>
                  Hoa hồng:{' '}
                  <strong className="text-emerald-400">
                    {product.commissionRatePct}% (~{formatVnd(product.estimatedCommissionVnd)}/đơn)
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  {product.rating} ({product.buyerEvidence.totalReviews.toLocaleString('vi-VN')} đánh giá)
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-4 sm:px-5 gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('evidence')}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold whitespace-nowrap transition ${
              activeTab === 'evidence'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Dữ Kiện Mua Bán (Giờ & Ngày)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sellers')}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold whitespace-nowrap transition ${
              activeTab === 'sellers'
                ? 'border-emerald-500 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Nhà Bán Hàng Uy Tín ({product.reputableSellers.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('content')}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold whitespace-nowrap transition ${
              activeTab === 'content'
                ? 'border-violet-500 text-violet-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Kịch Bản Hook & Tạo Video AI (9:16)
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {activeTab === 'evidence' && (
            <>
              {/* Key KPI Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="text-[11px] text-slate-400">Lượt mua 1 giờ qua</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-lg font-extrabold text-white">
                      {product.soldLastHour.toLocaleString('vi-VN')}
                    </span>
                    <span className="text-xs font-bold text-emerald-400">
                      +{product.hourlyGrowthPct}%
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Tốc độ chốt theo giờ</div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="text-[11px] text-slate-400">Lượt mua 24 giờ qua</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-lg font-extrabold text-white">
                      {product.soldToday.toLocaleString('vi-VN')}
                    </span>
                    <span className="text-xs font-bold text-emerald-400">
                      +{product.dailyGrowthPct}%
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Doanh thu ~{formatVnd(product.revenueTodayVnd)}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="text-[11px] text-slate-400">Tỷ lệ chuyển đổi KOC</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-lg font-extrabold text-amber-300">
                      {product.conversionRatePct}%
                    </span>
                    <span className="text-[11px] text-slate-400">
                      ({product.creatorCount7d} KOC/7d)
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Cạnh tranh:{' '}
                    {product.competitionLevel === 'low'
                      ? 'Thấp (Cơ hội vàng)'
                      : product.competitionLevel === 'medium'
                        ? 'Trung bình'
                        : 'Cao'}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="text-[11px] text-slate-400">Khách hài lòng / Mua lại</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-lg font-extrabold text-emerald-300">
                      {product.buyerEvidence.positiveRatePct}%
                    </span>
                    <span className="text-[11px] text-indigo-300">
                      Mua lại {product.buyerEvidence.repeatPurchaseRatePct}%
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Hoàn huỷ thấp: {product.buyerEvidence.returnRatePct}%
                  </div>
                </div>
              </div>

              {/* 4-Pillar Score Breakdown */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-amber-400" />
                    Chấm Điểm Đa Chiều Cho Affiliate ({product.scoreBreakdown.totalScore}/100)
                  </h3>
                  <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                    {product.scoreBreakdown.recommendationTag}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {[
                    {
                      label: 'Độ khớp mùa vụ & Xu hướng',
                      val: product.scoreBreakdown.seasonalFitScore,
                      max: 25,
                      color: 'bg-indigo-500',
                    },
                    {
                      label: 'Tốc độ bán theo giờ & ngày',
                      val: product.scoreBreakdown.velocityScore,
                      max: 30,
                      color: 'bg-emerald-500',
                    },
                    {
                      label: 'Hiệu quả Hoa hồng & Cơ hội KOC',
                      val: product.scoreBreakdown.commissionScore,
                      max: 25,
                      color: 'bg-amber-500',
                    },
                    {
                      label: 'Độ uy tín Shop & Đánh giá SP',
                      val: product.scoreBreakdown.sellerTrustScore,
                      max: 20,
                      color: 'bg-cyan-500',
                    },
                  ].map((bar) => (
                    <div key={bar.label} className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-300">{bar.label}</span>
                        <span className="font-bold text-white">
                          {bar.val} / {bar.max}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${bar.color}`}
                          style={{ width: `${Math.min(100, (bar.val / bar.max) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 24h Hourly Sales Chart */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-indigo-400" />
                    Biểu Đồ Lượt Mua 24 Giờ Qua (Cập nhật mỗi giờ)
                  </h3>
                  <span className="text-[11px] text-amber-300">
                    Khung giờ vàng nổ đơn: <strong>{product.buyerEvidence.peakBuyingHours}</strong>
                  </span>
                </div>
                <div className="flex items-end gap-1 h-28 pt-4">
                  {product.hourlyHistory.map((pt, i) => {
                    const heightPct = Math.max(8, Math.round((pt.sold / maxHourlySold) * 100));
                    const isLatest = i === product.hourlyHistory.length - 1;
                    return (
                      <div
                        key={`${pt.hourLabel}-${i}`}
                        className="group relative flex-1 flex flex-col items-center h-full justify-end"
                      >
                        <div className="pointer-events-none opacity-0 group-hover:opacity-100 absolute -top-9 z-10 whitespace-nowrap rounded bg-slate-800 border border-slate-700 px-2 py-1 text-[10px] text-white shadow">
                          {pt.hourLabel}: <strong>{pt.sold} đơn</strong> ({pt.liveViewers} xem)
                        </div>
                        <div
                          className={`w-full rounded-t transition-all ${
                            isLatest
                              ? 'bg-emerald-400'
                              : heightPct >= 75
                                ? 'bg-indigo-500'
                                : 'bg-slate-700 group-hover:bg-indigo-400'
                          }`}
                          style={{ height: `${heightPct}%` }}
                        />
                        {i % 4 === 0 && (
                          <span className="mt-1 text-[9px] text-slate-500">
                            {pt.hourLabel.slice(0, 2)}h
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 7-Day Daily Trend + Buyer Insights */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    Xu Hướng Mua Bán 7 Ngày Gần Nhất ({product.sold7d.toLocaleString('vi-VN')} đơn)
                  </h3>
                  <div className="space-y-2">
                    {product.dailyHistory.slice(-7).map((d) => {
                      const wPct = Math.max(10, Math.round((d.sold / maxDailySold) * 100));
                      return (
                        <div key={d.date} className="flex items-center gap-2 text-xs">
                          <span className="w-20 text-[11px] text-slate-400 font-mono">
                            {d.date.slice(5)}
                          </span>
                          <div className="flex-1 h-4 rounded bg-slate-800/80 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded"
                              style={{ width: `${wPct}%` }}
                            />
                          </div>
                          <span className="w-20 text-right font-semibold text-slate-200 text-[11px]">
                            {d.sold.toLocaleString('vi-VN')} đơn
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-amber-400" />
                    Tổng Hợp Phản Hồi Người Mua Thực Tế
                  </h3>
                  <p className="text-xs text-slate-300">
                    <span className="text-slate-400">Chân dung khách mua:</span>{' '}
                    {product.buyerEvidence.targetAudience}
                  </p>
                  <div>
                    <div className="text-[11px] font-semibold text-emerald-300 mb-1.5">
                      Điểm khách khen nhiều nhất (Dùng làm ý chính trong video):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {product.buyerEvidence.topPraiseKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 text-[11px] text-emerald-200"
                        >
                          ✓ {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                  {product.buyerEvidence.cautionNotes.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-amber-300 mb-1">
                        Lưu ý nhắc khách trong video để giảm hoàn hàng:
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-300 list-disc list-inside">
                        {product.buyerEvidence.cautionNotes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'sellers' && (
            <div className="space-y-3.5">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-xs text-emerald-200 flex items-center justify-between flex-wrap gap-2">
                <span>
                  Hệ thống đã lọc các gian hàng <strong>Mall / Yêu Thích+ / Star Shop</strong> có tỷ lệ giao đúng hạn cao và tỷ lệ hoàn huỷ thấp nhất cho sản phẩm này để bảo vệ hoa hồng thực nhận của bạn.
                </span>
              </div>

              {product.reputableSellers.map((seller, idx) => (
                <div
                  key={seller.id}
                  className={`rounded-2xl border p-4 transition ${
                    idx === 0
                      ? 'border-emerald-500/50 bg-emerald-950/15'
                      : 'border-slate-800 bg-slate-950/60'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {idx === 0 && (
                          <span className="rounded-md bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold uppercase text-slate-950">
                            Khuyên Chọn #1
                          </span>
                        )}
                        <PlatformPill platform={seller.platform} />
                        <span className="rounded-md bg-amber-500/15 border border-amber-500/35 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                          {seller.badge}
                        </span>
                        <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                          <Store className="w-4 h-4 text-slate-400" />
                          {seller.shopName}
                        </h4>
                        <span className="text-[11px] text-slate-400">• Kho {seller.location}</span>
                      </div>
                      <p className="text-xs text-slate-300">{seller.recommendedReason}</p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-slate-400">Điểm Uy Tín</div>
                        <div className="text-base font-extrabold text-emerald-400">
                          {seller.trustScore}/100
                        </div>
                      </div>
                      <a
                        href={seller.shopSearchUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-bold text-white shadow transition"
                      >
                        Mở Trên Sàn
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                  <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-3 border-t border-slate-800/80 text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400">Giá & Hoa hồng Shop</div>
                      <div className="font-bold text-white mt-0.5">
                        {formatVnd(seller.sellingPriceVnd)}{' '}
                        <span className="text-emerald-400">({seller.commissionRatePct}%)</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Đánh giá & Follow</div>
                      <div className="font-bold text-amber-300 mt-0.5">
                        ★ {seller.rating} • {(seller.followers / 1000).toFixed(0)}K flw
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1">
                        <PackageCheck className="w-3 h-3" /> Giao đúng hạn
                      </div>
                      <div className="font-bold text-emerald-300 mt-0.5">
                        {seller.onTimeShipPct}% (Hoàn {seller.returnRatePct}%)
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" /> Phản hồi Chat
                      </div>
                      <div className="font-bold text-slate-200 mt-0.5">
                        {seller.responseRatePct}% ({seller.yearsActive} năm)
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Gift className="w-3 h-3" /> Tồn kho & Mẫu thử
                      </div>
                      <div className="font-bold text-indigo-300 mt-0.5">
                        {seller.stockCount.toLocaleString('vi-VN')} sẵn •{' '}
                        {seller.freeSampleAvailable ? 'Có Free Sample' : 'Không mẫu'}
                      </div>
                    </div>
                  </div>

                  {seller.extraCommissionNote && (
                    <div className="mt-2.5 text-[11px] text-amber-300/90 flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 shrink-0" />
                      {seller.extraCommissionNote}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'content' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-rose-400" />
                  Gợi Ý Câu Hook 3 Giây Đầu Giữ Chân Người Xem (TikTok / Shopee Video)
                </h3>
                {product.viralHooks.map((hook, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-200"
                  >
                    <span>
                      <strong className="text-indigo-400 mr-1.5">Hook #{idx + 1}:</strong>"{hook}"
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(hook, idx)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-200"
                    >
                      {copiedIdx === idx ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" /> Đã chép
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                    <Clapperboard className="w-4 h-4 text-indigo-400" />
                    Prompt Tạo Video AI Khung Dọc 9:16 (Chuẩn TikTok / Reels / Shopee Video)
                  </h3>
                </div>
                <textarea
                  rows={4}
                  value={editablePrompt}
                  onChange={(e) => setEditablePrompt(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    Bấm nút bên phải để đẩy thẳng sản phẩm này sang bảng <strong>Nhập Job Hàng Loạt (Tỉ lệ 9:16)</strong>.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onPushToVideoStudio(product, editablePrompt);
                      onClose();
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition"
                  >
                    <Clapperboard className="w-4 h-4" />
                    Đẩy Sang Tạo Video AI (9:16)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer quick links */}
        <div className="border-t border-slate-800 bg-slate-950/90 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={product.productSearchUrlShopee}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 text-xs font-semibold text-orange-300 transition"
            >
              🛍️ Tìm trên Shopee
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={product.productSearchUrlTiktok}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-pink-500/40 bg-pink-500/10 hover:bg-pink-500/20 px-3 py-1.5 text-xs font-semibold text-pink-300 transition"
            >
              🎵 Tìm trên TikTok Shop
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <button
            type="button"
            onClick={() => {
              onPushToVideoStudio(product, editablePrompt);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white transition"
          >
            <Clapperboard className="w-3.5 h-3.5" />
            Tạo Video Affiliate Ngay
          </button>
        </div>
      </div>
    </div>
  );
};
