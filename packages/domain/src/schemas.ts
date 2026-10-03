import { z } from 'zod';

export const ProviderIdSchema = z.enum(['freeteknomusic','soundcloud','archiveorg','discogs','youtube','hearthis']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;
export const EntityRoleSchema = z.enum(['artist','crew','label']);
export type EntityRole = z.infer<typeof EntityRoleSchema>;
export type IndexKind = 'mix' | EntityRole | 'event';
export type RecordId = string;
export const TextSchema = z.string().trim().min(1).max(1000);
export const HttpUrlSchema = z.string().max(2048).refine(value => {
 try { const url=new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password && !url.port; } catch { return false; }
}, 'A public HTTP(S) URL without credentials is required');
const countries = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
export const CountrySchema = z.string().trim().toUpperCase().refine(value=>countries.has(value),'Use an ISO country code');
export const DateValueSchema = z.strictObject({value:z.string(),precision:z.enum(['year','month','day'])}).refine(({value,precision})=>{
 const pattern=precision==='year'?/^\d{4}$/:precision==='month'?/^\d{4}-\d{2}$/:/^\d{4}-\d{2}-\d{2}$/;
 if (!pattern.test(value) || value.startsWith('0000')) return false;
 const full=precision==='year'?value+'-01-01':precision==='month'?value+'-01':value;
 const time=Date.parse(full+'T00:00:00Z');
 return Number.isFinite(time) && new Date(time).toISOString().slice(0,value.length)===value;
}, 'Date and precision must describe a real calendar date');
export type DateValue = z.infer<typeof DateValueSchema>;
export const ProviderRefSchema = z.strictObject({provider:z.enum([...ProviderIdSchema.options,'web']),resourceType:z.enum(['audio','item','track','video','artist','label','user','channel','page']),url:HttpUrlSchema,externalId:z.string().trim().min(1).max(512).optional()}).refine(ref=>{
 const types:Record<string,string[]>={freeteknomusic:['audio','page'],soundcloud:['track','user'],archiveorg:['item','audio','page'],discogs:['artist','label'],youtube:['video','channel'],hearthis:['track','user'],web:['page']};
 return types[ref.provider].includes(ref.resourceType);
}, 'Resource type does not belong to this provider');
export type ProviderRef = z.infer<typeof ProviderRefSchema>;
export const MediaAssetSchema = z.strictObject({
 url:z.string().max(2048).refine(value=>HttpUrlSchema.safeParse(value).success || /^\/api\/catalog\/media\/[a-zA-Z0-9-]+$/.test(value),'Invalid media URL'),
 kind:z.enum(['cover','portrait','crew-logo','label-logo','flyer','waveform']),source:z.enum([...ProviderIdSchema.options,'curator','analysis']).optional(),
 sourceUrl:HttpUrlSchema.optional(),width:z.number().int().positive().max(10000).optional(),height:z.number().int().positive().max(10000).optional(),analyzedAt:z.iso.datetime().optional(),
});
export type MediaAsset=z.infer<typeof MediaAssetSchema>;
const asset=(kind:MediaAsset['kind'])=>MediaAssetSchema.refine(value=>value.kind===kind,'Incorrect image role');
const ids=z.array(TextSchema).max(100).default([]);
const texts=z.array(TextSchema).max(100).default([]);
const common={id:TextSchema,revision:z.number().int().positive(),verification:z.enum(['proposed','source-confirmed','curator-confirmed']),reviewState:z.enum(['ready','review']),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),sources:z.array(ProviderRefSchema).max(100).default([])};
export const MixRecordSchema=z.strictObject({...common,category:z.literal('mix'),title:TextSchema,artistIds:ids,crewIds:ids,labelIds:ids,eventIds:ids,
 description:z.string().trim().min(1).max(100000).optional(),durationMs:z.number().int().positive().max(7*24*3600000).optional(),recordedAt:DateValueSchema.optional(),uploadedAt:DateValueSchema.optional(),genres:texts,styles:texts,
 artwork:z.array(asset('cover')).max(10).default([]),waveform:asset('waveform').optional(),fileUrl:HttpUrlSchema.optional(),streamUrl:HttpUrlSchema.optional(),location:TextSchema.optional(),venue:TextSchema.optional(),bpmRange:z.tuple([z.number().positive().max(1000),z.number().positive().max(1000)]).refine(v=>v[0]<=v[1]).optional(),loudnessLufs:z.number().min(-100).max(10).optional(),
});
export const EntityRelationshipSchema=z.strictObject({targetId:TextSchema,relation:z.enum(['member-of','member','parent-label','sub-label','alias-of'])});
export const EntityRecordSchema=z.strictObject({...common,category:z.literal('entity'),displayName:TextSchema,roles:z.array(EntityRoleSchema).min(1).max(3),aliases:texts,profile:z.string().trim().min(1).max(100000).optional(),realName:TextSchema.optional(),country:CountrySchema.optional(),portrait:asset('portrait').optional(),crewLogo:asset('crew-logo').optional(),labelLogo:asset('label-logo').optional(),websites:z.array(HttpUrlSchema).max(30).default([]),contactInfo:z.string().max(10000).optional(),relationships:z.array(EntityRelationshipSchema).max(200).default([])}).superRefine((record,ctx)=>{
 for (const [field,role] of [['realName','artist'],['portrait','artist'],['crewLogo','crew'],['labelLogo','label'],['contactInfo','label']] as const) if(record[field] && !record.roles.includes(role)) ctx.addIssue({code:'custom',path:[field],message:'Field requires '+role+' role'});
});
export const EventRecordSchema=z.strictObject({...common,category:z.literal('event'),name:TextSchema,date:DateValueSchema.optional(),endDate:DateValueSchema.optional(),venue:TextSchema.optional(),location:TextSchema.optional(),country:CountrySchema.optional(),flyer:asset('flyer').optional(),organizerIds:ids,description:z.string().trim().min(1).max(100000).optional()}).refine(record=>!record.date || !record.endDate || record.date.value<=record.endDate.value,'Event ends before it starts');
export const CatalogRecordSchema=z.discriminatedUnion('category',[MixRecordSchema,EntityRecordSchema,EventRecordSchema]);
export type MixRecord=z.infer<typeof MixRecordSchema>;
export type EntityRecord=z.infer<typeof EntityRecordSchema>;
export type EventRecord=z.infer<typeof EventRecordSchema>;
export type CatalogRecord=z.infer<typeof CatalogRecordSchema>;
export const FieldClaimSchema=z.strictObject({id:TextSchema.optional(),targetRecordId:TextSchema,field:TextSchema,value:z.json(),provider:z.enum([...ProviderIdSchema.options,'curator','analysis']),sourceUrl:HttpUrlSchema,resource:ProviderRefSchema.optional(),observedAt:z.iso.datetime(),evidence:z.enum(['direct','parsed','curated','analysis']),match:z.enum(['confirmed','review']),reason:z.string().min(1).max(4000),confidence:z.number().min(0).max(1).default(0.8),state:z.enum(['selected','corroborated','pending','rejected']).default('pending'),recordRevision:z.number().int().positive().optional(),excerpt:z.string().max(4000).optional()});
export type FieldClaim=z.infer<typeof FieldClaimSchema>;
export const CatalogDetailSchema=z.strictObject({record:CatalogRecordSchema,related:z.array(CatalogRecordSchema).default([]),claims:z.array(FieldClaimSchema).default([]),missingFields:z.array(z.string()),completeness:z.number().min(0).max(1)});
export type CatalogDetail=z.infer<typeof CatalogDetailSchema>;
export const ReviewItemSchema=z.strictObject({id:TextSchema,recordId:TextSchema,field:TextSchema,current:z.json().optional(),candidate:FieldClaimSchema,recordRevision:z.number().int().positive(),createdAt:z.iso.datetime()});
export type ReviewItem=z.infer<typeof ReviewItemSchema>;
export interface PageQuery {q?:string;offset?:number;limit?:number;includeProposed?:boolean}
export const CatalogPageSchema=z.strictObject({items:z.array(CatalogRecordSchema),related:z.array(CatalogRecordSchema).default([]),total:z.number().int().nonnegative(),nextOffset:z.number().int().nonnegative().nullable()});
export type CatalogPage=z.infer<typeof CatalogPageSchema>;
export const EnrichmentReportSchema=z.strictObject({record:CatalogDetailSchema,applied:z.array(z.string()),corroborated:z.array(z.string()),reviewed:z.array(z.string()),missing:z.array(z.string()),attempted:z.array(ProviderIdSchema),failures:z.array(z.strictObject({provider:ProviderIdSchema,message:z.string()})),runId:TextSchema.optional(),state:z.enum(['complete','interrupted']).default('complete')});
export type EnrichmentReport=z.infer<typeof EnrichmentReportSchema>;
export const ImportResultSchema=z.strictObject({record:CatalogDetailSchema,created:z.boolean(),reviewItems:z.number().int().nonnegative()});
export type ImportResult=z.infer<typeof ImportResultSchema>;
export const MigrationResultSchema=z.strictObject({batchId:TextSchema,outcomes:z.array(z.strictObject({legacyId:TextSchema,status:z.enum(['imported','existing','skipped','error']),recordId:TextSchema.optional(),message:z.string().optional()}))});
export type MigrationResult=z.infer<typeof MigrationResultSchema>;
export interface CuratorActor {sessionId:string}
export const LegacyMixSchema=z.object({id:TextSchema,title:TextSchema,artists:texts,crews:texts,event:TextSchema.optional(),venue:TextSchema.optional(),location:TextSchema.optional(),recordedAt:z.string().optional(),durationMs:z.number().finite().nonnegative().optional(),description:z.string().optional(),genres:texts,styles:texts,artwork:z.array(z.object({url:HttpUrlSchema,kind:z.enum(['cover','artist','crew','event']),source:z.string()})).default([]),sources:z.array(z.object({provider:ProviderIdSchema,url:HttpUrlSchema,externalId:z.string().optional()})).min(1).max(100),entities:z.array(z.object({kind:EntityRoleSchema,name:TextSchema,provider:ProviderIdSchema.optional(),externalId:z.string().optional(),url:HttpUrlSchema.optional(),profile:z.string().optional(),imageUrl:HttpUrlSchema.optional()})).default([]),provenance:z.array(z.record(z.string(),z.unknown())).default([]),candidates:z.array(z.record(z.string(),z.unknown())).default([]),waveform:z.object({imageDataUrl:z.string().max(2000000),analyzedAt:z.iso.datetime(),sourceUrl:HttpUrlSchema}).optional(),status:z.string().optional(),createdAt:z.iso.datetime().optional(),updatedAt:z.iso.datetime().optional()});
export type LegacyMix=z.infer<typeof LegacyMixSchema>;
