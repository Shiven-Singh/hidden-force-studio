/**
 * ADK's Gemini model builds its GoogleGenAI client from getHttpOptions() and
 * only takes headers from the agent's generateContentConfig. Overriding the
 * method is the one place a timeout and retry policy reach every ADK call.
 */
import { Gemini } from '@google/adk';
import { HTTP_OPTIONS } from './http.js';

export class TimedGemini extends Gemini {
  constructor(model: string) {
    super({
      model,
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION ?? 'global',
    });
  }

  getHttpOptions(): Record<string, unknown> {
    const base = (super.getHttpOptions?.() ?? {}) as Record<string, unknown>;
    return { ...base, timeout: HTTP_OPTIONS.timeout, retryOptions: { ...HTTP_OPTIONS.retryOptions } };
  }
}
