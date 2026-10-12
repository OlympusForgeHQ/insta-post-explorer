// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {GooglePlacesSearch} from '@/server/places/resolvers/google';
const candidate={name:'Example Café',address:'12 Rue Example, Paris',city:'Paris',country:null,region:null,category:'cafe' as const,confidence:.4,evidence:[]};
it('retrieves bounded business identities without treating Google ranking as confidence',async()=>{
  let request:RequestInit|undefined;
  const resolver=new GooglePlacesSearch({apiKey:'test-secret',fetchImpl:async(_url,init)=>{
    request=init;return Response.json({places:[{id:'google-1',displayName:{text:'Example Café'},formattedAddress:'12 Rue Example, Paris, France',
      location:{latitude:48.85,longitude:2.35},types:['cafe','establishment'],
      addressComponents:[{longText:'Paris',shortText:'Paris',types:['locality']},{longText:'France',shortText:'FR',types:['country']}]}]});
  }});
  const [result]=await resolver.searchHints({candidate,sourceTheme:'Restaurant'});
  expect(result).toEqual({placeId:'google-1',latitude:48.85,longitude:2.35});
  expect(JSON.parse(request!.body as string)).toMatchObject({pageSize:5,textQuery:'Example Café, 12 Rue Example, Paris, Paris'});
  expect(request?.redirect).toBe('error');
  expect((request!.headers as Record<string,string>)['X-Goog-FieldMask']).toBe('places.id,places.location');
  const invalid=new GooglePlacesSearch({apiKey:'test-secret',fetchImpl:async()=>Response.json({places:[{id:'bad',location:{latitude:999,longitude:0}}]})});
  await expect(invalid.searchHints({candidate,sourceTheme:'Restaurant'})).rejects.toThrow('GOOGLE_PLACES_INVALID_RESPONSE');
  const denied=new GooglePlacesSearch({apiKey:'test-secret',fetchImpl:async()=>new Response('secret',{status:403})});
  await expect(denied.searchHints({candidate,sourceTheme:'Restaurant'})).rejects.toThrow('GOOGLE_PLACES_HTTP_403');
});
