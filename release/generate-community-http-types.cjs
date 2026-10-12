const fs=require('node:fs'),p=require('node:path'),crypto=require('node:crypto');
const root=p.resolve(__dirname,'..'),source=p.join(root,'components/server/src/easytier/communityGrantApi.ts');
const text=fs.readFileSync(source,'utf8').replace(/\r\n/g,'\n'),bytes=Buffer.from(text);
const blob=crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const expected='3725a571222d8897ea10eb2d1c0a662072f2a719';
if(blob!==expected)throw Error('canonical-API-owner-review-required');
const start=text.indexOf('export interface CommunitySessionRequestV1'),end=text.indexOf('export function parseCommunityGrantRequest');
if(start<0||end<=start)throw Error('canonical-API-layout-changed');
const generated='// Generated from canonical server communityGrantApi.ts (Git blob'+expected+').\n'+
 '// Do not edit independently. This projection keeps client builds inside their repository boundary.\n'+
 "import type {CommunityGrantScope, PrivateCommunityGrantV1, TrustedCommunityIntent} from './communityEtGrant';\n\n"+text.slice(start,end).trimEnd()+'\n';
const destination=p.join(root,'components/client/electron/communityEtHttpContract.ts');
if(process.argv.includes('--check')){if(fs.readFileSync(destination,'utf8').replace(/\r\n/g,'\n')!==generated)throw Error('client-HTTP-types-drifted');}
else fs.writeFileSync(destination,generated);
console.log('canonical-client-HTTP-types-match');
