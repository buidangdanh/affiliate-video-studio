import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
    return (
      url.hostname === 'flow.google.com' ||
      (url.hostname === 'labs.google' && url.pathname.startsWith('/fx'))
    );
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

interface FlowVideoCardSnapshot {
  thumbSrc: string;
  aria: string;
  cx: number;
  cy: number;
  x: number;
  y: number;
}

class FlowBrowserManager {
  private context: BrowserContext | null = null;
  private launchingPromise: Promise<BrowserContext> | null = null;
  private lastKnownProjectUrl: string | null = null;
  // Serialize UI interactions on the single visible Google Flow tab so concurrent jobs never collide
  private taskMutex: Promise<void> = Promise.resolve();

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.taskMutex;
    let release!: () => void;
    this.taskMutex = new Promise<void>((res) => {
      release = res;
    });
    return prev.then(fn).finally(() => release());
  }

  public async ensureContext(): Promise<BrowserContext> {
    if (this.context) {
      try {
        this.context.pages();
        return this.context;
      } catch {
        this.context = null;
      }
    }

    if (this.launchingPromise) {
      return this.launchingPromise;
    }

    this.launchingPromise = (async () => {
      // 1. Connect to existing visible Chrome Flow session on CDP port 9223 if already open
      try {
        const visibleBrowser = await chromium.connectOverCDP('http://127.0.0.1:9223', {
          timeout: 2000,
        });
        const visibleContext = visibleBrowser.contexts()[0];
        if (visibleContext) {
          visibleBrowser.on('disconnected', () => {
            if (this.context === visibleContext) {
              this.context = null;
            }
          });
          this.context = visibleContext;
          return visibleContext;
        }
      } catch {
        // Port 9223 not open yet — spawn Chrome detached with FLOW_PROFILE_DIR on port 9223
        const exe = findLocalBrowserExecutable();
        if (exe) {
          fs.mkdirSync(FLOW_PROFILE_DIR, { recursive: true });
          const child = spawn(
            exe,
            [
              `--user-data-dir=${FLOW_PROFILE_DIR}`,
              '--remote-debugging-port=9223',
              '--no-first-run',
              '--no-default-browser-check',
              '--start-maximized',
              this.lastKnownProjectUrl || DEFAULT_FLOW_URL,
            ],
            { detached: true, stdio: 'ignore' }
          );
          child.unref();

          for (let retry = 0; retry < 15; retry++) {
            await sleep(1000);
            try {
              const spawnedBrowser = await chromium.connectOverCDP(
                'http://127.0.0.1:9223',
                { timeout: 2000 }
              );
              const spawnedCtx = spawnedBrowser.contexts()[0];
              if (spawnedCtx) {
                spawnedBrowser.on('disconnected', () => {
                  if (this.context === spawnedCtx) {
                    this.context = null;
                  }
                });
                this.context = spawnedCtx;
                return spawnedCtx;
              }
            } catch {
              // Wait for port 9223
            }
          }
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

  private async getOrOpenFlowPage(customFlowUrl?: string): Promise<Page> {
    const targetUrl = customFlowUrl?.trim() || this.lastKnownProjectUrl || DEFAULT_FLOW_URL;
    const ctx = await this.ensureContext();
    const pages = ctx.pages();

    let page =
      pages.find((p) => isFlowUrl(p.url()) && p.url().includes('/project/')) ||
      pages.find((p) => isFlowUrl(p.url())) ||
      pages.find((p) => p.url().startsWith('https://accounts.google.com/')) ||
      pages.find((p) => p.url() === 'about:blank');

    if (!page) {
      page = await ctx.newPage();
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
      return page;
    }

    const cur = page.url();
    if (
      cur === 'about:blank' ||
      (!isFlowUrl(cur) && !cur.includes('accounts.google.com')) ||
      (isFlowUrl(cur) && !cur.includes('/project/') && targetUrl.includes('/project/'))
    ) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    }

    return page;
  }

  public async launchAndOpenFlow(customUrl?: string): Promise<FlowBrowserStatus> {
    const page = await this.getOrOpenFlowPage(customUrl);
    await page.bringToFront().catch(() => {});
    await this.prepareProjectGridWorkspace(page).catch(() => {});
    return this.getStatus();
  }

  public async closeBrowser(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }

  public async getStatus(): Promise<FlowBrowserStatus> {
    const exePath = findLocalBrowserExecutable();
    if (!this.context) {
      try {
        const b = await chromium.connectOverCDP('http://127.0.0.1:9223', {
          timeout: 1500,
        });
        const ctx = b.contexts()[0];
        if (ctx) {
          b.on('disconnected', () => {
            if (this.context === ctx) this.context = null;
          });
          this.context = ctx;
        }
      } catch {
        // Not currently running; do not auto-launch on passive status check
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
          'Chrome Flow đang đóng. Nhấn "Mở Chrome & Đăng nhập Flow" (hoặc bấm Submit job để hệ thống tự mở).',
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
      pages.find((p) => isFlowUrl(p.url())) ||
      pages[0];
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
        ? 'Đã sẵn sàng! Đã đăng nhập và mở sẵn không gian dự án Google Flow.'
        : state.isLoggedIn
          ? 'Đã đăng nhập Google Flow — hệ thống sẽ tự vào dự án khi chạy job.'
          : 'Đang chờ bạn đăng nhập tài khoản Google AI trên cửa sổ Chrome Flow.',
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

        // Match both ProseMirror role="textbox" (2026 Flow UI) and legacy textareas
        const composers = Array.from(
          document.querySelectorAll(
            '.ProseMirror[role="textbox"], [role="textbox"][contenteditable], textarea'
          )
        ).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width >= 100 && rect.height >= 14;
        });

        const hasDoneDetailBtn = Array.from(document.querySelectorAll('button')).some((b) => {
          const t = (b.textContent || '').trim().toLowerCase();
          return (t === 'xong' || t === 'done') && b.getBoundingClientRect().width > 20;
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

        const onFlowDomain =
          window.location.hostname === 'flow.google.com' ||
          (window.location.hostname === 'labs.google' &&
            window.location.pathname.startsWith('/fx'));

        return {
          isLoggedIn: !hasSignInBtn && onFlowDomain,
          hasPromptComposer: composers.length > 0 || hasDoneDetailBtn,
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

  /**
   * Ensures Flow is on the main project grid (not inside a detail player overlay),
   * closes the right-hand Agent chat panel if open, turns OFF the "Tác nhân Flow" (`spark`)
   * toggle so Direct Creation (`Điều kiện kích hoạt cài đặt`) is active, and clears stale chips.
   */
  private async prepareProjectGridWorkspace(page: Page): Promise<void> {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);

    // 1. Exit media detail view if "Xong" / "Done" button is visible at top-right
    const doneBtn = page
      .locator('button:visible')
      .filter({ hasText: /^(Xong|Done)$/i })
      .first();
    if ((await doneBtn.count()) > 0) {
      await doneBtn.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    // 2. Close right-side conversational Agent drawer if open
    const closeSidePanelBtn = page
      .locator('button:visible')
      .filter({ hasText: /^right_panel_close$/i })
      .first();
    if ((await closeSidePanelBtn.count()) > 0) {
      await closeSidePanelBtn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // 3. Ensure "Tác nhân Flow" / "Flow Agent" switch is OFF (`spark_off`) so Direct Creation mode is active!
    const agentToggle = page
      .locator(
        'button[aria-label="Tác nhân Flow"]:visible, button[aria-label*="Flow Agent"]:visible'
      )
      .last();
    if ((await agentToggle.count()) > 0) {
      const iconText = ((await agentToggle.innerText().catch(() => '')) || '').trim();
      if (iconText === 'spark') {
        await agentToggle.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(600);
      }
    }

    // 4. Switch left filter to "Tất cả nội dung nghe nhìn" / "All media" if currently filtered to Images only
    const allMediaTab = page
      .locator('button:visible')
      .filter({ hasText: /(Tất cả nội dung nghe nhìn|All media)/i })
      .first();
    if ((await allMediaTab.count()) > 0) {
      await allMediaTab.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(350);
    }

    // 5. Scroll Angular CDK virtual viewport & window to top so row 0 is always mounted
    await page
      .evaluate(() => {
        window.scrollTo(0, 0);
        for (const el of Array.from(
          document.querySelectorAll('cdk-virtual-scroll-viewport, *')
        )) {
          if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight + 20) {
            el.scrollTop = 0;
          }
        }
      })
      .catch(() => {});
    await page.waitForTimeout(650);

    // 6. Clear any leftover prompt text or stuck error chips in the composer
    await this.clearComposer(page);
  }

  private async clearComposer(page: Page): Promise<void> {
    const clearBtn = page
      .locator(
        'button[aria-label="Xoá câu lệnh"]:visible, button[aria-label*="Clear prompt"]:visible'
      )
      .last();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
    }

    const editor = page
      .locator(
        '.ProseMirror[role="textbox"]:visible, [role="textbox"][contenteditable="true"]:visible, textarea:visible'
      )
      .last();
    if ((await editor.count()) > 0) {
      await editor.click({ timeout: 2000 }).catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  /**
   * Captures baseline grid state before submitting a new generation.
   * Because Google Flow uses `<cdk-virtual-scroll-viewport>`, off-screen rows mount lazily on scroll,
   * while brand-new generations are ALWAYS prepended at index 0 (ahead of `anchorFirstVideoSrc` / `anchorFirstImageSrc`).
   */
  private async snapshotGridBaseline(page: Page): Promise<{
    allExistingSrcs: string[];
    anchorFirstVideoSrc: string | null;
    anchorFirstImageSrc: string | null;
  }> {
    return page.evaluate(() => {
      const allSrcs = new Set<string>();
      for (const img of Array.from(document.querySelectorAll('img'))) {
        const s = img.currentSrc || img.src || img.getAttribute('src') || '';
        if (s) allSrcs.add(s);
      }

      let firstVideoSrc: string | null = null;
      for (const tile of Array.from(document.querySelectorAll('flow-video-tile'))) {
        const img = tile.querySelector('img');
        const s = img ? img.currentSrc || img.src || img.getAttribute('src') || '' : '';
        if (s) {
          firstVideoSrc = s;
          break;
        }
      }

      let firstImageSrc: string | null = null;
      for (const tile of Array.from(document.querySelectorAll('flow-image-tile'))) {
        const img = tile.querySelector('img');
        const s = img ? img.currentSrc || img.src || img.getAttribute('src') || '' : '';
        if (s) {
          firstImageSrc = s;
          break;
        }
      }

      return {
        allExistingSrcs: Array.from(allSrcs),
        anchorFirstVideoSrc: firstVideoSrc,
        anchorFirstImageSrc: firstImageSrc,
      };
    });
  }

  /**
   * Scans newly prepended `<flow-video-tile>` cards ahead of `anchorFirstVideoSrc`.
   * Stops immediately upon reaching `anchorFirstVideoSrc` or any pre-existing thumbnail URL so
   * `<cdk-virtual-scroll-viewport>` lazy-loading older rows further down can never cause false positives!
   */
  private async findNewCompletedVideoCards(
    page: Page,
    allExistingSrcs: string[],
    anchorFirstVideoSrc: string | null
  ): Promise<FlowVideoCardSnapshot[]> {
    return page.evaluate(
      ({ existingList, anchorSrc }) => {
        // Keep virtual viewport pinned to top so index-0 newly generated tiles stay mounted
        const vp = document.querySelector('cdk-virtual-scroll-viewport');
        if (vp && vp.scrollTop > 40) {
          vp.scrollTop = 0;
        }

        const existingSet = new Set(existingList);
        const results: Array<{
          thumbSrc: string;
          aria: string;
          cx: number;
          cy: number;
          x: number;
          y: number;
        }> = [];

        const videoTiles = Array.from(document.querySelectorAll('flow-video-tile'));
        if (videoTiles.length > 0) {
          for (const tile of videoTiles) {
            const thumbImg = tile.querySelector('img');
            const thumbSrc = thumbImg
              ? thumbImg.currentSrc || thumbImg.src || thumbImg.getAttribute('src') || ''
              : '';

            // As soon as we reach the previous top-most video tile (or any known pre-existing tile),
            // every subsequent tile in DOM order is older project history -> stop scanning!
            if (thumbSrc && (thumbSrc === anchorSrc || existingSet.has(thumbSrc))) {
              break;
            }

            if (!thumbImg || !thumbSrc || !thumbImg.complete || thumbImg.naturalWidth < 120) {
              continue;
            }

            const playBtn = Array.from(tile.querySelectorAll('button')).find((b) =>
              (b.textContent || '').includes('play_circle')
            );
            if (!playBtn) continue;

            const imgRect = thumbImg.getBoundingClientRect();
            if (imgRect.width < 40 || imgRect.height < 40) continue;

            results.push({
              thumbSrc,
              aria: playBtn.getAttribute('aria-label') || '',
              cx: Math.round(imgRect.x + imgRect.width / 2),
              cy: Math.round(imgRect.y + imgRect.height / 2),
              x: Math.round(imgRect.x),
              y: Math.round(imgRect.y),
            });
          }
          return results;
        }

        // Fallback if Flow renames <flow-video-tile> custom tag in a future update
        const playButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
          const t = (b.textContent || '').trim();
          const r = b.getBoundingClientRect();
          return t.includes('play_circle') && r.width > 24;
        });

        for (const btn of playButtons) {
          let container: HTMLElement | null = btn as HTMLElement;
          let thumbImg: HTMLImageElement | null = null;
          for (let depth = 0; depth < 6 && container; depth++) {
            const candidate = container.querySelector('img');
            if (candidate) {
              thumbImg = candidate;
              break;
            }
            container = container.parentElement;
          }
          const thumbSrc = thumbImg
            ? thumbImg.currentSrc || thumbImg.src || thumbImg.getAttribute('src') || ''
            : '';
          if (thumbSrc && (thumbSrc === anchorSrc || existingSet.has(thumbSrc))) {
            break;
          }
          if (!thumbImg || !thumbSrc || !thumbImg.complete || thumbImg.naturalWidth < 120) {
            continue;
          }
          const imgRect = thumbImg.getBoundingClientRect();
          results.push({
            thumbSrc,
            aria: btn.getAttribute('aria-label') || '',
            cx: Math.round(imgRect.x + imgRect.width / 2),
            cy: Math.round(imgRect.y + imgRect.height / 2),
            x: Math.round(imgRect.x),
            y: Math.round(imgRect.y),
          });
        }

        return results;
      },
      { existingList: allExistingSrcs, anchorSrc: anchorFirstVideoSrc }
    );
  }

  private async tryEnterFlowProject(page: Page): Promise<void> {
    try {
      if (page.url().includes('/project/')) return;
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
        await page.waitForTimeout(3000);
      }
    } catch {
      // Ignore navigation race
    }
  }

  private async openSettingsPopup(page: Page): Promise<boolean> {
    const triggerByAria = page
      .locator(
        'button[aria-label="Điều kiện kích hoạt cài đặt"]:visible, button[aria-label*="Settings"]:visible'
      )
      .last();
    if ((await triggerByAria.count()) > 0) {
      await triggerByAria.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(450);
      return true;
    }

    const triggerByText = page
      .locator('button:visible')
      .filter({
        hasText:
          /(Video\s*·|Image\s*·|Hình ảnh\s*·|Nano Banana|Omni\s*1\.|Veo\s*3|720p\s*·|360p\s*·)/i,
      })
      .last();
    if ((await triggerByText.count()) > 0) {
      await triggerByText.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(450);
      return true;
    }

    return false;
  }

  private async configureFlowOptions(page: Page, job: VideoJob): Promise<void> {
    const opened = await this.openSettingsPopup(page);
    if (!opened) return;

    try {
      // 1. Select "Video" mode
      const videoTabBtn = page
        .locator('button:visible, [role="radio"]:visible, [role="tab"]:visible')
        .filter({ hasText: /(videocam\s*Video|^\s*Video\s*$)/i })
        .last();
      if ((await videoTabBtn.count()) > 0) {
        await videoTabBtn.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(350);
      }

      // 2. Select "Khung hình" (Frames) or "Thành phần" (Ingredients)
      if (job.inputType === 'frames_to_video' && (job.firstFrameAsset || job.lastFrameAsset)) {
        const framesBtn = page
          .locator('button:visible, [role="radio"]:visible')
          .filter({ hasText: /(Khung hình|Frames)/i })
          .last();
        if ((await framesBtn.count()) > 0) {
          await framesBtn.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(300);
        }
      } else if (job.inputType === 'image_to_video' && job.imageAsset) {
        // Use Khung hình (Start Frame) for single-image animation as well — highest fidelity on Omni Flash!
        const framesBtn = page
          .locator('button:visible, [role="radio"]:visible')
          .filter({ hasText: /(Khung hình|Frames)/i })
          .last();
        if ((await framesBtn.count()) > 0) {
          await framesBtn.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(300);
        }
      } else {
        const ingredientsBtn = page
          .locator('button:visible, [role="radio"]:visible')
          .filter({ hasText: /(Thành phần|Ingredients)/i })
          .last();
        if ((await ingredientsBtn.count()) > 0) {
          await ingredientsBtn.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(300);
        }
      }

      // 3. Aspect Ratio (Flow Video supports 16:9 and 9:16; snap square/portrait/landscape cleanly)
      const isVertical = job.aspectRatio === '9:16' || job.aspectRatio === '3:4';
      const ratioPattern = isVertical ? /(crop_9_16|9:16)/i : /(crop_16_9|16:9)/i;
      const ratioBtn = page
        .locator('button:visible, [role="radio"]:visible')
        .filter({ hasText: ratioPattern })
        .last();
      if ((await ratioBtn.count()) > 0) {
        await ratioBtn.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(250);
      }

      // 4. Resolution 720p
      const res720 = page
        .locator('button:visible, [role="radio"]:visible')
        .filter({ hasText: /^\s*720p\s*$/i })
        .last();
      if ((await res720.count()) > 0) {
        await res720.click({ timeout: 1200 }).catch(() => {});
        await page.waitForTimeout(200);
      }

      // 5. Duration button if exposed for the selected model (e.g. 4s / 6s / 8s / 10s)
      const durSec = Number(job.durationSeconds) || 6;
      const snappedDur = durSec <= 4 ? 4 : durSec <= 6 ? 6 : durSec <= 8 ? 8 : 10;
      const durBtn = page
        .locator('button:visible, [role="radio"]:visible')
        .filter({ hasText: new RegExp(`^\\s*${snappedDur}(s|\\s*giây)\\s*$`, 'i') })
        .last();
      if ((await durBtn.count()) > 0) {
        await durBtn.click({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(150);
      }

      // 6. Output count (x1..x4)
      const wantedCount = Math.max(1, Math.min(4, job.outputCount || 1));
      const countBtn = page
        .locator('button:visible, [role="radio"]:visible')
        .filter({ hasText: new RegExp(`^\\s*x${wantedCount}\\s*$`, 'i') })
        .last();
      if ((await countBtn.count()) > 0) {
        await countBtn.click({ timeout: 1200 }).catch(() => {});
        await page.waitForTimeout(200);
      }
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(350);
    }
  }

  /**
   * Uploads and attaches media file(s) using Google Flow's native filechooser picker
   * ("Bắt đầu" / "Kết thúc" for Frames mode, or "+" "Thêm thành phần vào ô nhập câu lệnh" for Ingredients/Image mode).
   */
  private async attachFileViaPickerSlot(
    page: Page,
    slotTrigger: 'start_frame' | 'end_frame' | 'ingredient',
    filePaths: string[]
  ): Promise<void> {
    const validPaths = filePaths.filter((p) => fs.existsSync(p));
    if (validPaths.length === 0) return;

    if (validPaths.length > 1 && slotTrigger === 'ingredient') {
      for (const singlePath of validPaths) {
        await this.attachFileViaPickerSlot(page, slotTrigger, [singlePath]);
      }
      return;
    }

    let slotBtn;
    if (slotTrigger === 'start_frame') {
      slotBtn = page.locator('button:visible').filter({ hasText: /(Bắt đầu|Start)/i }).first();
    } else if (slotTrigger === 'end_frame') {
      slotBtn = page.locator('button:visible').filter({ hasText: /(Kết thúc|End)/i }).first();
    } else {
      slotBtn = page
        .locator(
          'button[aria-label="Thêm thành phần vào ô nhập câu lệnh"]:visible, button[aria-label*="Add ingredient"]:visible'
        )
        .last();
    }

    if ((await slotBtn.count()) === 0) {
      // Fallback to "+" ingredient button if Start/End slot isn't shown
      slotBtn = page
        .locator(
          'button[aria-label="Thêm thành phần vào ô nhập câu lệnh"]:visible, button[aria-label*="Add"]:visible'
        )
        .last();
    }

    if ((await slotBtn.count()) === 0) return;

    await slotBtn.click({ timeout: 3000 });
    await page.waitForTimeout(600);

    const uploadMenuBtn = page
      .locator('button:visible, [role="menuitem"]:visible')
      .filter({ hasText: /(Tải nội dung nghe nhìn lên|Upload media|Upload)/i })
      .last();

    if ((await uploadMenuBtn.count()) === 0) {
      await page.keyboard.press('Escape').catch(() => {});
      return;
    }

    const [fc] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10_000 }),
      uploadMenuBtn.click(),
    ]);
    await fc.setFiles(validPaths);
    await page.waitForTimeout(1500);

    // Handle first-time media usage consent modal ("Tôi đồng ý" / "I agree") if shown
    const agreeBtn = page
      .locator('button:visible')
      .filter({ hasText: /^(Tôi đồng ý|I agree)$/i })
      .last();
    if ((await agreeBtn.count()) > 0) {
      await agreeBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    // Wait for upload processing to finish so "Thêm vào câu lệnh" / "Add to prompt" becomes enabled
    await page.waitForTimeout(5500);
    const addToPromptBtn = page
      .locator('button:visible')
      .filter({ hasText: /^(Thêm vào câu lệnh|Add to prompt)$/i })
      .last();

    if ((await addToPromptBtn.count()) > 0) {
      for (let w = 0; w < 20; w++) {
        const dis = await addToPromptBtn.isDisabled().catch(() => true);
        if (!dis) {
          await addToPromptBtn.click().catch(() => {});
          await page.waitForTimeout(600);
          return;
        }
        await page.waitForTimeout(1000);
      }
    }

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(350);
  }

  /**
   * Types prompt into Flow's `.ProseMirror[role="textbox"]` via `keyboard.insertText`
   * (so Angular/ProseMirror state enables the submit button!) and clicks "Bắt đầu tạo".
   */
  private async fillPromptAndSubmit(page: Page, prompt: string): Promise<void> {
    const editor = page
      .locator(
        '.ProseMirror[role="textbox"]:visible, [role="textbox"][contenteditable="true"]:visible, textarea:visible'
      )
      .last();

    await editor.waitFor({ state: 'visible', timeout: 15_000 });
    await editor.click();
    // Move cursor to the end so any inline ingredient chips attached earlier are preserved!
    await page.keyboard.press('End').catch(() => {});
    await page.waitForTimeout(150);

    const cleanPrompt = prompt.trim();
    await page.keyboard.insertText(` ${cleanPrompt}`);
    await page.waitForTimeout(500);

    const submitBtn = page
      .locator(
        'button[aria-label="Bắt đầu tạo"]:visible, button[aria-label="Start creating"]:visible, button[aria-label="Generate"]:visible'
      )
      .last();

    const fallbackBtn =
      (await submitBtn.count()) > 0
        ? submitBtn
        : page
            .locator('button:visible')
            .filter({ hasText: /(arrow_forward|Generate|Bắt đầu tạo)/i })
            .last();

    // Wait up to 25s in case an attached frame image is still finishing its last upload %
    let enabled = false;
    for (let w = 0; w < 25; w++) {
      if ((await fallbackBtn.count()) > 0 && !(await fallbackBtn.isDisabled().catch(() => true))) {
        enabled = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!enabled) {
      throw new Error(
        'Nút "Bắt đầu tạo" trên Google Flow vẫn bị khoá. Đang tự động làm mới khung nhập để thử lại.'
      );
    }

    await fallbackBtn.click();
    await page.waitForTimeout(1200);
  }

  /**
   * Opens a newly completed Flow video card and downloads the native 720p MP4 file via Flow's
   * official "Tải nội dung nghe nhìn xuống" (Download media) menu!
   */
  private async downloadVideoCardToDisk(
    page: Page,
    card: FlowVideoCardSnapshot,
    outFilePath: string
  ): Promise<boolean> {
    try {
      // Ensure we are on the grid first
      const doneBefore = page
        .locator('button:visible')
        .filter({ hasText: /^(Xong|Done)$/i })
        .first();
      if ((await doneBefore.count()) > 0) {
        await doneBefore.click().catch(() => {});
        await page.waitForTimeout(800);
      }

      // Re-locate exact card by its unique thumbnail src so scroll shifts never affect coordinates!
      const liveCenter = await page.evaluate((targetThumbSrc: string) => {
        const img = Array.from(document.querySelectorAll('img')).find(
          (i) => (i.currentSrc || i.src || '') === targetThumbSrc
        );
        if (!img) return null;
        img.scrollIntoView({ block: 'center', inline: 'center' });
        const r = img.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) return null;
        return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
      }, card.thumbSrc);

      const clickX = liveCenter?.cx ?? card.cx;
      const clickY = liveCenter?.cy ?? card.cy;

      await page.mouse.click(clickX, Math.max(80, clickY));
      await page.waitForTimeout(1800);

      const dlIconBtn = page
        .locator(
          'button[aria-label="Tải nội dung nghe nhìn xuống"]:visible, button[aria-label*="Download"]:visible'
        )
        .first();

      await dlIconBtn.waitFor({ state: 'visible', timeout: 12_000 });
      await dlIconBtn.click();
      await page.waitForTimeout(600);

      // Prefer "720p Kích thước gốc" (instant, 0 extra credits); fallback to first MP4 resolution item
      const res720Item = page
        .locator('[role="menuitem"]:visible, button:visible')
        .filter({ hasText: /^720p/i })
        .last();
      const targetMenuItem =
        (await res720Item.count()) > 0
          ? res720Item
          : page
              .locator('[role="menuitem"]:visible, button:visible')
              .filter({ hasText: /(1080p|720p)/i })
              .first();

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 45_000 }),
        targetMenuItem.click(),
      ]);

      await download.saveAs(outFilePath);

      // Exit detail view back to grid cleanly
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(350);
      const doneAfter = page
        .locator('button:visible')
        .filter({ hasText: /^(Xong|Done)$/i })
        .first();
      if ((await doneAfter.count()) > 0) {
        await doneAfter.click().catch(() => {});
        await page.waitForTimeout(800);
      }

      return fs.existsSync(outFilePath) && fs.statSync(outFilePath).size > 50_000;
    } catch (err) {
      console.warn('[Google Flow] Native card download failed:', err);
      // Ensure we exit detail view even on error
      const doneAfter = page
        .locator('button:visible')
        .filter({ hasText: /^(Xong|Done)$/i })
        .first();
      if ((await doneAfter.count()) > 0) {
        await doneAfter.click().catch(() => {});
        await page.waitForTimeout(600);
      }
      return false;
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
    onProgress(6, '[Google Flow] Đang chờ lượt điều khiển trình duyệt Flow...');

    return this.runExclusive(async () => {
      if (signal.aborted) throw new Error('Job đã bị huỷ');

      const page = await this.getOrOpenFlowPage(options.flowProjectUrl);
      const capturedMp4Buffers: Buffer[] = [];

      const onResponse = async (resp: import('playwright-core').Response) => {
        try {
          const ct = (resp.headers()['content-type'] || '').toLowerCase();
          const url = resp.url();
          if (
            (resp.status() === 200 || resp.status() === 206) &&
            (ct.includes('video/mp4') || (url.includes('.mp4') && !url.includes('preview')))
          ) {
            const buf = await resp.body().catch(() => null);
            if (buf && buf.length > 80_000) {
              capturedMp4Buffers.push(buf);
            }
          }
        } catch {
          // Ignore transient stream read errors
        }
      };

      page.on('response', onResponse);

      try {
        onProgress(10, '[Google Flow] Đang kiểm tra phiên đăng nhập & không gian dự án...');
        await sleep(1000, signal);

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
              `[Google Flow] Đang chờ bạn đăng nhập tài khoản trên cửa sổ Chrome (${120 - waitSec}s)...`
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
              14,
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

        // Ensure grid view, close Agent chat drawer, disable "Tác nhân Flow" spark switch & clear composer!
        await this.prepareProjectGridWorkspace(page);

        onProgress(
          18,
          `[Google Flow] Đang thiết lập chế độ Video (${job.aspectRatio}, x${Math.min(4, job.outputCount || 1)})...`
        );
        await this.configureFlowOptions(page, job);

        // Upload & attach start/end frames or reference image via native Flow picker
        if (job.inputType === 'image_to_video' && job.imageAsset) {
          onProgress(24, '[Google Flow] Đang tải ảnh đầu vào lên khung Bắt đầu...');
          const imgPath = path.join(UPLOADS_DIR, job.imageAsset.filename);
          await this.attachFileViaPickerSlot(page, 'start_frame', [imgPath]);
        } else if (job.inputType === 'frames_to_video') {
          if (job.firstFrameAsset) {
            onProgress(24, '[Google Flow] Đang tải Khung hình đầu lên Flow...');
            const firstPath = path.join(UPLOADS_DIR, job.firstFrameAsset.filename);
            await this.attachFileViaPickerSlot(page, 'start_frame', [firstPath]);
          }
          if (job.lastFrameAsset) {
            onProgress(27, '[Google Flow] Đang tải Khung hình cuối lên Flow...');
            const lastPath = path.join(UPLOADS_DIR, job.lastFrameAsset.filename);
            await this.attachFileViaPickerSlot(page, 'end_frame', [lastPath]);
          }
        }

        // Snapshot baseline AFTER uploading frames so uploaded media tiles are already in baseline!
        await page.waitForTimeout(800);
        const baseline = await this.snapshotGridBaseline(page);

        onProgress(32, '[Google Flow] Đang nhập câu lệnh vào ô ProseMirror và nhấn Bắt đầu tạo...');
        await this.fillPromptAndSubmit(page, job.prompt);

        const wantedCount = Math.max(1, Math.min(4, job.outputCount || 1));
        const maxWaitSec = 270;
        let newCompletedCards: FlowVideoCardSnapshot[] = [];

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

          // Video generation on Google Flow takes >=15s; only check completed tiles after initial 12s settle
          if (elapsed >= 8) {
            newCompletedCards = await this.findNewCompletedVideoCards(
              page,
              baseline.allExistingSrcs,
              baseline.anchorFirstVideoSrc
            );
          }

          if (newCompletedCards.length >= wantedCount) {
            // Brief settle pause so Flow finalizes backend MP4 asset
            await sleep(1500, signal);
            break;
          }

          // If at least 1 card completed and we've waited >90s, accept partial batch gracefully
          if (newCompletedCards.length > 0 && elapsed >= 90) {
            break;
          }

          const pct = Math.min(88, 34 + Math.round((elapsed / 95) * 52));
          onProgress(
            pct,
            `[Google Flow] Đang render video trên máy chủ Flow (${elapsed + 4}s • Xong ${newCompletedCards.length}/${wantedCount})...`
          );
        }

        const outputs: GeneratedVideoOutput[] = [];
        const safeModel = job.model.replace(/[^a-zA-Z0-9_-]/g, '-');

        // Primary path: Download each newly completed video card via Flow's native Download -> 720p button!
        if (newCompletedCards.length > 0) {
          const cardsToDownload = newCompletedCards.slice(0, wantedCount);
          for (let i = 0; i < cardsToDownload.length; i++) {
            if (signal.aborted) throw new Error('Job đã bị huỷ');
            const idx = i + 1;
            onProgress(
              92 + Math.min(7, i * 2),
              `[Google Flow] Đang tải file MP4 đầu ra (${idx}/${cardsToDownload.length})...`
            );

            const filename = `job-${String(job.seq).padStart(3, '0')}_flow_${safeModel}_${idx}_${Date.now()}.mp4`;
            const fullPath = path.join(OUTPUTS_DIR, filename);

            const ok = await this.downloadVideoCardToDisk(page, cardsToDownload[i], fullPath);
            if (ok && fs.existsSync(fullPath)) {
              const stat = fs.statSync(fullPath);
              outputs.push({
                index: idx,
                filename,
                url: `/media/outputs/${filename}`,
                downloadUrl: `/api/jobs/${job.id}/download/${idx}`,
                mimeType: 'video/mp4',
                sizeBytes: stat.size,
              });
            }
          }
        }

        // Secondary fallback: if network sniffer captured MP4 stream directly
        if (outputs.length === 0 && capturedMp4Buffers.length > 0) {
          const takeBuffers = capturedMp4Buffers.slice(0, wantedCount);
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
        }

        if (outputs.length === 0) {
          throw new Error(
            'Google Flow chưa trả về thẻ video mới sau 270 giây chờ (có thể câu lệnh bị bộ lọc an toàn của Google từ chối hoặc mạng chậm). Hãy thử chỉnh nhẹ câu lệnh và bấm Retry.'
          );
        }

        onProgress(100, `[Google Flow] Hoàn tất tạo và tải về ${outputs.length} video MP4!`);
        return outputs;
      } finally {
        page.off('response', onResponse);
      }
    });
  }

  /**
   * Generates a 9:16 reference keyframe image directly on Google Flow (Hình ảnh -> 9:16 -> Nano Banana 2.1)
   * using uploaded product photos + optional Scene 1 consistency anchor!
   */
  public async generateFlowImage916(params: {
    prompt: string;
    referenceFilePaths: string[];
    outPngPath: string;
    flowProjectUrl?: string;
  }): Promise<boolean> {
    return this.runExclusive(async () => {
      const page = await this.getOrOpenFlowPage(params.flowProjectUrl);

      try {
        await sleep(800);
        await this.tryEnterFlowProject(page);
        const state = await this.inspectPageState(page);
        if (!state.hasPromptComposer) {
          return false;
        }

        await this.prepareProjectGridWorkspace(page);

        // Configure Image -> 9:16 -> x1
        const opened = await this.openSettingsPopup(page);
        if (opened) {
          const imgTabBtn = page
            .locator('button:visible, [role="radio"]:visible')
            .filter({ hasText: /(image\s*Hình ảnh|^\s*(Image|Hình ảnh)\s*$)/i })
            .last();
          if ((await imgTabBtn.count()) > 0) {
            await imgTabBtn.click({ timeout: 1500 }).catch(() => {});
            await page.waitForTimeout(350);
          }

          const ratio916 = page
            .locator('button:visible, [role="radio"]:visible')
            .filter({ hasText: /(crop_9_16|9:16)/i })
            .last();
          if ((await ratio916.count()) > 0) {
            await ratio916.click({ timeout: 1200 }).catch(() => {});
            await page.waitForTimeout(200);
          }

          const x1Btn = page
            .locator('button:visible, [role="radio"]:visible')
            .filter({ hasText: /^\s*x1\s*$/i })
            .last();
          if ((await x1Btn.count()) > 0) {
            await x1Btn.click({ timeout: 1200 }).catch(() => {});
            await page.waitForTimeout(200);
          }

          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(350);
        }

        if (params.referenceFilePaths.length > 0) {
          await this.attachFileViaPickerSlot(
            page,
            'ingredient',
            params.referenceFilePaths.slice(0, 3)
          );
        }

        // Snapshot baseline AFTER attaching ingredient uploads so uploaded 9:16 anchor tiles are ignored!
        await page.waitForTimeout(1000);
        const baseline = await this.snapshotGridBaseline(page);

        await this.fillPromptAndSubmit(page, params.prompt);

        // Poll up to 110s for newly prepended portrait 9:16 <flow-image-tile> ahead of anchorFirstImageSrc
        for (let elapsed = 0; elapsed < 110; elapsed += 3) {
          await sleep(3000);
          const foundSrc = await page.evaluate(
            ({ oldList, anchorSrc }) => {
              const vp = document.querySelector('cdk-virtual-scroll-viewport');
              if (vp && vp.scrollTop > 40) vp.scrollTop = 0;

              const oldSet = new Set(oldList);
              const imgTiles = Array.from(document.querySelectorAll('flow-image-tile'));
              if (imgTiles.length > 0) {
                for (const tile of imgTiles) {
                  const img = tile.querySelector('img');
                  const src = img
                    ? img.currentSrc || img.src || img.getAttribute('src') || ''
                    : '';
                  if (src && (src === anchorSrc || oldSet.has(src))) {
                    break;
                  }
                  if (
                    img &&
                    src &&
                    img.complete &&
                    img.naturalWidth >= 220 &&
                    img.naturalHeight > img.naturalWidth * 1.35
                  ) {
                    return src;
                  }
                }
                return null;
              }

              const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
                const src = img.currentSrc || img.src || img.getAttribute('src') || '';
                return (
                  img.complete &&
                  img.naturalWidth >= 220 &&
                  img.naturalHeight > img.naturalWidth * 1.35 &&
                  !oldSet.has(src)
                );
              });
              return imgs.length > 0 ? imgs[0].currentSrc || imgs[0].src : null;
            },
            {
              oldList: baseline.allExistingSrcs,
              anchorSrc: baseline.anchorFirstImageSrc,
            }
          );

          if (foundSrc) {
            const dataUrl = await page.evaluate((src: string) => {
              const img = Array.from(document.querySelectorAll('img')).find(
                (i) => (i.currentSrc || i.src || '') === src
              );
              if (!img) return null;
              try {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                if (!ctx) return null;
                ctx.drawImage(img, 0, 0);
                return c.toDataURL('image/png');
              } catch {
                return null;
              }
            }, foundSrc);

            if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
              fs.writeFileSync(
                params.outPngPath,
                Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
              );
              return true;
            }

            const resp = await page.request.get(foundSrc);
            fs.writeFileSync(params.outPngPath, await resp.body());
            return true;
          }
        }

        return false;
      } catch (err) {
        console.warn('[Flow Image 9:16] Failed:', err);
        return false;
      }
    });
  }
}

export const flowManager = new FlowBrowserManager();
