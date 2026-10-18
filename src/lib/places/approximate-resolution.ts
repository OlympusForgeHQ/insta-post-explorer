import {foldForSearch} from '@/lib/import/normalize';
import type {PlaceCandidate} from '@/lib/places/candidates';
import {addressComponents,administrativeRegionMatches,isJapaneseCountry,japaneseFloor,japaneseMunicipalityMatches,japaneseMunicipalityName,japanesePrefectureName,municipalityCityLabels} from '@/lib/places/administrative-context';
import {distanceMeters} from '@/lib/places/distance';
import {decidePlaceResolution, RESOLUTION_POLICY_VERSION} from '@/lib/places/resolution';
import {scoreResolvedCandidate, type ContextualVenueArea, type ScoredResolution} from '@/lib/places/scoring';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';

const words = (value:string) => foldForSearch(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const literalTypes=['CAPTION','VIDEO_OCR','AUDIO_TRANSCRIPT','INSTAGRAM_LOCATION','AUTHOR_TEXT'];
const literalProof = (value:string,candidate:PlaceCandidate) => {
  const key=words(value);
  return key.length>=2 && candidate.evidence.some(evidence =>
    literalTypes.includes(evidence.type) &&
    ` ${words(evidence.excerpt)} `.includes(` ${key} `));
};

function cityAliases(candidate:PlaceCandidate):readonly string[] {
  if(!candidate.city)return [];
  const mayBeChina=!candidate.country||['cn','china','chine','中国','中國'].includes(foldForSearch(candidate.country));
  return [candidate.city,...(mayBeChina?municipalityCityLabels('CN',candidate.city):[]),
    ...(isJapaneseCountry(candidate.country)?[japaneseMunicipalityName(candidate.city)]:[])];
}

// Keep only a whole source name or a fully evidenced bilingual component. A
// plausible translation supplied by the model is not an independently known alias.
export function groundedVenueName(candidate:PlaceCandidate):string|null {
  if(!candidate.name || candidate.name.startsWith('@'))return null;
  const variants=[candidate.name,...candidate.name.split(/[()（）]|\s*\/\/\s*/u),
    ...candidate.name.matchAll(/[\p{Script=Latin}\p{N}][\p{Script=Latin}\p{N}\s&!'’.-]*|[\p{Script=Han}]+/gu)].map(value =>
    typeof value==='string'?value.trim():value[0].trim());
  const generic=new Set(['restaurant','bakery','boulangerie','patisserie','cafe','hotel','museum','musee','unknown','unknown restaurant']);
  const geography=[...cityAliases(candidate),candidate.region,candidate.country].filter((value):value is string=>Boolean(value)).map(words);
  const distinctive=(value:string)=>{
    let remainder=` ${words(value)} `;
    for(const label of geography)remainder=remainder.split(` ${label} `).join(' ');
    return remainder.trim()&&!generic.has(remainder.trim());
  };
  return [...new Set(variants)].find(value=>(words(value).length>=3||/^[\p{Script=Han}]{2}$/u.test(words(value)))&&distinctive(value)&&literalProof(value,candidate))??null;
}

function independentCityProof(city:string,candidate:PlaceCandidate):boolean {
  const identities=[candidate.name,groundedVenueName(candidate)].filter((value):value is string=>Boolean(value)).map(words);
  return candidate.evidence.some(evidence=>{
    if(!literalTypes.includes(evidence.type))return false;
    // An account/hashtag suffix or a place word inside the venue's own name
    // does not assert geography. Keep a separate occurrence such as "in Paris".
    let source=` ${words(evidence.excerpt.replace(/[@#][\p{L}\p{N}_.]+/gu,' '))} `;
    for(const identity of identities)source=source.split(` ${identity} `).join(' ');
    return source.includes(` ${words(city)} `);
  });
}

export function canApproximateVenue(candidate:PlaceCandidate):boolean {
  if(!groundedVenueName(candidate)||!candidate.city||candidate.inferredFields?.includes('city'))return false;
  return cityAliases(candidate).some(city=>independentCityProof(city,candidate));
}

const unitComponent=/^(?:unit|suite|flat|apartment|apt\.?)\s+(?:#\s*)?([0-9]+\s[a-z]|[a-z0-9]+(?:[-/][a-z0-9]+)*)$/iu;
const floorComponent=/^(?:(?:ground|first|second|third|\d+(?:st|nd|rd|th)?)\s+floor|floor\s+\d+|level\s+\d+)$/iu;
function addressParts(address:string|null,countryCode:string|null=null) { return addressComponents(address,countryCode); }
function units(address:string|null) {return addressParts(address).flatMap(part=>{
  const match=part.match(unitComponent);return match?[words(match[1])]:[];
});}

function conflictingInterior(source:string|null,provider:string|null,countryCode:string|null):boolean {
  const sourceUnits=units(source),providerUnits=units(provider);
  if(sourceUnits.length&&providerUnits.length&&sourceUnits.some(unit=>!providerUnits.includes(unit)))return true;
  const floors=(address:string|null)=>addressParts(address,countryCode).flatMap(part=>{
    const japanese=japaneseFloor(part,countryCode);
    if(japanese!==null)return [japanese];
    return floorComponent.test(part)?[words(part).replace(/\bground\b/u,'0').replace(/\bfirst\b/u,'1').replace(/\bsecond\b/u,'2').replace(/\bthird\b/u,'3')
      .replace(/(\d+)(?:st|nd|rd|th)\b/u,'$1').replace(/\b(?:floor|level)\b/gu,'').trim()]:[];
  });
  const a=floors(source),b=floors(provider);
  return a.length>0&&b.length>0&&a.some(floor=>!b.includes(floor));
}

function administrativeLevel(label:string):string|null {
  const level=words(label).match(/\b(subdistrict|district|county|province|state|city|municipality)$/u)?.[1];
  if(level)return level==='province'?'state':level;
  const chinese=label.match(/[区區县縣省市]$/u)?.[0];
  return chinese?({'区':'district','區':'district','县':'county','縣':'county','省':'state','市':'city'} as Record<string,string>)[chinese]:null;
}

function conflictingAdministrativeContext(candidate:PlaceCandidate,resolved:ResolvedPlaceCandidate):boolean {
  const regions=[...(!candidate.inferredFields?.includes('region')&&candidate.region?[candidate.region]:[]),
    ...addressParts(candidate.address).filter(part=>['district','county','state'].includes(administrativeLevel(part)??''))];
  const labels=[['state',resolved.region],['city',resolved.city],...Object.entries(resolved.administrativeLabels??{})];
  return regions.some(region=>{
    if(administrativeRegionMatches(region,resolved))return false;
    const level=resolved.countryCode==='JP'&&japanesePrefectureName(region)?'state':administrativeLevel(region);
    return labels.some(([field,label])=>label&&(level?level===(administrativeLevel(label)??field):['state','district','county'].includes(field!)));
  });
}

export function approximateDistrict(candidate:PlaceCandidate):string|null {
  const district=candidate.region&&!(isJapaneseCountry(candidate.country)&&japanesePrefectureName(candidate.region))&&
    !candidate.inferredFields?.includes('region')&&candidate.region!==candidate.city&&literalProof(candidate.region,candidate)
    ?candidate.region:addressParts(candidate.address).find(part=>['district','county'].includes(administrativeLevel(part)??''));
  return district&&literalProof(district,candidate)?district:null;
}

// Only discard standalone interior qualifiers. Street names, building numbers,
// neighbourhoods and unfamiliar components remain part of the verification.
export function approximateAddress(candidate:PlaceCandidate):string|null {
  if(!candidate.address)return null;
  const countryCode=isJapaneseCountry(candidate.country)?'JP':null;
  const parts=addressParts(candidate.address,countryCode).filter(part=>!unitComponent.test(part)&&!floorComponent.test(part)&&japaneseFloor(part,countryCode)===null)
    .map(part=>part.replace(/^no\.?\s*(?=\d)/iu,''));
  if(!parts.length||!parts.some(part=>/\d/u.test(part)&&literalProof(part,candidate)))return null;
  return parts.join(', ');
}

// An administrative result may supply a retrieval hint even when the complete
// address query was weak. It must name geography in this candidate's address;
// other recommendations in a shared caption and POI names cannot contribute.
export function addressDistrictHint(candidate:PlaceCandidate,resolved:ResolvedPlaceCandidate):string|null {
  if(resolved.provider!=='geoapify'||!candidate.address||!candidate.city||
    !['district','suburb','neighbourhood','quarter'].includes(resolved.providerResultType??'')||
    conflictingAdministrativeContext(candidate,resolved))return null;
  const comparison=scoreResolvedCandidate({candidate:{...candidate,name:null,address:null,region:null,category:'city'},resolved});
  if(!comparison.reasons.includes('city_match')||comparison.reasons.some(reason=>reason.endsWith('_contradiction'))||
    (candidate.country&&!comparison.reasons.includes('country_match')))return null;
  const components=addressParts(approximateAddress(candidate)).map(part=>part.replace(/^\d{1,6}[a-z]?(?:[-/]\d{1,6}[a-z]?)*\s+/iu,''));
  const hint=[resolved.providerName,...(resolved.providerNameAliases??[])].find((name):name is string=>Boolean(name&&words(name).length>=3&&
    ![candidate.city,candidate.region,candidate.country].some(geography=>geography&&(words(name!)===words(geography)||japaneseMunicipalityMatches(name!,geography,resolved.countryCode)))&&
    ![candidate.name,groundedVenueName(candidate)].some(identity=>identity&&words(identity)===words(name!))&&
    components.some(component=>words(component)===words(name!))&&literalProof(name!,candidate)));
  // Matching may fold accents, but retrieval preserves the source spelling:
  // a provider's transliteration can produce a different geocoding result.
  return hint?components.find(component=>words(component)===words(hint))??null:null;
}

// The provider point must lie inside its own bounds. Angular latitude +
// longitude span is a conservative enclosing radius, including date-line boxes.
export function verifiedAreaRadius(resolved:ResolvedPlaceCandidate):number|null {
  const b=resolved.providerBounds;
  if(!b||![b.lon1,b.lon2,resolved.longitude].every(x=>Number.isFinite(x)&&Math.abs(x)<=180)||
    ![b.lat1,b.lat2,resolved.latitude].every(x=>Number.isFinite(x)&&Math.abs(x)<=90)||b.lat1>=b.lat2||
    resolved.latitude<b.lat1||resolved.latitude>b.lat2)return null;
  const width=(b.lon2-b.lon1+360)%360 || (b.lon1===b.lon2?0:360);
  const offset=(resolved.longitude-b.lon1+360)%360;
  if(offset>width||width<=0||width>180)return null;
  const latSpan=Math.max(resolved.latitude-b.lat1,b.lat2-resolved.latitude);
  const lonSpan=Math.max(offset,width-offset);
  return Math.max(25,Math.ceil((latSpan+lonSpan)*Math.PI/180*6_371_000));
}

function evaluateAnchor(candidate:PlaceCandidate,resolved:ResolvedPlaceCandidate):{resolved:ResolvedPlaceCandidate;scored:ScoredResolution}|null {
  if(resolved.provider!=='geoapify'||!resolved.countryCode||!resolved.country||(resolved.providerRank??0)<.9||
    !['full_match','match_by_building'].includes(resolved.providerMatchType??'')||
    !Number.isFinite(resolved.latitude)||Math.abs(resolved.latitude)>90||!Number.isFinite(resolved.longitude)||Math.abs(resolved.longitude)>180)return null;
  const comparison=scoreResolvedCandidate({candidate:{...candidate,name:null,address:null,region:null,category:'city'},resolved});
  if(!comparison.reasons.includes('city_match')||comparison.reasons.some(reason=>reason.endsWith('_contradiction')))return null;
  if(candidate.country&&!comparison.reasons.includes('country_match'))return null;
  // A translated Chinese municipality name cannot locate a foreign namesake
  // when the source omitted its country.
  const japaneseCityProof=resolved.countryCode==='JP'&&isJapaneseCountry(candidate.country)&&
    independentCityProof(japaneseMunicipalityName(candidate.city!),candidate);
  if(!independentCityProof(candidate.city!,candidate)&&!japaneseCityProof&&!municipalityCityLabels(resolved.countryCode,candidate.city)
    .some(city=>independentCityProof(city,candidate)))return null;
  const reportedType=resolved.providerResultType??'';
  const sourceDistrict=approximateDistrict(candidate);
  const entityName=resolved.providerName??resolved.displayName.split(',')[0];
  // Some administrative districts are reported as `city`. Their own evidenced
  // name and a separately corroborated parent city establish the smaller zone;
  // neither provider fields nor the original candidate are rewritten.
  const type=reportedType==='city'&&sourceDistrict&&words(entityName)!==words(candidate.city!)&&
    literalProof(entityName,candidate)&&administrativeRegionMatches(sourceDistrict,
      {...resolved,city:entityName,region:null,administrativeLabels:{}})?'district':reportedType;
  let level:ContextualVenueArea['level'];
  let radius=verifiedAreaRadius(resolved);
  const missingDetails=['venue_identity'];
  if(['building','house','housenumber'].includes(type)){
    // A named POI/occupant is never used as a proxy for the source business.
    if(resolved.providerName!=null||resolved.providerNameAliases?.length||resolved.category?.startsWith('public_transport')||
      conflictingAdministrativeContext(candidate,resolved)||conflictingInterior(candidate.address,resolved.address,resolved.countryCode))return null;
    const address=approximateAddress(candidate);
    if(!address)return null;
    const sourceUnits=units(candidate.address),providerUnits=units(resolved.address);
    const decision=decidePlaceResolution({candidate:{...candidate,name:null,address,region:null},resolved});
    if(decision.precision!=='EXACT'||!decision.reasons.includes('verified_street_address'))return null;
    level='building';radius=radius===null?100:Math.max(50,radius);
    if(sourceUnits.length&&!sourceUnits.every(unit=>providerUnits.includes(unit)))missingDetails.push('unit');
    if(addressParts(candidate.address,resolved.countryCode).some(part=>floorComponent.test(part)||japaneseFloor(part,resolved.countryCode)!==null))missingDetails.push('floor');
  }else if(type==='street'){
    // A numbered address may be represented by its source street envelope,
    // provided the complete street wording is independently corroborated.
    if(!resolved.street||!candidate.address||radius===null||resolved.providerRank!==1||conflictingAdministrativeContext(candidate,resolved))return null;
    const street=words(resolved.street);
    const source=addressParts(approximateAddress(candidate)).map(part=>words(part).replace(/^\d+[a-z]?(?:[-/]\d+)?\s+/u,'').replace(/\s+\d+[a-z]?$/u,''));
    if(!source.includes(street)||!literalProof(resolved.street,candidate))return null;
    if(resolved.providerName&&!['street',words(resolved.street)].includes(words(resolved.providerName)))return null;
    level='street';radius=Math.max(100,radius);missingDetails.push('street_number');
  }else if(['district','suburb','neighbourhood','quarter'].includes(type)){
    const name=resolved.providerName??resolved.displayName.split(',')[0];
    const district=approximateDistrict(candidate)??addressDistrictHint(candidate,resolved);
    // A shared caption can mention several neighbourhoods. Only the district
    // attached to this candidate may narrow its envelope.
    if(radius===null||resolved.providerRank!==1||!district||!literalProof(name,candidate)||
      (!administrativeRegionMatches(district,resolved)&&words(district)!==words(name))||conflictingAdministrativeContext(candidate,resolved))return null;
    level='district';radius=Math.max(250,radius);missingDetails.push('street_address');
  }else if(['city','town','village','municipality','locality'].includes(type)){
    if(radius===null||resolved.providerRank!==1||conflictingAdministrativeContext(candidate,resolved))return null;
    const areaCandidate={...candidate,name:candidate.city,address:null,region:null,category:'city' as const};
    if(decidePlaceResolution({candidate:areaCandidate,resolved}).precision!=='APPROXIMATE')return null;
    level='city';radius=Math.max(1000,radius);missingDetails.push('street_address');
  }else return null;
  const sourceName=groundedVenueName(candidate)!;
  return {resolved,scored:{precision:'APPROXIMATE',confidence:.5,approximationRadiusMeters:radius,
    contextualArea:{level,sourceName,missingDetails},reasons:['contextual_venue_area',`contextual_area_${level}`,
      ...missingDetails.map(detail=>`unverified_${detail}`),...(!candidate.country?['inferred_country_from_verified_area']:[]),RESOLUTION_POLICY_VERSION]}};
}

export function selectContextualVenueArea(candidate:PlaceCandidate,results:readonly ResolvedPlaceCandidate[]) {
  if(!canApproximateVenue(candidate))return null;
  const evaluated=[...new Map(results.flatMap(resolved=>{
    const value=evaluateAnchor(candidate,resolved);return value?[[`${resolved.provider}:${resolved.providerPlaceId}`,value] as const]:[];
  })).values()];
  for(const level of ['building','street','district','city'] as const){
    const matches=evaluated.filter(value=>value.scored.contextualArea?.level===level)
      .sort((a,b)=>a.scored.approximationRadiusMeters!-b.scored.approximationRadiusMeters!||a.resolved.providerPlaceId.localeCompare(b.resolved.providerPlaceId));
    if(matches.some((match,index)=>matches.slice(index+1).some(other=>distanceMeters(match.resolved,other.resolved)>100)))continue;
    if(matches.length)return matches[0];
  }
  return null;
}
