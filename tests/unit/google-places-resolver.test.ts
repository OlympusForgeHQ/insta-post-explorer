// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {GooglePlacesResolver} from '@/server/places/resolvers/google';
const candidate={name:'Example Café',address:'12 Rue Example, Paris',city:'Paris',country:null,region:null,category:'cafe' as const,confidence:.4,evidence:[]};
it('retrieves bounded business identities without treating Google ranking as confidence',async()=>{
  let request:RequestInit|undefined;
  const resolver=new GooglePlacesResolver({apiKey:'test-secret',fetchImpl:async(_url,init)=>{
    request=init;return Response.json({places:[{id:'google-1',displayName:{text:'Example Café'},formattedAddress:'12 Rue Example, Paris, France',
      location:{latitude:48.85,longitude:2.35},types:['cafe','establishment'],
      addressComponents:[{longText:'Paris',shortText:'Paris',types:['locality']},{longText:'France',shortText:'FR',types:['country']}]}]});
  }});
  const [result]=await resolver.resolve({candidate,sourceTheme:'Restaurant'});
  expect(result).toMatchObject({provider:'google',providerPlaceId:'google-1',providerRank:null,city:'Paris',countryCode:'FR',providerName:'Example Café'});
  expect(JSON.parse(request!.body as string)).toMatchObject({pageSize:5,textQuery:'Example Café, 12 Rue Example, Paris, Paris'});
  expect(request?.redirect).toBe('error');
  const invalid=new GooglePlacesResolver({apiKey:'test-secret',fetchImpl:async()=>Response.json({places:[{id:'bad',location:{latitude:999,longitude:0}}]})});
  await expect(invalid.resolve({candidate,sourceTheme:'Restaurant'})).rejects.toThrow('GOOGLE_PLACES_INVALID_RESPONSE');
  const denied=new GooglePlacesResolver({apiKey:'test-secret',fetchImpl:async()=>new Response('secret',{status:403})});
  await expect(denied.resolve({candidate,sourceTheme:'Restaurant'})).rejects.toThrow('GOOGLE_PLACES_HTTP_403');
});
