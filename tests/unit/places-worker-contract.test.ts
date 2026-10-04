import { expect, it } from 'vitest';
import { workerCandidatesSchema } from '@/lib/places/worker-contract';
import { placeCandidateBatchSchema } from '@/lib/places/candidates';

const candidate={name:'Example Cafe',address:null,city:'Paris',region:null,country:'France',category:'cafe',categoryReason:'The source recommends brunch.',confidence:0.8,evidence:[{type:'CAPTION',excerpt:'Brunch at Example Cafe'}]};

it('accepts long worker itineraries without widening the caption-import limit',()=>{
 const candidates=Array.from({length:200},(_,i)=>({...candidate,name:`Example Cafe ${i+1}`}));
 expect(workerCandidatesSchema.parse({candidates}).candidates).toEqual(candidates);
 expect(workerCandidatesSchema.safeParse({candidates:[...candidates,candidate]}).success).toBe(false);
 expect(placeCandidateBatchSchema.safeParse(candidates.slice(0,51)).success).toBe(false);
 expect(placeCandidateBatchSchema.safeParse(candidates.slice(0,50)).success).toBe(true);
});
