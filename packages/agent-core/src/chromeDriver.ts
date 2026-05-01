import CDP, { type Client } from 'chrome-remote-interface';

import { LoopGuard } from './loopGuard.js';
import { withAgentRetry } from './retry.js';
import type {
  BrowserViewport,
  ChromeDriver,
  NavigateOptions,
  NavigateResult,
} from './types.js';

type CdpChromeDriverOptions = {
  host?: string;
  port?: number;
  secure?: boolean;
  target?: string;
  viewport?: BrowserViewport;
  defaultTimeoutMs?: number;
};

const defaultViewport: BrowserViewport = { width: 1366, height: 900 };
const defaultTimeoutMs = 15000;

export class CdpChromeDriver implements ChromeDriver {
  private readonly host: string;
  private readonly port: number;
  private readonly secure: boolean;
  private readonly target?: string;
  private readonly viewport: BrowserViewport;
  private readonly timeoutMs: number;
  private client: Client | null = null;

  constructor(options: CdpChromeDriverOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 9222;
    this.secure = options.secure ?? false;
    this.target = options.target;
    this.viewport = options.viewport ?? defaultViewport;
    this.timeoutMs = options.defaultTimeoutMs ?? defaultTimeoutMs;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    await withAgentRetry(
      async () => {
        let client: Client | null = null;
        try {
          client = await CDP({
            host: this.host,
            port: this.port,
            secure: this.secure,
            target: this.target,
          });

          await Promise.all([
            client.Page.enable(),
            client.DOM.enable(),
            client.Runtime.enable(),
            client.Network.enable(),
            client.Emulation.setDeviceMetricsOverride({
              width: this.viewport.width,
              height: this.viewport.height,
              deviceScaleFactor: 1,
              mobile: false,
            }),
          ]);

          this.client = client;
          client = null;
        } catch (error: unknown) {
          if (client) {
            await client.close().catch(() => {});
          }
          this.client = null;
          throw error;
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 300,
        maxDelayMs: 2500,
        label: 'cdp.connect',
      }
    );
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    const existingClient = this.client;
    this.client = null;
    await existingClient.close();
  }

  async navigate(url: string, options: NavigateOptions = {}): Promise<NavigateResult> {
    const client = this.requireClient();
    const waitForLoad = options.waitForLoad ?? true;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    const loadEventPromise = waitForLoad
      ? this.waitForLoadEvent(client, timeoutMs)
      : Promise.resolve();

    await client.Page.navigate({ url });
    await loadEventPromise;

    const finalUrl = await this.evaluate<string>('window.location.href');
    return { finalUrl };
  }

  async screenshot(): Promise<string> {
    const client = this.requireClient();
    const response = await client.Page.captureScreenshot({ format: 'png' });
    return response.data;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const client = this.requireClient();
    const evaluation = await client.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (evaluation.exceptionDetails) {
      const errorText = evaluation.exceptionDetails.text || 'Runtime.evaluate failed';
      throw new Error(errorText);
    }

    return evaluation.result.value as T;
  }

  async click(selector: string): Promise<void> {
    const escapedSelector = JSON.stringify(selector);
    const clicked = await this.evaluate<boolean>(`(() => {
      const element = document.querySelector(${escapedSelector});
      if (!(element instanceof HTMLElement)) return false;
      element.click();
      return true;
    })()`);

    if (!clicked) {
      throw new Error(`Unable to click selector: ${selector}`);
    }
  }

  async type(selector: string, value: string): Promise<void> {
    const escapedSelector = JSON.stringify(selector);
    const escapedValue = JSON.stringify(value);
    const typed = await this.evaluate<boolean>(`(() => {
      const element = document.querySelector(${escapedSelector});
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return false;
      }
      element.focus();
      element.value = ${escapedValue};
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);

    if (!typed) {
      throw new Error(`Unable to type into selector: ${selector}`);
    }
  }

  async press(key: string): Promise<void> {
    const client = this.requireClient();
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key });
  }

  async scroll(deltaY: number): Promise<void> {
    const escapedDelta = JSON.stringify(deltaY);
    await this.evaluate<void>(`window.scrollBy({ top: ${escapedDelta}, left: 0, behavior: 'instant' })`);
  }

  async waitForSelector(selector: string, timeoutMs = this.timeoutMs): Promise<void> {
    const start = Date.now();
    const escapedSelector = JSON.stringify(selector);
    const maxIterations = Math.min(2000, Math.ceil(timeoutMs / 100) + 20);
    const guard = new LoopGuard(maxIterations, `waitForSelector:${selector}`);

    while (Date.now() - start < timeoutMs) {
      guard.step();
      const exists = await this.evaluate<boolean>(`Boolean(document.querySelector(${escapedSelector}))`);
      if (exists) {
        return;
      }
      await sleep(150);
    }

    throw new Error(`Timed out waiting for selector '${selector}'`);
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error('Chrome CDP client is not connected');
    }
    return this.client;
  }

  private async waitForLoadEvent(client: Client, timeoutMs: number): Promise<void> {
    await withTimeout(
      new Promise<void>((resolve) => {
        client.Page.loadEventFired(() => {
          resolve();
        });
      }),
      timeoutMs,
      `Timed out waiting for page load after ${timeoutMs}ms`
    );
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
