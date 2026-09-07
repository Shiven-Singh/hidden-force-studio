/**
 * HTTP behaviour shared by every Gemini call, whether it goes through an ADK
 * LlmAgent or the direct client. A hung call must fail the run, not freeze it.
 */
export const MODEL_TIMEOUT_MS = 180_000;

/** Retry rate limits and server errors, which preview models return more often than GA ones. */
export const HTTP_OPTIONS: { timeout: number; retryOptions: { attempts: number; httpStatusCodes: number[] } } = {
  timeout: MODEL_TIMEOUT_MS,
  retryOptions: { attempts: 3, httpStatusCodes: [408, 429, 500, 502, 503, 504] },
};

/** How long the server waits for the pipeline to emit anything before calling the run dead. */
export const RUN_INACTIVITY_MS = 12 * 60_000;
