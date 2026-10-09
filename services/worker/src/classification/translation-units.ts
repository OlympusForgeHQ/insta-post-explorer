import {z} from 'zod';
import {translationOutputSchema,type TranslationOutput} from './translation-contract.js';
export type CaptionUnit={id:number;text:string;prefix:string;suffix:string};
const protectedPattern=/https?:\/\/[^\s<>"“”]+|[@#][\p{L}\p{N}_.]+|\p{N}+(?:[.,:/-]\p{N}+)*/gu;
export function prepareCaptionUnits(caption:string){
 let markerPrefix='IPEKEEP';while(caption.includes(markerPrefix))markerPrefix+='X';
 const values:string[]=[];
 const token=(value:string)=>{values.push(value);return `[[${markerPrefix}${values.length-1}]]`;};
 // Emoji are kept as complete graphemes (flags, skin tones and joined sequences).
 const emojiMasked=[...new Intl.Segmenter('und',{granularity:'grapheme'}).segment(caption)].map(({segment})=>/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u.test(segment)?token(segment):segment).join('');
 const markerPattern=new RegExp(`\\[\\[${markerPrefix}\\d+\\]\\]`,'g');
 // Do not remask the numeric indexes of markers already generated above.
 const masked=emojiMasked.split(new RegExp(`(\\[\\[${markerPrefix}\\d+\\]\\])`,'g')).map(part=>part.startsWith(`[[${markerPrefix}`)?part:part.replace(protectedPattern,token)).join('');
 const units:CaptionUnit[]=[];let pending='';
 for(const line of masked.split(/(\r\n|\r|\n)/)){
  if(!line||/^\s+$/u.test(line)){pending+=line;continue;}
  // Sentence segmentation can split "Hola![[IPEKEEP0]]" inside the marker.
  // Merge those boundaries before constructing independently restored units.
  const spans=[...line.matchAll(markerPattern)].map(m=>[m.index,m.index+m[0].length]);
  let joined='';
  for(const sentence of new Intl.Segmenter('und',{granularity:'sentence'}).segment(line)){
   joined+=sentence.segment;const end=sentence.index+sentence.segment.length;
   if(spans.some(([start,stop])=>start<end&&end<stop))continue;
   const segment=joined;joined='';
   const edge=/^(\s*)([\s\S]*?)(\s*)$/u.exec(segment)!;
   if(!edge[2]){pending+=segment;continue;}
   units.push({id:units.length,text:edge[2],prefix:pending+edge[1],suffix:edge[3]});pending='';
  }
 }
 const restore=(text:string)=>text.replace(markerPattern,marker=>values[Number(marker.slice(markerPrefix.length+2,-2))]??marker);
 const markers=(text:string)=>text.match(markerPattern)??[];
 const restoreTranslation=(source:string,text:string)=>{
  if(JSON.stringify(markers(source))!==JSON.stringify(markers(text)))throw Error('TRANSLATION_MARKERS_CHANGED');
  const restored=restore(text);if(restored.includes(`[[${markerPrefix}`))throw Error('TRANSLATION_MARKERS_CHANGED');return restored;
 };
 return {units,trailing:pending,restore,restoreTranslation,isNonlinguistic:(text:string)=>!/\p{L}/u.test(text.replace(markerPattern,''))};
}
export const indexedTranslationSchema=z.object({units:z.array(z.object({id:z.number().int().nonnegative(),decision:z.enum(['TRANSLATED','UNCHANGED','NEEDS_REVIEW']),sourceLanguages:z.array(z.string().regex(/^[a-z]{2,3}$/)).min(1).max(16),translatedCaption:z.string().max(200_000).nullable(),reason:z.string().min(1).max(1000)}).strict()).max(1000)}).strict();
export function validateIndexedUnits(units:CaptionUnit[],value:unknown){
 const parsed=indexedTranslationSchema.parse(value).units;
 if(JSON.stringify(parsed.map(x=>x.id))!==JSON.stringify(units.map(x=>x.id)))throw Error('TRANSLATION_UNIT_IDS_CHANGED');
 return parsed.map(unit=>({...translationOutputSchema.parse({decision:unit.decision,sourceLanguages:unit.sourceLanguages,translatedCaption:unit.translatedCaption,reason:unit.reason}),id:unit.id}));
}
export function combineUnits(results:TranslationOutput[],parts:string[]):TranslationOutput{
 const languages=[...new Set(results.flatMap(r=>r.sourceLanguages))];
 if(results.some(r=>r.decision==='NEEDS_REVIEW'))return {decision:'NEEDS_REVIEW',sourceLanguages:languages,translatedCaption:null,reason:'Ambiguous source unit'};
 const changed=results.some(r=>r.decision==='TRANSLATED');
 return translationOutputSchema.parse({decision:changed?'TRANSLATED':'UNCHANGED',sourceLanguages:languages.length?languages:['zxx'],translatedCaption:changed?parts.join(''):null,reason:changed?'Foreign units translated; protected content and unchanged units restored locally.':'French, English or nonlinguistic source retained.'});
}
