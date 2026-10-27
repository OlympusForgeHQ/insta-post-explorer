import {foldForSearch} from '@/lib/import/normalize';
import type {CityBranchSourceContext} from '@/lib/places/branch-scope';
import type {PlaceCandidate} from '@/lib/places/candidates';
import {verifiedAdministrativeCityNames,addressComponents,administrativeRegionMatches,belgianMunicipalityAliases,belgianStreetSpelling,isBelgianCountry,isJapaneseCountry,japaneseFloor,japaneseMunicipalityMatches,japaneseMunicipalityName,japanesePrefectureName,municipalityCityLabels} from '@/lib/places/administrative-context';
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
    ...(isJapaneseCountry(candidate.country)?[japaneseMunicipalityName(candidate.city)]:[]),
    ...(isBelgianCountry(candidate.country)?belgianMunicipalityAliases('BE',candidate.city):[])];
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
  return [...new Set(variants)].find(value=>(words(value).length>=3||/^[\p{Script=Han}]{2}$/u.test(words(value)))&&distinctive(value)&&(literalProof(value,{...candidate,evidence:candidate.evidence.map(item=>({...item,excerpt:item.excerpt.replace(/[@#][\p{L}\p{N}_.]+/gu,' ')}))})||literalHandleProof(value,candidate)))??null;
}

// A handle can spell the complete proposed name without spaces. It cannot
// establish a branch, a city suffix or a fuzzy prefix of another business.
function literalHandleProof(value:string,candidate:PlaceCandidate):boolean {
  const compact=words(value).replace(/ /gu,'');
  if(compact.length<8)return false;
  return candidate.evidence.some(item=>literalTypes.includes(item.type)&&
    [...item.excerpt.matchAll(/(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_.]+)/gu)]
      .some(match=>words(match[1]).replace(/ /gu,'')===compact));
}

// Recover bounded literal context omitted from an extraction excerpt. This
// does not infer fields or broaden branch scope; the original input/evidence
// stays unchanged and provider verification remains mandatory.
export function enrichApproximationEvidence(candidate:PlaceCandidate,source?:CityBranchSourceContext):PlaceCandidate {
  if(!source?.caption||!candidate.name||!candidate.city||candidate.evidence.length>=8)return candidate;
  const caption=source.caption;
  const lines=(text:string)=>text.split(/\r?\n/u).map(line=>line.trim()).filter(line=>line.length>0&&line.length<=500);
  const proof=(excerpt:string)=>({...candidate,evidence:[{type:'CAPTION' as const,excerpt}]});
  const cityProof=(excerpt:string)=>cityAliases(candidate).some(city=>independentCityProof(city,proof(excerpt)));
  const captionLines=lines(caption);
  const grounded=groundedVenueName(candidate);
  const venueLine=captionLines.find(excerpt=>groundedVenueName(proof(excerpt)));
  const existingLiteral=candidate.evidence.some(item=>item.type!=='CAPTION'||caption.includes(item.excerpt));
  if(!existingLiteral||(!grounded&&!venueLine))return candidate;
  const blocks=caption.split(/\r?\n\s*\r?\n|(?=^\s*\d{1,3}[.)]\s)/mu);
  const ownBlocks=venueLine?blocks.filter(block=>lines(block).includes(venueLine)):[];
  // Only the venue's own line and the explicit location line in its bounded
  // item can supply locality. Another recommendation never contributes a city.
  const ownLines=ownBlocks.length===1?lines(ownBlocks[0]):[];
  const literalAddressCity=candidate.address&&caption.includes(candidate.address)&&cityProof(candidate.address)?candidate.address:null;
  const cityAtEnd=(line:string)=>cityAliases(candidate).some(city=>
    ['in','a','en','de','of'].some(join=>words(line).endsWith(` ${join} ${words(city)}`))||
    line.split(',').some((part,index,parts)=>index===parts.length-1&&words(part)===words(city)));
  const ownCityLine=venueLine&&cityProof(venueLine)&&cityAtEnd(venueLine)?venueLine:null;
  // A guide header must explicitly end in its geographic scope. Business
  // names, hashtags and free text elsewhere in the caption are not headers.
  const header=captionLines[0]??'';
  const headerWords=words(header);
  const uncorroboratedLocation=ownLines.some(line=>/^📍/u.test(line)&&!cityProof(line));
  const globalCity= !uncorroboratedLocation&&!/[@#]/u.test(header)&&/\b(?:things to do|adresses?|addresses|guide|spots|places|ideas|idees|activites|sorties|lieux)\b/u.test(headerWords)&&
    cityAliases(candidate).some(city=>['in','a','en','de','of'].some(join=>headerWords.endsWith(` ${join} ${words(city)}`)))?header:null;
  const context=[...ownLines,...candidate.evidence.map(item=>item.excerpt)];
  const ownContradiction=context.some(line=>{
    const asserted=line.match(/(?:^|[^\p{L}\p{N}])(?:in|à|ville\s*:|city\s*:)\s+([^\n.!?;]+)[.!?]?$/iu)?.[1];
    return asserted&&!cityAliases(candidate).some(city=>words(asserted)===words(city));
  });
  if(ownContradiction)return candidate;
  const cityLine=literalAddressCity||ownCityLine||globalCity;
  const additions=[...(!grounded&&venueLine?[venueLine]:[]),...(cityLine?[cityLine]:[])]
    .filter((excerpt,index,all)=>all.indexOf(excerpt)===index&&!candidate.evidence.some(item=>item.type==='CAPTION'&&item.excerpt===excerpt));
  if(candidate.evidence.length+additions.length>8||(!additions.length&&!(cityLine&&candidate.inferredFields?.includes('city'))))return candidate;
  return {...candidate,...(cityLine&&candidate.inferredFields?.includes('city')?{inferredFields:candidate.inferredFields.filter(field=>field!=='city')}:{}),
    evidence:[...candidate.evidence,...additions.map(excerpt=>({type:'CAPTION' as const,excerpt}))]};
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

// Comparison-only bridge: retain the original extraction and evidence in the
// plan while evaluating the literal locality on a verified administrative entity.
export function bindVerifiedCityEvidence(candidate:PlaceCandidate,results:readonly ResolvedPlaceCandidate[]):PlaceCandidate {
  if(canApproximateVenue(candidate)||candidate.inferredFields?.includes('city')||!candidate.city||!candidate.country||!groundedVenueName(candidate))return candidate;
  for(const resolved of results){
    const names=verifiedAdministrativeCityNames(resolved);
    if(!names.some(name=>words(name)===words(candidate.city!)))continue;
    const comparison=scoreResolvedCandidate({candidate:{...candidate,name:null,address:null,region:null,category:'city'},resolved});
    if(!comparison.reasons.includes('country_match')||comparison.reasons.some(reason=>reason.endsWith('_contradiction')))continue;
    const literal=names.find(name=>words(name)!==words(candidate.city!)&&independentCityProof(name,candidate));
    if(!literal)continue;
    const cityOnlyAddress=candidate.address&&names.some(name=>words(name)===words(candidate.address!));
    return {...candidate,city:literal,...(cityOnlyAddress?{address:null}:{})};
  }
  return candidate;
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
  if(district&&literalProof(district,candidate))return district;
  // A single explicitly named neighborhood is a retrieval hint only. A fresh
  // provider district must still corroborate its name, locality and bounds.
  const partial=candidate.address?.trim();
  if(!partial||partial.length>120||/[\d+,;|/]|[-–—]\s|\s[-–—]|\b(?:and|et)\b/iu.test(partial)||!literalProof(partial,candidate))return null;
  if([candidate.name,...cityAliases(candidate),candidate.country].some(value=>value&&words(value)===words(partial)))return null;
  return partial;
}

// A complete named street or square can be a zone even when no number was
// supplied. Its geometry and full name must still be verified independently.
export function approximateStreet(candidate:PlaceCandidate):string|null {
  const countryCode=isBelgianCountry(candidate.country)?'BE':null;
  if(countryCode){
    const numbered=addressParts(approximateAddress(candidate)).flatMap(part=>{
      const street=withoutStreetNumber(part);
      return street!==part&&isStreetName(street,countryCode)?[{part,street}]:[];
    });
    if(numbered.length)return numbered.length===1&&literalProof(numbered[0].part,candidate)?numbered[0].street:null;
  }
  const value=approximateDistrict(candidate);
  if(!value)return null;
  return isStreetName(value,countryCode)?value:null;
}

const streetKey=(value:string,countryCode:string|null)=>words(belgianStreetSpelling(value,countryCode));
const isStreetName=(value:string,countryCode:string|null)=>/^(?:rue|place|avenue|boulevard|square|road|street|chaussee|quai|allee|impasse)\s+\p{L}|\p{L}\s+(?:street|road|avenue|square)$/u.test(streetKey(value,countryCode));
// Remove a whole edge house number before punctuation folding, so 133/135 or
// 12a-14b cannot leave a fragment masquerading as part of the street name.
function withoutStreetNumber(value:string):string {
  const number='\\d{1,6}[a-z]?(?:[-/]\\d{1,6}[a-z]?)*';
  return value.replace(new RegExp(`^${number}\\s+`,'iu'),'').replace(new RegExp(`\\s+${number}$`,'iu'),'');
}

// Only the provider's own complete bilingual street label supplies aliases.
// Accept one French/Dutch pair of the same street type, never a list of roads,
// a city suffix, an unspaced compound or a prefix of a longer street name.
function providerStreetKeys(value:string,countryCode:string|null):string[] {
  const full=streetKey(value,countryCode);
  if(countryCode!=='BE')return [full];
  const parts=value.split(/\s+[-–—/]\s+/u);
  if(parts.length!==2||parts.some(part=>part.length>120))return [full];
  const keys=parts.map(part=>streetKey(part,countryCode));
  const frenchTypes:Record<string,string>={rue:'street',place:'square',avenue:'avenue',chaussee:'causeway',allee:'alley',quai:'quay'};
  const dutchTypes:Record<string,string>={straat:'street',plein:'square',laan:'avenue',steenweg:'causeway',dreef:'alley',kaai:'quay'};
  const french=(key:string)=>frenchTypes[key.match(/^(rue|place|avenue|chaussee|allee|quai)\s+\p{L}/u)?.[1]??''];
  const dutch=(key:string)=>dutchTypes[key.match(/\p{L}\s*(straat|plein|laan|steenweg|dreef|kaai)$/u)?.[1]??''];
  return (french(keys[0])&&french(keys[0])===dutch(keys[1]))||(french(keys[1])&&french(keys[1])===dutch(keys[0]))
    ?[full,...keys]:[full];
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
  const providerCityProof=verifiedAdministrativeCityNames(resolved).some(city=>independentCityProof(city,candidate));
  const belgianCityProof=resolved.countryCode==='BE'&&isBelgianCountry(candidate.country)&&cityAliases(candidate).some(city=>independentCityProof(city,candidate));
  if(!independentCityProof(candidate.city!,candidate)&&!japaneseCityProof&&!belgianCityProof&&!providerCityProof&&!municipalityCityLabels(resolved.countryCode,candidate.city)
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
    if(resolved.countryCode==='BE'){
      // A broad provider city label cannot override an explicit source postcode.
      // Match the numbered-address policy, only for street envelopes: wider
      // districts/cities may legitimately contain several postal areas.
      const postcode=(value:string|null)=>value?.split(',').slice(1)
        .map(part=>part.trim().match(/^(\d{4})(?:\s+\p{L}|$)/u)?.[1]).find(Boolean);
      const sourcePostcode=postcode(candidate.address),providerPostcode=resolved.postalCode??postcode(resolved.address);
      if(sourcePostcode&&providerPostcode&&sourcePostcode!==providerPostcode)return null;
    }
    const streets=providerStreetKeys(resolved.street,resolved.countryCode);
    const source=addressParts(approximateAddress(candidate)??approximateStreet(candidate)).filter(part=>literalProof(part,candidate))
      .map(part=>streetKey(withoutStreetNumber(part),resolved.countryCode));
    if(!source.some(part=>streets.includes(part)))return null;
    if(resolved.providerName&&!['street',...streets].includes(streetKey(resolved.providerName,resolved.countryCode)))return null;
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
  candidate=bindVerifiedCityEvidence(candidate,results);
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
