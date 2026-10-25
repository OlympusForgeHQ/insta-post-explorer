import {describe,it,expect} from 'vitest';
import {translationOutputSchema,translationResultSchema,validateTranslationContent} from '@/lib/classification/translation';
const translated={decision:'TRANSLATED' as const,sourceLanguages:['es'],translatedCaption:'Mélanger 200 g de farine. @chef #receta https://example.test/a',reason:'Spanish recipe'};
describe('Caption translation contract',()=>{
 it('accepts current and historical inference provenance while rejecting unrelated models',()=>{
  const result={...translated,usage:{inputTokens:10,outputTokens:5},elapsedMs:10};
  for(const model of ['deepseek/deepseek-v4.1-flash-1017','deepseek/deepseek-v4.1-flash'])expect(translationResultSchema.parse({...result,model}).model).toBe(model);
  expect(translationResultSchema.safeParse({...result,model:'other/model'}).success).toBe(false);
 });
 it.each([
  {decision:'UNCHANGED',sourceLanguages:['fr'],translatedCaption:null,reason:'French'},
  {decision:'UNCHANGED',sourceLanguages:['en','fr'],translatedCaption:null,reason:'English and French'},
  {decision:'UNCHANGED',sourceLanguages:['zxx'],translatedCaption:null,reason:'No linguistic prose'},
  translated,
  {decision:'NEEDS_REVIEW',sourceLanguages:['und'],translatedCaption:null,reason:'Ambiguous'},
 ])('accepts the explicit $decision outcome',value=>expect(translationOutputSchema.safeParse(value).success).toBe(true));
 it.each([
  {...translated,sourceLanguages:['en']},
  {...translated,decision:'UNCHANGED'},
  {...translated,translatedCaption:null},
  {...translated,decision:'UNCHANGED',translatedCaption:null,sourceLanguages:['es']},
 ])('rejects contradictory language/translation outcomes',value=>expect(translationOutputSchema.safeParse(value).success).toBe(false));
 it('rejects changed protected tokens without interpreting source instructions',()=>{
  const source='Mezcla 200 g de harina. @chef #receta https://example.test/a';
  expect(()=>validateTranslationContent(source,translated)).not.toThrow();
  for(const text of ['Mélanger 300 g de farine. @chef #receta https://example.test/a','Mélanger 200 g de farine. @other #receta https://example.test/a','Mélanger 200 g de farine. @chef #recette https://example.test/a','Mélanger 200 g de farine. @chef #receta https://evil.test/a'])expect(()=>validateTranslationContent(source,{...translated,translatedCaption:text})).toThrow('TRANSLATION_TOKENS_CHANGED');
 });
});
