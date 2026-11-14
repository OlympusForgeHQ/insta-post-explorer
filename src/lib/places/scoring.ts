import { foldForSearch } from "@/lib/import/normalize";
import { continentCodeForCountry } from "@/lib/places/continents";
import type { PlaceCandidate } from "@/lib/places/candidates";
import type { ResolvedPlaceCandidate } from "@/server/places/resolvers/types";
import {verifiedAdministrativeCityNames,addressComponents,belgianMunicipalityAliases,belgianStreetSpelling,brusselsMunicipalityParentLabels,japaneseFloor,japaneseMunicipalityMatches} from '@/lib/places/administrative-context';

// Deterministic resolution scoring (design section 6). A textual candidate and
// its provider-verified resolution are combined into a bounded confidence and a
// precision class. The score never depends on provider coordinates or on the
// non-deterministic order of provider results; the same input always yields the
// same output. `EXACT` additionally requires a provider-verified specific result
// type and no contradiction. Country destinations require explicit travel intent
// and provider bounds, and are represented only as approximate zones.

export type PlacePrecisionOutcome = "EXACT" | "PROBABLE" | "APPROXIMATE" | "UNKNOWN";

export type ScoringInput = {
  candidate: Pick<PlaceCandidate, "name" | "address" | "city" | "region" | "country" | "category" | "confidence" | "inferredFields">;
  resolved: ResolvedPlaceCandidate;
};

export type ContextualVenueArea = {
  level: "building" | "street" | "venue" | "district" | "city";
  sourceName: string;
  missingDetails: string[];
};

export type ScoredResolution = {
  contextualArea?: ContextualVenueArea;
  confidence: number;
  precision: PlacePrecisionOutcome;
  approximationRadiusMeters: number | null;
  reasons: string[];
};

// Confidence thresholds (design section 7.2 / CODEX_PLACES_EXTENSION section 7).
export const PRECISION_THRESHOLDS = {
  EXACT: 0.9,
  PROBABLE: 0.75,
  APPROXIMATE: 0.5,
} as const;

// Additive weights, summing to 1.0, applied to normalized field agreement and
// the model's own stated confidence. Name and city dominate because they carry
// the most locating signal for a caption-derived candidate.
export const SCORING_WEIGHTS = {
  candidateConfidence: 0.25,
  nameMatch: 0.35,
  cityMatch: 0.2,
  countryMatch: 0.15,
  regionMatch: 0.05,
} as const;

// Each contradicting locating field (city or country asserted by the model but
// disagreeing with the provider) subtracts this much, which is enough to push an
// otherwise strong match below the APPROXIMATE floor.
export const CONTRADICTION_PENALTY = 0.4;
export const ADDRESS_PROVIDER_EXACT_THRESHOLD = 0.9;
export const ADDRESS_PROVIDER_INNER_PART_EXACT_THRESHOLD = 0.95;

const ADDRESS_LEVEL_MATCH_TYPES = new Set(["full_match", "match_by_building"]);

// Approximation radii by area level (design section 4 / D4).
export const APPROXIMATION_RADII_METERS = {
  district: 5_000,
  city: 10_000,
  county: 50_000,
  state: 150_000,
} as const;

type ResultKind =
  | { kind: "specific" }
  | { kind: "area"; radius: number }
  | { kind: "country" }
  | { kind: "unknown" };

// Map a provider result type to a specificity kind. Unknown types are treated as
// non-locating and resolve to UNKNOWN — the safe default.
function classifyResultType(resultType: string | null): ResultKind {
  const key = (resultType ?? "").trim().toLowerCase();
  if (["amenity", "building", "street", "housenumber", "house", "tourism", "leisure", "poi"].includes(key)) {
    return { kind: "specific" };
  }
  if (["suburb", "district", "neighbourhood", "quarter"].includes(key)) {
    return { kind: "area", radius: APPROXIMATION_RADII_METERS.district };
  }
  if (["city", "town", "village", "municipality", "locality", "postcode"].includes(key)) {
    return { kind: "area", radius: APPROXIMATION_RADII_METERS.city };
  }
  if (key === "county") {
    return { kind: "area", radius: APPROXIMATION_RADII_METERS.county };
  }
  if (["state", "region", "province"].includes(key)) {
    return { kind: "area", radius: APPROXIMATION_RADII_METERS.state };
  }
  if (key === "country") {
    return { kind: "country" };
  }
  return { kind: "unknown" };
}

function normalizedEquals(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return foldForSearch(left) === foldForSearch(right);
}

// A field agrees (1) when both sides assert it and they fold-match; it
// contradicts when both assert it and they differ; otherwise it is neutral (0).
function fieldAgreement(candidateValue: string | null, resolvedValue: string | null): {
  match: number;
  contradiction: boolean;
} {
  if (!candidateValue || !resolvedValue) return { match: 0, contradiction: false };
  return normalizedEquals(candidateValue, resolvedValue)
    ? { match: 1, contradiction: false }
    : { match: 0, contradiction: true };
}

// Compare source-language country labels against the provider's verified ISO
// code. ICU supplies exact translations; no fuzzy match can erase a conflict.
const countryNames = ['fr', 'en', 'nl', 'es', 'de', 'it'].map(locale => new Intl.DisplayNames([locale], { type: 'region' }));
const countryAliases:Readonly<Record<string,readonly string[]>>={
  US:['USA','United States of America',"États-Unis d’Amérique"],
  GB:['UK','United Kingdom of Great Britain and Northern Ireland'],
  CZ:['Czech Republic','République tchèque'],NL:['The Netherlands'],
};
function countryAgreement(candidateValue: string | null, resolved: ResolvedPlaceCandidate) {
  const code = resolved.countryCode?.trim().toUpperCase();
  if (candidateValue && code && continentCodeForCountry(code)) {
    const aliases = [code,...(countryAliases[code]??[]), ...countryNames.map(names => names.of(code) ?? '')];
    if (aliases.some(alias => normalizedEquals(candidateValue, alias))) return { match: 1, contradiction: false };
  }
  return fieldAgreement(candidateValue, resolved.country);
}

function cityAgreement(candidateValue: string | null, resolvedValue: string | null, countryCode: string | null = null) {
  if (candidateValue && resolvedValue) {
    if(japaneseMunicipalityMatches(candidateValue,resolvedValue,countryCode))return {match:1,contradiction:false};
    const belgianAliases=belgianMunicipalityAliases(countryCode,resolvedValue);
    if(belgianAliases.length&&belgianMunicipalityAliases(countryCode,candidateValue)[0]===belgianAliases[0])return {match:1,contradiction:false};
    // London is often source context for a POI whose provider locality is the
    // City of London or Greater London. This is directional and GB-only; it
    // does not make those areas interchangeable or verify a different POI.
    if (countryCode?.trim().toUpperCase() === 'GB' &&
      ['london', 'londres'].includes(foldForSearch(candidateValue)) &&
      ['london', 'city of london', 'greater london'].includes(foldForSearch(resolvedValue))) {
      return { match: 1, contradiction: false };
    }
    // Only a complete bilingual component asserted by the provider is an alias.
    // Do not split ordinary hyphenated names or accept arbitrary substrings.
    const aliases = resolvedValue.split(/\s+[-–—/]\s+/u);
    if(countryCode?.toUpperCase()==='BE'&&aliases.length>1&&!belgianAliases.length&&
      aliases.some(alias=>belgianMunicipalityAliases(countryCode,alias).length))return {match:0,contradiction:true};
    if (aliases.some(alias => normalizedEquals(candidateValue, alias))) return { match: 1, contradiction: false };
  }
  return fieldAgreement(candidateValue, resolvedValue);
}

type AddressAgreement = {
  match: boolean;
  houseNumberMatch: boolean;
  contradiction: boolean;
};

// French repetition suffixes belong to the house number: "11 bis" and "11"
// are different addresses, while "11 bis" and "11bis" are the same one.
export const HOUSE_NUMBER_SUFFIX = '(?:bis|ter|quater)';
const HOUSE_NUMBER = `\\d{1,6}(?:\\s?${HOUSE_NUMBER_SUFFIX}\\b|[a-z])?(?:[-/]\\d{1,6}[a-z]?)*`;
const compactHouseNumber = (value: string) => value.toLowerCase().replace(/\s+/gu, '');

function normalizeAddress(value: string): string {
  return foldForSearch(value).split(',').map((segment,index)=>index>0
    ?segment.replace(/^\s*\d{4,6}(?:-\d{4})?\s+(?=\p{L})/u,''):segment).join(',')
    .replace(/\b(?:bd|blvd)\b/gu, 'boulevard')
    .replace(/\b(?:av|ave)\b/gu, 'avenue')
    .replace(/\bst\b/gu, 'street')
    .replace(/\brd\b/gu, 'road')
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(new RegExp(`\\b(\\d{1,6}) (${HOUSE_NUMBER_SUFFIX})\\b`,'gu'), '$1$2')
    .trim();
}

// "30, avenue Montaigne": a short number alone before its street. A longer
// lone number is more plausibly a postcode and keeps the previous behavior.
function detachedHouseNumber(segments: readonly string[]): string | null {
  if (segments.length < 2 || !/^\s*\p{L}/u.test(segments[1])) return null;
  const alone = segments[0].match(new RegExp(`^\\s*(${HOUSE_NUMBER})\\s*$`,'iu'))?.[1];
  return alone && !/^\d{4,6}$/u.test(alone) ? compactHouseNumber(alone) : null;
}

function likelyHouseNumber(value: string): string | null {
  // Ignore postal codes and ordinal district names; a number must introduce
  // a street/address segment, rather than appear anywhere in formatted text.
  const cleaned = value.replace(/\b\d{1,3}(?:st|nd|rd|th|er|e|eme|ème)\b/gi, '');
  // Preserve the complete compound identifier even for callers without country
  // context (including deduplication). A suffix is not the same address.
  const number=HOUSE_NUMBER;
  const segments = cleaned.split(',');
  const detached = detachedHouseNumber(segments);
  if (detached) return detached;
  for (const [index, segment] of segments.entries()) {
    const leading = segment.match(new RegExp(`^\\s*(${number})\\s+\\p{L}`,'iu'))?.[1];
    if (leading && !(index > 0 && /^\d{4,6}$/.test(leading))) return compactHouseNumber(leading);
    const trailing = segment.match(new RegExp(`\\p{L}\\s+(${number})\\s*$`,'iu'))?.[1];
    if (trailing) return compactHouseNumber(trailing);
  }
  return null;
}

export function addressAgreement(candidateValue: string | null, resolvedValue: string | null): AddressAgreement {
  if (!candidateValue || !resolvedValue) {
    return { match: false, houseNumberMatch: false, contradiction: false };
  }

  const candidateAddress = normalizeAddress(candidateValue);
  const resolvedAddress = normalizeAddress(resolvedValue);
  const candidateHouseNumber = likelyHouseNumber(candidateValue);
  const resolvedHouseNumber = likelyHouseNumber(resolvedValue);
  const houseNumberMatch =
    candidateHouseNumber !== null && candidateHouseNumber === resolvedHouseNumber;
  const contradiction =
    candidateHouseNumber !== null &&
    resolvedHouseNumber !== null &&
    candidateHouseNumber !== resolvedHouseNumber;
  const containsAddress =
    Math.min(candidateAddress.length, resolvedAddress.length) >= 8 &&
    (candidateAddress.includes(resolvedAddress) || resolvedAddress.includes(candidateAddress));

  return {
    match: containsAddress && !contradiction,
    houseNumberMatch,
    contradiction,
  };
}

function providerAddressAgreement(candidateValue: string | null, resolved: ResolvedPlaceCandidate): AddressAgreement {
  if(resolved.countryCode==='BE'){
    const postcode=(value:string|null)=>value?.split(',').slice(1)
      .map(part=>part.trim().match(/^(\d{4})(?:\s+\p{L}|$)/u)?.[1]).find(Boolean);
    const sourcePostcode=postcode(candidateValue),providerPostcode=resolved.postalCode??postcode(resolved.address);
    if(sourcePostcode&&providerPostcode&&sourcePostcode!==providerPostcode)return {match:false,houseNumberMatch:false,contradiction:true};
    candidateValue=candidateValue===null?null:belgianStreetSpelling(candidateValue,resolved.countryCode);
    resolved={...resolved,address:resolved.address===null?null:belgianStreetSpelling(resolved.address,resolved.countryCode),
      street:resolved.street?belgianStreetSpelling(resolved.street,resolved.countryCode):resolved.street};
  }
  // Floors are checked independently by the decision layer. They may not
  // become house numbers or hide a different block/building identifier.
  const numberedAddress=(value:string|null)=>value===null?null:addressComponents(value,resolved.countryCode)
    .filter(part=>japaneseFloor(part,resolved.countryCode)===null).join(', ');
  if(resolved.countryCode==='JP')candidateValue=numberedAddress(candidateValue);
  const fallback = addressAgreement(candidateValue,resolved.countryCode==='JP'?numberedAddress(resolved.address):resolved.address);
  if (!candidateValue || !resolved.street || !resolved.houseNumber) return fallback;
  // Some GB records place an explicit ground-floor qualifier in housenumber.
  // Compare it separately only when the source asserts that same floor. Keep
  // the raw provider field intact and require the entire numbered street.
  const groundFloorNumber = resolved.countryCode === 'GB'
    ? resolved.houseNumber.trim().match(/^(?:ground\s+floor|gf)\s+(\d{1,6}[a-z]?)$/iu)?.[1].toLowerCase()
    : undefined;
  if (groundFloorNumber) {
    const sourceAddress = candidateValue.trim().match(/^(?:ground\s+floor|gf)(?:\s*,\s*|\s+)(.+)$/iu)?.[1];
    const segments = sourceAddress?.split(',').map(value => value.trim()) ?? [];
    const sourceNumber = sourceAddress ? likelyHouseNumber(sourceAddress) : null;
    const street = normalizeAddress(resolved.street);
    const completeStreet = segments.length > 0 &&
      [`${groundFloorNumber} ${street}`, `${street} ${groundFloorNumber}`].includes(normalizeAddress(segments[0]));
    // Only independently asserted locality components may follow the street.
    // A second floor, flat, block or unknown qualifier cannot be dropped.
    const localities = [resolved.city, resolved.region, resolved.country, ...(resolved.localityNames ?? [])]
      .filter((value): value is string => Boolean(value)).map(normalizeAddress);
    const localityOnly = segments.slice(1).every(segment => {
      const withoutPostcode = segment.replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/giu, '').trim();
      return !withoutPostcode || localities.includes(normalizeAddress(withoutPostcode));
    });
    const houseNumberMatch = sourceNumber === groundFloorNumber;
    const match = houseNumberMatch && completeStreet && localityOnly;
    return {match, houseNumberMatch, contradiction: !match};
  }
  const houseNumber = likelyHouseNumber(candidateValue);
  if (!houseNumber) return fallback;
  // Rejoin a detached number with its street, then drop only the provider's own
  // postcode (and locality) when the source wrote them after the street without
  // a separator. A different postcode or locality stays and fails the comparison.
  const sourceParts = candidateValue.split(",");
  const postcode = resolved.postalCode ? normalizeAddress(resolved.postalCode) : null;
  // A street followed only by that postcode carries no house number at all.
  if (postcode && houseNumber === postcode) return { match: false, houseNumberMatch: false, contradiction: false };
  const localities = [resolved.city, ...(resolved.localityNames ?? [])]
    .filter((value): value is string => Boolean(value)).map(normalizeAddress);
  const tails = postcode ? [` ${postcode}`, ...localities.map(locality => ` ${postcode} ${locality}`)] : [];
  const segments = (detachedHouseNumber(sourceParts)
    ? [`${sourceParts[0]} ${sourceParts[1]}`, ...sourceParts.slice(2)] : sourceParts).map(normalizeAddress).map(segment => {
      const tail = tails.find(value => segment.endsWith(value));
      const street = tail ? segment.slice(0, -tail.length) : segment;
      return /\d/u.test(street) ? street : segment;
    });
  const parts = resolved.street.split(/\s+[-–—/]\s+/u).map(normalizeAddress);
  // Belgian bilingual labels each contain a complete street designation;
  // a separator followed by a direction, extension or unit is not an alias.
  const completeStreet = /(?:^(?:rue|avenue|chaussee|boulevard|place|square|quai|impasse|allee|route|chemin)\s+\S)|(?:\S(?:straat|laan|steenweg|plein|kaai|dreef|weg)$)/u;
  const bilingual = resolved.countryCode==='BE' && parts.length===2 && parts.every(part=>completeStreet.test(part));
  const streets = bilingual ? parts : [normalizeAddress(resolved.street)];
  const number = normalizeAddress(resolved.houseNumber);
  // A provider street can itself start with a suffix word ("5 Ter Platen");
  // the complete numbered street below still has to agree in that case.
  const exactNumber = [houseNumber, houseNumber.replace(new RegExp(`${HOUSE_NUMBER_SUFFIX}$`,'u'), '')]
    .includes(compactHouseNumber(resolved.houseNumber));
  const streetAndNumber = streets.flatMap(street=>[`${number} ${street}`, `${street} ${number}`])
    .some(value => segments.includes(normalizeAddress(value)));
  return {match: exactNumber && streetAndNumber, houseNumberMatch: exactNumber,
    contradiction: !exactNumber || !streetAndNumber};
}

// A conservative display radius around the provider's own representative point.
// This is an approximate enclosing zone, not a political boundary or an address.
function countryRadius(resolved:ResolvedPlaceCandidate):number|null {
  const b=resolved.providerBounds;
  if(!b || ![b.lon1,b.lon2,resolved.longitude].every(x=>Number.isFinite(x)&&Math.abs(x)<=180) ||
    ![b.lat1,b.lat2,resolved.latitude].every(x=>Number.isFinite(x)&&Math.abs(x)<=90) || b.lat1>b.lat2)return null;
  const latitudeSpan=Math.max(Math.abs(resolved.latitude-b.lat1),Math.abs(resolved.latitude-b.lat2));
  const width=(b.lon2-b.lon1+360)%360 || (b.lon1===b.lon2?0:360);
  const center=b.lon1+width/2;
  const centerDistance=Math.abs(((resolved.longitude-center+540)%360)-180);
  const longitudeSpan=Math.min(180,centerDistance+width/2);
  return Math.max(1000,Math.ceil(Math.min(180,latitudeSpan+longitudeSpan)*Math.PI/180*6_371_000));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function explicitlyNamesCity(candidate: ScoringInput['candidate']): boolean {
  if (!['voyage', 'city'].includes(candidate.category) || candidate.address || !candidate.name || !candidate.city) return false;
  if(normalizedEquals(candidate.name,candidate.city))return true;
  const name = foldForSearch(candidate.name)
    .replace(/^(?:ville de|village de|city of|village of)\s+/u, '')
    .replace(/\s+(?:ville|city|village)$/u, '');
  return name === foldForSearch(candidate.city);
}

function normalizedEntityName(value: string): string {
  return foldForSearch(value)
    .replace(/[-’‘`']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Provider classes that describe a destination itself, as opposed to a shop,
// a service or a lodging that merely carries a destination's name.
const SIGHT_CLASSES=['tourism','heritage','leisure','natural','national_park','entertainment','man_made','beach','religion'];
const SERVICE_CLASSES=['commercial','catering','accommodation','rental','parking','healthcare','service','office','education','childcare','pet','public_transport','production','camping'];
const providerClasses=(resolved:ResolvedPlaceCandidate)=>(resolved.category??'').split(';').map(value=>value.split('.')[0]).filter(Boolean);
export const isSightResult=(resolved:ResolvedPlaceCandidate)=>providerClasses(resolved).some(value=>SIGHT_CLASSES.includes(value));
export const isServiceResult=(resolved:ResolvedPlaceCandidate)=>{const classes=providerClasses(resolved);return classes.length>0&&classes.every(value=>SERVICE_CLASSES.includes(value));};
export const isNamedSight=(candidate:Pick<PlaceCandidate,'category'|'address'|'name'>)=>candidate.category==='voyage'&&!candidate.address&&Boolean(candidate.name?.trim());

// A sight is often catalogued with a qualifier the source omits ("Walibi
// Belgium", "Bellewaerde Park") or in another word order ("Citadel of Dinant").
// Every extra word must come from the provider's own country, city or class;
// a different distinctive word is still a different entity.
export function sightNameAgrees(name:string,provider:string,resolved:ResolvedPlaceCandidate):boolean {
  const particles=new Set(['of','the','de','du','des','la','le','van','der','di']);
  const tokens=(value:string)=>normalizedEntityName(value).split(' ').filter(word=>word&&!particles.has(word));
  const source=tokens(name),entity=tokens(provider);
  if(!source.length||source.join('').length<4||entity.length<source.length)return false;
  const rest=[...entity];
  for(const word of source){const index=rest.indexOf(word);if(index<0)return false;rest.splice(index,1);}
  if(!rest.length)return source.length>1&&!isServiceResult(resolved);
  const qualifiers=new Set([resolved.country,resolved.city,...(resolved.category??'').split(/[.;_]/u)]
    .flatMap(value=>value?tokens(value):[]));
  return isSightResult(resolved)&&rest.every(word=>qualifiers.has(word));
}

export function entityNamesAgree(left: string, right: string): boolean {
  const a = normalizedEntityName(left), b = normalizedEntityName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // Compact account spellings must preserve the entire name, not a fuzzy prefix.
  if(!/\s/u.test(left)&&a.replace(/ /g,'').length>=8&&a.replace(/ /g,'')===b.replace(/ /g,''))return true;
  const descriptors:Record<string,string>={restaurant:'restaurant',pizzeria:'restaurant',gallery:'gallery',galerie:'gallery',hotel:'hotel',plage:'beach',
    cafe:'cafe',coffee:'cafe',bakery:'bakery',bakehouse:'bakery',boulangerie:'bakery',patisserie:'bakery'};
  const cuisines=new Set(['italian','french','japanese','korean','chinese','indian']);
  const parts=(name:string)=>{
    const words=name.split(' '),types=new Set<string>(),modifiers=new Set<string>();
    if(words.length>1&&descriptors[words[0]])types.add(descriptors[words.shift()!]);
    if(words.length>1&&descriptors[words.at(-1)!])types.add(descriptors[words.pop()!]);
    if(types.size&&words.length>1&&cuisines.has(words.at(-1)!))modifiers.add(words.pop()!);
    return {core:words.join(' '),types,modifiers};
  };
  const x=parts(a),y=parts(b);
  // Only omit generic descriptors. Keep the full distinctive name and reject
  // incompatible explicit types, even at the same address or in the same city.
  if(x.types.size>1||y.types.size>1||[...x.types].some(type=>y.types.size&&!y.types.has(type)))return false;
  if([...x.modifiers].some(value=>y.modifiers.size&&!y.modifiers.has(value)))return false;
  return x.core.length>=3&&x.core===y.core&&!descriptors[x.core];
}

export function scoreResolvedCandidate({ candidate, resolved }: ScoringInput): ScoredResolution {
  const reasons: string[] = [];
  if(resolved.category?.startsWith('public_transport')&&
    (['restaurant','cafe','patisserie','lodging'].includes(candidate.category)||
      !/\b(?:station|gare|metro|métro|bus|tram|pier|quai|ferry|terminal|airport|aéroport|aeroport)\b/iu.test(candidate.name??''))){
    return {confidence:0,precision:'UNKNOWN',approximationRadiusMeters:null,reasons:['provider_entity_type_contradiction']};
  }
  const populatedArea=resolved.category==='populated_place'&&resolved.providerResultType!=='country';
  const geographicRadius=populatedArea&&['voyage','city'].includes(candidate.category)&&!candidate.address
    ?countryRadius(resolved):null;
  if(populatedArea&&geographicRadius===null)return {confidence:0,precision:'UNKNOWN',approximationRadiusMeters:null,reasons:['provider_area_bounds_missing']};
  const resultKind:ResultKind=geographicRadius!==null?{kind:'area',radius:geographicRadius}:classifyResultType(resolved.providerResultType);

  // Match the entity itself, never a city embedded in its formatted address or
  // a different entity with a longer name (for example a park's motorway stop).
  const entityName = resolved.providerName ?? resolved.displayName.split(',')[0];
  const entityNames=[entityName,...(resolved.providerNameAliases??[])];
  const address = providerAddressAgreement(candidate.address, resolved);
  // A destination's own translated name can establish its area identity even
  // when the provider reports a containing municipality under `city`.
  const namesDestinationArea=resultKind.kind==='area'&&explicitlyNamesCity(candidate)&&
    entityNames.some(name=>normalizedEntityName(candidate.name!)===normalizedEntityName(name));
  const directCity=candidate.city&&verifiedAdministrativeCityNames(resolved).some(name=>normalizedEquals(candidate.city!,name))
    ?{match:1,contradiction:false}:cityAgreement(candidate.city,resolved.city,resolved.countryCode);
  const sourceMunicipality=belgianMunicipalityAliases(resolved.countryCode,candidate.city);
  const providerMunicipality=belgianMunicipalityAliases(resolved.countryCode,resolved.city);
  const broadBrussels=sourceMunicipality[0]==='Brussels';
  const parentLabels=brusselsMunicipalityParentLabels(resolved.countryCode,resolved.region,resolved.city,resolved.subdivisionCode);
  // A broad Brussels mention can include a proved constituent municipality.
  // An explicit different commune cannot borrow a parent's postal alias.
  const belgianConflict=sourceMunicipality.length>0&&providerMunicipality.length>0&&!broadBrussels&&!directCity.match;
  const parentRequired=broadBrussels&&!directCity.match;
  const city = belgianConflict?directCity:parentRequired
    ?parentLabels.length?{match:1,contradiction:false}:directCity
    :namesDestinationArea||resolved.localityNames?.some(value => cityAgreement(candidate.city,value,resolved.countryCode).match)
      ?{match:1,contradiction:false}:directCity;
  let contextualName = candidate.name;
  if (contextualName && candidate.city && city.match && address.match) {
    const suffix = ` ${normalizedEntityName(candidate.city)}`;
    const normalized = normalizedEntityName(contextualName);
    if (normalized.endsWith(suffix)) contextualName = normalized.slice(0,-suffix.length);
  }
  const literalName =
    candidate.name && entityNames.some(name=>entityNamesAgree(candidate.name!, name) ||
      (contextualName && contextualName !== candidate.name && entityNamesAgree(contextualName, name)));
  const qualifiedSight=!literalName&&isNamedSight(candidate)&&resultKind.kind==='specific'&&
    entityNames.some(name=>sightNameAgrees(candidate.name!,name,resolved));
  const nameMatch = literalName || qualifiedSight ? 1 : 0;
  if (nameMatch) reasons.push("name_match");
  if (qualifiedSight) reasons.push('provider_name_qualified');
  if(nameMatch&&candidate.name&&!entityNamesAgree(candidate.name,entityName))reasons.push('provider_name_alias');

  const country = countryAgreement(candidate.country, resolved);
  const region = fieldAgreement(candidate.region, resolved.region);
  if (city.match) reasons.push("city_match");
  if (country.match) reasons.push("country_match");
  if (address.match) reasons.push("address_match");
  if (city.contradiction) reasons.push("city_contradiction");
  if (country.contradiction) reasons.push("country_contradiction");
  if (address.contradiction) reasons.push("address_contradiction");

  const contradictions =
    (city.contradiction ? 1 : 0) +
    (country.contradiction ? 1 : 0) +
    (address.contradiction ? 1 : 0);
  const base =
    SCORING_WEIGHTS.candidateConfidence * candidate.confidence +
    SCORING_WEIGHTS.nameMatch * nameMatch +
    SCORING_WEIGHTS.cityMatch * city.match +
    SCORING_WEIGHTS.countryMatch * country.match +
    SCORING_WEIGHTS.regionMatch * region.match;
  const addressVerifiedBase =
    address.match && resolved.providerRank !== null
      ? Math.max(base, resolved.providerRank)
      : base;
  const confidence = round4(clamp01(addressVerifiedBase - CONTRADICTION_PENALTY * contradictions));

  const providerMatchType = (resolved.providerMatchType ?? "").trim().toLowerCase();
  const providerMatchTypeAccepted =
    ADDRESS_LEVEL_MATCH_TYPES.has(providerMatchType) ||
    (providerMatchType === "inner_part" &&
      resolved.providerRank !== null &&
      resolved.providerRank >= ADDRESS_PROVIDER_INNER_PART_EXACT_THRESHOLD);
  const strongAddressMatch =
    address.match &&
    address.houseNumberMatch &&
    resolved.providerRank !== null &&
    resolved.providerRank >= ADDRESS_PROVIDER_EXACT_THRESHOLD &&
    providerMatchTypeAccepted;
  if (strongAddressMatch) reasons.push("address_provider_verified");

  // Text agreement cannot verify a POI/address that the provider itself gives
  // zero confidence, such as a homonymous street returned for a named park.
  if (resultKind.kind === 'specific' && resolved.providerRank === 0) {
    const structuredIdentity=['amenity','poi','tourism'].includes(resolved.providerResultType??'')&&
      candidate.name&&resolved.providerName&&normalizedEntityName(candidate.name)===normalizedEntityName(resolved.providerName)&&
      resolved.street&&resolved.houseNumber&&address.match&&address.houseNumberMatch&&city.match&&country.match&&
      providerMatchType==='full_match'&&resolved.providerStreetConfidence!==0&&resolved.providerBuildingConfidence!==0;
    if(structuredIdentity)reasons.push('structured_identity_despite_query_confidence');
    else{
      reasons.push('provider_zero_confidence');
      return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
    }
  }

  // A verified street address does not establish that its named occupant is
  // the business in the source. Old tenants are common in provider datasets.
  if (resultKind.kind === 'specific' && candidate.name && !candidate.name.startsWith('@') &&
    resolved.providerName && nameMatch === 0) {
    reasons.push('provider_entity_name_unverified');
    return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
  }

  // A destination city cannot become a station or shop sharing the city name.
  if (resultKind.kind === 'specific' && explicitlyNamesCity(candidate)) {
    reasons.push('city_candidate_requires_area');
    return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
  }

  if (resultKind.kind === "country") {
    const radius=countryRadius(resolved);
    if(candidate.category==='voyage'&&!candidate.address&&!candidate.city&&!candidate.region&&
      (candidate.name||candidate.country)&&(!candidate.name||countryAgreement(candidate.name,resolved).match)&&
      (!candidate.country||country.match)&&resolved.providerRank===1&&providerMatchType==='full_match'&&radius!==null){
      reasons.push('named_country_destination');
      return {confidence,precision:'APPROXIMATE',approximationRadiusMeters:radius,reasons};
    }
    reasons.push("country_only");
    return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
  }
  if (resultKind.kind === "unknown") {
    reasons.push("unresolvable_result_type");
    return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
  }

  if (resultKind.kind === "specific") {
    if (
      confidence >= PRECISION_THRESHOLDS.EXACT &&
      contradictions === 0 &&
      (nameMatch === 1 || strongAddressMatch)
    ) {
      reasons.push("exact_specific_match");
      return { confidence, precision: "EXACT", approximationRadiusMeters: null, reasons };
    }
    if (confidence >= PRECISION_THRESHOLDS.PROBABLE) {
      reasons.push("probable_specific_match");
      return { confidence, precision: "PROBABLE", approximationRadiusMeters: null, reasons };
    }
    reasons.push("below_probable_threshold");
    return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
  }

  // An area can locate itself, but its city/region label cannot verify that a
  // named business or monument lies inside the area's fixed uncertainty radius.
  // In particular, unrelated businesses must not collapse into one city record.
  const namesArea = (candidate.name && entityNames.some(name=>normalizedEntityName(candidate.name!) === normalizedEntityName(name))) ||
    (explicitlyNamesCity(candidate) && cityAgreement(candidate.city, entityName, resolved.countryCode).match === 1);
  const businessCategory = ['restaurant', 'cafe', 'patisserie', 'lodging'].includes(candidate.category);
  if (candidate.address || (candidate.name && (!namesArea || businessCategory))) {
    reasons.push('specific_candidate_area_unverified');
    return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
  }

  // Area kind.
  if (!nameMatch && !cityAgreement(candidate.city, entityName, resolved.countryCode).match &&
    !fieldAgreement(candidate.region, entityName).match) {
    reasons.push('area_identity_unverified');
    return { confidence, precision: 'UNKNOWN', approximationRadiusMeters: null, reasons };
  }
  if(geographicRadius!==null&&namesArea){
    reasons.push('provider_geographic_area');
    return {confidence,precision:'APPROXIMATE',approximationRadiusMeters:geographicRadius,reasons};
  }
  if (confidence >= PRECISION_THRESHOLDS.APPROXIMATE) {
    reasons.push("approximate_area_match");
    return { confidence, precision: "APPROXIMATE", approximationRadiusMeters: resultKind.radius, reasons };
  }
  reasons.push("below_approximate_threshold");
  return { confidence, precision: "UNKNOWN", approximationRadiusMeters: null, reasons };
}
