import { ProviderRefSchema, type ProviderRef } from './schemas.js';
export function normalizeName(value:string):string { return value.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/gu,' '); }
export function normalizedSet(values:string[]):string[] { const seen=new Set<string>();return values.map(v=>v.normalize('NFKC').trim()).filter(v=>{const key=normalizeName(v);if(!key||seen.has(key))return false;seen.add(key);return true;}); }
export function normalizeProviderRef(input:ProviderRef):ProviderRef {
 const ref=ProviderRefSchema.parse(input); const url=new URL(ref.url); url.protocol='https:';url.hash='';
 for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_')||['fbclid','gclid'].includes(key))url.searchParams.delete(key);
 const allowed:Record<string,string[]>={freeteknomusic:['freeteknomusic.org','www.freeteknomusic.org','archive.freeteknomusic.org'],soundcloud:['soundcloud.com','www.soundcloud.com'],archiveorg:['archive.org','www.archive.org'],discogs:['discogs.com','www.discogs.com'],youtube:['youtube.com','www.youtube.com','m.youtube.com','youtu.be'],hearthis:['hearthis.at','www.hearthis.at']};
 if(ref.provider!=='web'&&!allowed[ref.provider].includes(url.hostname))throw new Error('Source host does not belong to '+ref.provider);
 if(ref.provider==='youtube'&&ref.resourceType==='video'){
  const id=url.hostname==='youtu.be'?url.pathname.slice(1):url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]||url.searchParams.get('v');
  if(!id||! /^[A-Za-z0-9_-]{11}$/.test(id) || (ref.externalId && ref.externalId!==id))throw new Error('Invalid YouTube video identity');
  return {...ref,externalId:id,url:'https://www.youtube.com/watch?v='+id};
 }
 if(ref.provider==='discogs'){
  const match=url.pathname.match(/^\/(artist|label)\/(\d+)(?:-|$)/);
  if(!match||match[1]!==ref.resourceType||(ref.externalId&&ref.externalId!==match[2]))throw new Error('Invalid Discogs entity identity');
  return {...ref,externalId:match[2],url:'https://www.discogs.com/'+match[1]+'/'+match[2]};
 }
 if(['soundcloud','hearthis'].includes(ref.provider)){url.hostname=ref.provider==='soundcloud'?'soundcloud.com':'hearthis.at';url.pathname=url.pathname.replace(/\/$/,'');url.search='';}
 if(ref.provider==='soundcloud' && ref.externalId)ref.externalId=ref.externalId.replace(/^urn:soundcloud:(tracks|users):/,'');
 return {...ref,url:url.toString()};
}
