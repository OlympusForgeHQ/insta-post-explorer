// @vitest-environment node
import {expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {ComplementaryPlaceResolver} from '@/server/places/resolvers/complementary';
import {FallbackPlaceResolver} from '@/server/places/resolvers/fallback';
import type {PlaceResolutionInput, ResearchedPlaceAddress, ResolvedPlaceCandidate} from '@/server/places/resolvers/types';
const input: PlaceResolutionInput = {sourceTheme: 'Restaurant', candidate: {
  name: 'Example Bakery', address: null, city: 'New York', region: null, country: 'United States',
  category: 'patisserie', confidence: .8, evidence: [{type: 'CAPTION', excerpt: 'Example Bakery in New York'}],
}};
const research: ResearchedPlaceAddress = {name: 'Example Bakery', streetAddress: '12 Example Street',
  city: 'New York', country: 'United States', postalCode: '10005',
  sources: [{url: 'https://paper.example/story', excerpt: 'Example Bakery, 12 Example Street, New York 10005'},
    {url: 'https://tourism.test/visit', excerpt: 'Example Bakery, 12 Example Street, New York 10005'}],
  researchedAt: '2026-10-20T00:00:00.000Z'};
const building: ResolvedPlaceCandidate = {provider: 'geoapify', providerPlaceId: 'independent-building',
  displayName: '12 Example Street', providerName: null, address: '12 Example Street, New York, NY 10005, United States',
  street: 'Example Street', houseNumber: '12', postalCode: '10005', city: 'New York', region: 'New York',
  country: 'United States', countryCode: 'US', latitude: 40.7, longitude: -74,
  providerResultType: 'building', providerRank: 1, providerMatchType: 'full_match',
  providerStreetConfidence: 1, providerBuildingConfidence: 1, category: null, attribution: 'Powered by Geoapify'};

it('retrieves a supported address independently without rewriting the source or inventing a provider business', async () => {
  const original = structuredClone(input);
  const geocoded: PlaceResolutionInput[] = [];
  const resolver = new ComplementaryPlaceResolver({resolve: async () => []},
    {resolve: async query => {geocoded.push(query); return [building];}}, {search: async () => [research]});
  expect(await resolver.resolve(input)).toEqual([{...building, webResearch: research}]);
  expect(geocoded).toHaveLength(1);
  expect(geocoded[0].candidate).toMatchObject({name: null, address: '12 Example Street, 10005'});
  expect(input).toEqual(original);
});

it('does not research an already verified venue or an unnamed destination', async () => {
  const search = vi.fn(async () => [research]);
  const venue = {...building, providerName: 'Example Bakery', displayName: 'Example Bakery', providerResultType: 'amenity'};
  const resolver = new ComplementaryPlaceResolver({resolve: async () => [venue]},
    {resolve: async () => []}, {search});
  expect(await resolver.resolve(input)).toEqual([venue]);
  await new ComplementaryPlaceResolver({resolve: async () => []},
    {resolve: async () => []}, {search}).resolve({...input, candidate: {...input.candidate, name: null}});
  expect(search).not.toHaveBeenCalled();
});

it('rejects postal homonyms and keeps fallback available after a failed research request', async () => {
  const other = {...building, providerPlaceId: 'other-borough', postalCode: '11221',
    address: '12 Example Street, New York, NY 11221, United States'};
  const resolver = new ComplementaryPlaceResolver({resolve: async () => [], resolveApproximate: async () => [building]},
    {resolve: async () => [other]}, {search: async () => [research]});
  expect(await resolver.resolve(input)).toEqual([]);
  const failed = new ComplementaryPlaceResolver({resolve: async () => [], resolveApproximate: async () => [building]},
    {resolve: async () => []}, {search: async () => {throw Error('secret response body');}});
  expect(await failed.resolve(input)).toEqual([]);
  expect(await failed.resolveApproximate(input)).toEqual([building]);
});

it('keeps a known second site ambiguous when web results only corroborate one branch', async () => {
  const resolver = new ComplementaryPlaceResolver({
    resolve: async () => [],
    resolveWithHints: async () => ({results: [], hints: [
      {latitude: building.latitude, longitude: building.longitude},
      {latitude: 40.77, longitude: -73.95},
    ]}),
  }, {resolve: async () => [building]}, {search: async () => [research]});
  expect(await resolver.resolve(input)).toEqual([]);
});

it('continues complementary research when optional Google hints are unavailable', async () => {
  const primary = new FallbackPlaceResolver({resolve: async () => []},
    {searchHints: async () => {throw Error('GOOGLE_MONTHLY_CAP_REACHED');}});
  const resolver = new ComplementaryPlaceResolver(primary, {resolve: async () => [building]},
    {search: async () => [research]});
  expect(await resolver.resolve(input)).toEqual([{...building, webResearch: research}]);
});

it('uses location-only hints to disambiguate geocoded street homonyms without borrowing their coordinates', async () => {
  const withoutPostcode={...research,postalCode:null};
  const other={...building,providerPlaceId:'different-borough',latitude:40.78,postalCode:'11221'};
  const resolver=new ComplementaryPlaceResolver({
    resolve:async()=>[],
    resolveWithHints:async()=>({results:[],hints:[{latitude:building.latitude+.001,longitude:building.longitude}]}),
  },{resolve:async()=>[other,building]},{search:async()=>[withoutPostcode]});
  expect(await resolver.resolve(input)).toEqual([{...building,webResearch:withoutPostcode}]);
});
