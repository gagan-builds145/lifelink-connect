/**
 * Small authenticated HTTP client for the Python ML service.
 *
 * Prediction and health calls are idempotent, so they may be retried. Training
 * calls are not retried automatically. No token is ever sent to the browser.
 */

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function mlServiceConfigured(): boolean {
  return Boolean(process.env.ML_SERVICE_URL?.trim());
}

export function mlServiceUrl(): string {
  const url = process.env.ML_SERVICE_URL?.trim();
  if (!url) {
    throw new Error(
      "The Python ML service is not configured. Set ML_SERVICE_URL on the Convex deployment and start ml_service, then retry.",
    );
  }
  return url.replace(/\/$/, "");
}

export function mlServiceHeaders(): Record<string, string> {
  const token = process.env.ML_SERVICE_TOKEN?.trim();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

type MlFetchOptions = {
  timeoutMs?: number;
  attempts?: number;
};

/**
 * Fetch with per-attempt timeout. Network errors and retryable HTTP statuses
 * are attempted again immediately; non-retryable responses are returned for the
 * caller to surface. The final response is returned even when it is a 5xx, so
 * callers can include the service's error body.
 */
export async function mlFetch(
  path: string,
  init: RequestInit,
  options: MlFetchOptions = {},
): Promise<Response> {
  const url = `${mlServiceUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 2));
  const timeoutMs = Math.max(1_000, Math.min(180_000, options.timeoutMs ?? 20_000));
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...mlServiceHeaders(),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastResponse = response;
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) {
        return response;
      }
      lastError = new Error(`ML service returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
    }
  }

  if (lastResponse) return lastResponse;
  const detail = lastError instanceof Error ? lastError.message : "network error";
  throw new Error(
    `Could not reach the ML service at ${url} after ${attempts} attempt(s): ${detail}`,
  );
}
