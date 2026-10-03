import { CatalogRecordSchema, type CatalogRecord } from './schemas.js';
import { normalizedSet } from './normalize.js';
export const editableFields:Record<CatalogRecord['category'],readonly string[]>={
 mix:['title','artistIds','crewIds','labelIds','eventIds','description','durationMs','recordedAt','uploadedAt','genres','styles','artwork','waveform','fileUrl','streamUrl','location','venue','bpmRange','loudnessLufs'],
 entity:['displayName','roles','aliases','profile','realName','country','portrait','crewLogo','labelLogo','websites','contactInfo','relationships'],
 event:['name','date','endDate','venue','location','country','flyer','organizerIds','description'],
};
export function isMissing(value:unknown):boolean { return value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length); }
export function validateField(record:CatalogRecord,field:string,value:unknown):unknown {
 if(!editableFields[record.category].includes(field))throw new Error('Field is not editable for '+record.category+': '+field);
 const normalized=Array.isArray(value)&&value.every(v=>typeof v==='string')?normalizedSet(value as string[]):value;
 const parsed=CatalogRecordSchema.parse({...record,[field]:normalized});
 return (parsed as unknown as Record<string,unknown>)[field];
}
export function missingFields(record:CatalogRecord):string[]{
 const fields=record.category==='mix'?['artwork','description','recordedAt','genres','artistIds','crewIds','eventIds','location','durationMs']:record.category==='event'?['date','venue','location','country','flyer']:['profile','country',...record.roles.flatMap(role=>role==='artist'?['portrait']:role==='crew'?['crewLogo']:['labelLogo'])];
 return fields.filter(field=>isMissing((record as unknown as Record<string,unknown>)[field]) && !(field==='genres'&&record.category==='mix'&&record.styles.length));
}
export function completeness(record:CatalogRecord):number {
 const fields=record.category==='mix'?10:record.category==='event'?6:2+record.roles.length+1;
 return Math.max(0,Math.min(1,(fields-missingFields(record).length)/fields));
}
