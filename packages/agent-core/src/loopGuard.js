export class LoopGuard {
    maxSteps;
    label;
    count = 0;
    constructor(maxSteps, label) {
        this.maxSteps = maxSteps;
        this.label = label;
        if (maxSteps < 1) {
            throw new Error('LoopGuard maxSteps must be at least 1');
        }
    }
    step() {
        this.count += 1;
        if (this.count > this.maxSteps) {
            throw new Error(`Loop guard exceeded (${this.label}): ${this.count} > ${this.maxSteps}`);
        }
    }
}
//# sourceMappingURL=loopGuard.js.map