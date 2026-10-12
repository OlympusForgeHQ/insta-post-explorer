import 'server-only';
import {foldForSearch} from '@/lib/import/normalize';
import {prisma} from '@/server/db';
import type {PlaceCandidate} from '@/lib/places/candidates';
export type VerifiedPlaceMemory = {id:string;name:string;city:string|null;country:string|null;region:string|null;address:string|null;aliases:string[]};
export function enrichFromVerifiedMemory(candidate:PlaceCandidate, memory:VerifiedPlaceMemory[]):PlaceCandidate {
  if (!candidate.name || !candidate.city || candidate.country) return candidate;
  const name = foldForSearch(candidate.name), city = foldForSearch(candidate.city);
  const matches = memory.filter(entry => entry.city && foldForSearch(entry.city) === city &&
    [entry.name,...entry.aliases].some(alias => foldForSearch(alias) === name));
  const countries = new Set(matches.map(entry => entry.country).filter((country):country is string => Boolean(country)));
  if (countries.size !== 1 || matches.some(entry => !entry.country)) return candidate;
  return {...candidate,country:[...countries][0],inferredFields:[...new Set([...(candidate.inferredFields ?? []),'country' as const])]};
}

// Only explicit identity confirmations teach geographic context. A category-only
// correction or an automatic successful analysis is not an identity label.
export async function loadVerifiedResolutionMemory(ownerId:string, candidates:PlaceCandidate[]):Promise<VerifiedPlaceMemory[]> {
  const names = [...new Set(candidates.map(candidate => candidate.name).filter((name):name is string => Boolean(name)))];
  if (!names.length) return [];
  const places = await prisma.place.findMany({where:{ownerId,isUserConfirmed:true,reviewStatus:'CONFIRMED',
    precision:{in:['EXACT','PROBABLE']},OR:names.map(name=>({normalizedName:foldForSearch(name)}))},
    orderBy:{id:'asc'},take:201,select:{id:true,displayName:true,city:true,country:true,region:true,address:true}});
  // Do not learn from an arbitrarily truncated set of homonymous records.
  if (places.length > 200) return [];
  return places.map(place=>({...place,name:place.displayName,aliases:[]}));
}
