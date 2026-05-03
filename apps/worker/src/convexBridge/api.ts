import { anyApi, componentsGeneric } from 'convex/server';

/** Same runtime as `convex/_generated/api.js`, without pulling in `api.d.ts` (which references every Convex module). */
export const api = anyApi;
export const internal = anyApi;
export const components = componentsGeneric();
