import {foldForSearch} from '@/lib/import/normalize';
import type {PlaceCandidate} from './candidates';
const words=(value:string)=>foldForSearch(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const compact=(value:string)=>words(value).replace(/ /gu,'');

// Scope is an extraction assertion about the whole post, not knowledge that a
// chain has branches. Missing metadata retains the historical explicit rule.
export type CityBranchSourceContext={caption:string;structuredLocation:string|null};

export function cityBranchScope(candidate:PlaceCandidate,sourceContext?:CityBranchSourceContext):'explicit'|'generic'|null {
  if(!candidate.name||!candidate.city||candidate.address)return null;
  if(candidate.locationScope && candidate.locationScope.kind!=='CITY')return null;
  const name=words(candidate.name),city=words(candidate.city);
  const explicit=(excerpt:string)=>{
    const source=words(excerpt);
    if(!source.startsWith(name+' '))return false;
    const rest=source.slice(name.length).trim();
    return [`plusieurs adresses a ${city}`,`plusieurs boutiques a ${city}`,
      `multiple locations in ${city}`,`has multiple locations in ${city}`,
      `several locations in ${city}`].includes(rest);
  };
  if(candidate.evidence.some(e=>explicit(e.excerpt)))return 'explicit';
  if(!candidate.country || candidate.inferredFields?.includes('city') ||
    !['restaurant','cafe','patisserie','divers','lodging'].includes(candidate.category) ||
    candidate.locationScope?.kind!=='CITY')return null;
  const proof=candidate.evidence[candidate.locationScope.evidenceIndex];
  if(!proof || proof.type!=='CAPTION' || !sourceContext ||
    !sourceContext.caption.includes(proof.excerpt) || sourceContext.caption.trim()!==proof.excerpt.trim())return null;
  if(sourceContext.structuredLocation && ![city,words(`${city} ${candidate.country}`)]
    .includes(words(sourceContext.structuredLocation)))return null;
  // Require the whole literal caption, not a model-selected line that could
  // omit a neighborhood. The city must remain separate from the brand/account:
  // an account suffix is not an independent assertion of a city.
  const cityWords=city.split(' ').length;
  const sourceWords=proof.excerpt.trim().split(/\s+/u);
  if(sourceWords.length<=cityWords || words(sourceWords.slice(-cityWords).join(' '))!==city)return null;
  const forms=[name,compact(name)].flatMap(brand=>['','in','a','at']
    .map(join=>words(`${brand} ${join} ${city}`)));
  const grounded=(excerpt:string)=>forms.includes(words(excerpt));
  if(!grounded(proof.excerpt)||!candidate.evidence.every(e=>e.type==='CAPTION' &&
    sourceContext.caption.includes(e.excerpt) && grounded(e.excerpt)))return null;
  return 'generic';
}

export function recommendsCityBranches(candidate:PlaceCandidate,sourceContext?:CityBranchSourceContext):boolean {
  return cityBranchScope(candidate,sourceContext)!==null;
}
