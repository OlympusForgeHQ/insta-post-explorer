// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {GooglePlacesSearch} from '@/server/places/resolvers/google';
it('waits on temporary rate limits and reserves every bounded attempt',async()=>{
 let calls=0,reserved=0;const delays:number[]=[];
 const resolver=new GooglePlacesSearch({apiKey:'test-secret',reserveRequest:async()=>{reserved++;},sleepImpl:async ms=>{delays.push(ms);},
  fetchImpl:async()=>++calls<3?new Response('',{status:429,headers:{'retry-after':'20'}}):Response.json({places:[]})});
 expect(await resolver.searchHints({candidate,sourceTheme:'Restaurant'})).toEqual([]);
 expect(calls).toBe(3);expect(reserved).toBe(3);expect(delays).toEqual([20000,20000]);
});
it('stops after three throttled attempts and does not retry before a long Retry-After',async()=>{
 for(const retryAfter of [undefined,'120']){
  let calls=0;const resolver=new GooglePlacesSearch({apiKey:'test-secret',sleepImpl:async()=>{},fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:retryAfter?{'retry-after':retryAfter}:{}});}});
  await expect(resolver.searchHints({candidate,sourceTheme:'Restaurant'})).rejects.toThrow('GOOGLE_PLACES_HTTP_429');
  expect(calls).toBe(retryAfter?1:3);
 }
});
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
