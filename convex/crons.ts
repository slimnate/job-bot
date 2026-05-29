import { cronJobs } from 'convex/server';
import { internal } from './_generated/api.js';

const crons = cronJobs();

crons.interval('worker schedules tick', { minutes: 1 }, internal.schedules.tick, {});

export default crons;
