import {describe,it,expect} from 'vitest';
import {selectExamples,failureFamily,LearningTracker,learningContextSchema,captionShape} from '../src/classification/learning.js';
const example=(id:string,source:string)=>({id,kind:'tags' as const,source,tags:['Chocolat'],avoidTags:[]});
describe('Verified learning context',()=>{
 it('selects relevant bounded distinct examples instead of unrelated or generic matches',()=>{
  const selected=selectExamples('Brownie chocolat pistache moelleux',[
   example('irrelevant','Voyage Japon Kyoto temples'),example('generic','Recette facile pour vous'),
   ...Array.from({length:6},(_,i)=>example('relevant-'+i,'Brownie chocolat pistache '+['fondant','four','maison','dessert','cuisson','noisettes'][i])),
   example('oversize','Brownie chocolat '+ 'x'.repeat(1300))
  ]);
  expect(selected).toHaveLength(3);expect(selected.every(x=>x.id.startsWith('relevant-'))).toBe(true);
  expect(selectExamples('Bon appétit',[example('weak','Bon voyage appétit')])).toEqual([]);
  expect(JSON.stringify(selected).length).toBeLessThanOrEqual(8000);
 });
 it('keeps typed diagnostics without private text and bounds repeated signals',()=>{
  const tracker=new LearningTracker({version:1,domain:'translation',shape:captionShape('Hola amigo'),strategy:'preserve_source',examples:[example('sample','Hola amigo') ]});
  for(let i=0;i<100;i++)tracker.observe({stage:'caption_translation_rejected',reason:'TRANSLATION_SOURCE_CHANGED',secret:'private caption'});
  tracker.observe({stage:'caption_translation_context_review',unresolvedCount:1});
  const report=tracker.report(123,{inputTokens:20,outputTokens:10});
  expect(report).toMatchObject({strategy:'preserve_source',exampleIds:['sample'],signals:['SOURCE_FIDELITY','CONTEXT'],elapsedMs:123});
  expect(JSON.stringify(report)).not.toContain('private');
  expect(failureFamily('INFERENCE_BUSY')).toBe('PROVIDER_BUSY');expect(failureFamily('MEDIA_UNAVAILABLE')).toBe('MEDIA');expect(failureFamily('unknown private error')).toBe('OTHER');
 });
 it('rejects executable policy names and oversized context',()=>{
  expect(learningContextSchema.safeParse({version:1,domain:'translation',shape:'short:latin:single',strategy:'execute_shell',examples:[]}).success).toBe(false);
  expect(learningContextSchema.safeParse({version:1,domain:'translation',shape:'short:latin:single',strategy:'standard',examples:Array.from({length:4},(_,i)=>example(String(i),'Hola amigo'))}).success).toBe(false);
 });
});
