import type { EntityRef, ProviderHealth } from '../domain.js';
import { cleanProfile, type ProviderMetadata } from '../catalog/provider-claims.js';
import { HttpUrlSchema } from '@syco23/mixsets-domain';
import { retry, withTimeout } from '../core/utils.js';

const API = 'https://api.discogs.com/';

export class DiscogsEnricher {
  id = 'discogs' as const;

  private headers(): Record<string, string> {
    const token = process.env.DISCOGS_TOKEN;
    return {
      accept: 'application/vnd.discogs.v2.discogs+json',
      'user-agent': 'SYCO23-Mixsets/0.1 (+metadata-enrichment)',
      ...(token ? { authorization: `Discogs token=${token}` } : {}),
    };
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await withTimeout((inner) => fetch('https://api.discogs.com/database/search?q=spiral+tribe&type=artist&per_page=1', { signal: inner, headers: this.headers() }), 7_000, signal);
      const authenticated = Boolean(process.env.DISCOGS_TOKEN);
      return {
        id: this.id,
        state: response.ok ? (authenticated ? 'ready' : 'limited') : 'offline',
        detail: response.ok
          ? authenticated ? 'Artist/label enrichment authenticated' : 'Unauthenticated rate limit; set DISCOGS_TOKEN'
          : `Discogs API ${response.status} ${response.statusText || 'request rejected'}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return { id: this.id, state: 'offline', detail: String(error), checkedAt: new Date().toISOString() };
    }
  }

  async hydrateEntity(id:string,kind:'artist'|'label',signal?:AbortSignal):Promise<ProviderMetadata>{
    if(!/^\d+$/.test(id))throw new Error('Invalid Discogs entity ID');
    const payload=await retry(()=>withTimeout(async(inner)=>{
      const response=await fetch(new URL(`${kind==='label'?'labels':'artists'}/${id}`,API),{signal:inner,headers:this.headers()});
      if(!response.ok)throw new Error(`Discogs entity ${response.status}`);
      return response.json() as Promise<Record<string,any>>;
    },12000,signal));
    if(String(payload.id)!==id)throw new Error('Discogs returned a different entity identity');
    const resource={provider:'discogs' as const,resourceType:kind,externalId:id,url:`https://www.discogs.com/${kind}/${id}`};
    const facts:ProviderMetadata['facts']={},relationships:ProviderMetadata['relationships']=[];
    if(payload.profile?.trim())facts.profile=cleanProfile(payload.profile);
    if(kind==='artist'&&payload.realname?.trim())facts.realName=payload.realname.trim();
    const urls=(payload.urls||[]).filter((url:unknown)=>HttpUrlSchema.safeParse(url).success);if(urls.length)facts.websites=urls.slice(0,30);
    const image=payload.images?.find((image:Record<string,unknown>)=>HttpUrlSchema.safeParse(image.uri).success)?.uri;
    if(image)facts[kind==='artist'?'portrait':'labelLogo']={url:image,kind:kind==='artist'?'portrait':'label-logo',source:'discogs',sourceUrl:resource.url};
    if(payload.aliases?.length)facts.aliases=payload.aliases.map((alias:Record<string,any>)=>alias.name).filter(Boolean);
    if(kind==='label'&&payload.contact_info?.trim())facts.contactInfo=payload.contact_info.trim();
    const add=(items:Record<string,any>[],relation:ProviderMetadata['relationships'][number]['relation'],resourceType:'artist'|'label')=>{for(const item of items||[])if(item.name&&Number.isSafeInteger(Number(item.id)))relationships.push({name:item.name,externalId:String(item.id),resourceType,relation});};
    add(payload.aliases,'alias-of','artist');add(payload.groups,'member-of','artist');add(payload.members,'member','artist');
    if(payload.parent_label)add([payload.parent_label],'parent-label','label');add(payload.sublabels,'sub-label','label');
    return {resource,name:payload.name||id,facts,relationships};
  }

  async enrichEntity(name: string, kind: 'artist' | 'crew' | 'label', signal?: AbortSignal): Promise<EntityRef[]> {
    const type = kind === 'label' ? 'label' : 'artist';
    const params = new URLSearchParams({ q: name, type, per_page: '5' });
    const payload = await retry(() => withTimeout(async (inner) => {
      const response = await fetch(new URL(`database/search?${params}`, API), { signal: inner, headers: this.headers() });
      if (!response.ok) throw new Error(`Discogs search ${response.status} ${response.statusText || 'request rejected'}`);
      return response.json() as Promise<{ results?: Array<Record<string, any>> }>;
    }, 12_000, signal));

    const results = payload.results ?? [];
    const exact = results.filter((result) => String(result.title || '').trim().toLowerCase() === name.trim().toLowerCase());
    // A search hit only has a placeholder profile. Hydrate a unique exact match
    // from the entity endpoint; ambiguous names remain review candidates.
    const details = exact.length === 1 && Number.isSafeInteger(Number(exact[0].id))
      ? await retry(() => withTimeout(async (inner) => {
        const response = await fetch(new URL(`${type === 'label' ? 'labels' : 'artists'}/${exact[0].id}`, API), {
          signal: inner,
          headers: this.headers(),
        });
        if (!response.ok) throw new Error(`Discogs entity ${response.status} ${response.statusText || 'request rejected'}`);
        return response.json() as Promise<Record<string, any>>;
      }, 12_000, signal))
      : null;

    return results.map((result) => ({
      kind,
      name: result.title || name,
      provider: this.id,
      externalId: String(result.id || ''),
      url: details && details.id === result.id ? details.uri : result.uri,
      imageUrl: details && details.id === result.id ? details.images?.[0]?.uri || result.cover_image : result.cover_image || result.thumb,
      profile: details && details.id === result.id ? details.profile?.trim() || undefined : undefined,
    }));
  }
}
