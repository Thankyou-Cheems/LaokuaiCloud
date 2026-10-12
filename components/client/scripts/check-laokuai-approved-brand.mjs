/* eslint-env node */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f)),sha=b=>createHash('sha256').update(b).digest('hex'),require=createRequire(import.meta.url);
const source=JSON.parse(read('private-brand/ICON-SOURCE.json')),expected='06b380ae3c6f155ba11551d6eeb8a97f21a528cf6a51d9a83d43a0d26ca5a415';
assert.equal(source.sourceName,'kiriye-approved.png');assert.equal(source.sourceSha256,expected);assert.equal(sha(read('private-brand/'+source.sourceName)),expected);assert.equal(source.sourceLibraryFileId,'libfile_e4f794e64ab0819185ecf6e8bbac5248');
let checks=4;
for(const size of [16,24,32,48,64,128,256,512]){const bytes=read(`private-brand/icon-${size}.png`);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);assert.ok([4,6].includes(bytes[25]));checks++;}
assert.deepEqual(read('private-brand/icon.png'),read('private-brand/icon-512.png'));assert.deepEqual(read('public/laokuai-icon.png'),read('private-brand/icon-256.png'));checks+=2;
const ico=read('private-brand/icon.ico');assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),4);assert.deepEqual([...Array(4)].map((_,i)=>ico[6+i*16]||256),[16,32,48,256]);for(let i=0;i<4;i++){const entry=6+i*16;assert.ok(ico.readUInt32LE(entry+12)+ico.readUInt32LE(entry+8)<=ico.length);}checks++;
assert.equal(sha(read('private-brand/CheemsBurger_transparent.png')),source.historicalSource.sourceSha256);assert.notEqual(expected,source.historicalSource.sourceSha256);checks++;
const config=require('../electron-builder.laokuai.cjs');assert.equal(config.win.icon,'private-brand/icon.ico');assert.ok(config.extraResources.some(x=>x.from==='private-brand/icon.png'&&x.to==='icon.png'));assert.equal(config.extraResources.filter(x=>/^tray.*\.png$/.test(x.to)).length,11);assert.ok(config.extraResources.some(x=>x.from==='LAOKUAI-BRAND-NOTICES.md'&&x.to==='legal/LAOKUAI-BRAND-NOTICES.md'));checks+=4;
const logo=read('src/packages/common/src/components/logo.tsx').toString(),index=read('index.html').toString();assert.ok(logo.includes('/laokuai-icon.png'));assert.ok(index.includes('/laokuai-icon.png'));checks+=2;
console.log(JSON.stringify({checks,passed:true,rawPngSha256:expected,icoSha256:sha(ico),rendererSha256:sha(read('public/laokuai-icon.png')),scope:'Approved original and derivative/file/resource contract only; no EXE build or real tray/window rendering.'}));
