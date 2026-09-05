import current from './generated/kernel.json';
import searchCompatibility from './generated/search-compatibility.json';
import type { ScientificInput } from './contracts';

/** Explicit compatibility: the older module implements search operations only. */
export function approvedRelease(id:string,input:ScientificInput){
  if(id===current.id)return current;
  if(id===searchCompatibility.id&&input.version==='vah-search-1')return searchCompatibility;
  throw Error('Restore the compatible approved release for this work type.');
}
