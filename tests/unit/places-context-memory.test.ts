// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {enrichFromVerifiedMemory} from '@/server/places/resolution-memory';
import type {PlaceCandidate} from '@/lib/places/candidates';

it('learns geography from confirmed identity without copying a branch address or hiding conflicts',()=>{
  const candidate:PlaceCandidate={name:'Example Café',city:'Paris',country:null,region:null,address:null,category:'cafe',confidence:.4,evidence:[]};
  const memory=[{id:'verified',name:'Example Café',city:'Paris',country:'France',region:'Île-de-France',address:'12 Rue Example',aliases:[]}];
  const learned=enrichFromVerifiedMemory(candidate,memory);
  expect(learned).toMatchObject({country:'France',address:null,inferredFields:['country']});
  expect(candidate.country).toBeNull();
  expect(enrichFromVerifiedMemory({...candidate,city:null},memory).country).toBeNull();
  expect(enrichFromVerifiedMemory({...candidate,country:'Canada'},memory).country).toBe('Canada');
  expect(enrichFromVerifiedMemory(candidate,[...memory,{...memory[0],id:'other',country:'United States'}]).country).toBeNull();
});
