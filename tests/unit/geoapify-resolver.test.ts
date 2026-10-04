// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PlaceCandidate } from "@/lib/places/candidates";
import {
  GeoapifyPlaceResolver,
  GeoapifyResolverError,
  getConfiguredPlaceResolver,
  PlacesResolverConfigError,
} from "@/server/places/resolvers";
import type { PlaceResolutionInput } from "@/server/places/resolvers/types";
import { scoreResolvedCandidate } from "@/lib/places/scoring";

const SECRET_KEY = "super-secret-geoapify-key";

function restaurantCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    name: "Nobu Dubai",
    address: null,
    city: "Dubai",
    region: null,
    country: "United Arab Emirates",
    category: "restaurant",
    confidence: 0.9,
    evidence: [{ type: "CAPTION", excerpt: "Dinner at Nobu Dubai, amazing" }],
    ...overrides,
  };
}

function resolutionInput(overrides: Partial<PlaceCandidate> = {}): PlaceResolutionInput {
  return { candidate: restaurantCandidate(overrides), sourceTheme: "Restaurant" };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function validGeoapifyBody() {
  return {
    results: [
      {
        place_id: "geo-abc",
        name: "Nobu Dubai",
        formatted: "Nobu, Atlantis The Palm, Dubai, United Arab Emirates",
        city: "Dubai",
        state: null,
        country: "United Arab Emirates",
        country_code: "ae",
        lat: 25.13,
        lon: 55.11,
        result_type: "amenity",
        rank: { confidence: 0.95, match_type: "full_match" },
        category: "catering.restaurant",
      },
    ],
  };
}

// The legacy suite exercises a single retry (two attempts) with no real waiting.
function resolver(fetchImpl: typeof fetch) {
  return new GeoapifyPlaceResolver({
    apiKey: SECRET_KEY,
    baseUrl: "https://api.geoapify.com",
    fetchImpl,
    timeoutMs: 50,
    maxResults: 5,
    maxAttempts: 2,
    baseRetryDelayMs: 0,
    sleepImpl: async () => {},
  });
}

describe("GeoapifyPlaceResolver", () => {
  it("does not turn an address match into a different business, while retaining unnamed buildings", async () => {
    const candidate = restaurantCandidate({ name: 'New Bakery', address: '12 Rue de la Paix, 75002 Paris', city: 'Paris', country: 'France' });
    for (const [name, precision] of [['Old Grocer', 'UNKNOWN'], [undefined, 'EXACT']] as const) {
      const body = { results: [{ place_id: 'address-12', name, formatted: '12 Rue de la Paix, 75002 Paris, France',
        city: 'Paris', country: 'France', country_code: 'fr', lat: 48.87, lon: 2.33, result_type: name ? 'amenity' : 'building',
        rank: { confidence: 1, match_type: 'full_match' } }] };
      const fetchMock = vi.fn().mockImplementation(async (url: string) => jsonResponse(new URL(url).searchParams.has('name') ? {results: []} : body));
      const [match] = await resolver(fetchMock).resolve({candidate, sourceTheme: 'Restaurant'});
      expect(scoreResolvedCandidate({candidate, resolved: match}).precision).toBe(precision);
    }
  });

  it("builds a structured request without leaking the key or caption", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(validGeoapifyBody()));
    await resolver(fetchMock).resolve(resolutionInput());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/v1/geocode/search?");
    expect(url).toContain("name=Nobu+Dubai");
    expect(url).toContain("city=Dubai");
    expect(url).toContain("country=United+Arab+Emirates");
    expect(url).not.toContain("caption");
    expect(url).not.toContain("Dinner at Nobu");
  });

  it("uses a free-form address query without sending a handle or caption", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(validGeoapifyBody()));
    await resolver(fetchMock).resolve(
      resolutionInput({
        name: "@airelleschateaudeversailles",
        address: "12 rue de l'Independance Americaine, 78000 Versailles",
        city: "Versailles",
        region: "Ile-de-France",
        country: "France",
      }),
    );

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("text")).toBe(
      "12 rue de l'Independance Americaine, 78000 Versailles, Ile-de-France, France",
    );
    expect(url.searchParams.get("bias")).toBe("countrycode:none");
    expect(url.searchParams.has("name")).toBe(false);
    expect(url.toString()).not.toContain("airelleschateaudeversailles");
    expect(url.toString()).not.toContain("Dinner+at+Nobu");
  });

  it("retains a named venue identity only when its address is independently corroborated", async () => {
    const building={place_id:'building-10',formatted:'10 Avenue de Wagram, 75008 Paris, France',city:'Paris',country:'France',lat:48.875702,lon:2.2967064,result_type:'building',rank:{confidence:1,match_type:'full_match'}};
    const venue={...building,place_id:'venue-terre',name:"Terre d'Azur",formatted:"Terre d'Azur, Avenue de Wagram, 8th Arrondissement of Paris, 75008 Paris, France",lat:48.8756751,lon:2.29672,result_type:'amenity'};
    const fetchMock=vi.fn().mockImplementation(async(url:string)=>jsonResponse({results:new URL(url).searchParams.has('name')?[venue]:[building]}));
    const result=await resolver(fetchMock).resolve(resolutionInput({name:'Terre d’Azur',address:'10 Avenue de Wagram, 75008 Paris',city:'Paris',country:'France'}));
    expect(result).toHaveLength(1);expect(result[0]).toMatchObject({providerPlaceId:'venue-terre',displayName:"Terre d'Azur",latitude:48.8756751});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const far=vi.fn().mockImplementation(async(url:string)=>jsonResponse({results:new URL(url).searchParams.has('name')?[{...venue,lat:49}]:[building]}));
    expect((await resolver(far).resolve(resolutionInput({name:'Terre d’Azur',address:'10 Avenue de Wagram, 75008 Paris',city:'Paris',country:'France'})))[0].providerPlaceId).toBe('building-10');
  });

  it("normalizes a valid response into resolved candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(validGeoapifyBody()));
    const [first] = await resolver(fetchMock).resolve(resolutionInput());
    expect(first).toMatchObject({
      provider: "geoapify",
      providerPlaceId: "geo-abc",
      displayName: "Nobu Dubai",
      city: "Dubai",
      country: "United Arab Emirates",
      countryCode: "AE",
      latitude: 25.13,
      longitude: 55.11,
      providerResultType: "amenity",
      providerRank: 0.95,
      providerMatchType: "full_match",
    });
    expect(first.attribution).toBeTruthy();
  });

  it("returns an empty array when the provider has no results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    await expect(resolver(fetchMock).resolve(resolutionInput())).resolves.toEqual([]);
  });

  it("caps the number of returned results to maxResults", async () => {
    const many = { results: Array.from({ length: 9 }, (_, i) => ({ ...validGeoapifyBody().results[0], place_id: `geo-${i}` })) };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(many));
    const results = await resolver(fetchMock).resolve(resolutionInput());
    expect(results).toHaveLength(5);
  });

  it("throws GEOAPIFY_INVALID_RESPONSE on a malformed payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ nope: true }));
    await expect(resolver(fetchMock).resolve(resolutionInput())).rejects.toMatchObject({
      code: "GEOAPIFY_INVALID_RESPONSE",
    });
  });

  it("throws GEOAPIFY_INVALID_RESPONSE when a result has a non-numeric coordinate", async () => {
    const bad = { results: [{ ...validGeoapifyBody().results[0], lat: "not-a-number" }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(bad));
    await expect(resolver(fetchMock).resolve(resolutionInput())).rejects.toMatchObject({
      code: "GEOAPIFY_INVALID_RESPONSE",
    });
  });

  it("does not retry a non-retryable 400 and throws GEOAPIFY_HTTP_ERROR", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "bad request" }, 400));
    await expect(resolver(fetchMock).resolve(resolutionInput())).rejects.toMatchObject({
      code: "GEOAPIFY_HTTP_ERROR",
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on 429 and succeeds on the second attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse(validGeoapifyBody()));
    const results = await resolver(fetchMock).resolve(resolutionInput());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it("throws GEOAPIFY_UNAVAILABLE after a retried 503 keeps failing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unavailable" }, 503));
    await expect(resolver(fetchMock).resolve(resolutionInput())).rejects.toMatchObject({
      code: "GEOAPIFY_UNAVAILABLE",
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws GEOAPIFY_TIMEOUT when the request is aborted", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    ) as unknown as typeof fetch;
    await expect(resolver(fetchMock).resolve(resolutionInput())).rejects.toMatchObject({
      code: "GEOAPIFY_TIMEOUT",
    });
  });

  it("never includes the API key or caption in thrown errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "forbidden" }, 403));
    try {
      await resolver(fetchMock).resolve(resolutionInput());
      throw new Error("expected the resolver to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GeoapifyResolverError);
      const serialized = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
      expect(serialized).not.toContain(SECRET_KEY);
      expect(serialized).not.toContain("Dinner at Nobu");
    }
  });
});

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

// A resolver that never really waits; captured `sleeps` are the requested delays.
function retryingResolver(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  const resolverInstance = new GeoapifyPlaceResolver({
    apiKey: SECRET_KEY,
    baseUrl: "https://api.geoapify.com",
    fetchImpl,
    timeoutMs: 50,
    maxResults: 5,
    maxAttempts: 3,
    baseRetryDelayMs: 100,
    maxRetryDelayMs: 1_000,
    jitter: () => 1, // deterministic: use the full exponential delay
    sleepImpl: async (ms: number) => {
      sleeps.push(ms);
    },
    ...overrides,
  });
  return { resolver: resolverInstance, sleeps };
}

describe("GeoapifyPlaceResolver retry policy", () => {
  it("retries a timeout and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError()) // attempt 1: timeout
      .mockResolvedValueOnce(jsonResponse(validGeoapifyBody())); // attempt 2: success
    const { resolver: r } = retryingResolver(fetchMock as unknown as typeof fetch);
    const results = await r.resolve(resolutionInput());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it("retries a network error and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET")) // attempt 1: network failure
      .mockResolvedValueOnce(jsonResponse(validGeoapifyBody()));
    const { resolver: r } = retryingResolver(fetchMock as unknown as typeof fetch);
    const results = await r.resolve(resolutionInput());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it.each([408, 500, 502, 503, 504])("retries a %d and then succeeds", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "transient" }, status))
      .mockResolvedValueOnce(jsonResponse(validGeoapifyBody()));
    const { resolver: r } = retryingResolver(fetchMock);
    const results = await r.resolve(resolutionInput());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it("honors a Retry-After header instead of the computed backoff", async () => {
    const retryAfter = new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "2" },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(retryAfter).mockResolvedValueOnce(jsonResponse(validGeoapifyBody()));
    const { resolver: r, sleeps } = retryingResolver(fetchMock, { maxRetryDelayMs: 5_000 });
    await r.resolve(resolutionInput());
    expect(sleeps).toEqual([2_000]); // 2 seconds, not the 100ms exponential base
  });

  it("caps Retry-After at the configured maximum", async () => {
    const retryAfter = new Response(JSON.stringify({ error: "rate limited" }), {
      status: 503,
      headers: { "content-type": "application/json", "retry-after": "3600" },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(retryAfter).mockResolvedValueOnce(jsonResponse(validGeoapifyBody()));
    const { resolver: r, sleeps } = retryingResolver(fetchMock, { maxRetryDelayMs: 1_000 });
    await r.resolve(resolutionInput());
    expect(sleeps).toEqual([1_000]);
  });

  it("grows the backoff exponentially and caps it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unavailable" }, 503));
    const { resolver: r, sleeps } = retryingResolver(fetchMock, {
      maxAttempts: 5,
      baseRetryDelayMs: 300,
      maxRetryDelayMs: 1_000,
    });
    await expect(r.resolve(resolutionInput())).rejects.toMatchObject({ code: "GEOAPIFY_UNAVAILABLE", status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(sleeps).toEqual([300, 600, 1_000, 1_000]); // 300, 600, capped at 1000
  });

  it("applies jitter as a factor of the exponential delay", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unavailable" }, 503));
    const { resolver: r, sleeps } = retryingResolver(fetchMock, {
      maxAttempts: 2,
      baseRetryDelayMs: 200,
      jitter: () => 0.5,
    });
    await expect(r.resolve(resolutionInput())).rejects.toMatchObject({ code: "GEOAPIFY_UNAVAILABLE" });
    expect(sleeps).toEqual([100]); // round(200 * 0.5)
  });

  it("exhausts attempts on a persistent timeout and throws GEOAPIFY_TIMEOUT", async () => {
    const fetchMock = vi.fn().mockRejectedValue(abortError());
    const { resolver: r } = retryingResolver(fetchMock as unknown as typeof fetch);
    await expect(r.resolve(resolutionInput())).rejects.toMatchObject({ code: "GEOAPIFY_TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry when maxAttempts is 1", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unavailable" }, 503));
    const { resolver: r, sleeps } = retryingResolver(fetchMock, { maxAttempts: 1 });
    await expect(r.resolve(resolutionInput())).rejects.toMatchObject({ code: "GEOAPIFY_UNAVAILABLE", status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("does not retry a deterministic 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "not found" }, 404));
    const { resolver: r } = retryingResolver(fetchMock);
    await expect(r.resolve(resolutionInput())).rejects.toMatchObject({ code: "GEOAPIFY_HTTP_ERROR", status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never leaks the key or caption after exhausted retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unavailable" }, 503));
    const { resolver: r } = retryingResolver(fetchMock);
    try {
      await r.resolve(resolutionInput());
      throw new Error("expected the resolver to throw");
    } catch (error) {
      const serialized = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
      expect(serialized).not.toContain(SECRET_KEY);
      expect(serialized).not.toContain("Dinner at Nobu");
    }
  });
});

describe("getConfiguredPlaceResolver", () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.GEOAPIFY_API_KEY;
    delete process.env.PLACES_RESOLVER_PROVIDER;
    delete process.env.GEOAPIFY_API_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("throws PLACES_RESOLVER_NOT_CONFIGURED when the API key is absent", () => {
    expect(() => getConfiguredPlaceResolver()).toThrow(PlacesResolverConfigError);
    try {
      getConfiguredPlaceResolver();
    } catch (error) {
      expect((error as PlacesResolverConfigError).code).toBe("PLACES_RESOLVER_NOT_CONFIGURED");
    }
  });

  it("rejects an unsupported provider", () => {
    process.env.GEOAPIFY_API_KEY = SECRET_KEY;
    process.env.PLACES_RESOLVER_PROVIDER = "somethingelse";
    try {
      getConfiguredPlaceResolver();
      throw new Error("expected a config error");
    } catch (error) {
      expect((error as PlacesResolverConfigError).code).toBe("UNSUPPORTED_PLACES_RESOLVER");
    }
  });

  it("builds a resolver when the key is present", () => {
    process.env.GEOAPIFY_API_KEY = SECRET_KEY;
    expect(getConfiguredPlaceResolver()).toBeInstanceOf(GeoapifyPlaceResolver);
  });
});
