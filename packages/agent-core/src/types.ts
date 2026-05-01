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
}
