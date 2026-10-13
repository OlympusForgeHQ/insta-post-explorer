import {foldForSearch} from '@/lib/import/normalize';
import {entityNamesAgree} from './scoring';
import type {PlaceCandidate} from './candidates';

const tokens=(value:string)=>foldForSearch(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const contains=(source:string,value:string)=>tokens(value).length>=3&&` ${tokens(source)} `.includes(` ${tokens(value)} `);

// Recovery may fill missing geography or isolate an explicit address/alias. It
// cannot rewrite an asserted identity merely by keeping the same source quote.
export function isSupportedRecovery(before:PlaceCandidate,after:PlaceCandidate):boolean {
  for(const field of ['city','region','country'] as const){
    if(before[field] && !before.inferredFields?.includes(field) && after.inferredFields?.includes(field))return false;
    if(before[field]&&foldForSearch(before[field])!==foldForSearch(after[field]??''))return false;
    if(!before[field]&&after[field]&&!after.inferredFields?.includes(field))return false;
  }
  if(before.name!==after.name){
    if(!before.name||!after.name||!(entityNamesAgree(before.name,after.name)||contains(before.name,after.name)))return false;
  }
  if(before.address!==after.address){
    if(!after.address)return false;
    if(before.address){
      // Retain all asserted address components. Only split complete, explicitly
      // separated branch addresses; dropping a house number changes identity.
      const branches=before.address.split(/\s*[;|]\s*|\s+\/\s+/u);
      const explicitBranches=branches.length>1&&branches.every(branch=>/^\d{1,6}[a-z]?\s+\p{L}+\s+\p{L}/iu.test(tokens(branch)));
      if(tokens(before.address)!==tokens(after.address)&&!(explicitBranches&&branches.some(branch=>tokens(branch)===tokens(after.address!))))return false;
    }else if(!before.evidence.some(item=>contains(item.excerpt,after.address!)))return false;
  }
  return true;
}
