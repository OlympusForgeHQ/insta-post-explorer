import { scoreResolvedCandidate, type ScoringInput, type ScoredResolution } from '@/lib/places/scoring';
import {foldForSearch} from '@/lib/import/normalize';

export const RESOLUTION_POLICY_VERSION = 'contextual-identity-v2';
export const PLACE_CONTEXT_RULES = `Infer missing country, city or region from the combined post context and geographic knowledge when the identity is coherent. These fields need not appear literally in the post. Mark deduced fields in inferredFields and retain the original source excerpts unchanged. Do not override explicit contradictory context or invent a branch address. Split distinct branch addresses into separate candidates. A chain account alone does not identify a branch. Never output coordinates or provider IDs.`;

// The legacy comparison layer provides normalized agreements and conflicts.
// Its weighted confidence is diagnostic only: acceptance follows identity rules.
export function decidePlaceResolution(input: ScoringInput): ScoredResolution {
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
    reasons: [...reasons, reason, RESOLUTION_POLICY_VERSION],
  });
  if (reasons.some(reason => reason.endsWith('_contradiction') || [
    'provider_zero_confidence', 'provider_entity_name_unverified', 'city_candidate_requires_area',
    'country_only', 'unresolvable_result_type', 'specific_candidate_area_unverified', 'area_identity_unverified',
  ].includes(reason))) return outcome('UNKNOWN', 'identity_conflict_or_unverified');

  const {candidate, resolved} = input;
  if(candidate.address && resolved.address && !has('address_match'))return outcome('UNKNOWN','address_not_corroborated');
  if(candidate.region && resolved.region && foldForSearch(candidate.region)!==foldForSearch(resolved.region))return outcome('UNKNOWN','region_not_corroborated');
  const type = resolved.providerResultType ?? '';
  const poi = ['amenity', 'tourism', 'leisure', 'poi'].includes(type);
  const area = ['suburb','district','neighbourhood','quarter','city','town','village','municipality','locality','postcode','county','state','region','province'].includes(type);
  const locationAgreement = has('city_match') || has('country_match') || has('address_match');
  if (!candidate.country && resolved.country && (has('city_match') || has('address_match'))) {
    reasons.push('inferred_country_from_resolved_identity');
  }
  if (!candidate.city && resolved.city && has('address_match')) reasons.push('inferred_city_from_resolved_identity');
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
