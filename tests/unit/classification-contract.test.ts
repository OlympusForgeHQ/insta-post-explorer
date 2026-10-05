import {describe,it,expect} from 'vitest';
import {classificationResultSchema,classificationCommandSchema} from '@/lib/classification/contract';
const valid={status:'SUCCEEDED',mainTheme:'Sucré',tags:['Chocolat','Brownie','Dessert protéiné'],reason:'The dessert recipe contains chocolate',media:[{mediaId:'m1',kind:'IMAGE',durationMs:null,frameCount:1,audio:'not_applicable'}],model:'deepseek/deepseek-v4.1-flash',usage:{inputTokens:50,outputTokens:30},elapsedMs:100};
describe('Classification contract',()=>{
 it('accepts existing theme and 3–5 precise tags, or a review without invented tags',()=>{
  expect(classificationResultSchema.parse(valid).tags).toHaveLength(3);
  expect(classificationResultSchema.parse({...valid,status:'NEEDS_REVIEW',mainTheme:null,tags:[],reason:'Not enough context'}).status).toBe('NEEDS_REVIEW');
 });
 it.each([
  {tags:['Chocolat','Brownie']},{tags:['A','B','C','D','E','F']},{tags:['Chocolat','chocolât','Brownie']},{tags:['Sucré','Chocolat','Brownie']},{mainTheme:'Nouvelle catégorie'},{latitude:48},
 ])('rejects invalid output %j',change=>expect(classificationResultSchema.safeParse({...valid,...change}).success).toBe(false));
 it('rejects unowned or general-purpose worker commands',()=>{
  expect(classificationCommandSchema.safeParse({action:'claim',ownerId:'someone'}).success).toBe(false);
  expect(classificationCommandSchema.safeParse({action:'enqueue',postId:'old-post'}).success).toBe(false);
 });
});
