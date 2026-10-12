/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..'), args = process.argv.slice(2);
const option = name => {const i=args.indexOf(name); if(i<0||!args[i+1])throw Error('Missing '+name);return path.resolve(args[i+1]);};
const out = option('--out-dir'), dependencies = option('--dependency-root'), assets = option('--product-assets');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
  if(fs.existsSync(path.join(out,'dist')))throw Error('Fresh output dist required; preserve prior run');
  const dist=path.join(out,'dist'), copied=path.join(dist,'assets');fs.mkdirSync(copied,{recursive:true});
  const resources=fs.readdirSync(assets).filter(f=>/\.(css|woff2?|ttf|png)$/.test(f));
  const css=resources.find(f=>/^index-.*\.css$/.test(f));if(!css)throw Error('Exact product CSS required');
  for(const f of resources)fs.copyFileSync(path.join(assets,f),path.join(copied,f));
  fs.copyFileSync(path.join(root,'public/laokuai-icon.png'),path.join(dist,'laokuai-icon.png'));
  const req=createRequire(path.join(dependencies,'package.json')),esbuild=req('esbuild');
  const result=await esbuild.build({entryPoints:[path.join(root,'scripts/fixtures/community-lan-popup.tsx')],absWorkingDir:root,platform:'browser',format:'esm',bundle:true,jsx:'automatic',nodePaths:[path.join(dependencies,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},metafile:true,logLevel:'silent',outfile:path.join(dist,'fixture.js')});
  fs.writeFileSync(path.join(dist,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TEST community popup fixture</title><link rel="stylesheet" href="./assets/${css}"><style>html,body,#root{margin:0;width:100%;height:100%;min-height:0;overflow:hidden}</style><div id="root"></div><script type="module" src="./fixture.js"></script></html>`);
  fs.copyFileSync(path.join(root,'scripts/check-community-popup-layout.cjs'),path.join(out,'main.cjs'));
  const inputs=['src/components/CommunityLanStatusControl.tsx','src/lib/easyTierCommunitySubscriptions.ts','src/lib/icons.tsx','scripts/fixtures/community-lan-popup.tsx','scripts/check-community-popup-layout.cjs'];
  const outputs=['fixture.js','index.html','laokuai-icon.png',...resources.map(f=>'assets/'+f)].map(f=>({path:f,sha256:sha(fs.readFileSync(path.join(dist,f)))}));
  const receipt={actualBrowserRun:false,scope:'Real production control/status mapping and exact prior product CSS. Synthetic rail/community only; no product bootstrap/account/native/media.',sourceInputHashes:Object.fromEntries(inputs.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))])),dependencies,esbuildVersion:esbuild.version,productCss:{path:path.join(assets,css),sha256:sha(fs.readFileSync(path.join(assets,css)))},outputs};
  fs.writeFileSync(path.join(out,'BUILD-RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n');fs.writeFileSync(path.join(out,'metafile.json'),JSON.stringify(result.metafile,null,2));
  const main=fs.readFileSync(path.join(out,'main.cjs'),'utf8');if(!main.includes('show: false')||!main.includes('connect-src \'none\'')||!main.includes('nodeIntegration: false')||!main.includes('offscreen: true'))throw Error('Isolation source guard missing');
  fs.writeFileSync(path.join(out,'PURE-CHECKS.json'),JSON.stringify({status:'PURE-CHECKS-PASS',testOnly:true,noActualRun:true,viewportCases:[[980,720],[340,420],[300,300],[240,240],[320,300]],sourceAndOutputsPinned:true},null,2)+'\n');console.log(JSON.stringify({out,outputs:outputs.length,inputs:inputs.length,actualBrowserRun:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
