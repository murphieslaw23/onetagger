import { EntityRecordSchema, MixRecordSchema, FieldClaimSchema } from '@syco23/mixsets-domain';
export const stamp='2026-10-03T10:00:00.000Z';
const common={revision:1,verification:'source-confirmed',reviewState:'ready',createdAt:stamp,updatedAt:stamp,sources:[]};
export function artist(id='artist'){return EntityRecordSchema.parse({...common,id,category:'entity',displayName:'Kan10',roles:['artist'],aliases:[],websites:[],relationships:[]});}
export function mix(id='mix'){return MixRecordSchema.parse({...common,id,category:'mix',title:'Live Koalisson III',artistIds:[],crewIds:[],labelIds:[],eventIds:[],genres:[],styles:[],artwork:[]});}
export function claim(targetRecordId='artist',field='profile',value:unknown='French artist'){return FieldClaimSchema.parse({targetRecordId,field,value,provider:'discogs',sourceUrl:'https://www.discogs.com/artist/724857',observedAt:stamp,evidence:'direct',match:'confirmed',reason:'Confirmed source identity',confidence:.9,state:'pending'});}
export const actor={sessionId:'test-curator'};
