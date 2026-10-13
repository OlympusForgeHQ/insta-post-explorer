import {foldForSearch} from '@/lib/import/normalize';
import type {PlaceCandidate} from './candidates';
const words=(value:string)=>foldForSearch(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
// The recommendation must bind the named chain and the city in the same source
// excerpt. Mere knowledge that a brand has branches is not an all-branches request.
export function recommendsCityBranches(candidate:PlaceCandidate):boolean {
  if(!candidate.name||!candidate.city||candidate.address)return false;
  const name=words(candidate.name),city=words(candidate.city);
  return candidate.evidence.some(e=>{
    const excerpt=words(e.excerpt);
    if(!excerpt.startsWith(name+' '))return false;
    const rest=excerpt.slice(name.length).trim();
    return [`plusieurs adresses a ${city}`,`plusieurs boutiques a ${city}`,
      `multiple locations in ${city}`,`has multiple locations in ${city}`,
      `several locations in ${city}`].some(scope=>rest===scope);
  });
}
