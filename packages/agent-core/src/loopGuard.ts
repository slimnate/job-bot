export class LoopGuard {
  private count = 0;

  constructor(
    private readonly maxSteps: number,
    private readonly label: string
  ) {
    if (maxSteps < 1) {
      throw new Error('LoopGuard maxSteps must be at least 1');
    }
  }

  step(): void {
    this.count += 1;
    if (this.count > this.maxSteps) {
      throw new Error(`Loop guard exceeded (${this.label}): ${this.count} > ${this.maxSteps}`);
    }
  }
}
