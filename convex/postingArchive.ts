import { v } from 'convex/values';
import { mutation, query } from './_generated/server.js';

const archiveLabelValidator = v.union(v.literal('good'), v.literal('bad'));

/**
 * Soft-archives a posting with a good/bad fit label. Rankings and Q&A are preserved.
 */
export const archive = mutation({
  args: {
    postingId: v.id('job_postings'),
    label: archiveLabelValidator,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      throw new Error('Posting not found.');
    }
    if (posting.archivedAt !== undefined) {
      throw new Error('Posting is already archived. Use updateArchiveLabel or unarchive first.');
    }

    const now = Date.now();
    const trimmedNotes = args.notes?.trim();
    await ctx.db.patch(args.postingId, {
      archivedAt: now,
      archiveLabel: args.label,
      archiveNotes: trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : undefined,
      updatedAt: now,
    });
    return { archived: true, archivedAt: now, archiveLabel: args.label };
  },
});

/**
 * Restores an archived posting to the active list.
 */
export const unarchive = mutation({
  args: {
    postingId: v.id('job_postings'),
  },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      throw new Error('Posting not found.');
    }
    if (posting.archivedAt === undefined) {
      return { unarchived: false };
    }

    const now = Date.now();
    await ctx.db.patch(args.postingId, {
      archivedAt: undefined,
      archiveLabel: undefined,
      archiveNotes: undefined,
      updatedAt: now,
    });
    return { unarchived: true };
  },
});

/**
 * Changes the good/bad label on an already-archived posting.
 */
export const updateArchiveLabel = mutation({
  args: {
    postingId: v.id('job_postings'),
    label: archiveLabelValidator,
  },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      throw new Error('Posting not found.');
    }
    if (posting.archivedAt === undefined) {
      throw new Error('Posting is not archived.');
    }

    const now = Date.now();
    await ctx.db.patch(args.postingId, {
      archiveLabel: args.label,
      updatedAt: now,
    });
    return { updated: true, archiveLabel: args.label };
  },
});

/**
 * Counts active (non-archived) postings for one employer name (exact match on stored `company`).
 */
export const countByCompanyActive = query({
  args: {
    company: v.string(),
  },
  handler: async (ctx, args) => {
    const normalized = args.company.trim();
    if (!normalized) {
      return 0;
    }
    const rows = await ctx.db
      .query('job_postings')
      .withIndex('by_company', (q) => q.eq('company', normalized))
      .collect();
    return rows.filter((posting) => posting.archivedAt === undefined).length;
  },
});

/**
 * Batch active posting counts per company for archived list employer follow-up.
 */
export const countActiveForCompanies = query({
  args: {
    companies: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const unique = [...new Set(args.companies.map((company) => company.trim()).filter(Boolean))];
    const counts: Record<string, number> = {};
    for (const company of unique) {
      const rows = await ctx.db
        .query('job_postings')
        .withIndex('by_company', (q) => q.eq('company', company))
        .collect();
      counts[company] = rows.filter((posting) => posting.archivedAt === undefined).length;
    }
    return counts;
  },
});
