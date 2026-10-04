import "server-only";

import { z } from "zod";

import { foldForSearch } from "@/lib/import/normalize";
import { distanceMeters } from "@/lib/places/distance";
import type { PlaceCandidate } from "@/lib/places/candidates";
import type { PlaceResolutionInput, PlaceResolver, ResolvedPlaceCandidate } from "@/server/places/resolvers/types";

// Geoapify geographic resolver behind the replaceable PlaceResolver interface.
// It turns a textual candidate into provider-verified coordinates and a provider
// identity. It never logs the API key, the request URL, or the caption, and its
// thrown errors carry only a stable code and an optional HTTP status.

const GEOAPIFY_ATTRIBUTION = "Powered by Geoapify";
// Transient HTTP statuses worth retrying: request timeout, rate limit, and the
// gateway/unavailable 5xx family. A 500 is included because Geoapify occasionally
// returns it under load; genuinely deterministic 4xx (400/401/403/404) are not
// retried. Timeouts and network failures are also retried (handled below).
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 8_000;

export type GeoapifyResolverErrorCode =
  | "GEOAPIFY_HTTP_ERROR"
  | "GEOAPIFY_INVALID_RESPONSE"
  | "GEOAPIFY_TIMEOUT"
  | "GEOAPIFY_UNAVAILABLE";

export class GeoapifyResolverError extends Error {
  readonly code: GeoapifyResolverErrorCode;
  readonly status?: number;
  constructor(code: GeoapifyResolverErrorCode, status?: number) {
    // The message is the stable code only: never interpolate the URL, key, or body.
    super(code);
    this.code = code;
    this.status = status;
    this.name = "GeoapifyResolverError";
  }
}

export type GeoapifyResolverConfig = {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResults?: number;
  // Total attempts including the first (bounded 1..6). One means no retry.
  maxAttempts?: number;
  // Exponential backoff base and cap, in milliseconds.
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  // Backward-compatible alias for baseRetryDelayMs.
  retryDelayMs?: number;
  // Injectable for deterministic tests. jitter() returns a factor in [0, 1);
  // sleepImpl replaces the real timer so tests never wait.
  jitter?: () => number;
  sleepImpl?: (ms: number) => Promise<void>;
};

// Only the bounded fields we normalize are declared; unknown provider fields are
// discarded after parsing. A non-numeric coordinate fails validation.
const geoapifyResultSchema = z
  .object({
    place_id: z.string().min(1),
    name: z.string().nullish(),
    formatted: z.string().nullish(),
    address_line1: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    country: z.string().nullish(),
    country_code: z.string().nullish(),
    lat: z.number(),
    lon: z.number(),
    result_type: z.string().nullish(),
    rank: z
      .object({
        confidence: z.number().min(0).max(1).nullish(),
        match_type: z.string().trim().min(1).max(100).nullish(),
      })
      .passthrough()
      .nullish(),
    category: z.string().nullish(),
  })
  .passthrough();

const geoapifyResponseSchema = z.object({ results: z.array(geoapifyResultSchema) });

function clampMaxResults(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 5;
  return Math.min(5, Math.max(1, Math.trunc(value)));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

// Parse an HTTP Retry-After header (delta-seconds or an HTTP date) into a
// non-negative millisecond delay, or null when it is absent or unparseable.
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000;
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function isRetryableTransport(error: unknown): error is GeoapifyResolverError {
  return (
    error instanceof GeoapifyResolverError &&
    (error.code === "GEOAPIFY_TIMEOUT" || error.code === "GEOAPIFY_UNAVAILABLE")
  );
}

export class GeoapifyPlaceResolver implements PlaceResolver {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResults: number;
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly jitter: () => number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(config: GeoapifyResolverConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 8_000;
    this.maxResults = clampMaxResults(config.maxResults);
    this.maxAttempts = clampInt(config.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 6);
    this.baseRetryDelayMs = clampInt(
      config.baseRetryDelayMs ?? config.retryDelayMs,
      DEFAULT_BASE_RETRY_DELAY_MS,
      0,
      60_000,
    );
    this.maxRetryDelayMs = clampInt(config.maxRetryDelayMs, DEFAULT_MAX_RETRY_DELAY_MS, this.baseRetryDelayMs, 60_000);
    this.jitter = config.jitter ?? Math.random;
    this.sleepImpl = config.sleepImpl ?? delay;
  }

  async resolve(input: PlaceResolutionInput): Promise<ResolvedPlaceCandidate[]> {
    const addressResults = await this.search(input.candidate);
    // A caption can identify both a business and its street address. Keep the
    // business identity only when a specific address independently locates it.
    // Never substitute address coordinates into a named provider result.
    if (!input.candidate.address || !input.candidate.name || input.candidate.name.startsWith("@")) return addressResults;
    const anchors = addressResults.filter(result =>
      ["building", "housenumber", "house", "amenity"].includes(result.providerResultType ?? "") &&
      (result.providerRank ?? 0) >= 0.9);
    if (!anchors.length) return addressResults;
    const named = await this.search({ ...input.candidate, address: null });
    const foldName = (name: string) => foldForSearch(name).replace(/[’‘`]/g, "'");
    const corroborated = named.filter(result =>
      foldName(result.displayName) === foldName(input.candidate.name!) &&
      anchors.some(anchor => distanceMeters(anchor, result) <= 100));
    return corroborated.length ? corroborated : addressResults;
  }

  private async search(candidate: PlaceCandidate): Promise<ResolvedPlaceCandidate[]> {
    const response = await this.fetchWithRetry(this.buildUrl(candidate));

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new GeoapifyResolverError("GEOAPIFY_INVALID_RESPONSE");
    }

    const parsed = geoapifyResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new GeoapifyResolverError("GEOAPIFY_INVALID_RESPONSE");
    }

    return parsed.data.results.slice(0, this.maxResults).map((result) => normalizeResult(result));
  }

  // Retry transient failures — request timeouts, network errors, and the
  // retryable HTTP statuses — with capped exponential backoff and full jitter,
  // honoring a Retry-After header when present. Deterministic 4xx and exhausted
  // attempts surface a stable error. The URL, key, and body are never logged.
  private async fetchWithRetry(url: string): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response | null = null;
      let transientError: GeoapifyResolverError | null = null;
      try {
        response = await this.fetchOnce(url);
      } catch (error) {
        if (isRetryableTransport(error)) transientError = error;
        else throw error; // never reached today, but keeps unexpected errors intact
      }

      if (response && response.ok) return response;

      const retryable = transientError !== null || (response !== null && RETRYABLE_STATUSES.has(response.status));
      if (retryable && attempt < this.maxAttempts) {
        await this.sleepImpl(this.retryDelayMs(attempt, response?.headers.get("retry-after") ?? null));
        continue;
      }

      if (transientError) throw transientError;
      if (response) {
        if (RETRYABLE_STATUSES.has(response.status)) {
          throw new GeoapifyResolverError("GEOAPIFY_UNAVAILABLE", response.status);
        }
        throw new GeoapifyResolverError("GEOAPIFY_HTTP_ERROR", response.status);
      }
      throw new GeoapifyResolverError("GEOAPIFY_UNAVAILABLE");
    }
  }

  // Full-jitter exponential backoff, capped at maxRetryDelayMs. A valid
  // Retry-After header takes precedence (also capped) so the provider's own
  // pacing is respected on 429/503.
  private retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs !== null) return Math.min(retryAfterMs, this.maxRetryDelayMs);
    const exponential = Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * 2 ** (attempt - 1));
    return Math.round(exponential * this.jitter());
  }

  private async fetchOnce(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
    } catch (error) {
      if (isAbortError(error)) throw new GeoapifyResolverError("GEOAPIFY_TIMEOUT");
      throw new GeoapifyResolverError("GEOAPIFY_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }

  // Address candidates use Geoapify's free-form address alternative. Other
  // candidates retain the structured request. The API key travels in the query
  // string but is never logged, and the full caption is never included.
  private buildUrl(candidate: PlaceCandidate): string {
    const params = new URLSearchParams();
    if (candidate.address) {
      const addressKey = foldForSearch(candidate.address);
      const context: string[] = [];
      for (const value of [candidate.city, candidate.region, candidate.country]) {
        if (value && !addressKey.includes(foldForSearch(value))) context.push(value);
      }
      params.set("text", [candidate.address, ...context].join(", "));
      params.set("bias", "countrycode:none");
    } else {
      if (candidate.name) params.set("name", candidate.name);
      if (candidate.city) params.set("city", candidate.city);
      if (candidate.region) params.set("state", candidate.region);
      if (candidate.country) params.set("country", candidate.country);
    }
    params.set("limit", String(this.maxResults));
    params.set("format", "json");
    params.set("apiKey", this.apiKey);
    return `${this.baseUrl}/v1/geocode/search?${params.toString()}`;
  }
}

function normalizeResult(result: z.infer<typeof geoapifyResultSchema>): ResolvedPlaceCandidate {
  return {
    provider: "geoapify",
    providerPlaceId: result.place_id,
    displayName: result.name ?? result.formatted ?? result.address_line1 ?? result.place_id,
    providerName: result.name ?? null,
    category: result.category ?? null,
    address: result.formatted ?? null,
    city: result.city ?? null,
    region: result.state ?? null,
    country: result.country ?? null,
    countryCode: result.country_code ? result.country_code.trim().toUpperCase() : null,
    latitude: result.lat,
    longitude: result.lon,
    providerResultType: result.result_type ?? null,
    providerRank: result.rank?.confidence ?? null,
    providerMatchType: result.rank?.match_type ?? null,
    attribution: GEOAPIFY_ATTRIBUTION,
  };
}
