import type { GenericId } from 'convex/values';

/** Minimal doc/id shapes for the worker; avoids importing `convex/_generated/dataModel.js` (which pulls `schema.ts` into the TS program). */
export type Id<TableName extends string = string> = GenericId<TableName>;

export type Doc<TableName extends string = string> = {
  _id: Id<TableName>;
  _creationTime: number;
} & Record<string, unknown>;
