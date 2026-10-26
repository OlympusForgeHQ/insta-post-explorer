import "server-only";

import { z } from "zod";

import { foldForSearch } from "@/lib/import/normalize";
import { distanceMeters } from "@/lib/places/distance";
import {decidePlaceResolution} from '@/lib/places/resolution';
import {entityNamesAgree} from '@/lib/places/scoring';
import {administrativeRegionMatches,isJapaneseCountry,japaneseMunicipalityName,japanesePrefectureName,municipalityCityLabels,tokyoSpecialWardParentLabels} from '@/lib/places/administrative-context';
import {recommendsCityBranches} from '@/lib/places/branch-scope';
import type { PlaceCandidate } from "@/lib/places/candidates";
import type { PlaceResolutionInput, PlaceResolver, ResolvedPlaceCandidate } from "@/server/places/resolvers/types";
import {addressDistrictHint,approximateAddress, approximateDistrict, canApproximateVenue, selectContextualVenueArea} from '@/lib/places/approximate-resolution';

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
  beforeRequest?: () => Promise<void>;
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
    address_line2: z.string().nullish(),
    street: z.string().nullish(),
    housenumber: z.string().nullish(),
    postcode: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    county: z.string().nullish(),
    district: z.string().nullish(),
    suburb: z.string().nullish(),
    municipality: z.string().nullish(),
    country: z.string().nullish(),
    country_code: z.string().nullish(),
    iso3166_2: z.string().max(32).nullish(),
    lat: z.number(),
    lon: z.number(),
    result_type: z.string().nullish(),
    bbox: z.object({lon1:z.number().min(-180).max(180),lat1:z.number().min(-90).max(90),lon2:z.number().min(-180).max(180),lat2:z.number().min(-90).max(90)}).nullish(),
    rank: z
      .object({
        confidence: z.number().min(0).max(1).nullish(),
        confidence_street_level: z.number().min(0).max(1).nullish(),
        confidence_building_level: z.number().min(0).max(1).nullish(),
        match_type: z.string().trim().min(1).max(100).nullish(),
      })
      .passthrough()
      .nullish(),
    category: z.string().nullish(),
    categories: z.array(z.string()).max(100).nullish(),
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
  private readonly beforeRequest?: () => Promise<void>;
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
    this.beforeRequest = config.beforeRequest;
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
    const results=await this.resolveGeocoding(input);
    await this.refineJapaneseWard(input,results);
    if(input.candidate.name&&!input.candidate.name.startsWith('@')&&!results.some(resolved=>decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN')){
      // Structured name fields can resolve only the city or reject a translated
      // name. Bounded free-form retrieval preserves the full source context.
      for(const language of ['en','fr']){
        const text=[...new Set([input.candidate.name,input.candidate.address,input.candidate.city,input.candidate.region,input.candidate.country].filter(Boolean))].join(', ');
        for(const match of await this.searchText(text,language,input.proximity))this.mergePoi(results,match,input);
        if(results.some(resolved=>decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN'))break;
      }
    }
    if(input.candidate.name && !input.candidate.name.startsWith('@') && input.candidate.city && input.candidate.country &&
      (recommendsCityBranches(input.candidate,input.sourceContext) || !results.some(resolved=>decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN'))){
      const areas=await this.search({...input.candidate,name:null,address:null});
      const cities=areas.filter(area=>['city','town','municipality'].includes(area.providerResultType??'')&&
        area.providerRank===1&&area.providerMatchType==='full_match'&&
        decidePlaceResolution({candidate:{...input.candidate,name:input.candidate.city,address:null,category:'city'},resolved:area}).precision==='APPROXIMATE');
      if(cities.length===1){
        const params=new URLSearchParams({apiKey:this.apiKey,lang:'en',name:input.candidate.name!,
          categories:'catering,commercial,accommodation,tourism,entertainment,leisure',
          filter:`place:${cities[0].providerPlaceId}`,limit:'100'});
        const branches=await this.searchPois(params,100,true);
        for(const branch of branches){
          // Membership comes from the provider's verified city boundary filter,
          // not from the query text or a global borough/city alias.
          // Geoapify's Tokyo boundary spans the whole prefecture, including Tama
          // and the islands. Its membership alone does not prove the urban city.
          const tokyo=isJapaneseCountry(input.candidate.country)&&japanesePrefectureName(input.candidate.city)==='tokyo';
          if(!tokyo||(branch.countryCode==='JP'&&(foldForSearch(branch.city??'')==='tokyo'||
            tokyoSpecialWardParentLabels(branch.countryCode,branch.region,branch.city,branch.subdivisionCode).length>0))){
            branch.providerLocalityBoundary={placeId:cities[0].providerPlaceId,name:input.candidate.city};
            branch.localityNames=[...new Set([...(branch.localityNames??[]),input.candidate.city])];
          }
          this.mergePoi(results,branch,input);
        }
      }
    }
    if(!input.candidate.name||results.some(resolved=>decidePlaceResolution({candidate:input.candidate,resolved}).precision!=='UNKNOWN'))return results;
    // Geocoding often returns an address or city without its business. Query
    // the independent POI catalog near the hint, keeping its own identity and
    // coordinates. The caller still checks identity, distance and ambiguity.
    const anchors=input.proximity?[input.proximity]:results.filter(result=>
      result.providerName&&entityNamesAgree(input.candidate.name!,result.providerName)&&
      result.providerRank===0&&['amenity','poi','tourism'].includes(result.providerResultType??'')).slice(0,3);
    for(const {latitude,longitude}of anchors){
    const params=new URLSearchParams({apiKey:this.apiKey,lang:'en',name:input.candidate.name,
      categories:'catering,commercial,accommodation,tourism,entertainment,leisure',
      filter:`circle:${longitude},${latitude},200`,limit:'20'});
    let nearby=await this.searchPois(params,20);
    if(!nearby.some(result=>decidePlaceResolution({candidate:input.candidate,resolved:result}).precision!=='UNKNOWN')){
      params.delete('name');params.set('limit','100');
      nearby=nearby.concat(await this.searchPois(params,100));
    }
    for(const match of nearby){
      if(distanceMeters({latitude,longitude},match)>200)continue;
      this.mergePoi(results,match,input);
    }
    }
    return results;
  }

  private async refineJapaneseWard(input:PlaceResolutionInput,results:ResolvedPlaceCandidate[]):Promise<void> {
    const {candidate}=input;
    if(candidate.category!=='voyage'||candidate.address||!candidate.name||!candidate.city||
      !isJapaneseCountry(candidate.country)||japanesePrefectureName(candidate.city)!=='tokyo'||
      results.some(resolved=>decidePlaceResolution({candidate,resolved}).precision!=='UNKNOWN'))return;
    const hints=results.filter(result=>{
      if(!result.providerName||!entityNamesAgree(candidate.name!,result.providerName)||result.providerRank!==0||
        result.providerMatchType!=='full_match'||!['amenity','poi','tourism','leisure'].includes(result.providerResultType??'')||
        !tokyoSpecialWardParentLabels(result.countryCode,result.region,result.city,result.subdivisionCode).length)return false;
      const {reasons}=decidePlaceResolution({candidate,resolved:result});
      return ['name_match','city_match','country_match'].every(reason=>reasons.includes(reason))&&
        !reasons.some(reason=>reason.endsWith('_contradiction'))&&
        (!candidate.region||candidate.inferredFields?.includes('region')||administrativeRegionMatches(candidate.region,result));
    });
    const wardKey=(name:string)=>foldForSearch(japaneseMunicipalityName(name));
    if(!hints.length||new Set(hints.map(hint=>wardKey(hint.city!))).size!==1)return;
    const ward=hints[0].city!;
    const accept=(fresh:ResolvedPlaceCandidate[])=>{
      for(const match of fresh){
        if((match.providerRank??0)<=0||!match.city||wardKey(match.city)!==wardKey(ward)||
          !tokyoSpecialWardParentLabels(match.countryCode,match.region,match.city,match.subdivisionCode).length||
          !hints.some(hint=>hint.providerPlaceId===match.providerPlaceId&&distanceMeters(hint,match)<=200)||
          decidePlaceResolution({candidate,resolved:match}).precision==='UNKNOWN')continue;
        // Retain the original zero-confidence observation alongside the fresh
        // provider result. Source evidence and provider coordinates are untouched.
        results.push(match);
      }
      return results.some(resolved=>decidePlaceResolution({candidate,resolved}).precision!=='UNKNOWN');
    };
    // The ward is a provider-verified retrieval hint, not new source evidence.
    // Two lookups at most, with the existing bounded transport retries: original
    // name, then one existing native-name alias.
    if(accept(await this.search({...candidate,city:ward,region:null},input.proximity)))return;
    const alias=hints.flatMap(hint=>hint.providerNameAliases??[]).find(name=>
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)&&foldForSearch(name)!==foldForSearch(candidate.name!));
    if(alias)accept(await this.searchText([alias,ward,candidate.country].join(', '),'en',input.proximity));
  }

  async resolveApproximate(input:PlaceResolutionInput):Promise<ResolvedPlaceCandidate[]> {
    if(!canApproximateVenue(input.candidate))return [];
    const candidate=input.candidate;
    const address=approximateAddress(candidate);
    // Three bounded neutral geocoding queries at most. They contain geographic
    // fields only, never captions, source identifiers, business names or Google
    // coordinates. Each response is still checked against the unchanged source.
    const results:ResolvedPlaceCandidate[]=[];
    if(address){
      results.push(...await this.search({...candidate,name:null,address}));
      if(['building','street'].includes(selectContextualVenueArea(candidate,results)?.scored.contextualArea?.level??''))return results;
    }
    // A weak administrative match is only a name hint. Re-query it without the
    // parent region, then evaluate the fresh raw response at the normal threshold.
    const hints=[...new Map(results.flatMap(result=>{
      const name=addressDistrictHint(candidate,result);return name?[[foldForSearch(name),name] as const]:[];
    })).values()];
    const district=approximateDistrict(candidate)??(hints.length===1?hints[0]:null);
    if(district){
      results.push(...await this.search({...candidate,name:null,address:district,region:null},undefined,'locality'));
      if(['building','street','district'].includes(selectContextualVenueArea(candidate,results)?.scored.contextualArea?.level??''))return results;
    }
    const japanese=isJapaneseCountry(candidate.country);
    const region=japanese&&candidate.region&&japanesePrefectureName(candidate.region)?candidate.region:null;
    results.push(...await this.search({...candidate,name:null,address:null,region},undefined,japanese?'city':undefined));
    return results;
  }

  private mergePoi(results:ResolvedPlaceCandidate[],match:ResolvedPlaceCandidate,input:PlaceResolutionInput){
    const existing=results.findIndex(item=>item.providerPlaceId===match.providerPlaceId);
    if(existing<0)results.push(match);
    else if(decidePlaceResolution({candidate:input.candidate,resolved:results[existing]}).precision==='UNKNOWN'&&
      decidePlaceResolution({candidate:input.candidate,resolved:match}).precision!=='UNKNOWN')results[existing]=match;
  }

  private async searchPois(params:URLSearchParams,limit:number,requireComplete=false):Promise<ResolvedPlaceCandidate[]>{
    const response=await this.fetchWithRetry(`${this.baseUrl}/v2/places?${params.toString()}`);
    let payload:unknown;
    try{payload=await response.json();}catch{throw new GeoapifyResolverError('GEOAPIFY_INVALID_RESPONSE');}
    const parsed=z.object({features:z.array(z.object({properties:geoapifyResultSchema})).max(limit)}).safeParse(payload);
    if(!parsed.success || (requireComplete && parsed.data.features.length===limit))throw new GeoapifyResolverError('GEOAPIFY_INVALID_RESPONSE');
    const matches:ResolvedPlaceCandidate[]=[];
    for(const {properties} of parsed.data.features){
      if(!properties.name||!Number.isFinite(properties.lat)||!Number.isFinite(properties.lon)||Math.abs(properties.lat)>90||Math.abs(properties.lon)>180)continue;
      const match=normalizeResult({...properties,result_type:'amenity'},'places');
      matches.push(match);
    }
    return matches;
  }

  private async resolveGeocoding(input:PlaceResolutionInput):Promise<ResolvedPlaceCandidate[]> {
    const addressResults = await this.search(input.candidate,input.proximity);
    // A caption can identify both a business and its street address. Keep the
    // business identity only when a specific address independently locates it.
    // Never substitute address coordinates into a named provider result.
    if (!input.candidate.address || !input.candidate.name || input.candidate.name.startsWith("@")) return addressResults;
    const anchors = addressResults.filter(result =>
      ["building", "housenumber", "house", "amenity"].includes(result.providerResultType ?? "") &&
      (result.providerRank ?? 0) >= 0.9);
    if (!anchors.length) return addressResults;
    const named = await this.search({ ...input.candidate, address: null },input.proximity);
    const foldName = (name: string) => foldForSearch(name).replace(/[’‘`]/g, "'");
    const corroborated = named.filter(result =>
      foldName(result.displayName) === foldName(input.candidate.name!) &&
      anchors.some(anchor => distanceMeters(anchor, result) <= 100));
    return corroborated.length ? corroborated : addressResults;
  }

  private async search(candidate: PlaceCandidate, proximity?:PlaceResolutionInput["proximity"],type?:'locality'|'city'): Promise<ResolvedPlaceCandidate[]> {
    const response = await this.fetchWithRetry(this.buildUrl(candidate,proximity,type));

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

  private async searchText(text:string,language:string,proximity?:PlaceResolutionInput['proximity']):Promise<ResolvedPlaceCandidate[]> {
    const params=new URLSearchParams({text,lang:language,format:'json',limit:String(this.maxResults),apiKey:this.apiKey});
    if(proximity)params.set('bias',`proximity:${proximity.longitude},${proximity.latitude}`);
    const response=await this.fetchWithRetry(`${this.baseUrl}/v1/geocode/search?${params}`);
    let payload:unknown;
    try{payload=await response.json();}catch{throw new GeoapifyResolverError('GEOAPIFY_INVALID_RESPONSE');}
    const parsed=geoapifyResponseSchema.safeParse(payload);
    if(!parsed.success)throw new GeoapifyResolverError('GEOAPIFY_INVALID_RESPONSE');
    return parsed.data.results.slice(0,this.maxResults).map(row=>normalizeResult(row));
  }

  // Retry transient failures — request timeouts, network errors, and the
  // retryable HTTP statuses — with capped exponential backoff and full jitter,
  // honoring a Retry-After header when present. Deterministic 4xx and exhausted
  // attempts surface a stable error. The URL, key, and body are never logged.
  private async fetchWithRetry(url: string): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      // Authority loss is terminal, not a retryable provider transport failure.
      await this.beforeRequest?.();
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
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(new GeoapifyResolverError("GEOAPIFY_TIMEOUT"));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
        if (controller.signal.aborted || !response.ok) {
          void response.body?.cancel().catch(() => {});
          if (controller.signal.aborted) throw new GeoapifyResolverError("GEOAPIFY_TIMEOUT");
          return response;
        }
        if (!response.body) return response;
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const part = await reader.read();
          if (controller.signal.aborted) throw new GeoapifyResolverError("GEOAPIFY_TIMEOUT");
          if (part.done) break;
          chunks.push(part.value);
        }
        // Callers parse an in-memory body only after the whole network response
        // arrived within the attempt deadline, including all body chunks.
        return new Response(Buffer.concat(chunks), {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
      })()]);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) throw new GeoapifyResolverError("GEOAPIFY_TIMEOUT");
      throw new GeoapifyResolverError("GEOAPIFY_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }

  // Address candidates use Geoapify's free-form address alternative. Other
  // candidates retain the structured request. The API key travels in the query
  // string but is never logged, and the full caption is never included.
  private buildUrl(source: PlaceCandidate, proximity?:PlaceResolutionInput["proximity"],type?:'locality'|'city'): string {
    const city=source.city&&isJapaneseCountry(source.country)?japaneseMunicipalityName(source.city):source.city;
    // Retrieval normalization changes neither source evidence nor provider labels.
    // Replace only a complete locality component, never a street or business name.
    const candidate=city!==source.city?{...source,city,address:source.address?.split(/[,;]/u).map(part=>
      foldForSearch(part.trim())===foldForSearch(source.city!)?city:part.trim()).join(', ')??null}:source;
    const params = new URLSearchParams();
    if(type)params.set('type',type);
    if(candidate.category==='voyage'&&!candidate.address&&!candidate.city&&!candidate.region&&candidate.country&&
      (!candidate.name||foldForSearch(candidate.name)===foldForSearch(candidate.country))){
      // A country is the target entity, not a business named after that country.
      params.set('text',candidate.country);params.set('type','country');
    } else if (candidate.address) {
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
    if(proximity)params.set("bias",`proximity:${proximity.longitude},${proximity.latitude}`);
    params.set("limit", String(this.maxResults));
    params.set("format", "json");
    params.set("apiKey", this.apiKey);
    return `${this.baseUrl}/v1/geocode/search?${params.toString()}`;
  }
}

function normalizeResult(result: z.infer<typeof geoapifyResultSchema>,source:'geocoding'|'places'='geocoding'): ResolvedPlaceCandidate {
  const tokyoParentLabels=tokyoSpecialWardParentLabels(result.country_code??null,result.state??null,result.city??null,result.iso3166_2??null);
  const structuredTokyo=foldForSearch(result.city??'')==='tokyo'||tokyoParentLabels.length>0;
  // The formatted postal locality may differ from the administrative city.
  // Keep only separate address components after the street; never turn a street
  // called Hackney Road or an unrelated district into a city alias.
  const postalLocalities=result.street&&result.address_line2
    ?result.address_line2.split(',').slice(1).map(value=>result.postcode?value.replace(result.postcode,'').trim():value.trim())
      .filter(value=>value&& !/\d/u.test(value)&&![result.country,result.state].some(other=>other&&foldForSearch(other)===foldForSearch(value)))
      .filter(value=>!(result.country_code?.trim().toUpperCase()==='JP'||isJapaneseCountry(result.country??null))||
        japanesePrefectureName(value)!=='tokyo'||structuredTokyo)
    :[];
  return {
    provider: "geoapify",
    providerPlaceId: result.place_id,
    displayName: result.name ?? result.formatted ?? result.address_line1 ?? result.place_id,
    providerName: result.name ?? null,
    providerNameAliases: Object.entries(result.other_names&&typeof result.other_names==='object'&&!Array.isArray(result.other_names)?result.other_names:{})
      .filter(([key,value])=>/^(?:name|alt_name|short_name|official_name)(?::[\w-]+)?$/u.test(key)&&typeof value==='string'&&value.length<=200)
      .slice(0,128).flatMap(([,value])=>(value as string).split(';').map(name=>name.trim()).filter(Boolean)),
    street: result.street ?? null,
    houseNumber: result.housenumber ?? null,
    ...(result.postcode ? {postalCode: result.postcode} : {}),
    localityNames: [...new Set([result.city,...postalLocalities,...municipalityCityLabels(result.country_code??null,result.state??null),
      ...tokyoParentLabels].filter((value):value is string=>Boolean(value)))],
    administrativeLabels: Object.fromEntries((['city','state','county','district','suburb','municipality'] as const)
      .flatMap(key=>result[key]?[ [key,result[key]] ]:[])),
    category: result.category ?? result.categories?.slice().sort((a,b)=>b.length-a.length)[0] ?? null,
    address: result.formatted ?? null,
    city: result.city ?? null,
    region: result.state ?? null,
    ...(result.iso3166_2 ? {subdivisionCode: result.iso3166_2} : {}),
    country: result.country ?? null,
    countryCode: result.country_code ? result.country_code.trim().toUpperCase() : null,
    latitude: result.lat,
    longitude: result.lon,
    providerResultType: result.result_type ?? null,
    providerBounds: result.bbox ?? null,
    providerRank: result.rank?.confidence ?? null,
    providerSource: source,
    providerStreetConfidence: result.rank?.confidence_street_level ?? null,
    providerBuildingConfidence: result.rank?.confidence_building_level ?? null,
    providerMatchType: result.rank?.match_type ?? null,
    attribution: GEOAPIFY_ATTRIBUTION,
  };
}
