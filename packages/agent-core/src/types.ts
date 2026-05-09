export type BrowserViewport = {
  width: number;
  height: number;
};

export type NavigateOptions = {
  waitForLoad?: boolean;
  timeoutMs?: number;
};

export type NavigateResult = {
  finalUrl: string;
};

export type ExtractorJobPosting = {
  externalId: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  salaryText?: string;
  descriptionSnippet?: string;
  postedAt?: number;
  discoveredAt: number;
  rawPayload: Record<string, unknown>;
};

export type SourceExtractionResult = {
  source: string;
  postings: ExtractorJobPosting[];
};

export type SourceExtractor = {
  source: string;
  extract: (driver: ChromeDriver) => Promise<SourceExtractionResult>;
};

/**
 * When installed, the page can call the global with a **single string** (per CDP);
 * the worker uses this to stream LinkedIn job JSON out of a long `Runtime.evaluate` without waiting for it to finish.
 */
export type JobPostingStreamBindingUninstall = () => Promise<void>;

export interface ChromeDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  navigate(url: string, options?: NavigateOptions): Promise<NavigateResult>;
  screenshot(): Promise<string>;
  evaluate<T>(expression: string): Promise<T>;
  click(selector: string): Promise<void>;
  type(selector: string, value: string): Promise<void>;
  press(key: string): Promise<void>;
  scroll(deltaY: number): Promise<void>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
  /**
   * Reads cookies visible to the browser for the provided URLs.
   * Useful for auth-state checks before starting scrape work.
   */
  getCookiesForUrls?(urls: string[]): Promise<Array<{ name: string; value: string; domain?: string; path?: string }>>;
  /**
   * CDP `Runtime.addBinding` (optional; implemented by `CdpChromeDriver`).
   * The page calls `window[bindingName](jsonString)`.
   */
  installJobPostingStreamBinding?(
    bindingName: string,
    onPayload: (jsonPayload: string) => Promise<void>
  ): Promise<JobPostingStreamBindingUninstall>;
}
