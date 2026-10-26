import {foldForSearch} from '@/lib/import/normalize';
import type {ResolvedPlaceCandidate} from '@/server/places/resolvers/types';

export const isJapaneseCountry=(country:string|null)=>Boolean(country&&['jp','japan','japon','日本'].includes(foldForSearch(country)));
export const isBelgianCountry=(country:string|null)=>Boolean(country&&['be','belgium','belgique','belgie','belgien'].includes(foldForSearch(country)));

// Official closed list and bilingual identities. These are municipalities, not
// interchangeable neighbours: only a separately proved parent can add Brussels.
// https://be.brussels/en/about-region/structure-and-organisations/local-authorities-and-municipalities/municipalities
// https://www.vlaanderen.be/gemeenten-en-provincies/brussel/het-brusselse-hoofdstedelijke-gewest
const brusselsMunicipalities=[
  ['Brussels','Bruxelles','Brussel'],['Anderlecht'],['Ixelles','Elsene'],['Etterbeek'],['Evere'],
  ['Ganshoren'],['Jette'],['Koekelberg'],['Auderghem','Oudergem'],['Schaerbeek','Schaarbeek'],
  ['Berchem-Sainte-Agathe','Sint-Agatha-Berchem'],['Saint-Gilles','Sint-Gillis'],
  ['Molenbeek-Saint-Jean','Sint-Jans-Molenbeek'],['Saint-Josse-ten-Noode','Sint-Joost-ten-Node'],
  ['Woluwe-Saint-Lambert','Sint-Lambrechts-Woluwe'],['Woluwe-Saint-Pierre','Sint-Pieters-Woluwe'],
  ['Uccle','Ukkel'],['Forest','Vorst'],['Watermael-Boitsfort','Watermaal-Bosvoorde'],
] as const;
const belgianLabel=(value:string)=>foldForSearch(value).replace(/[-\s]+/gu,' ').trim();
export function belgianMunicipalityAliases(countryCode:string|null,value:string|null):readonly string[]{
  if(countryCode?.trim().toUpperCase()!=='BE'||!value)return [];
  const parts=value.split(/\s+[-–—/]\s+/u).map(belgianLabel);
  return brusselsMunicipalities.find(names=>parts.every(part=>names.some(name=>belgianLabel(name)===part)))??[];
}
const brusselsRegions=new Set(['Brussels-Capital Region','Brussels Capital','Brussels-Capital',
  'Région de Bruxelles-Capitale','Région Bruxelles-Capitale','Bruxelles-Capitale',
  'Brussels Hoofdstedelijk Gewest','Brussel Hoofdstedelijk Gewest'].map(belgianLabel));
export function brusselsMunicipalityParentLabels(countryCode:string|null,state:string|null,city:string|null,subdivisionCode:string|null=null):readonly string[]{
  if(countryCode?.trim().toUpperCase()!=='BE'||!belgianMunicipalityAliases(countryCode,city).length)return [];
  const code=subdivisionCode?.trim().toUpperCase();
  if((state&&!brusselsRegions.has(belgianLabel(state)))||(code&&code!=='BE-BRU'))return [];
  if(!state&&code!=='BE-BRU')return [];
  return brusselsMunicipalities[0];
}

// Comparison only: expand complete Belgian street-type abbreviations, leaving
// numbers, interior qualifiers and all raw source/provider strings untouched.
export function belgianStreetSpelling(value:string,countryCode:string|null):string{
  if(countryCode?.trim().toUpperCase()!=='BE')return value;
  return value.replace(/(^|[,;]\s*)(\s*(?:\d{1,6}[a-z]?(?:[-/]\d{1,6}[a-z]?)*\s+)?)((?:chau|pl)\.)(?=\s+\p{L})/giu,
    (_match,start:string,number:string,kind:string)=>`${start}${number}${kind.toLowerCase()==='chau.'?'Chaussée':'Place'}`);
}

// These are administrative suffixes, not translations or parent-city aliases.
// In particular Shibuya and Tokyo must remain different location identities.
export function japaneseMunicipalityName(value:string):string {
  return value.trim().replace(/(?:\s+(?:city|ward)|[-\s](?:ku|shi))$/iu,'').replace(/(?<=\p{Script=Han})[区市]$/u,'');
}

export function japaneseMunicipalityMatches(left:string,right:string,countryCode:string|null):boolean {
  const level=(value:string)=>/(?:\s+city|[-\s]shi|\p{Script=Han}市)$/iu.test(value.trim())?'city'
    :/(?:\s+ward|[-\s]ku|\p{Script=Han}区)$/iu.test(value.trim())?'ward':null;
  const leftLevel=level(left),rightLevel=level(right);
  // A bare provider city can corroborate "City", but cannot establish that a
  // same-named ward is that municipality rather than a child administration.
  return countryCode?.toUpperCase()==='JP'&&!(leftLevel&&rightLevel&&leftLevel!==rightLevel)
    &&!((leftLevel==='ward'||rightLevel==='ward')&&leftLevel!==rightLevel)
    &&foldForSearch(japaneseMunicipalityName(left))===foldForSearch(japaneseMunicipalityName(right));
}

// A source region can be a prefecture even when a geocoder omits its state.
// Missing parent context is unknown; a different explicit parent still conflicts.
const japanesePrefectures=new Set(('Aichi Akita Aomori Chiba Ehime Fukui Fukuoka Fukushima Gifu Gunma Hiroshima Hokkaido Hyogo Ibaraki Ishikawa Iwate Kagawa Kagoshima Kanagawa Kochi Kumamoto Kyoto Mie Miyagi Miyazaki Nagano Nagasaki Nara Niigata Oita Okayama Okinawa Osaka Saga Saitama Shiga Shimane Shizuoka Tochigi Tokushima Tokyo Tottori Toyama Wakayama Yamagata Yamaguchi Yamanashi').toLowerCase().split(' '));
export function japanesePrefectureName(value:string):string|null {
  const name=foldForSearch(value).replace(/(?:\s+(?:prefecture|metropolis)|[-\s](?:ken|to|fu))$/u,'');
  return japanesePrefectures.has(name)?name:null;
}

export function japaneseFloor(value:string,countryCode:string|null):string|null {
  const match=countryCode?.toUpperCase()==='JP'?value.trim().match(/^(B)?(\d{1,3})F$/iu):null;
  return match?`${match[1]?'-':''}${Number(match[2])}`:null;
}

export function addressComponents(address:string|null,countryCode:string|null=null):string[] {
  return (address??'').split(/[,;]/u).map(value=>value.trim()).filter(Boolean).flatMap(part=>{
    // Split only a floor prefix followed by a complete numbered address. A
    // business or street called "1F Cafe" is not an interior qualifier.
    const match=countryCode?.toUpperCase()==='JP'?part.match(/^((?:B)?\d{1,3}F)\s+(\d{1,6}[a-z]?(?:[-/]\d{1,6}[a-z]?)*\s+\p{L}.*)$/iu):null;
    return match?[match[1],match[2]]:[part];
  });
}

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

// Closed special-ward list from the Tokyo Metropolitan Government:
// https://www.english.metro.tokyo.lg.jp/municipalities-within-tokyo
// Tokyo's other cities, towns and villages are not interchangeable with its
// urban special-ward locality. A state or an address fragment alone is no proof.
const tokyoSpecialWards=new Set(('Adachi Arakawa Bunkyo Chiyoda Chuo Edogawa Itabashi Katsushika Kita Koto Meguro Minato Nakano Nerima Ota Setagaya Shibuya Shinagawa Shinjuku Suginami Sumida Taito Toshima').toLowerCase().split(' '));
export function tokyoSpecialWardParentLabels(countryCode:string|null,state:string|null,city:string|null,subdivisionCode:string|null=null):readonly string[] {
  if(countryCode?.trim().toUpperCase()!=='JP'||!city)return [];
  const code=subdivisionCode?.trim().toUpperCase();
  // ISO 3166-2 JP-13 identifies Tokyo even when the provider omits its state.
  // Missing labels cannot override a conflicting explicit state or subdivision.
  if((state&&japanesePrefectureName(state)!=='tokyo')||(code&&/^JP-\d{2}$/u.test(code)&&code!=='JP-13'))return [];
  if(!state&&code!=='JP-13')return [];
  const name=foldForSearch(city).replace(/(?:\s+(?:city|ward)|[-\s]ku)$/u,'');
  return tokyoSpecialWards.has(name)?['Tokyo']:[];
}

export function administrativeRegionMatches(region:string,resolved:ResolvedPlaceCandidate):boolean {
  const prefecture=resolved.countryCode==='JP'?japanesePrefectureName(region):null;
  if(prefecture){
    const states=[resolved.region,resolved.administrativeLabels?.state];
    if(states.some(label=>label&&japanesePrefectureName(label)===prefecture))return true;
    return prefecture==='tokyo'&&states.every(label=>!label||japanesePrefectureName(label)==='tokyo')&&
      tokyoSpecialWardParentLabels(resolved.countryCode,resolved.region,resolved.city,resolved.subdivisionCode).length>0;
  }
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
