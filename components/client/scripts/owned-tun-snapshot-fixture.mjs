import { createHash } from 'node:crypto';
import { TABLES } from './owned-tun-snapshot-semantics.mjs';
// Pure fake configuration facts, never OS queries or a launchable network config.
export const token=value=>'s:'+createHash('sha256').update(value).digest('hex');
export function fakeFacts(guid) {
  const table=(name,rows=[])=>({columns:[...TABLES[name]],rows});
  const id=token('synthetic-rule');
  return {schema:1,tables:{
    rules:table('rules',[[id,'n:1','n:1','n:2','n:7','n:1']]),
    profiles:table('profiles',['domain','private','public'].map(v=>[token(v),'n:1','n:4','n:2','n:1'])),
    address:table('address',[[id,[token('Any')],[token('Any')]]]),
    port:table('port',[[id,'n:6',[token('Any')],[token('Any')],'z:null','n:0']]),
    application:table('application',[[id,token('fake-program'),'z:null']]),service:table('service',[[id,token('Any')]]),
    interface:table('interface',[[id,[token('Any')]]]),interfaceType:table('interfaceType',[[id,'n:0']]),
    security:table('security',[[id,'n:0','n:0','n:0',token('Any'),token('Any'),token('Any')]]),
    default4:table('default4',[['n:1',token('fake-hop'),'n:25','n:10']]),default6:table('default6'),
  },interfaces:{[guid]:{addresses:table('addresses',[[token('fake-ip'),'n:24','n:2','n:1','n:1']]),routes:table('routes'),
    dns:table('dns',[['n:2',[token('dns-a'),token('dns-b')]]])}}};
}
