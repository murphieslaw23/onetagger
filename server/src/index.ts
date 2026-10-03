import { join } from 'node:path';
import { openCatalog } from './catalog/repository.js';
import { createApiServer } from './app.js';
const port=Number(process.env.PORT||8787);
const catalog=openCatalog(process.env.CATALOG_PATH||join(process.cwd(),'.data/catalog.sqlite'));
const server=createApiServer({catalog,passwordHash:process.env.CURATOR_PASSWORD_HASH||'',origins:(process.env.CORS_ORIGIN||'https://mixsets.syco23.org,http://localhost:5173,http://127.0.0.1:5173').split(',').map(v=>v.trim()).filter(Boolean),secureCookies:process.env.NODE_ENV==='production'});
server.listen(port,'0.0.0.0',()=>console.log(`SYCO23 Mixsets API listening on :${port}`));
process.on('SIGTERM',()=>server.close(()=>{catalog.close();process.exit(0);}));
process.on('SIGINT',()=>server.close(()=>{catalog.close();process.exit(0);}));
