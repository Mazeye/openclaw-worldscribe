export type HealthInfo = {
  ok: boolean;
  server?: string;
  world_routing?: boolean;
  writable?: boolean;
  default_world?: string;
  embedder?: string;
  llm_configured?: boolean;
  version?: string;
  jobs?: { running: number; queued: number };
};

export async function probeHealth(baseUrl: string, timeoutMs = 3000): Promise<HealthInfo | undefined> {
  try {
    const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return undefined;
    return (await r.json()) as HealthInfo;
  } catch {
    return undefined;
  }
}

export async function waitForHealth(baseUrl: string, timeoutMs: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<HealthInfo> {
  const deadline = Date.now() + timeoutMs;
  let last: HealthInfo | undefined;
  while (Date.now() < deadline) {
    last = await probeHealth(baseUrl);
    if (last?.ok) return last;
    await sleep(2000);
  }
  throw new Error(`Worldscribe at ${baseUrl} did not become healthy within ${Math.round(timeoutMs / 1000)}s` + (last ? ` (last: ${JSON.stringify(last)})` : ""));
}
