import {describe,it,expect} from 'vitest';
import {isSupportedRecovery} from '@/lib/places/recovery';
import type {PlaceCandidate} from '@/lib/places/candidates';
const candidate:PlaceCandidate={name:'Example Cafe',city:'Paris',region:null,country:null,address:null,category:'cafe',confidence:.4,
  evidence:[{type:'CAPTION',excerpt:'Example Cafe, 12 Main Street, Paris'}]};
describe('bounded contextual enrichment',()=>{
  it('permits inferred missing geography and an address explicitly stated in the evidence',()=>{
    expect(isSupportedRecovery(candidate,{...candidate,country:'France',inferredFields:['country'],address:'12 Main Street'})).toBe(true);
    expect(isSupportedRecovery(candidate,{...candidate,country:'France'})).toBe(false);
  });
  it('preserves asserted geography and cannot invent a replacement identity or address',()=>{
    expect(isSupportedRecovery({...candidate,address:'12 Main Street'},{...candidate,address:'Main Street'})).toBe(false);
    expect(isSupportedRecovery({...candidate,address:'12 Main Street\nSpringfield'},{...candidate,address:'Springfield'})).toBe(false);
    expect(isSupportedRecovery({...candidate,address:'12 Main Street; Springfield'},{...candidate,address:'Springfield'})).toBe(false);
    expect(isSupportedRecovery({...candidate,address:'12 Main Street; 14 Other Street'},{...candidate,address:'12 Main Street'})).toBe(true);
    for(const patch of [{name:'Other Cafe'},{city:'Lyon'},{address:'999 Main Street'}]){
      expect(isSupportedRecovery(candidate,{...candidate,...patch})).toBe(false);
    }
  });
});
