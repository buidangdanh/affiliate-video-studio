export type InputType = 'text_to_video' | 'image_to_video' | 'frames_to_video';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ProviderMode =
  | 'auto_flow_first'
  | 'auto_gemini_first'
  | 'gemini'
  | 'flow'
  | 'mock';

export type ExecutedProvider = 'gemini' | 'flow' | 'mock';

export interface UploadedAsset {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  url: string;
  size: number;
}

export interface GeneratedVideoOutput {
  index: number;
  filename: string;
  url: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface VideoJob {
  id: string;
  seq: number;
  batchId?: string;
  prompt: string;
  negativePrompt?: string;
  inputType: InputType;
  model: string;
  aspectRatio: AspectRatio;
  outputCount: number;
  durationSeconds: number;
  resolution?: '720p' | '1080p';
  imageAsset?: UploadedAsset | null;
  firstFrameAsset?: UploadedAsset | null;
  lastFrameAsset?: UploadedAsset | null;
  status: JobStatus;
  progress: number;
  statusMessage?: string;
  error?: string;
  retryCount: number;
  providerMode: ProviderMode;
  executedProvider?: ExecutedProvider;
  failoverFrom?: 'gemini' | 'flow';
  failoverReason?: string;
  outputs: GeneratedVideoOutput[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProviderHealth {
  geminiExhaustedUntil: number | null;
  geminiExhaustedReason: string | null;
  flowExhaustedUntil: number | null;
  flowExhaustedReason: string | null;
  totalFailovers: number;
}

export interface PublicSystemSettings {
  providerMode: ProviderMode;
  hasGeminiApiKey: boolean;
  maskedGeminiApiKey: string;
  flowProjectUrl: string;
  maxConcurrency: number;
  maxJobsPerMinute: number;
  mockDurationSec: number;
  mockFailureRate: number;
  isPaused: boolean;
  providerHealth: ProviderHealth;
}

export interface FlowBrowserStatus {
  isBrowserOpen: boolean;
  isLoggedIn: boolean;
  isProjectReady: boolean;
  currentUrl: string;
  browserExecutable: string | null;
  message: string;
}

export interface QueueStats {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  jobsStartedLastMinute: number;
  maxJobsPerMinute: number;
  maxConcurrency: number;
  nextRateLimitSlotAt: number | null;
  isPaused: boolean;
  recentStartTimestamps: number[];
}

export interface DraftJob {
  localId: string;
  selected: boolean;
  prompt: string;
  inputType: InputType;
  model: string;
  aspectRatio: AspectRatio;
  outputCount: number;
  durationSeconds: number;
  imageAsset: UploadedAsset | null;
  firstFrameAsset: UploadedAsset | null;
  lastFrameAsset: UploadedAsset | null;
  uploadingField?: 'image' | 'firstFrame' | 'lastFrame' | null;
}

export const PROVIDER_MODE_OPTIONS: Array<{
  value: ProviderMode;
  label: string;
  shortLabel: string;
  desc: string;
}> = [
  {
    value: 'auto_flow_first',
    label: 'Tự động: Ưu tiên Google Flow (Ultra) → Dự phòng Gemini API',
    shortLabel: 'Auto: Flow → Gemini API',
    desc: 'Dùng hạn mức Web Flow trước; khi hết điểm/chưa sẵn sàng tự chuyển sang Gemini API Key',
  },
  {
    value: 'auto_gemini_first',
    label: 'Tự động: Ưu tiên Gemini API → Dự phòng Google Flow (Ultra)',
    shortLabel: 'Auto: Gemini API → Flow',
    desc: 'Dùng Credit API hàng tháng trước; khi hết quota/credit tự chuyển sang Google Flow Chrome',
  },
  {
    value: 'gemini',
    label: 'Chỉ dùng Phương án 1: Google Gemini API Key',
    shortLabel: 'Chỉ Gemini API',
    desc: 'Chạy ngầm 100% qua Google AI Studio / Gemini Veo API chính thức',
  },
  {
    value: 'flow',
    label: 'Chỉ dùng Phương án 2: Google Labs Flow (Chrome Ultra)',
    shortLabel: 'Chỉ Google Flow',
    desc: 'Điều khiển cửa sổ Chrome đã đăng nhập tài khoản Google AI Ultra trên Flow',
  },
  {
    value: 'mock',
    label: 'Chế độ Demo MP4 (Test nhanh luồng hàng đợi, không tốn phí)',
    shortLabel: 'Demo MP4',
    desc: 'Tạo file video MP4 mẫu trực tiếp bằng FFmpeg trên máy để kiểm thử',
  },
];

export const INPUT_TYPE_OPTIONS: Array<{ value: InputType; label: string; shortLabel: string }> = [
  { value: 'text_to_video', label: 'Tạo video từ Text', shortLabel: 'Từ Text' },
  { value: 'image_to_video', label: 'Tạo video từ Hình ảnh', shortLabel: 'Từ Hình ảnh' },
  { value: 'frames_to_video', label: 'Tạo video từ Khung hình', shortLabel: 'Từ Khung hình' },
];

export const MODEL_OPTIONS: Array<{ value: string; label: string; desc: string }> = [
  { value: 'gemini-omni-1.2-flash', label: 'Gemini Omni 1.2 Flash (Video 2026)', desc: 'Model tạo video + âm thanh mới nhất trên Gemini API' },
  { value: 'veo-3.0-fast-generate-001', label: 'Veo 3-Fast (Flow / Tự map Omni 1.2)', desc: 'Tốc độ cao trên Flow & tự tương thích Gemini API' },
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast (Flow)', desc: 'Thế hệ mới trên Google Flow' },
  { value: 'gemini-omni-1.1-flash', label: 'Gemini Omni 1.1 Flash', desc: 'Model tạo video ổn định trên Gemini API' },
  { value: 'veo-2.0-generate-001', label: 'Veo 2', desc: 'Phiên bản ổn định' },
];

export const ASPECT_RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: '16:9', label: '16:9 (Ngang)' },
  { value: '9:16', label: '9:16 (Dọc)' },
  { value: '1:1', label: '1:1 (Vuông)' },
  { value: '4:3', label: '4:3 (Cổ điển)' },
  { value: '3:4', label: '3:4 (Chân dung)' },
];

export const DURATION_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 8, label: '8 giây (Chuẩn Veo)' },
  { value: 6, label: '6 giây' },
  { value: 5, label: '5 giây' },
];

export const SAMPLE_PROMPTS: string[] = [
  'Flycam bay lượn trên vịnh Hạ Long lúc bình minh, sương mù nhẹ bao phủ các đảo đá vôi, ánh nắng vàng ấm áp, 4K điện ảnh',
  'Chú mèo phi hành gia mặc bộ đồ vũ trụ trắng đang bước đi chậm rãi trên bề mặt mặt trăng, Trái Đất xanh rực rỡ phía xa',
  'Quán cà phê nhỏ ấm cúng ở phố cổ Hà Nội trong cơn mưa chiều, khói bốc lên từ tách cà phê phin bên khung cửa sổ gỗ',
  'Siêu xe thể thao tương lai chạy xuyên qua đại lộ cyberpunk rực rỡ đèn neon lúc nửa đêm, phản chiếu mặt đường ướt',
  'Cận cảnh giọt sương mai rơi xuống cánh hoa sen hồng đang nở rộ trên mặt hồ tĩnh lặng, chuyển động slow-motion mượt mà',
  'Đầu bếp chuyên nghiệp đang áp chảo bít tết với ngọn lửa bùng lên ấn tượng trong gian bếp nhà hàng sang trọng',
  'Đoàn tàu tốc hành chạy qua thung lũng núi tuyết Thụy Sĩ vào mùa thu với rừng lá phong đỏ vàng rực rỡ',
  'Rùa biển khổng lồ bơi uyển chuyển giữa rạn san hô đầy màu sắc dưới làn nước biển trong vắt ánh nắng xuyên qua',
  'Thành phố nổi trên mây lúc hoàng hôn với những thác nước đổ xuống không trung và khinh khí cầu bay lượn',
  'Cảnh quay timelapse bầu trời đêm đầy sao dải Ngân Hà xoay tròn phía trên ngọn hải đăng cổ kính ven biển',
];
