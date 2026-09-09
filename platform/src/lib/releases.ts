import current from './generated/kernel.json';
import searchCompatibility from './generated/search-compatibility.json';
import type { ScientificInput } from './contracts';

/** Explicit compatibility: the older module implements search operations only. */
export function approvedRelease(id:string,input:ScientificInput){
  if(id===current.id)return current;
  if(id===searchCompatibility.id&&input.version==='vah-search-1')return searchCompatibility;
  throw Error('This task’s software release is not available. The project must restore a compatible approved release before this task can resume.');
}
