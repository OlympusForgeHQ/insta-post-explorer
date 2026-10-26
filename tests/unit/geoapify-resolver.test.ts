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
import {entityNamesAgree} from '@/lib/places/scoring';
import {decidePlaceResolution} from '@/lib/places/resolution';
import {selectContextualVenueArea} from '@/lib/places/approximate-resolution';

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

it('checks completion authority before each network retry and propagates its loss',async()=>{
 let admitted=true;let requests=0;
 const resolver=new GeoapifyPlaceResolver({apiKey:'test',baseUrl:'https://geo.test',
  beforeRequest:async()=>{if(!admitted)throw Error('PLACES_LEASE_LOST');},
  fetchImpl:async()=>{requests++;admitted=false;return new Response('',{status:503});},
  sleepImpl:async()=>{},maxAttempts:3});
 await expect(resolver.resolve(resolutionInput())).rejects.toThrow('PLACES_LEASE_LOST');
 expect(requests).toBe(1);
});

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
  it.each(['structured','native'] as const)('rechecks the same Japanese destination using a verified ward: %s',async(mode)=>{
    const candidate=restaurantCandidate({name:'Example Garden',category:'voyage',city:'Tokyo',country:'Japan'});
    const original=structuredClone(candidate);
    const hint={place_id:'same-garden',name:'Example Garden',other_names:{'name:ja':'見本庭園',alt_name:'見本の庭園'},
      city:'Chiyoda',country:'Japan',country_code:'jp',iso3166_2:'JP-13',lat:35.68,lon:139.75,
      result_type:'amenity',category:'leisure.park',rank:{confidence:0,match_type:'full_match'}};
    const urls:URL[]=[];
    const fetchMock=vi.fn<typeof fetch>(async input=>{
      const url=new URL(String(input));urls.push(url);
      if(url.pathname==='/v2/places')return jsonResponse({features:[]});
      const structured=url.searchParams.get('name')==='Example Garden'&&url.searchParams.get('city')==='Chiyoda';
      const native=url.searchParams.get('text')==='見本庭園, Chiyoda, Japan';
      if(structured&&mode==='structured'||native&&mode==='native')return jsonResponse({results:[{...hint,lat:35.6801,rank:{confidence:1,match_type:'full_match'}}]});
      return jsonResponse({results:url.searchParams.get('name')==='Example Garden'?[hint]:[]});
    });
    const results=await resolver(fetchMock).resolve({candidate,sourceTheme:'Voyages'});
    const verified=results.find(resolved=>decidePlaceResolution({candidate,resolved}).precision==='EXACT');
    expect(verified).toMatchObject({providerPlaceId:'same-garden',providerRank:1,latitude:35.6801,city:'Chiyoda',region:null});
    expect(results.find(result=>result.providerRank===0)).toMatchObject({providerPlaceId:'same-garden',latitude:35.68});
    expect(candidate).toEqual(original);
    expect(urls).toHaveLength(mode==='structured'?2:3);
    if(mode==='native')expect(urls[2].searchParams.get('lang')).toBe('en');
  });

  it.each(['different_id','different_ward','different_country','different_name','distant_coordinates','zero_confidence'] as const)(
    'keeps Japanese ward refinement bounded and rejects %s',async(scenario)=>{
      const candidate=restaurantCandidate({name:'Example Garden',category:'voyage',city:'Tokyo',country:'Japan'});
      const hint={place_id:'same-garden',name:'Example Garden',other_names:{'name:ja':'見本庭園',alt_name:'見本の庭園'},
        city:'Chiyoda',country:'Japan',country_code:'jp',iso3166_2:'JP-13',lat:35.68,lon:139.75,
        result_type:'amenity',category:'leisure.park',rank:{confidence:0,match_type:'full_match'}};
      const fresh={...hint,rank:{confidence:scenario==='zero_confidence'?0:1,match_type:'full_match'},
        ...(scenario==='different_id'?{place_id:'other-garden'}:{}),...(scenario==='different_ward'?{city:'Shinjuku'}:{}),
        ...(scenario==='different_country'?{country:'China',country_code:'cn'}:{}),
        ...(scenario==='different_name'?{name:'Different Garden',other_names:{}}:{}),
        ...(scenario==='distant_coordinates'?{lat:36.68}:{})};
      const refinements:URL[]=[];
      const fetchMock=vi.fn<typeof fetch>(async input=>{
        const url=new URL(String(input));
        if(url.pathname==='/v2/places')return jsonResponse({features:[]});
        if(url.searchParams.get('city')==='Chiyoda'||url.searchParams.get('text')?.includes('見本')){
          refinements.push(url);return jsonResponse({results:[fresh]});
        }
        return jsonResponse({results:url.searchParams.get('name')==='Example Garden'?[hint]:[]});
      });
      const results=await resolver(fetchMock).resolve({candidate,sourceTheme:'Voyages'});
      expect(results.every(resolved=>decidePlaceResolution({candidate,resolved}).precision==='UNKNOWN')).toBe(true);
      expect(refinements).toHaveLength(2);
      expect(refinements[1].searchParams.get('text')).toBe('見本庭園, Chiyoda, Japan');
      expect(results[0]).toMatchObject({providerPlaceId:'same-garden',providerRank:0,latitude:35.68});
    });

  it.each(['already_verified','conflicting_state','ambiguous_ward'] as const)('does not refine an unnecessary or unsupported Japanese ward: %s',async(scenario)=>{
    const candidate=restaurantCandidate({name:'Example Garden',category:'voyage',city:'Tokyo',country:'Japan'});
    const hint={place_id:'same-garden',name:'Example Garden',other_names:{'name:ja':'見本庭園'},
      city:'Chiyoda',state:scenario==='conflicting_state'?'Osaka':null,country:'Japan',country_code:'jp',iso3166_2:'JP-13',
      lat:35.68,lon:139.75,result_type:'amenity',category:'leisure.park',rank:{confidence:scenario==='already_verified'?1:0,match_type:'full_match'}};
    const urls:URL[]=[];
    const fetchMock=vi.fn<typeof fetch>(async input=>{
      const url=new URL(String(input));urls.push(url);
      return jsonResponse(url.pathname==='/v2/places'?{features:[]}:{results:[hint,
        ...(scenario==='ambiguous_ward'?[{...hint,place_id:'other-garden',city:'Shinjuku'}]:[])]});
    });
    await resolver(fetchMock).resolve({candidate,sourceTheme:'Voyages'});
    expect(urls.some(url=>['Chiyoda','Shinjuku'].includes(url.searchParams.get('city')??'')||url.searchParams.get('text')?.includes('見本'))).toBe(false);
    if(scenario==='already_verified')expect(urls).toHaveLength(1);
  });

  it.each([
    {city:'Shibuya',state:'Tokyo',countryCode:'jp',accepted:true},
    {city:'Chiyoda-ku',state:'Tokyo Metropolis',countryCode:'jp',accepted:true},
    {city:'Shibuya City',state:'Tokyo',countryCode:'jp',accepted:true},
    {city:'Shibuya',state:null,countryCode:'jp',accepted:false},
    {city:'Shibuya',state:'Osaka',countryCode:'jp',accepted:false},
    {city:'Shibuya',state:'Tokyo',countryCode:null,accepted:false},
    {city:'Shibuya',state:'Tokyo',countryCode:'us',accepted:false},
    {city:'Hachioji',state:'Tokyo',countryCode:'jp',accepted:false},
    {city:'Example Ward',state:'Tokyo',countryCode:'jp',accepted:false},
    {city:'Shibuya-shi',state:'Tokyo',countryCode:'jp',accepted:false},
  ])('uses verified Tokyo special-ward containment for $city / $state / $countryCode',async({city,state,countryCode,accepted})=>{
    const candidate=restaurantCandidate({name:'Example Garden',category:'voyage',city:'Tokyo',country:'Japan'});
    const original=structuredClone(candidate);
    const row={place_id:'ward-garden',name:'Example Garden',city,state,country:'Japan',country_code:countryCode,
      formatted:'Example Garden, Shibuya, Tokyo, Japan',lat:35.66,lon:139.70,result_type:'amenity',
      category:'leisure.park',rank:{confidence:1,match_type:'full_match'}};
    const fetchMock=vi.fn<typeof fetch>(async()=>jsonResponse({results:[row]}));
    const [match]=await resolver(fetchMock).resolve({candidate,sourceTheme:'Voyages'});
    const decision=decidePlaceResolution({candidate,resolved:match});
    expect(decision.precision).toBe(accepted?'EXACT':'UNKNOWN');
    expect(decision.reasons).toContain(accepted?'city_match':'city_contradiction');
    expect(match).toMatchObject({city,region:state,providerName:'Example Garden',address:row.formatted,latitude:35.66,longitude:139.70});
    expect(candidate).toEqual(original);
    expect(match.localityNames?.includes('Tokyo')).toBe(accepted);
    if(accepted){
      for(const source of [{...candidate,city:'Shinjuku'},{...candidate,name:'Different Garden'}]){
        expect(decidePlaceResolution({candidate:source,resolved:match}).precision).toBe('UNKNOWN');
      }
    }
  });

  it('keeps zero-confidence Tokyo ward hints unresolved until independent POI retrieval verifies their identity',async()=>{
    const candidate=restaurantCandidate({name:'Example Garden',category:'voyage',city:'Tokyo',country:'Japan'});
    const row={place_id:'ward-garden',name:'Example Garden',city:'Chiyoda',country:'Japan',country_code:'jp',iso3166_2:'JP-13',
      formatted:'Example Garden, Chiyoda, Japan',lat:35.68,lon:139.75,result_type:'amenity',
      category:'leisure.park',rank:{confidence:0,match_type:'full_match'}};
    for(const independent of [true,false]){
      const fetchMock=vi.fn<typeof fetch>(async input=>{
        const url=new URL(String(input));
        return url.pathname==='/v2/places'
          ?jsonResponse({features:independent?[{properties:{...row,rank:undefined,lat:35.6801}}]:[]})
          :jsonResponse({results:[row]});
      });
      const [match]=await resolver(fetchMock).resolve({candidate,sourceTheme:'Voyages'});
      expect(decidePlaceResolution({candidate,resolved:match}).precision).toBe(independent?'EXACT':'UNKNOWN');
      expect(match).toMatchObject({city:'Chiyoda',region:null,subdivisionCode:'JP-13',
        providerRank:independent?null:0,latitude:independent?35.6801:35.68});
      expect(match.administrativeLabels).toEqual({city:'Chiyoda'});
      expect(match.localityNames).toEqual(['Chiyoda','Tokyo']);
      expect(decidePlaceResolution({candidate:{...candidate,region:'Tokyo'},resolved:match}).precision).toBe(independent?'EXACT':'UNKNOWN');
      expect(decidePlaceResolution({candidate:{...candidate,region:'Osaka'},resolved:match}).precision).toBe('UNKNOWN');
      const poiUrl=new URL(String(fetchMock.mock.calls.find(([url])=>new URL(String(url)).pathname==='/v2/places')![0]));
      expect(poiUrl.searchParams.get('filter')).toBe('circle:139.75,35.68,200');
    }
  });

  it.each([
    {state:'Osaka',code:'JP-13',city:'Chiyoda',countryCode:'jp'},
    {state:'Tokyo',code:'JP-14',city:'Chiyoda',countryCode:'jp'},
    {state:null,code:'JP-13',city:'Chiyoda',countryCode:'cn'},
    {state:null,code:'JP-13',city:'Hachioji',countryCode:'jp'},
    {state:null,code:'JP-TK',city:'Chiyoda',countryCode:'jp'},
  ])('rejects unsupported or conflicting subdivision containment: $state / $code / $city / $countryCode',async({state,code,city,countryCode})=>{
    const candidate=restaurantCandidate({name:'Example Garden',category:'voyage',city:'Tokyo',country:'Japan'});
    const row={place_id:'ward-garden',name:'Example Garden',city,state,country:'Japan',country_code:countryCode,iso3166_2:code,
      lat:35.68,lon:139.75,result_type:'amenity',category:'leisure.park',rank:{confidence:1,match_type:'full_match'}};
    const fetchMock=vi.fn<typeof fetch>(async()=>jsonResponse({results:[row]}));
    const [match]=await resolver(fetchMock).resolve({candidate,sourceTheme:'Voyages'});
    expect(decidePlaceResolution({candidate,resolved:match}).precision).toBe('UNKNOWN');
    expect(match.localityNames).not.toContain('Tokyo');
  });

  it.each([['Chiyoda',true],['Hachioji',false]] as const)('does not treat the prefecture-wide Tokyo boundary as special-ward proof: %s',async(city,accepted)=>{
    const candidate=restaurantCandidate({name:'Example Garden',category:'voyage',city:'Tokyo',country:'Japan'});
    const area={place_id:'tokyo-prefecture-boundary',name:'Tokyo',city:'Tokyo',country:'Japan',country_code:'jp',iso3166_2:'JP-13',
      lat:35.67,lon:139.76,result_type:'city',category:'administrative',rank:{confidence:1,match_type:'full_match'},
      bbox:{lon1:135.85,lat1:20.21,lon2:154.20,lat2:35.89}};
    const poi={place_id:'example-garden',name:'Example Garden',city,country:'Japan',country_code:'jp',iso3166_2:'JP-13',
      lat:35.68,lon:139.75,categories:['leisure.park']};
    const fetchMock=vi.fn<typeof fetch>(async input=>{
      const url=new URL(String(input));
      return jsonResponse(url.pathname==='/v2/places'?{features:[{properties:poi}]}:
        {results:!url.searchParams.has('name')&&!url.searchParams.has('text')?[area]:[]});
    });
    const matches=await resolver(fetchMock).resolve({candidate,sourceTheme:'Voyages'});
    expect(matches.some(resolved=>decidePlaceResolution({candidate,resolved}).precision==='EXACT')).toBe(accepted);
    if(!accepted)expect(matches.some(match=>match.providerLocalityBoundary?.name==='Tokyo')).toBe(false);
  });

  it.each([['Chiyoda','jp',true],['Hachioji','jp',false],['Hachioji',null,false],['Chiyoda',null,false]] as const)(
    'requires structured containment for a Tokyo postal fragment: %s / %s',async(city,countryCode,accepted)=>{
    const candidate=restaurantCandidate({name:'Example Garden',category:'voyage',city:'Tokyo',country:'Japan'});
    const row={place_id:'postal-garden',name:'Example Garden',city,country:'Japan',country_code:countryCode,iso3166_2:'JP-13',
      street:'Example Street',address_line2:`1 Example Street, ${city}, Tokyo, Japan`,formatted:`Example Garden, 1 Example Street, ${city}, Tokyo, Japan`,
      lat:35.68,lon:139.75,result_type:'amenity',rank:{confidence:1,match_type:'full_match'}};
    const fetchMock=vi.fn<typeof fetch>(async()=>jsonResponse({results:[row]}));
    const [match]=await resolver(fetchMock).resolve({candidate,sourceTheme:'Voyages'});
    expect(decidePlaceResolution({candidate,resolved:match}).precision).toBe(accepted?'EXACT':'UNKNOWN');
    expect(match.localityNames?.includes('Tokyo')).toBe(accepted);
    expect(match.address).toBe(row.formatted);
  });

  it.each([
    ['Shanghai','Shanghai','CN',true],
    ['Beijing','北京市','CN',true],
    ['Tianjin','Tianjin','CN',true],
    ['Chongqing','Chongqing','CN',true],
    ['New York','New York','US',false],
    ['Shanghai','Shanghai','US',false],
    ['Guangzhou','Guangdong','CN',false],
    ['Beijing','Hebei','CN',false],
    ['Shanghai','Shanghai',null,false],
  ] as const)('uses only verified Chinese municipality context for %s / %s / %s',async(city,state,countryCode,accepted)=>{
    const providerCity=countryCode==='US'?'Albany':'Example District';
    const country=countryCode==='US'?'United States':'China';
    const candidate=restaurantCandidate({name:'Example Bakery',address:'12 Example Road',city,region:'Example District',country});
    const row={place_id:'municipal-bakery',name:'Example Bakery',formatted:`12 Example Road, ${providerCity}, ${state}, ${country}`,
      address_line2:`12 Example Road, ${providerCity}, ${state}, ${country}`,street:'Example Road',housenumber:'12',
      city:providerCity,state,county:'Example County',district:'Example District',suburb:'Example Subdistrict',municipality:state,
      country,country_code:countryCode,lat:31.2,lon:121.4,result_type:'amenity',rank:{confidence:1,match_type:'full_match'}};
    const fetchMock=vi.fn<typeof fetch>(async()=>jsonResponse({results:[row]}));
    const [match]=await resolver(fetchMock).resolve({candidate,sourceTheme:'Restaurant'});
    const decision=decidePlaceResolution({candidate,resolved:match});
    expect(decision.precision).toBe(accepted?'EXACT':'UNKNOWN');
    expect(match).toMatchObject({city:providerCity,region:state,providerName:'Example Bakery',administrativeLabels:{
      city:providerCity,state,county:'Example County',district:'Example District',suburb:'Example Subdistrict',municipality:state,
    }});
    expect(match.providerNameAliases).toEqual([]);
    if(accepted){
      expect(match.localityNames).toContain(city);
      expect(decision.reasons).not.toContain('city_contradiction');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }else expect(decision.reasons).toContain('city_contradiction');
  });

  it('recognizes omitted generic venue descriptors without conflating different business types',()=>{
    expect(entityNamesAgree('Miel Bakery','Miel')).toBe(true);
    expect(entityNamesAgree('Café Sakura','Sakura')).toBe(true);
    expect(entityNamesAgree('Sakura Hotel','Sakura Restaurant')).toBe(false);
    expect(entityNamesAgree('Miel Bakery','Miel Cafe')).toBe(false);
    expect(entityNamesAgree('Bakery','')).toBe(false);
  });
  it('retrieves actual named POIs near a transient hint when geocoding only returns a locality',async()=>{
    const properties={...validGeoapifyBody().results[0],result_type:undefined,rank:undefined};
    const fetchMock=vi.fn().mockImplementation(async(url:string)=>new URL(url).pathname==='/v2/places'
      ?jsonResponse({type:'FeatureCollection',features:[{type:'Feature',properties}]})
      :jsonResponse({results:[{...properties,result_type:'building'}]}));
    const matches=await resolver(fetchMock).resolve({...resolutionInput(),proximity:{latitude:25.1301,longitude:55.1101}});
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({provider:'geoapify',providerName:'Nobu Dubai',providerResultType:'amenity',latitude:25.13,longitude:55.11});
    const url=new URL(fetchMock.mock.calls.find(([url])=>new URL(url).pathname==='/v2/places')![0]);
    expect(url.searchParams.get('name')).toBe('Nobu Dubai');
    expect(url.searchParams.get('filter')).toBe('circle:55.1101,25.1301,200');
    expect(url.searchParams.get('limit')).toBe('20');
  });
  it('uses a transient proximity bias without substituting hint coordinates',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(jsonResponse(validGeoapifyBody()));
    const [match]=await resolver(fetchMock).resolve({...resolutionInput(),proximity:{latitude:25.1301,longitude:55.1101}});
    const url=new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('bias')).toBe('proximity:55.1101,25.1301');
    expect(url.searchParams.get('name')).toBe('Nobu Dubai');
    expect(match.latitude).toBe(25.13);expect(match.longitude).toBe(55.11);
  });
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
    expect(result.find(item=>item.providerPlaceId==='venue-terre')).toMatchObject({displayName:"Terre d'Azur",latitude:48.8756751});
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
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
    const fetchMock = vi.fn().mockImplementation(async()=>jsonResponse({ results: [] }));
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

  it('keeps the request deadline active through a stalled body, cancels it and bounds retries',async()=>{
    vi.useFakeTimers();
    try{
      for(const recover of [true,false]){
        const cancel=vi.fn();
        const fetchMock=vi.fn<typeof fetch>(async()=>{
          if(recover&&fetchMock.mock.calls.length===2)return jsonResponse(validGeoapifyBody());
          return new Response(new ReadableStream({cancel}));
        });
        let outcome='pending';
        const result=resolver(fetchMock).resolve(resolutionInput())
          .then(()=>{outcome='resolved';},error=>{outcome=error.code;});
        await vi.advanceTimersByTimeAsync(100);
        expect(outcome).toBe(recover?'resolved':'GEOAPIFY_TIMEOUT');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledTimes(recover?1:2);
        await result;
      }
    }finally{vi.useRealTimers();}
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


describe('bounded neutral area fallback',()=>{
 it.each([true,false].flatMap(verified=>['Examplecho','ÉxamplechO'].map(sourceDistrict=>({verified,sourceDistrict}))))('re-verifies an address-bound administrative hint using source spelling: $sourceDistrict, verified=$verified',async({verified,sourceDistrict})=>{
  const raw={place_id:'example-neighbourhood',name:'Examplechō',city:'Shibuya',district:'Examplechō',country:'Japan',country_code:'jp',
   formatted:'Examplechō, Shibuya, Japan',lat:35.66,lon:139.70,result_type:'suburb',
   rank:{confidence:.71875,match_type:'full_match'},bbox:{lon1:139.69,lat1:35.65,lon2:139.71,lat2:35.67}};
  const city={...raw,place_id:'shibuya-area',name:'Shibuya',district:undefined,result_type:'city',rank:{confidence:1,match_type:'full_match'},
   bbox:{lon1:139.66,lat1:35.64,lon2:139.73,lat2:35.70}};
  const fetchMock=vi.fn<typeof fetch>(async(url)=>{
   const params=new URL(String(url)).searchParams;
   if(params.get('type')==='locality'){
    const sourceSpelling=params.get('text')===`${sourceDistrict}, Shibuya, Japan`;
    return jsonResponse({results:[{...raw,rank:{confidence:verified&&sourceSpelling?1:.25,match_type:verified&&sourceSpelling?'full_match':'match_by_city_or_disrict'}}]});
   }
   if(params.get('type')==='city')return jsonResponse({results:[city]});
   return jsonResponse({results:[raw]});
  });
  const candidate=restaurantCandidate({name:'Example Bakery',address:`1F 12-3 ${sourceDistrict}, Shibuya City, Tokyo`,city:'Shibuya City',region:'Tokyo',country:'Japan',
   evidence:[{type:'CAPTION',excerpt:`Example Bakery, 1F 12-3 ${sourceDistrict}, Shibuya City, Tokyo`}]});
  const source=structuredClone(candidate);
  const results=await resolver(fetchMock).resolveApproximate({candidate,sourceTheme:'Restaurant'});
  const best=selectContextualVenueArea(candidate,results);
  expect(best?.resolved.providerPlaceId).toBe(verified?'example-neighbourhood':'shibuya-area');
  expect(best?.resolved.providerRank).toBe(1);expect(best?.scored.contextualArea?.level).toBe(verified?'district':'city');
  const urls=fetchMock.mock.calls.map(([url])=>new URL(String(url)));
  expect(urls).toHaveLength(verified?2:3);
  expect(urls[0].searchParams.get('text')).toBe(`12-3 ${sourceDistrict}, Shibuya, Tokyo, Japan`);
  expect(urls[1].searchParams.get('text')).toBe(`${sourceDistrict}, Shibuya, Japan`);
  expect(urls[1].searchParams.get('type')).toBe('locality');
  expect(urls.every(url=>!url.searchParams.has('name')&&!url.href.includes('Bakery'))).toBe(true);
  expect(candidate).toEqual(source);
  expect(results[0].providerName).toBe(raw.name);
  expect(results[0].providerRank).toBe(.71875);
 });
 it('queries the source address without a unit and never transmits the business or evidence',async()=>{
  const fetchMock=vi.fn<typeof fetch>(async()=>jsonResponse({results:[{place_id:'building-12',formatted:'12 Example Road, Paris',
   street:'Example Road',housenumber:'12',city:'Paris',country:'France',country_code:'fr',lat:48.85,lon:2.35,result_type:'building',
   rank:{confidence:1,match_type:'full_match'}}]}));
  const candidate=restaurantCandidate({name:'Example Bakery',address:'Unit C, 12 Example Road',city:'Paris',country:'France',
   evidence:[{type:'CAPTION',excerpt:'Private caption: Example Bakery, Unit C, 12 Example Road, Paris'}]});
  const matches=await resolver(fetchMock).resolveApproximate({candidate,sourceTheme:'Restaurant'});
  expect(matches).toHaveLength(1);expect(matches[0].providerName).toBeNull();expect(fetchMock).toHaveBeenCalledTimes(1);
  const url=new URL(String(fetchMock.mock.calls[0][0]));expect(url.searchParams.get('text')).toBe('12 Example Road, Paris, France');
  expect(url.href).not.toContain('Bakery');expect(url.href).not.toContain('Private');expect(url.href).not.toContain('Unit');
 });
 it('does not stop at a city returned by an address query when a district can narrow the envelope',async()=>{
  const base={place_id:'paris',name:'Paris',formatted:'Paris, France',city:'Paris',country:'France',country_code:'fr',lat:48.85,lon:2.35,
   result_type:'city',rank:{confidence:1,match_type:'full_match'},bbox:{lon1:2.2,lat1:48.8,lon2:2.5,lat2:48.9}};
  const district={...base,place_id:'north',name:'North District',result_type:'district',district:'North District',bbox:{lon1:2.34,lat1:48.84,lon2:2.36,lat2:48.86}};
  const fetchMock=vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({results:[base]})).mockResolvedValueOnce(jsonResponse({results:[district]}));
  const candidate=restaurantCandidate({name:'Example Bakery',address:'12 Example Road',city:'Paris',region:'North District',country:'France',
   evidence:[{type:'CAPTION',excerpt:'Example Bakery, 12 Example Road, North District, Paris'}]});
  const results=await resolver(fetchMock).resolveApproximate({candidate,sourceTheme:'Restaurant'});
  expect(fetchMock).toHaveBeenCalledTimes(2);expect(results.some(result=>result.providerPlaceId==='north')).toBe(true);
 });
 it('bounds retries over address, district and city and skips ungrounded or country-only candidates',async()=>{
  const fetchMock=vi.fn<typeof fetch>(async()=>jsonResponse({results:[]}));const service=resolver(fetchMock);
  const candidate=restaurantCandidate({name:'Example Bakery',address:'12 Example Road',city:'Paris',region:'North District',country:'France',
   evidence:[{type:'CAPTION',excerpt:'Example Bakery, 12 Example Road, North District, Paris'}]});
  expect(await service.resolveApproximate({candidate,sourceTheme:'Restaurant'})).toEqual([]);expect(fetchMock).toHaveBeenCalledTimes(3);
  const urls=fetchMock.mock.calls.map(call=>new URL(String(call[0])));expect(urls.every(url=>!url.searchParams.has('name'))).toBe(true);
  expect(urls.at(-1)?.searchParams.get('city')).toBe('Paris');expect(urls.at(-1)?.searchParams.has('state')).toBe(false);
  fetchMock.mockClear();
  for(const source of [{...candidate,city:null},{...candidate,evidence:[]}])expect(await service.resolveApproximate({candidate:source,sourceTheme:'Restaurant'})).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
 });
});
