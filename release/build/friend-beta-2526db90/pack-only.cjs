const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process'),a=require('node:assert/strict');
const stage=p.resolve(__dirname,'..'),client=p.join(stage,'source/components/client');
const first=JSON.parse(fs.readFileSync(p.join(stage,'checkpoint-a5/PACKAGE-AUDIT.json')));
// Runtime bundles must match the original compiled source snapshot exactly.
const old=JSON.parse(fs.readFileSync(p.join(client,'build/legal/LAOKUAI-PACKAGE-MANIFEST.json')));
const crypto=require('node:crypto');for(const[file,pin]of Object.entries(old.packedFiles)){const b=fs.readFileSync(p.join(client,file));a.equal(b.length,pin.bytes);a.equal(crypto.createHash('sha256').update(b).digest('hex'),pin.sha256);}
const notice=require(p.join(client,'scripts/write-i18n-test-notices.cjs')).writeNotices(client);
const text=fs.readFileSync(notice,'utf8');for(const marker of ['react@','uiohook-napi@','react-dom@'])a.ok(text.includes('=== '+marker),'Missing original '+marker+' notice');
fs.writeFileSync(p.join(stage,'NOTICE-FOLLOWUP.json'),JSON.stringify({runtimeBundlesUnchanged:true,sourceCommit:'2526db9081567da13f246be801a3b4662cb38102',originalNoticeUnits:(text.match(/^=== /gm)||[]).length,noticeBytes:fs.statSync(notice).size,firstPackagePreserved:true,rendererOrMainOrNativeRecompiled:false},null,2));
const args=['node_modules/electron-builder/cli.js','--config=../../../operations/builder.cjs','--win','portable','--x64','--publish','never'];
const child=cp.spawnSync(process.execPath,args,{cwd:client,env:{...process.env,ELECTRON_BUILDER_CACHE:p.join(stage,'builder-cache'),GRYT_VARIANT:'slim'},windowsHide:true,shell:false,encoding:'utf8',maxBuffer:32*1024*1024});
fs.writeFileSync(p.join(stage,'logs/portable-complete-dependency-closure.log'),(child.stdout||'')+(child.stderr||''));fs.writeFileSync(p.join(stage,'PACK-FINAL.json'),JSON.stringify({exit:child.status,sourceCommit:'2526db9081567da13f246be801a3b4662cb38102',normalGate:true,recompiled:false,reason:'Include full existing runtime dependency closure with complete original notices'},null,2));console.log('Packaging resource follow-up '+child.status);process.exit(child.status??1);
