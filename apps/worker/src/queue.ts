import { workerLog } from './log.js';

export type QueueTask<TContext = void> = {
  id: string;
  context: TContext;
  run: (context: TContext) => Promise<void>;
};

export interface QueueSnapshot {
  readonly queued: number;
  readonly running: number;
}

export class InMemoryTaskQueue<TContext = void> {
  private readonly concurrency: number;
  private readonly pending: Array<QueueTask<TContext>> = [];
  private activeCount = 0;

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, Math.floor(concurrency));
  }

  enqueue(task: QueueTask<TContext>): void {
    this.pending.push(task);
    const depth = this.pending.length;
    if (depth > 200) {
      workerLog.warn('queue.depth.high', {
        depth,
        taskId: task.id,
        running: this.activeCount,
      });
    }
    this.drain();
  }

  snapshot(): QueueSnapshot {
    return {
      queued: this.pending.length,
      running: this.activeCount,
    };
  }

  private drain(): void {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) {
        return;
      }

      this.activeCount += 1;
      void task
        .run(task.context)
        .catch((error: unknown) => {
          workerLog.error('queue.task.failed', {
            taskId: task.id,
            err: error instanceof Error ? error.message : 'Unknown queue task error',
          });
        })
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }
}
