import CDP from 'chrome-remote-interface';
import { LoopGuard } from './loopGuard.js';
import { withAgentRetry } from './retry.js';
const defaultViewport = { width: 1366, height: 900 };
const defaultTimeoutMs = 15000;
export class CdpChromeDriver {
    host;
    port;
    secure;
    target;
    viewport;
    timeoutMs;
    client = null;
    constructor(options = {}) {
        this.host = options.host ?? '127.0.0.1';
        this.port = options.port ?? 9222;
        this.secure = options.secure ?? false;
        this.target = options.target;
        this.viewport = options.viewport ?? defaultViewport;
        this.timeoutMs = options.defaultTimeoutMs ?? defaultTimeoutMs;
    }
    isConnected() {
        return this.client !== null;
    }
    async connect() {
        if (this.client) {
            return;
        }
        await withAgentRetry(async () => {
            let client = null;
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
            }
            catch (error) {
                if (client) {
                    await client.close().catch(() => { });
                }
                this.client = null;
                throw error;
            }
        }, {
            maxAttempts: 3,
            baseDelayMs: 300,
            maxDelayMs: 2500,
            label: 'cdp.connect',
        });
    }
    async disconnect() {
        if (!this.client) {
            return;
        }
        const existingClient = this.client;
        this.client = null;
        await existingClient.close();
    }
    async navigate(url, options = {}) {
        const client = this.requireClient();
        const waitForLoad = options.waitForLoad ?? true;
        const timeoutMs = options.timeoutMs ?? this.timeoutMs;
        const loadEventPromise = waitForLoad
            ? this.waitForLoadEvent(client, timeoutMs)
            : Promise.resolve();
        await client.Page.navigate({ url });
        await loadEventPromise;
        const finalUrl = await this.evaluate('window.location.href');
        return { finalUrl };
    }
    async screenshot() {
        const client = this.requireClient();
        const response = await client.Page.captureScreenshot({ format: 'png' });
        return response.data;
    }
    async evaluate(expression) {
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
        return evaluation.result.value;
    }
    async click(selector) {
        const escapedSelector = JSON.stringify(selector);
        const clicked = await this.evaluate(`(() => {
      const element = document.querySelector(${escapedSelector});
      if (!(element instanceof HTMLElement)) return false;
      element.click();
      return true;
    })()`);
        if (!clicked) {
            throw new Error(`Unable to click selector: ${selector}`);
        }
    }
    async type(selector, value) {
        const escapedSelector = JSON.stringify(selector);
        const escapedValue = JSON.stringify(value);
        const typed = await this.evaluate(`(() => {
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
    async press(key) {
        const client = this.requireClient();
        await client.Input.dispatchKeyEvent({ type: 'keyDown', key });
        await client.Input.dispatchKeyEvent({ type: 'keyUp', key });
    }
    async scroll(deltaY) {
        const escapedDelta = JSON.stringify(deltaY);
        await this.evaluate(`window.scrollBy({ top: ${escapedDelta}, left: 0, behavior: 'instant' })`);
    }
    async waitForSelector(selector, timeoutMs = this.timeoutMs) {
        const start = Date.now();
        const escapedSelector = JSON.stringify(selector);
        const maxIterations = Math.min(2000, Math.ceil(timeoutMs / 100) + 20);
        const guard = new LoopGuard(maxIterations, `waitForSelector:${selector}`);
        while (Date.now() - start < timeoutMs) {
            guard.step();
            const exists = await this.evaluate(`Boolean(document.querySelector(${escapedSelector}))`);
            if (exists) {
                return;
            }
            await sleep(150);
        }
        throw new Error(`Timed out waiting for selector '${selector}'`);
    }
    requireClient() {
        if (!this.client) {
            throw new Error('Chrome CDP client is not connected');
        }
        return this.client;
    }
    async waitForLoadEvent(client, timeoutMs) {
        await withTimeout(new Promise((resolve) => {
            client.Page.loadEventFired(() => {
                resolve();
            });
        }), timeoutMs, `Timed out waiting for page load after ${timeoutMs}ms`);
    }
}
async function withTimeout(promise, timeoutMs, errorMessage) {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=chromeDriver.js.map