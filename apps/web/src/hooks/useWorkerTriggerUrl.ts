import { useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';

/**
 * Worker trigger URL: Vite env overrides Convex app settings. No hardcoded fallback.
 */
export function useWorkerTriggerUrl(): string | null {
  const settings = useQuery(api.appSettings.get, {});
  const fromConvex = settings?.values.VITE_WORKER_TRIGGER_URL?.trim();
  const fromVite = (import.meta.env.VITE_WORKER_TRIGGER_URL as string | undefined)?.trim();
  if (fromVite && fromVite.length > 0) {
    return fromVite;
  }
  if (fromConvex && fromConvex.length > 0) {
    return fromConvex;
  }
  return null;
}
