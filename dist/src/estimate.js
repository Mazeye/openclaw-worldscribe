// ~ one LLM round trip per 2k-char segment plus per-unit passes; 25-50 s per segment at concurrency 1 on DeepSeek.
const SEC_PER_SEGMENT = [25, 50];
export function costEstimate(est, cfg, opts = {}) {
    const usd = (est.est_prompt_tokens / 1e6) * cfg.llm.priceInPerMTok + (est.est_completion_tokens / 1e6) * cfg.llm.priceOutPerMTok;
    const segments = est.segments ?? Math.max(1, Math.ceil(est.chars / 2000));
    const par = Math.max(1, cfg.llm.concurrency);
    const minutes = [
        Math.max(1, Math.round((segments * SEC_PER_SEGMENT[0]) / par / 60)),
        Math.max(1, Math.round((segments * SEC_PER_SEGMENT[1]) / par / 60)),
    ];
    const needsConfirmation = est.chars > cfg.ingest.confirmAboveChars && !opts.confirm;
    const summary = `${est.units} unit(s), ${est.chars.toLocaleString("en-US")} chars, ≈${Math.round(est.est_prompt_tokens / 1000)}k in / ` +
        `${Math.round(est.est_completion_tokens / 1000)}k out tokens, ≈$${usd.toFixed(2)} at ${cfg.llm.model}, ` +
        `≈${minutes[0]}–${minutes[1]} min at concurrency ${par}`;
    return {
        units: est.units,
        chars: est.chars,
        promptTokens: est.est_prompt_tokens,
        completionTokens: est.est_completion_tokens,
        usd,
        minutes,
        needsConfirmation,
        summary,
    };
}
