import {expect,it} from 'vitest';
import {groundPlacesEvidence} from '../src/places/evidence.js';
const media=[{mediaId:'clip',kind:'VIDEO',durationMs:1200,frameCount:2,audio:'transcribed'}];
const candidate=(evidence:Record<string,unknown>[])=>({name:'Example Cafe',evidence});
it('restores only whitespace differences to exact caption spans and preserves other data',()=>{
 const caption='Brunch\n\nat Example\u00a0Cafe. Another recommendation.';
 const source=[candidate([{type:'CAPTION',excerpt:'Brunch at Example Cafe.'}])];
 const result=groundPlacesEvidence(source,caption,media);
 expect(result[0].evidence).toEqual([{type:'CAPTION',excerpt:'Brunch\n\nat Example\u00a0Cafe.'}]);
 expect(source[0].evidence[0].excerpt).toBe('Brunch at Example Cafe.');
 expect(()=>groundPlacesEvidence([candidate([{type:'CAPTION',excerpt:'Lunch at Example Cafe.'}])],caption,media)).toThrow('PLACES_EVIDENCE_INVALID');
});
it('rejects invented media references and timestamps rather than clamping or dropping evidence',()=>{
 for(const evidence of [
  {type:'VIDEO_OCR',mediaId:'other',videoTimestampMs:0,excerpt:'Cafe'},
  {type:'VIDEO_OCR',mediaId:'clip',videoTimestampMs:2000,excerpt:'Cafe'},
  {type:'AUDIO_TRANSCRIPT',mediaId:'clip',excerpt:'Cafe'},
 ])expect(()=>groundPlacesEvidence([candidate([evidence])],'',media)).toThrow('PLACES_EVIDENCE_INVALID');
 const supported=[candidate([{type:'VIDEO_OCR',mediaId:'clip',videoTimestampMs:1200,excerpt:'Cafe'}])];
 expect(groundPlacesEvidence(supported,'',media)).toEqual(supported);
 expect(()=>groundPlacesEvidence([candidate([{type:'AUDIO_TRANSCRIPT',mediaId:'clip',videoTimestampMs:0,excerpt:'Cafe'}])],'',[{...media[0],audio:'absent'}])).toThrow('PLACES_EVIDENCE_INVALID');
});

it('rejects scope references outside the actual evidence array',()=>{
 const proof=[{type:'CAPTION',excerpt:'Cafe'}];
 for(const evidenceIndex of [-1,1,1.5])expect(()=>groundPlacesEvidence([{...candidate(proof),locationScope:{kind:'CITY',evidenceIndex}}],'Cafe',[])).toThrow('PLACES_EVIDENCE_INVALID');
 expect(groundPlacesEvidence([{...candidate(proof),locationScope:{kind:'CITY',evidenceIndex:0}}],'Cafe',[])).toHaveLength(1);
});
