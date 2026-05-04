export const agentCoreVersion = 'agent-core-v1';

export {
  buildChromeRemoteDebuggingArgs,
  launchChromeWithRemoteDebugging,
  resolveChromeExecutablePath,
} from './chromeLauncher.js';
export { CdpChromeDriver, JOB_BOT_POSTING_PUSH_BINDING } from './chromeDriver.js';
export { LoopGuard } from './loopGuard.js';
export { withAgentRetry } from './retry.js';
export { RemoteOkDeterministicExtractor } from './sources/remoteOkExtractor.js';
export type {
  BrowserViewport,
  ChromeDriver,
  ExtractorJobPosting,
  JobPostingStreamBindingUninstall,
  NavigateOptions,
  NavigateResult,
  SourceExtractionResult,
  SourceExtractor,
} from './types.js';
