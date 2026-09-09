export async function probeHealth(baseUrl, timeoutMs = 3000) {
    try {
        const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok)
            return undefined;
        return (await r.json());
    }
    catch {
        return undefined;
    }
}
export async function waitForHealth(baseUrl, timeoutMs, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await probeHealth(baseUrl);
        if (last?.ok)
            return last;
        await sleep(2000);
    }
    throw new Error(`Worldscribe at ${baseUrl} did not become healthy within ${Math.round(timeoutMs / 1000)}s` + (last ? ` (last: ${JSON.stringify(last)})` : ""));
}
