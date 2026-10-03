import http from 'node:http';
import { z } from 'zod';
import { ProviderIdSchema, HttpUrlSchema } from '@syco23/mixsets-domain';
import { ProviderRegistry } from './core/registry.js';
import { InMemoryJobQueue } from './jobs/in-memory.js';
import { enrichMix } from './core/enrichment.js';
import { WaveformQueue } from './core/waveform.js';
import { CatalogRepository, RevisionConflict } from './catalog/repository.js';
import { createCuratorAuth } from './auth/curator.js';
import { handleAuthRoute } from './auth/routes.js';
import { handleCatalogRoute } from './catalog/routes.js';
import { json as respond, body, requireCurator, requireOrigin, HttpError, type ApiContext } from './http.js';
const SearchSchema=z.object({q:z.string().max(1000).optional(),url:HttpUrlSchema.optional(),artist:z.string().max(1000).optional(),crew:z.string().max(1000).optional(),minDurationMs:z.number().int().nonnegative().max(604800000).optional(),durationExpectedMs:z.number().int().positive().max(604800000).optional(),maxDepth:z.number().int().min(0).max(10).optional(),maxItems:z.number().int().min(1).max(2500).optional(),limit:z.number().int().min(1).max(100).optional()}).strict().refine(v=>v.q||v.url||v.artist,'Search text or source URL is required');
const EnrichSchema=z.object({title:z.string().trim().min(1).max(1000),artists:z.array(z.string().max(1000)).max(100),crews:z.array(z.string().max(1000)).max(100).optional(),durationMs:z.number().int().positive().max(604800000).optional(),recordedAt:z.string().max(100).optional(),description:z.string().max(100000).optional(),genres:z.array(z.string().max(1000)).max(100).optional(),artwork:z.array(z.object({url:HttpUrlSchema,provider:ProviderIdSchema.optional(),kind:z.enum(['cover','artist','crew']).optional()})).max(10).optional(),sources:z.array(z.object({provider:ProviderIdSchema,url:HttpUrlSchema,externalId:z.string().max(512).optional()})).max(100).optional(),externalIds:z.record(z.string(),z.string().max(512)).optional()}).strip();
export function createApiServer(options:{catalog:CatalogRepository,passwordHash:string,origins:string[],registry?:ProviderRegistry,secureCookies?:boolean}){
 const registry=options.registry||new ProviderRegistry(),queue=new InMemoryJobQueue(registry),waveformQueue=new WaveformQueue();
 const context:ApiContext={catalog:options.catalog,auth:createCuratorAuth(options.catalog,options.passwordHash,options.secureCookies!==false),registry,origins:options.origins.filter(origin=>origin!=='*')};
 const json=(req:http.IncomingMessage,res:http.ServerResponse,status:number,value:unknown)=>respond(context,req,res,status,value);
 return http.createServer(async(req,res)=>{
  try{
   if(!req.url)throw new HttpError(404,'Not found');
   const url=new URL(req.url,'http://localhost');
   if(req.method==='OPTIONS'){requireOrigin(context,req);json(req,res,204,{});return;}
   if(!['GET','HEAD'].includes(req.method||'')){requireOrigin(context,req);if(url.pathname!=='/api/auth/login')requireCurator(context,req);}
   if(req.method==='GET'&&(/^\/api\/(jobs|waveforms)(\/|$)/.test(url.pathname)))requireCurator(context,req);
   if(await handleAuthRoute(context,req,res)||await handleCatalogRoute(context,req,res))return;
    if (req.method === 'GET' && url.pathname === '/api/live') {
      return json(req, res, 200, { ok: true, service: 'syco23-mixsets' });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(req, res, 200, { ok: true, service: 'syco23-mixsets', providers: await registry.health() });
    }
    if (req.method === 'GET' && url.pathname === '/api/providers') {
      return json(req, res, 200, await registry.health());
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      return json(req, res, 200, queue.list());
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const input = z.record(z.string(), z.any()).parse(await body(req));
      if (!input.provider || (!input.query?.q && !input.query?.url && !input.query?.artist)) return json(req, res, 400, { error: 'provider and query are required' });
      return json(req, res, 202, queue.create(ProviderIdSchema.parse(input.provider), SearchSchema.parse(input.query)));
    }
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
      const job = queue.get(jobMatch[1]);
      return job ? json(req, res, 200, job) : json(req, res, 404, { error: 'job not found' });
    }
    const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const job = queue.cancel(cancelMatch[1]);
      return job ? json(req, res, 200, job) : json(req, res, 404, { error: 'job not found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/enrich') {
      const input = z.record(z.string(), z.any()).parse(await body(req));
      if (!input.title || !Array.isArray(input.artists)) return json(req, res, 400, { error: 'title and artists are required' });
      return json(req, res, 200, await enrichMix(registry, EnrichSchema.parse(input)));
    }
    if (req.method === 'POST' && url.pathname === '/api/waveforms') {
      const input = z.record(z.string(), z.any()).parse(await body(req));
      if (typeof input.sourceUrl !== 'string' || input.sourceUrl.length > 2048) return json(req, res, 400, { error: 'A direct public audio URL is required' });
      try { return json(req, res, 202, waveformQueue.create(input.sourceUrl)); }
      catch (error) { return json(req, res, 422, { error: error instanceof Error ? error.message : String(error) }); }
    }
    const waveformMatch = url.pathname.match(/^\/api\/waveforms\/([^/]+)$/);
    if (req.method === 'GET' && waveformMatch) {
      const job = waveformQueue.get(waveformMatch[1]);
      return job ? json(req, res, 200, job) : json(req, res, 404, { error: 'waveform job not found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/soundcloud/artwork') {
      const input = z.record(z.string(), z.any()).parse(await body(req));
      if (typeof input.url !== 'string' || input.url.length > 2048) return json(req, res, 400, { error: 'A public SoundCloud track URL is required' });
      try {
        const artwork = await registry.soundcloud.resolvePublicArtwork(input.url);
        return artwork.artworkUrl
          ? json(req, res, 200, artwork)
          : json(req, res, 422, { error: 'That SoundCloud link has no track cover artwork' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(req, res, message.includes('URL is invalid') ? 400 : 502, { error: message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/artwork/preview') {
      const input = z.record(z.string(), z.any()).parse(await body(req));
      if (typeof input.url !== 'string' || input.url.length > 2048 || !['soundcloud', 'youtube', 'hearthis'].includes(input.provider)) {
        return json(req, res, 400, { error: 'Choose SoundCloud, YouTube, or hearthis.at and enter a public track URL' });
      }
      try {
        if (input.provider === 'soundcloud') {
          const artwork = await registry.soundcloud.resolvePublicArtwork(input.url);
          return artwork.artworkUrl ? json(req, res, 200, { ...artwork, provider: 'soundcloud' })
            : json(req, res, 422, { error: 'That SoundCloud link has no track cover artwork' });
        }
        if (input.provider === 'youtube') {
          const video = await registry.youtube.lookupVideo(input.url);
          return video.artworkUrl ? json(req, res, 200, { provider: 'youtube', sourceUrl: `https://www.youtube.com/watch?v=${video.id}`, title: video.title, artworkUrl: video.artworkUrl })
            : json(req, res, 422, { error: 'That YouTube video has no public thumbnail' });
        }
        const track = await registry.hearthis.lookupTrack(input.url);
        const artworkUrl = await registry.hearthis.lookupArtwork(input.url);
        return artworkUrl ? json(req, res, 200, { provider: 'hearthis', sourceUrl: track.permalink_url, title: track.title, artworkUrl })
          : json(req, res, 422, { error: 'That hearthis.at track has no cover artwork' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(req, res, message.includes('URL is invalid') ? 400 : 502, { error: message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/discogs/enrich') {
      const input = z.record(z.string(), z.any()).parse(await body(req));
      if (!input.name) return json(req, res, 400, { error: 'name is required' });
      const kind = ['artist', 'crew', 'label'].includes(input.kind) ? input.kind : 'artist';
      return json(req, res, 200, await registry.discogs.enrichEntity(z.string().trim().min(1).max(1000).parse(input.name), kind));
    }

   json(req,res,404,{error:'Not found'});
  }catch(error){
   const status=error instanceof HttpError?error.status:error instanceof RevisionConflict?409:error instanceof z.ZodError?400:400;
   json(req,res,status,{error:error instanceof z.ZodError?'Invalid request: '+error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('; '):error instanceof Error?error.message:'Request failed'});
  }
 });
}
