export const agentCoreVersion = 'agent-core-v1';

export { CdpChromeDriver } from './chromeDriver.js';
export { LoopGuard } from './loopGuard.js';
export { withAgentRetry } from './retry.js';
export { RemoteOkDeterministicExtractor } from './sources/remoteOkExtractor.js';
export type {
  BrowserViewport,
  ChromeDriver,
  ExtractorJobPosting,
  NavigateOptions,
  NavigateResult,
  SourceExtractionResult,
  SourceExtractor,
} from './types.js';
