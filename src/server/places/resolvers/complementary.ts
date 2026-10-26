import 'server-only';
import {decidePlaceResolution} from '@/lib/places/resolution';
import {distanceMeters} from '@/lib/places/distance';
import {foldForSearch} from '@/lib/import/normalize';
import type {PlaceAddressResearch, PlaceResolutionInput, PlaceResolver} from './types';

export class ComplementaryPlaceResolver implements PlaceResolver {
  constructor(private readonly primary: PlaceResolver, private readonly geocoder: PlaceResolver,
    private readonly research: PlaceAddressResearch) {}

  async resolve(input: PlaceResolutionInput) {
    const {results: initial, hints} = this.primary.resolveWithHints
      ? await this.primary.resolveWithHints(input)
      : {results: await this.primary.resolve(input), hints: []};
    const specific = (resolved: (typeof initial)[number]) =>
      ['EXACT', 'PROBABLE'].includes(decidePlaceResolution({candidate: input.candidate, resolved}).precision);
    const candidate = input.candidate;
    if (initial.some(specific) || !candidate.name || !candidate.city || !candidate.country ||
      !['restaurant', 'cafe', 'patisserie', 'lodging', 'divers', 'voyage'].includes(candidate.category)) return initial;
    // Named travel venues may need address research; a city/country destination
    // itself belongs to the geographic-area path, never to a business lookup.
    if (candidate.category==='voyage' && !candidate.address &&
      [candidate.city,candidate.region,candidate.country].some(value=>value&&foldForSearch(value)===foldForSearch(candidate.name!))) return initial;
    try {
      const sites: typeof hints = [];
      for (const hint of hints) if (!sites.some(site => distanceMeters(site, hint) <= 100)) sites.push(hint);
      const addresses = await this.research.search({...input, minimumSites: Math.max(1, sites.length)});
      if (!addresses.length || addresses.length > 3) return initial;
      if (addresses.length < sites.length) return initial;
      const verified = [...initial];
      for (const webResearch of addresses) {
        // Address lookup is independent from the original source and from any
        // Google response. The original candidate remains immutable.
        const query = {...input, proximity: undefined, candidate: {...candidate, name: null,
          address: [webResearch.streetAddress, webResearch.postalCode].filter(Boolean).join(', '),
          region: candidate.inferredFields?.includes('region') && candidate.region &&
            foldForSearch(candidate.region)===foldForSearch(webResearch.city) ? null : candidate.region,
          city: webResearch.city, country: webResearch.country}};
        const matches = await this.geocoder.resolve(query);
        const qualified = matches.map(match => ({...match, webResearch})).filter(specific);
        const nearHint = (match: (typeof qualified)[number]) =>
          !sites.length || sites.some(site => distanceMeters(site, match) <= 100);
        let accepted = qualified.filter(nearHint);
        if (sites.length && !accepted.length) {
          // One neutral refinement may use only a structured district returned
          // for an independently verified building, never Google text/points or
          // a label guessed from the source, provider name or formatted address.
          // The broader retrieval fence selects context only; accepting the
          // independently geocoded result still requires the 100 m bound above.
          const anchor = qualified
            .filter(match => ['building','house','housenumber'].includes(match.providerResultType ?? ''))
            .map(match => ({match, distance: Math.min(...sites.map(site => distanceMeters(site, match)))}))
            .filter(item => item.distance <= 500)
            .sort((a, b) => a.distance - b.distance ||
              a.match.providerPlaceId.localeCompare(b.match.providerPlaceId))[0]?.match;
          const district = (anchor?.administrativeLabels?.suburb || anchor?.administrativeLabels?.district)?.trim();
          if (district && district.length <= 200 && ![webResearch.city, webResearch.country,
            ...query.candidate.address.split(',')].some(value => foldForSearch(value.trim()) === foldForSearch(district))) {
            const refined = await this.geocoder.resolve({...query, candidate: {...query.candidate,
              address: [webResearch.streetAddress, district, webResearch.postalCode].filter(Boolean).join(', ')}});
            accepted = refined.map(match => ({...match, webResearch})).filter(specific).filter(nearHint);
          }
        }
        // A postal homonym or provider ambiguity must not pick a random site.
        if (!accepted.length || accepted.some((a, index) =>
          accepted.slice(index + 1).some(b => distanceMeters(a, b) > 100))) return initial;
        for (const match of accepted) {
          if (!verified.some(item => item.providerPlaceId === match.providerPlaceId &&
            item.webResearch?.name === match.webResearch.name)) verified.push(match);
        }
      }
      // Every known site still requires independent corroboration within the
      // existing 100 m bound, including after a neutral district refinement.
      if (sites.some(site => !verified.some(match => match.webResearch && distanceMeters(site, match) <= 100))) return initial;
      return verified;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if(message==='PLACES_LEASE_LOST')throw error;
      const code = /^(?:WEB_SEARCH|GEOAPIFY)_[A-Z0-9_]{1,64}$/u.test(message) ? message : 'WEB_SEARCH_FAILED';
      console.warn(JSON.stringify({stage: 'places_complementary_research', code}));
      return initial;
    }
  }

  async resolveApproximate(input: PlaceResolutionInput) {
    return this.primary.resolveApproximate?.(input) ?? [];
  }
}
