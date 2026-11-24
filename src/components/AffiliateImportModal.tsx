import React, { useState } from 'react';
import { FileSpreadsheet, Plus, Upload, X } from 'lucide-react';
import type { EcommercePlatform, SellerBadge } from '../affiliateTypes';

interface ImportRecord {
  name: string;
  platform?: EcommercePlatform;
  category?: string;
  priceVnd?: number;
  commissionRatePct?: number;
  soldToday?: number;
  shopName?: string;
  shopBadge?: SellerBadge;
  rating?: number;
}

interface AffiliateImportModalProps {
  onClose: () => void;
  onImport: (records: ImportRecord[]) => Promise<void>;
}

const SAMPLE_CSV = `name,platform,category,priceVnd,commissionRatePct,soldToday,shopName,shopBadge,rating
Áo Khoác Phao Lông Vũ Siêu Nhẹ Chống Nước Mùa Đông,shopee,Thời Trang,429000,16.5,2450, Routine Official Mall,Shopee Mall,4.9
Máy Sưởi Ấm Tay Mini Kiêm Sạc Dự Phòng 5000mAh,tiktok,Thiết Bị Điện Tử,159000,19.0,1890,Remax Vietnam Flagship,TikTok Shop Mall,4.8
Set Khăn Choàng Cổ Len Cashmere Hộp Quà Giáng Sinh,tiktok,Thời Trang,179000,21.0,3120,Julido Fashion Mall,Star Shop,4.9`;

export const AffiliateImportModal: React.FC<AffiliateImportModalProps> = ({
  onClose,
  onImport,
}) => {
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const parseInputToRecords = (raw: string): ImportRecord[] => {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    // Try JSON first
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : parsed.records || parsed.products || [];
      return arr.map((item: Record<string, unknown>) => ({
        name: String(item.name || item.productName || item.title || '').trim(),
        platform: item.platform === 'shopee' ? 'shopee' : 'tiktok',
        category: String(item.category || 'Sản Phẩm Import'),
        priceVnd: Number(item.priceVnd || item.price) || 199000,
        commissionRatePct: Number(item.commissionRatePct || item.commission) || 15,
        soldToday: Number(item.soldToday || item.sold24h || item.sales) || 1200,
        shopName: String(item.shopName || item.seller || 'Gian Hàng Uy Tín'),
        rating: Number(item.rating) || 4.9,
      }));
    }

    // Parse CSV lines
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    const firstLower = lines[0].toLowerCase();
    const hasHeader = firstLower.includes('name') || firstLower.includes('tên');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines
      .map((line) => {
        const cols = line.split(',').map((c) => c.trim());
        const [
          name,
          platformRaw,
          category,
          priceRaw,
          commRaw,
          soldRaw,
          shopName,
          shopBadgeRaw,
          ratingRaw,
        ] = cols;
        const platform: EcommercePlatform =
          (platformRaw || '').toLowerCase().includes('shopee') ? 'shopee' : 'tiktok';
        const shopBadge: SellerBadge =
          shopBadgeRaw === 'Shopee Mall' ||
          shopBadgeRaw === 'TikTok Shop Mall' ||
          shopBadgeRaw === 'Yêu Thích+' ||
          shopBadgeRaw === 'Star Shop'
            ? shopBadgeRaw
            : platform === 'shopee'
              ? 'Shopee Mall'
              : 'TikTok Shop Mall';

        return {
          name: name || '',
          platform,
          category: category || 'Sản Phẩm Import',
          priceVnd: Number(String(priceRaw || '').replace(/[^\d]/g, '')) || 199000,
          commissionRatePct: Number(commRaw) || 15,
          soldToday: Number(String(soldRaw || '').replace(/[^\d]/g, '')) || 1200,
          shopName: shopName || 'Gian Hàng Chính Hãng',
          shopBadge,
          rating: Number(ratingRaw) || 4.9,
        };
      })
      .filter((r) => r.name.length > 0);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
  };

  const handleSubmit = async () => {
    setError('');
    try {
      const records = parseInputToRecords(csvText);
      if (records.length === 0) {
        setError('Không tìm thấy dòng sản phẩm hợp lệ nào.');
        return;
      }
      setSubmitting(true);
      await onImport(records);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Định dạng dữ liệu không hợp lệ.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">
              Import Dữ Liệu Sản Phẩm (Kalodata / Metric / Shopee Affiliate CSV / JSON)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>
              Dán danh sách CSV hoặc JSON bên dưới để hệ thống tự động chấm điểm mùa vụ, uy tín shop và đưa vào xét duyệt <strong>Top 10 mỗi ngày</strong>.
            </span>
            <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200">
              <Upload className="w-3.5 h-3.5" />
              Chọn file .CSV / .JSON
              <input
                type="file"
                accept=".csv,.json,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <textarea
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="name,platform,category,priceVnd,commissionRatePct,soldToday,shopName,shopBadge,rating"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
          />

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-xs font-bold text-white shadow"
            >
              <Plus className="w-4 h-4" />
              {submitting ? 'Đang chấm điểm & Import...' : 'Import & Phân Tích Ngay'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
