"use strict";

function sleep(durationMs, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const timerId = setTimeout(resolve, durationMs);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timerId);
                reject(signal.reason);
            },
            { once: true },
        );
    });
}
