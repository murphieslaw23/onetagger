import {test,expect,vi} from 'vitest';import {request} from './api';import {CatalogDetailSchema} from '@syco23/mixsets-domain';
test('transport includes curator cookies and rejects malformed canonical responses',async()=>{
 const mocked=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({record:{id:'mix',title:'Malformed'}}));try{await expect(request('/catalog/records/mix',CatalogDetailSchema)).rejects.toThrow('invalid catalog data');expect(mocked.mock.calls[0][1]?.credentials).toBe('include');}finally{mocked.mockRestore();}
});
