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

export interface SystemSettings {
  providerMode: ProviderMode;
  geminiApiKey: string;
  flowProjectUrl: string;
  maxConcurrency: number;
  maxJobsPerMinute: number;
  mockDurationSec: number;
  mockFailureRate: number;
  isPaused: boolean;
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

export interface CreateJobInput {
  prompt: string;
  negativePrompt?: string;
  inputType: InputType;
  model: string;
  aspectRatio: AspectRatio;
  outputCount: number;
  durationSeconds?: number;
  resolution?: '720p' | '1080p';
  imageAsset?: UploadedAsset | null;
  firstFrameAsset?: UploadedAsset | null;
  lastFrameAsset?: UploadedAsset | null;
}
