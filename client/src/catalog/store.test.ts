import {test,expect,vi} from 'vitest';import {MixRecordSchema} from '@syco23/mixsets-domain';
const module=await import('./store').catch(()=>null);
const stamp='2026-10-03T12:00:00.000Z';
export const record=MixRecordSchema.parse({id:'mix',category:'mix',title:'Server title',revision:1,verification:'source-confirmed',reviewState:'ready',createdAt:stamp,updatedAt:stamp,artistIds:[],crewIds:[],labelIds:[],eventIds:[],genres:[],styles:[],artwork:[],sources:[]});
export const detail={record,related:[],claims:[],missingFields:['artwork','description'],completeness:.5};
test('committed server responses control the archive; rejected writes do not appear saved',async()=>{
 expect(module).not.toBeNull();const transport={detail:vi.fn().mockResolvedValue(detail),patch:vi.fn().mockRejectedValue(Object.assign(new Error('Record revision changed'),{status:409}))};const store=module!.createCatalogStore(transport as never);await store.loadDetail('mix');await expect(store.updateRecord('mix',{title:'Not saved'},1)).rejects.toThrow('revision');const saved=store.state.details.mix.record;expect(saved.category==='mix'&&saved.title).toBe('Server title');expect(store.state.error).toContain('revision');
});
test('expired authentication leads to login and missing-field wording remains truthful',async()=>{
 expect(module).not.toBeNull();const transport={enrich:vi.fn().mockRejectedValue(Object.assign(new Error('Curator login required'),{status:401}))};const store=module!.createCatalogStore(transport as never);await expect(store.enrichRecord('mix')).rejects.toThrow();expect(store.state.requiresLogin).toBe(true);expect(module!.enrichmentMessage({record:detail,applied:[],reviewed:[],corroborated:[],missing:detail.missingFields,attempted:[],failures:[],state:'complete'})).toContain('2 fields still missing');
});
