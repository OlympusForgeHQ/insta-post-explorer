import { entityNamesAgree, scoreResolvedCandidate, type ScoringInput, type ScoredResolution } from '@/lib/places/scoring';
import {foldForSearch} from '@/lib/import/normalize';
import {addressComponents,administrativeRegionMatches,japaneseFloor} from '@/lib/places/administrative-context';

export const RESOLUTION_POLICY_VERSION = 'provider-context-v8';
export const PLACE_CONTEXT_RULES = `Infer missing country, city or region from the combined post context and geographic knowledge when the identity is coherent. These fields need not appear literally in the post. Mark deduced fields in inferredFields and retain the original source excerpts unchanged. Do not override explicit contradictory context or invent a branch address. Split distinct branch addresses into separate candidates. A chain account alone does not identify a branch. Never output coordinates or provider IDs. Before declaring a venue name unknown, review visible branding/signage and ordinary-sounding phrases in speech that could be a business name. Treat such a phrase only as a tentative identity when independent source context corroborates that role; generic praise alone never establishes branding. Keep verbatim evidence and let the geographic provider verify identity.
For locationScope, inspect the FULL caption, all OCR, audio, Instagram location and other supplied context at fusion. CITY is only for a generic recommendation of a named business in an explicitly named city with no address, neighborhood, street, station, landmark, branch qualifier or other narrower discriminator anywhere in the recommendation. The owner wants every independently verified shop in that city for this generic case. A chain account alone, missing address or inferred city does not prove CITY. Record SPECIFIC if any narrower context exists, even when address is null; otherwise UNKNOWN. Bind evidenceIndex to existing literal evidence. Retain narrower context in evidence; never shorten it away to obtain CITY. The generic CITY path requires a CAPTION proof covering the complete literal caption, with the city mentioned separately from the business/account name. A city embedded only in an account or hashtag never proves city scope. Extra caption wording or narrower Instagram location remains conservative. Do not invent branches or enumerate addresses: the server verifies actual branches. Preserve existing explicit multiple-location recommendations.`;

function addressUnitsCorroborated(source:string|null,provider:string|null,countryCode:string|null):boolean {
  // A numbered street does not corroborate an explicit unit. Only standalone
  // address components with numeric/alphabetic identifiers participate; street
  // and business names such as "Flat Rock Road" or "Unit 2 Cafe" do not.
  const unit=/^(unit|suite|flat|apartment|apt\.?)\s+(?:#\s*)?([0-9]+\s[a-z]|[a-z0-9]+(?:[-/][a-z0-9]+)*)$/iu;
  const key=(match:RegExpMatchArray)=>`${foldForSearch(match[1]).replace(/\.$/u,'')}:${foldForSearch(match[2])}`;
  const units=(address:string|null)=>addressComponents(address,countryCode).flatMap(component=>{
    const japanese=japaneseFloor(component,countryCode);
    if(japanese!==null)return [`floor:${japanese}`];
    const match=component.trim().match(unit);
    if(match)return [key(match)];
    // Explicit numbered interior levels carry the same location constraint as
    // a unit. Keep the separately verified GB ground-floor address rule intact.
    const floor=component.trim().match(/^(?:(first|second|third|\d+(?:st|nd|rd|th)?)\s+floor|(?:floor|level)\s+(\d+))$/iu);
    if(!floor)return [];
    const level=(floor[1]??floor[2]).toLowerCase().replace(/^(first|second|third)$/u,value=>({first:'1',second:'2',third:'3'})[value]!)
      .replace(/(\d+)(?:st|nd|rd|th)$/u,'$1');
    return [`floor:${level}`];
  });
  const supplied=new Set(units(provider));
  return units(source).every(identifier=>supplied.has(identifier));
}

// The legacy comparison layer provides normalized agreements and conflicts.
// Its weighted confidence is diagnostic only: acceptance follows identity rules.
export function decidePlaceResolution(input: ScoringInput): ScoredResolution {
  if (input.resolved.webResearch) return decideResearchedAddress(input);
  return decideSourceResolution(input);
}

function researchedStreetSpelling(value:string|null|undefined,countryCode:string|null):string|null|undefined {
  if(!value||countryCode!=='US')return value;
  const ordinals:Record<string,string>={first:'1st',second:'2nd',third:'3rd',fourth:'4th',fifth:'5th',
    sixth:'6th',seventh:'7th',eighth:'8th',ninth:'9th',tenth:'10th'};
  return value.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?=\s+(?:avenue|ave|street|st|road|rd|boulevard|blvd)\b)/giu,
    word=>ordinals[word.toLowerCase()]);
}

function decideResearchedAddress(input: ScoringInput): ScoredResolution {
  // Compare equivalent street spellings only in a transient copy. Raw provider
  // addresses, web excerpts and Instagram evidence remain unchanged.
  const spell=(value:string|null|undefined)=>researchedStreetSpelling(value,input.resolved.countryCode);
  const candidate={...input.candidate,address:spell(input.candidate.address)??null};
  const resolved={...input.resolved,address:spell(input.resolved.address)??null,street:spell(input.resolved.street)};
  const research=resolved.webResearch!;
  const original=scoreResolvedCandidate({candidate,resolved});
  const reject=(reason:string):ScoredResolution=>({precision:'UNKNOWN',confidence:0,approximationRadiusMeters:null,
    reasons:[...original.reasons,reason,RESOLUTION_POLICY_VERSION]});
  // Research is a separate server-validated source. It can supply a missing
  // address, but cannot replace the post's identity or contradictory geography.
  if (resolved.provider!=='geoapify' || !candidate.name ||
    !(entityNamesAgree(candidate.name,research.name)||entityNamesAgree(research.name,candidate.name)) ||
    !research.streetAddress.trim() || !research.city.trim() || !research.country.trim() || research.sources.length<2) {
    return reject('web_identity_unverified');
  }
  if (original.reasons.some(reason=>reason.endsWith('_contradiction')) ||
    (candidate.city&&!original.reasons.includes('city_match')) ||
    (candidate.country&&!original.reasons.includes('country_match')) ||
    (candidate.address&&!original.reasons.includes('address_match')) ||
    (candidate.region&&!candidate.inferredFields?.includes('region')&&!administrativeRegionMatches(candidate.region,resolved)) ||
    !addressUnitsCorroborated(candidate.address,resolved.address,resolved.countryCode)) return reject('web_source_context_conflict');
  if (!['building','house','housenumber','amenity','poi','tourism','leisure'].includes(resolved.providerResultType??'')) {
    return reject('web_address_building_unverified');
  }
  if (resolved.providerName===undefined || resolved.providerStreetConfidence===0 || resolved.providerBuildingConfidence===0 ||
    (resolved.providerName!==null && ![resolved.providerName,...(resolved.providerNameAliases??[])].some(name=>
      entityNamesAgree(research.name,name)||entityNamesAgree(name,research.name)))) return reject('web_provider_identity_unverified');
  const postcode=(value:string)=>foldForSearch(value).replace(/[\s-]/gu,'');
  if (research.postalCode && (!resolved.postalCode || postcode(research.postalCode)!==postcode(resolved.postalCode))) {
    return reject('web_postcode_unverified');
  }
  // This internal comparison never changes candidate evidence or persists a
  // researched address as though it were supplied by the original post.
  const checked=decideSourceResolution({candidate:{...candidate,address:spell(research.streetAddress)!,
    city:research.city,country:research.country},resolved});
  if (checked.precision!=='EXACT' || !checked.reasons.includes('verified_street_address') ||
    !checked.reasons.includes('city_match') || !checked.reasons.includes('country_match')) {
    return {...checked,precision:'UNKNOWN',confidence:0,approximationRadiusMeters:null,
      reasons:[...checked.reasons,'web_address_building_unverified']};
  }
  return {...checked,reasons:checked.reasons.map(reason=>reason==='verified_street_address'?'verified_web_address':reason)};
}

function decideSourceResolution(input: ScoringInput): ScoredResolution {
  const comparison = scoreResolvedCandidate(input);
  const reasons = comparison.reasons.filter(reason => ![
    'below_probable_threshold', 'below_approximate_threshold', 'exact_specific_match',
    'probable_specific_match', 'approximate_area_match',
  ].includes(reason));
  const has = (reason: string) => reasons.includes(reason);
  const outcome = (precision: ScoredResolution['precision'], reason: string): ScoredResolution => ({
    // Compatibility/display certainty is an outcome label, not an acceptance gate
    // or calibrated probability. Do not feed it back into later identity decisions.
    confidence: precision === 'EXACT' ? Math.max(.9,comparison.confidence)
      : precision === 'PROBABLE' ? Math.max(.75,Math.min(.89,comparison.confidence))
      : precision === 'APPROXIMATE' ? Math.max(.5,comparison.confidence) : 0,
    precision, approximationRadiusMeters: precision === 'APPROXIMATE' ? comparison.approximationRadiusMeters : null,
    reasons: [...new Set([...reasons, reason, RESOLUTION_POLICY_VERSION])],
  });
  if (reasons.some(reason => reason.endsWith('_contradiction') || [
    'provider_zero_confidence', 'provider_entity_name_unverified', 'city_candidate_requires_area',
    'provider_area_bounds_missing', 'country_only', 'unresolvable_result_type', 'specific_candidate_area_unverified', 'area_identity_unverified',
  ].includes(reason))) return outcome('UNKNOWN', 'identity_conflict_or_unverified');

  const {candidate, resolved} = input;
  if(candidate.address && resolved.address && !has('address_match'))return outcome('UNKNOWN','address_not_corroborated');
  if(candidate.region&&!candidate.inferredFields?.includes('region')&&!administrativeRegionMatches(candidate.region,resolved))return outcome('UNKNOWN','region_not_corroborated');
  if(!addressUnitsCorroborated(candidate.address,resolved.address,resolved.countryCode))return outcome('UNKNOWN','address_unit_unverified');
  if(has('named_country_destination'))return outcome('APPROXIMATE','named_country_destination');
  if(has('provider_geographic_area'))return outcome('APPROXIMATE','provider_geographic_area');
  const type = resolved.providerResultType ?? '';
  const poi = ['amenity', 'tourism', 'leisure', 'poi'].includes(type);
  const area = ['suburb','district','neighbourhood','quarter','city','town','village','municipality','locality','postcode','county','state','region','province'].includes(type);
  const locationAgreement = has('city_match') || has('country_match') || has('address_match');
  if (!candidate.country && resolved.country && (has('city_match') || has('address_match'))) {
    reasons.push('inferred_country_from_resolved_identity');
  }
  if (!candidate.city && resolved.city && has('address_match')) reasons.push('inferred_city_from_resolved_identity');
  if(has('structured_identity_despite_query_confidence'))return outcome('PROBABLE','structured_identity_despite_query_confidence');
  if (has('address_provider_verified')) return outcome('EXACT', 'verified_street_address');
  if (poi && has('name_match') && locationAgreement) {
    return outcome(has('city_match') && has('country_match') && !candidate.inferredFields?.length ? 'EXACT' : 'PROBABLE', 'venue_identity_and_context');
  }
  if (area && !['restaurant','cafe','patisserie','lodging'].includes(candidate.category)) {
    // Radius comes from the existing provider type mapping, independently of score.
    const radius = ['state','region','province'].includes(type) ? 150_000 : type === 'county' ? 50_000
      : ['suburb','district','neighbourhood','quarter'].includes(type) ? 5_000 : 10_000;
    return {...outcome('APPROXIMATE', 'named_destination_area'), approximationRadiusMeters: radius};
  }
  return outcome('UNKNOWN', 'insufficient_identity_context');
}
