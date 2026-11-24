export type RealProvider = 'gemini' | 'flow';

export class ProviderQuotaExhaustedError extends Error {
  public readonly provider: RealProvider;
  public readonly cooldownMs: number;

  constructor(provider: RealProvider, message: string, cooldownMs = 15 * 60 * 1000) {
    super(message);
    this.name = 'ProviderQuotaExhaustedError';
    this.provider = provider;
    this.cooldownMs = cooldownMs;
  }
}

export function isGeminiQuotaOrBillingError(err: unknown): boolean {
  if (err instanceof ProviderQuotaExhaustedError && err.provider === 'gemini') {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('billing') ||
    msg.includes('credit') ||
    msg.includes('insufficient') ||
    msg.includes('exceeded') ||
    msg.includes('chưa cấu hình gemini api key') ||
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid')
  );
}

export function isFlowQuotaOrUnavailableError(err: unknown): boolean {
  if (err instanceof ProviderQuotaExhaustedError && err.provider === 'flow') {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('not enough credits') ||
    msg.includes('out of credits') ||
    msg.includes('insufficient credits') ||
    msg.includes('không đủ tín dụng') ||
    msg.includes('hết tín dụng') ||
    msg.includes('hết điểm') ||
    msg.includes('quota') ||
    msg.includes('limit reached') ||
    msg.includes('đã đạt giới hạn') ||
    msg.includes('chưa đăng nhập google flow')
  );
}
