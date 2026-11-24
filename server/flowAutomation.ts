import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { OUTPUTS_DIR, STORAGE_ROOT, UPLOADS_DIR } from './store.ts';
import { ProviderQuotaExhaustedError } from './errors.ts';
import type { GeneratedVideoOutput, VideoJob } from './types.ts';
import type { ProgressCallback } from './videoGenerator.ts';

export const FLOW_PROFILE_DIR = path.join(STORAGE_ROOT, 'flow-visible-profile');
const DEFAULT_FLOW_URL = 'https://labs.google/fx/tools/flow';

export function isFlowUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'flow.google.com' ||
      (url.hostname === 'labs.google' && url.pathname.startsWith('/fx'));
  } catch {
    return false;
  }
}

export interface FlowBrowserStatus {
  isBrowserOpen: boolean;
  isLoggedIn: boolean;
  isProjectReady: boolean;
  currentUrl: string;
  browserExecutable: string | null;
  message: string;
}

export function findLocalBrowserExecutable(): string | null {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe')
      : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Job đã bị huỷ'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('Job đã bị huỷ'));
      },
      { once: true }
    );
  });
}

class FlowBrowserManager {
  private context: BrowserContext | null = null;
  private launchingPromise: Promise<BrowserContext> | null = null;
  private idlePages: Page[] = [];
  private lastKnownProjectUrl: string | null = null;

  public async ensureContext(): Promise<BrowserContext> {
    if (this.context) {
      try {
        this.context.pages();
        return this.context;
      } catch {
        this.context = null;
        this.idlePages = [];
      }
    }

    if (this.launchingPromise) {
      return this.launchingPromise;
    }

    this.launchingPromise = (async () => {
      // Chrome opened from the Windows shortcut runs on the user's visible desktop.
      try {
        const visibleBrowser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 2000 });
        const visibleContext = visibleBrowser.contexts()[0];
        if (visibleContext) {
          visibleBrowser.on('disconnected', () => {
            if (this.context === visibleContext) {
              this.context = null;
              this.idlePages = [];
            }
          });
          this.context = visibleContext;
          return visibleContext;
        }
        await visibleBrowser.close();
      } catch {
        if (fs.existsSync(path.join(STORAGE_ROOT, '..', 'Mo Chrome Flow.lnk'))) {
          throw new Error(
            'Mất kết nối với Chrome Flow của dự án. Mở file D:\\TaoVideoAI\\Mo Chrome Flow.lnk rồi nhấn Kiểm tra phiên. Hệ thống không tự chuyển sang Chrome khác để tránh mất phiên đăng nhập.'
          );
        }
      }
      const exePath = findLocalBrowserExecutable();
      if (!exePath) {
        throw new ProviderQuotaExhaustedError(
          'flow',
          'Không tìm thấy trình duyệt Google Chrome hoặc Microsoft Edge trên máy tính.',
          5 * 60 * 1000
        );
      }

      fs.mkdirSync(FLOW_PROFILE_DIR, { recursive: true });

      const ctx = await chromium.launchPersistentContext(FLOW_PROFILE_DIR, {
        executablePath: exePath,
        headless: false,
        viewport: null,
        acceptDownloads: true,
        args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
      });

      ctx.on('close', () => {
        this.context = null;
        this.idlePages = [];
      });

      this.context = ctx;
      return ctx;
    })();

    try {
      return await this.launchingPromise;
    } finally {
      this.launchingPromise = null;
    }
  }

  public async launchAndOpenFlow(customUrl?: string): Promise<FlowBrowserStatus> {
    const targetUrl = customUrl?.trim() || this.lastKnownProjectUrl || DEFAULT_FLOW_URL;
    const ctx = await this.ensureContext();
    const pages = ctx.pages();
    const page = pages.find((p) => isFlowUrl(p.url()) && p.url().includes('/project/')) ||
      pages.find((p) => isFlowUrl(p.url())) || pages[0] || await ctx.newPage();

    const cur = page.url();
    if ((!isFlowUrl(cur) && !cur.includes('accounts.google.com')) ||
        (isFlowUrl(cur) && !cur.includes('/project/') && targetUrl.includes('/project/'))) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    }
    await page.bringToFront().catch(() => {});
    return this.getStatus();
  }

  public async closeBrowser(): Promise<void> {
    this.idlePages = [];
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }

  public async getStatus(): Promise<FlowBrowserStatus> {
    const exePath = findLocalBrowserExecutable();
    if (!this.context) {
      try {
        await this.ensureContext();
      } catch {
        // Report disconnected state without substituting a different profile.
      }
    }
    if (!this.context) {
      return {
        isBrowserOpen: false,
        isLoggedIn: false,
        isProjectReady: false,
        currentUrl: '',
        browserExecutable: exePath,
        message:
          'Chưa kết nối được Chrome Flow. Mở D:\\TaoVideoAI\\Mo Chrome Flow.lnk rồi nhấn Kiểm tra phiên.',
      };
    }

    const pages = this.context.pages();
    if (pages.length === 0) {
      return {
        isBrowserOpen: true,
        isLoggedIn: false,
        isProjectReady: false,
        currentUrl: '',
        browserExecutable: exePath,
        message: 'Cửa sổ Chrome đang mở nhưng chưa có tab Google Flow.',
      };
    }

    const activePage =
      pages.find((p) => isFlowUrl(p.url()) && p.url().includes('/project/')) ||
      pages.find((p) => isFlowUrl(p.url())) || pages[0];
    const url = activePage.url();

    if (url.includes('/project/')) {
      this.lastKnownProjectUrl = url;
    }

    const state = await this.inspectPageState(activePage);

    return {
      isBrowserOpen: true,
      isLoggedIn: state.isLoggedIn,
      isProjectReady: state.hasPromptComposer,
      currentUrl: url,
      browserExecutable: exePath,
      message: state.hasPromptComposer
        ? 'Đã sẵn sàng! Đã đăng nhập và mở sẵn không gian làm việc Google Flow.'
        : state.isLoggedIn
          ? 'Đã đăng nhập Google Flow — hệ thống sẽ tự vào dự án khi chạy job.'
          : 'Đang chờ bạn đăng nhập tài khoản Google AI Ultra trên cửa sổ Chrome vừa mở.',
    };
  }

  private async inspectPageState(page: Page): Promise<{
    isLoggedIn: boolean;
    hasPromptComposer: boolean;
    hasCaptchaGate: boolean;
    quotaErrorText: string | null;
  }> {
    try {
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com')) {
        return {
          isLoggedIn: false,
          hasPromptComposer: false,
          hasCaptchaGate: false,
          quotaErrorText: null,
        };
      }

      return await page.evaluate(() => {
        const href = window.location.href;
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const hasSignInBtn = Array.from(document.querySelectorAll('a, button')).some((el) => {
          const t = (el.textContent || '').trim().toLowerCase();
          return (
            t === 'sign in' ||
            t === 'đăng nhập' ||
            t === 'sign in with google' ||
            t === 'đăng nhập bằng google'
          );
        });

        const textareas = Array.from(
          document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]')
        ).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 120 && rect.height >= 16;
        });

        const hasCaptcha =
          Boolean(
            document.querySelector(
              'iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha"], #captcha-form'
            )
          ) &&
          Array.from(
            document.querySelectorAll('iframe[src*="recaptcha/api2/bframe"], #captcha-form')
          ).some((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 100 && r.height > 100;
          });

        const quotaPhrases = [
          'not enough credits',
          'out of credits',
          'insufficient credits',
          'không đủ tín dụng',
          'đã hết tín dụng',
          'daily limit reached',
          'monthly limit reached',
          'đã đạt giới hạn',
        ];
        let matchedQuota: string | null = null;
        for (const phrase of quotaPhrases) {
          if (bodyText.includes(phrase)) {
            matchedQuota = phrase;
            break;
          }
        }

        return {
          isLoggedIn: !hasSignInBtn &&
            (window.location.hostname === 'flow.google.com' ||
              (window.location.hostname === 'labs.google' && window.location.pathname.startsWith('/fx'))),
          hasPromptComposer: textareas.length > 0,
          hasCaptchaGate: hasCaptcha,
          quotaErrorText: matchedQuota,
        };
      });
    } catch {
      return {
        isLoggedIn: false,
        hasPromptComposer: false,
        hasCaptchaGate: false,
        quotaErrorText: null,
      };
    }
  }

  private async acquireWorkerPage(customFlowUrl?: string): Promise<Page> {
    const targetUrl = customFlowUrl?.trim() || this.lastKnownProjectUrl || DEFAULT_FLOW_URL;
    const ctx = await this.ensureContext();

    while (this.idlePages.length > 0) {
      const candidate = this.idlePages.pop()!;
      if (!candidate.isClosed()) {
        return candidate;
      }
    }

    const existingFlowTab = ctx
      .pages()
      .find((p) => isFlowUrl(p.url()) || p.url().startsWith('https://accounts.google.com/') || p.url() === 'about:blank');

    if (existingFlowTab) {
      if (existingFlowTab.url() === 'about:blank' ||
          (isFlowUrl(existingFlowTab.url()) && !existingFlowTab.url().includes('/project/') && targetUrl.includes('/project/'))) {
        await existingFlowTab
          .goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          .catch(() => {});
      }
      return existingFlowTab;
    }

    const page = await ctx.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    return page;
  }

  private releaseWorkerPage(page: Page): void {
    if (!page.isClosed() && !this.idlePages.includes(page)) {
      this.idlePages.push(page);
    }
  }

  public async executeFlowJob(
    job: VideoJob,
    options: {
      flowProjectUrl?: string;
      canFailoverImmediately: boolean;
    },
    onProgress: ProgressCallback,
    signal: AbortSignal
  ): Promise<GeneratedVideoOutput[]> {
    const page = await this.acquireWorkerPage(options.flowProjectUrl);
    const capturedMp4Buffers: Buffer[] = [];

    const onResponse = async (resp: import('playwright-core').Response) => {
      try {
        const ct = (resp.headers()['content-type'] || '').toLowerCase();
        const url = resp.url();
        if (
          resp.status() === 200 &&
          (ct.includes('video/mp4') ||
            (url.includes('.mp4') && !url.includes('preview')))
        ) {
          const buf = await resp.body().catch(() => null);
          if (buf && buf.length > 50_000) {
            capturedMp4Buffers.push(buf);
          }
        }
      } catch {
        // Ignore transient stream read errors
      }
    };

    page.on('response', onResponse);

    try {
      onProgress(8, '[Google Flow] Đang kiểm tra phiên đăng nhập & dự án Flow...');
      await sleep(1500, signal);

      await this.tryEnterFlowProject(page);
      let state = await this.inspectPageState(page);

      if (!state.hasPromptComposer && !state.isLoggedIn) {
        if (options.canFailoverImmediately) {
          throw new ProviderQuotaExhaustedError(
            'flow',
            'Chưa đăng nhập Google Flow trên cửa sổ Chrome -> Tự động chuyển sang phương án dự phòng.',
            2 * 60 * 1000
          );
        }

        await page.bringToFront().catch(() => {});
        for (let waitSec = 0; waitSec < 120; waitSec += 3) {
          onProgress(
            10,
            `[Google Flow] Đang chờ bạn đăng nhập tài khoản Gemini Ultra trên cửa sổ Chrome (${120 - waitSec}s)...`
          );
          await sleep(3000, signal);
          await this.tryEnterFlowProject(page);
          state = await this.inspectPageState(page);
          if (state.hasPromptComposer) break;
        }

        if (!state.hasPromptComposer) {
          throw new ProviderQuotaExhaustedError(
            'flow',
            'Chưa đăng nhập hoặc chưa mở dự án trên Google Flow sau thời gian chờ.',
            2 * 60 * 1000
          );
        }
      }

      if (!state.hasPromptComposer) {
        await this.tryEnterFlowProject(page);
        await sleep(2500, signal);
        state = await this.inspectPageState(page);
      }

      if (state.hasCaptchaGate) {
        await page.bringToFront().catch(() => {});
        for (let w = 0; w < 90; w += 3) {
          onProgress(
            12,
            '[Google Flow] Cần bạn xác nhận bảo mật trực tiếp trên cửa sổ Chrome đang mở...'
          );
          await sleep(3000, signal);
          state = await this.inspectPageState(page);
          if (!state.hasCaptchaGate) break;
        }
        if (state.hasCaptchaGate) {
          throw new Error(
            'Google Flow đang yêu cầu xác minh người dùng trực tiếp trên cửa sổ trình duyệt Chrome.'
          );
        }
      }

      if (state.quotaErrorText) {
        throw new ProviderQuotaExhaustedError(
          'flow',
          `Google Flow đã hết tín dụng / đạt giới hạn (${state.quotaErrorText}).`
        );
      }

      if (page.url().includes('/project/')) {
        this.lastKnownProjectUrl = page.url();
      }

      const existingVideoSrcs = new Set<string>(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll('video'))
            .map((v) => v.currentSrc || v.src || '')
            .filter(Boolean)
        )
      );

      onProgress(18, `[Google Flow] Đang thiết lập thông số (${job.model}, ${job.aspectRatio})...`);
      await this.configureFlowOptions(page, job);

      if (job.inputType === 'image_to_video' && job.imageAsset) {
        onProgress(24, '[Google Flow] Đang tải ảnh đầu vào lên Flow...');
        const imgPath = path.join(UPLOADS_DIR, job.imageAsset.filename);
        await this.uploadFilesToFlow(page, [imgPath]);
      } else if (job.inputType === 'frames_to_video') {
        const pathsToUpload: string[] = [];
        if (job.firstFrameAsset) {
          pathsToUpload.push(path.join(UPLOADS_DIR, job.firstFrameAsset.filename));
        }
        if (job.lastFrameAsset) {
          pathsToUpload.push(path.join(UPLOADS_DIR, job.lastFrameAsset.filename));
        }
        if (pathsToUpload.length > 0) {
          onProgress(24, '[Google Flow] Đang tải khung hình đầu/cuối lên Flow...');
          await this.uploadFilesToFlow(page, pathsToUpload);
        }
      }

      onProgress(30, '[Google Flow] Đang nhập Prompt và nhấn Tạo video...');
      await this.fillPromptAndSubmit(page, job.prompt);

      const maxWaitSec = 240;
      const newVideoUrls: string[] = [];

      for (let elapsed = 0; elapsed < maxWaitSec; elapsed += 4) {
        await sleep(4000, signal);

        const liveState = await this.inspectPageState(page);
        if (liveState.quotaErrorText) {
          throw new ProviderQuotaExhaustedError(
            'flow',
            `Google Flow thông báo hết điểm / hạn mức: "${liveState.quotaErrorText}".`
          );
        }
        if (liveState.hasCaptchaGate) {
          await page.bringToFront().catch(() => {});
          onProgress(
            45,
            '[Google Flow] Google Flow yêu cầu bạn xác nhận trực tiếp trên cửa sổ Chrome...'
          );
          continue;
        }

        const foundUrls: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll('video'))
            .map((v) => v.currentSrc || v.src || '')
            .filter((u) => u.startsWith('http') || u.startsWith('blob:'))
        );

        for (const u of foundUrls) {
          if (!existingVideoSrcs.has(u) && !newVideoUrls.includes(u)) {
            newVideoUrls.push(u);
          }
        }

        if (
          newVideoUrls.length >= job.outputCount ||
          capturedMp4Buffers.length >= job.outputCount ||
          (elapsed >= 20 && (newVideoUrls.length > 0 || capturedMp4Buffers.length > 0))
        ) {
          if (newVideoUrls.length < job.outputCount && elapsed < 60) {
            await sleep(3000, signal);
          }
          break;
        }

        const pct = Math.min(88, 32 + Math.round((elapsed / 90) * 55));
        onProgress(pct, `[Google Flow] Đang render video trên máy chủ Flow (${elapsed + 4}s)...`);
      }

      const outputs: GeneratedVideoOutput[] = [];
      const safeModel = job.model.replace(/[^a-zA-Z0-9_-]/g, '-');

      if (capturedMp4Buffers.length > 0) {
        const takeBuffers = capturedMp4Buffers.slice(0, job.outputCount);
        for (let i = 0; i < takeBuffers.length; i++) {
          const idx = i + 1;
          const filename = `job-${String(job.seq).padStart(3, '0')}_flow_${safeModel}_${idx}_${Date.now()}.mp4`;
          const fullPath = path.join(OUTPUTS_DIR, filename);
          fs.writeFileSync(fullPath, takeBuffers[i]);
          outputs.push({
            index: idx,
            filename,
            url: `/media/outputs/${filename}`,
            downloadUrl: `/api/jobs/${job.id}/download/${idx}`,
            mimeType: 'video/mp4',
            sizeBytes: takeBuffers[i].length,
          });
        }
      } else if (newVideoUrls.length > 0) {
        const takeUrls = newVideoUrls.slice(0, job.outputCount);
        for (let i = 0; i < takeUrls.length; i++) {
          const idx = i + 1;
          const vUrl = takeUrls[i];
          const filename = `job-${String(job.seq).padStart(3, '0')}_flow_${safeModel}_${idx}_${Date.now()}.mp4`;
          const fullPath = path.join(OUTPUTS_DIR, filename);

          const base64Data = await page.evaluate(async (targetUrl) => {
            const res = await fetch(targetUrl);
            const blob = await res.blob();
            return await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const result = String(reader.result || '');
                const comma = result.indexOf(',');
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }, vUrl);

          const buf = Buffer.from(base64Data, 'base64');
          fs.writeFileSync(fullPath, buf);
          outputs.push({
            index: idx,
            filename,
            url: `/media/outputs/${filename}`,
            downloadUrl: `/api/jobs/${job.id}/download/${idx}`,
            mimeType: 'video/mp4',
            sizeBytes: buf.length,
          });
        }
      }

      if (outputs.length === 0) {
        throw new Error(
          'Không thu được video đầu ra từ Google Flow sau thời gian chờ. Hãy kiểm tra cửa sổ Chrome xem dự án Flow đã mở sẵn khung nhập Prompt chưa.'
        );
      }

      onProgress(100, `[Google Flow] Hoàn tất tạo ${outputs.length} video!`);
      return outputs;
    } finally {
      page.off('response', onResponse);
      this.releaseWorkerPage(page);
    }
  }

  private async tryEnterFlowProject(page: Page): Promise<void> {
    try {
      const clicked = await page.evaluate(() => {
        const triggers = [
          'new project',
          'dự án mới',
          'create with flow',
          'tạo bằng flow',
          'bắt đầu',
          'get started',
        ];
        const buttons = Array.from(document.querySelectorAll('button, a'));
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (triggers.some((t) => text.includes(t))) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        await page.waitForTimeout(2500);
      }
    } catch {
      // Ignore navigation race
    }
  }

  private async configureFlowOptions(page: Page, job: VideoJob): Promise<void> {
    try {
      const desiredModePatterns =
        job.inputType === 'text_to_video'
          ? [/text to video/i, /tạo video từ văn bản/i, /từ văn bản/i]
          : [/frames to video/i, /tạo video từ khung hình/i, /ingredients to video/i, /hình ảnh/i];

      const modeToggle = page
        .locator('button, [role="combobox"]')
        .filter({
          hasText:
            /Text to Video|Frames to Video|Ingredients to Video|Tạo video từ văn bản|Tạo video từ khung hình|Tạo video từ thành phần/i,
        })
        .first();

      if ((await modeToggle.count()) > 0) {
        await modeToggle.click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(400);
        for (const pat of desiredModePatterns) {
          const opt = page
            .locator('[role="option"], [role="menuitem"], button')
            .filter({ hasText: pat })
            .first();
          if ((await opt.count()) > 0) {
            await opt.click({ timeout: 2000 }).catch(() => {});
            break;
          }
        }
      }

      const ratioOpt = page
        .locator('button, [role="radio"], [role="option"]')
        .filter({ hasText: new RegExp(`^\\s*${job.aspectRatio}\\s*$`) })
        .first();
      if ((await ratioOpt.count()) > 0) {
        await ratioOpt.click({ timeout: 1500 }).catch(() => {});
      }
    } catch {
      // Continue gracefully
    }
  }

  private async uploadFilesToFlow(page: Page, filePaths: string[]): Promise<void> {
    const validPaths = filePaths.filter((p) => fs.existsSync(p));
    if (validPaths.length === 0) return;

    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    if (count > 0) {
      if (validPaths.length === 1 || count === 1) {
        await fileInputs.first().setInputFiles(validPaths);
      } else {
        await fileInputs.nth(0).setInputFiles(validPaths[0]);
        await page.waitForTimeout(600);
        const updatedCount = await fileInputs.count();
        if (updatedCount > 1) {
          await fileInputs.nth(1).setInputFiles(validPaths[1]);
        }
      }
      await page.waitForTimeout(1500);
    }
  }

  private async fillPromptAndSubmit(page: Page, prompt: string): Promise<void> {
    const composer = page
      .locator('textarea:visible, [contenteditable="true"][role="textbox"]:visible')
      .first();

    await composer.waitFor({ state: 'visible', timeout: 15_000 });
    await composer.click();
    await composer.fill(prompt);
    await page.waitForTimeout(400);

    const namedSubmit = page.getByRole('button', { name: /^(Bắt đầu tạo|Start creating|Generate|Send)$/i }).filter({ visible: true }).last();
    const generateBtn = (await namedSubmit.count()) > 0 ? namedSubmit : page
      .locator('button:visible')
      .filter({ hasText: /Generate|Tạo|arrow_forward|send/i })
      .last();

    if ((await generateBtn.count()) > 0 && (await generateBtn.isEnabled().catch(() => false))) {
      await generateBtn.click();
    } else {
      throw new Error('Không tìm thấy nút gửi prompt khả dụng trên Flow. Yêu cầu chưa được gửi.');
    }
    await page.waitForFunction(() => {
      const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]'));
      return inputs.some((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 120 && rect.height >= 16 &&
          !((el instanceof HTMLTextAreaElement ? el.value : el.textContent) || '').trim();
      });
    }, undefined, { timeout: 15_000 });
  }
}

export const flowManager = new FlowBrowserManager();
