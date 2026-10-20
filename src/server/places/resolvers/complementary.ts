import 'server-only';
import {decidePlaceResolution} from '@/lib/places/resolution';
import {distanceMeters} from '@/lib/places/distance';
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
      !['restaurant', 'cafe', 'patisserie', 'lodging', 'divers'].includes(candidate.category)) return initial;
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
        const matches = await this.geocoder.resolve({...input, candidate: {...candidate, name: null,
          address: [webResearch.streetAddress, webResearch.postalCode].filter(Boolean).join(', '),
          city: webResearch.city, country: webResearch.country}});
        const accepted = matches.map(match => ({...match, webResearch})).filter(specific)
          .filter(match=>!sites.length||sites.some(site=>distanceMeters(site,match)<=500));
        // A postal homonym or provider ambiguity must not pick a random site.
        if (!accepted.length || accepted.some((a, index) =>
          accepted.slice(index + 1).some(b => distanceMeters(a, b) > 100))) return initial;
        for (const match of accepted) {
          if (!verified.some(item => item.providerPlaceId === match.providerPlaceId &&
            item.webResearch?.name === match.webResearch.name)) verified.push(match);
        }
      }
      // Independent geocoding can differ by a building/entrance offset, but
      // cannot silently resolve another borough or omit a known distinct site.
      if (sites.some(site => !verified.some(match => match.webResearch && distanceMeters(site, match) <= 500))) return initial;
      return verified;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^(?:WEB_SEARCH|GEOAPIFY)_[A-Z0-9_]{1,64}$/u.test(message) ? message : 'WEB_SEARCH_FAILED';
      console.warn(JSON.stringify({stage: 'places_complementary_research', code}));
      return initial;
    }
  }

  async resolveApproximate(input: PlaceResolutionInput) {
    return this.primary.resolveApproximate?.(input) ?? [];
  }
}
