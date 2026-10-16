import {foldForSearch} from '@/lib/import/normalize';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';

const municipalityNames=[
  ['Beijing','北京','北京市'],
  ['Tianjin','天津','天津市'],
  ['Shanghai','上海','上海市'],
  ['Chongqing','重庆','重庆市','重慶','重慶市'],
] as const;

function administrativeName(value:string):{name:string;level:string|null} {
  const normalized=foldForSearch(value).replace(/['’‘]/gu,'');
  const suffix=normalized.match(/^(.+?)\s+(subdistrict|district|county|province|state|city|municipality)$/u);
  if(suffix)return {name:suffix[1],level:suffix[2]==='province'?'state':suffix[2]};
  const chinese=normalized.match(/^(.+)([区區县縣省市])$/u);
  const levels:Record<string,string>={'区':'district','區':'district','县':'county','縣':'county','省':'state','市':'city'};
  return chinese?{name:chinese[1],level:levels[chinese[2]]}:{name:normalized,level:null};
}

// These four municipalities are simultaneously province-level administrations
// and cities. Never apply this interpretation to another country or state.
export function municipalityCityLabels(countryCode:string|null,state:string|null):readonly string[] {
  if(countryCode?.trim().toUpperCase()!=='CN'||!state)return [];
  const parsed=administrativeName(state);
  if(parsed.level&&!['city','municipality'].includes(parsed.level))return [];
  return municipalityNames.find(names=>names.some(name=>administrativeName(name).name===parsed.name))??[];
}

export function administrativeRegionMatches(region:string,resolved:ResolvedPlaceCandidate):boolean {
  const source=administrativeName(region);
  if(!source.name)return false;
  // Only structured administrative fields participate. Names of businesses,
  // streets and unstructured address fragments cannot corroborate a district.
  const labels:Array<[string,string|null|undefined]>=[['state',resolved.region],['city',resolved.city],...Object.entries(resolved.administrativeLabels??{})];
  return labels.some(([field,label])=>{
    if(!label)return false;
    const provider=administrativeName(label);
    // Explicit text takes precedence when a district is returned as city.
    // Otherwise keep the field's level: a bare state cannot prove a district.
    return source.name===provider.name&&(!source.level||source.level===(provider.level??field));
  });
}
