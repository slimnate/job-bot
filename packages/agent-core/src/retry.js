function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function defaultIsRetryable(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return (message.includes('timed out') ||
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('websocket') ||
        message.includes('target closed') ||
        message.includes('session closed'));
}
export async function withAgentRetry(operation, options) {
    const { maxAttempts, baseDelayMs, maxDelayMs, jitterRatio = 0.2, label, isRetryable = defaultIsRetryable, } = options;
    const attempts = Math.max(1, Math.floor(maxAttempts));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            const retryable = attempt < attempts && isRetryable(error);
            if (!retryable) {
                throw error;
            }
            const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
            const jitter = exp * jitterRatio * Math.random();
            await sleep(exp + jitter);
        }
    }
    throw new Error(label ? `${label}: retry exhausted` : 'withAgentRetry: retry exhausted');
}
//# sourceMappingURL=retry.js.map