// Actual handler modules, mocked ports; synthetic input only, no DB/listener.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../client/node_modules/typescript');
const source = path.resolve(__dirname, '../src');
const noop = () => undefined;
const empty = new Proxy({}, {get: (_, key) => key === '__esModule' ? false : noop});
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(source,file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code, {exports,require:id=>mocks[id] ?? (id.startsWith('node:') ? require(id) : empty),Buffer,process,console,Date,performance,URL}, {filename:file});
  return exports;
}
async function main() {
  const crypto = load('db/interfaces.ts', {crypto:require('node:crypto'),util:require('node:util')});
  const synthetic = 'Synthetic-Case Space 123!';
  const hash = await crypto.hashServerPassword(synthetic);
  assert(await crypto.verifyServerPassword(synthetic,hash.saltB64,hash.hashB64));
  for (const wrong of [synthetic.toLowerCase(), synthetic+' ', '']) assert.equal(await crypto.verifyServerPassword(wrong,hash.saltB64,hash.hashB64),false);
  for (const [salt,key] of [['',''],[hash.saltB64,''],['bad',hash.hashB64],[hash.saltB64,hash.hashB64+'!']]) assert.equal(await crypto.verifyServerPassword(synthetic,salt,key),false);
  let scenarios=0;
  async function join(options={}) {
    const events=[],logs=[],roles=[],writes=[];
    const cfg={owner_gryt_user_id:'existing-owner',join_policy:'open',lan_open:true,password_hash:hash.hashB64,password_salt:hash.saltB64,password_algo:'scrypt',token_version:0,...options.cfg};
    const user={gryt_user_id:options.owner?'existing-owner':'independent-user',server_user_id:'member-id',nickname:'Test',is_active:true};
    const asyncNoop=async()=>undefined;
    const db={verifyServerPassword:crypto.verifyServerPassword,getServerConfig:async()=>{if(options.dbFailure)throw Error('synthetic-db-unavailable');return cfg;},getUserByGrytId:async()=>options.active?user:null,
      upsertUser:async()=>{writes.push('upsert');return user;},listMemberRoles:async()=>options.active?['admin']:[],setServerRole:async(_,role)=>roles.push(role),createRefreshToken:async()=>({token_id:'synthetic-refresh'}),
      effectiveModerationState:()=>({}),normalizeJoinPolicy:v=>v,claimServerOwner:async()=>({owner:'existing-owner'}),consumeServerInvite:async()=>{writes.push('invite');return {ok:true};},getBotById:async()=>({status:'approved',nickname:'TestBot'}),insertServerAudit:asyncNoop};
    const modules={'../../db':db,'consola':{info:(...a)=>logs.push(a),warn:(...a)=>logs.push(a),error:(...a)=>logs.push(a)},'../../auth/identity':{consumeChallenge:()=>({nickname:'Test',serverHost:'test.invalid',nonce:'n',inviteCode:'old-valid-invite'}),verifyCertificate:async()=>({grytUserId:user.gryt_user_id,sub:user.gryt_user_id,tier:options.bot?'bot':'local'}),verifyAssertion:async()=>({sub:user.gryt_user_id}),identityTierAccepted:()=>true,identityTierOf:()=> 'local',looksLikeABotName:()=>false},
      '../../utils/rateLimiter':{checkRateLimit:()=>({allowed:true})},'../../moderation/sessionGate':{checkIdentityAllowed:async()=>({ok:true})},'../../services/permissions':{defaultRoleForTier:()=> 'admin'},'../../services/autoRoles':{applyAutoRoles:async()=>writes.push('autorole')},'../../services/inviteRoles':{applyInviteRole:async()=>writes.push('invite-role')},'../../plugins':{pluginEvents:()=>({emit:noop})},'../../utils/jwt':{generateAccessToken:()=> 'synthetic-access',generateFileToken:()=> 'synthetic-file'},'../../utils/fileUrl':{generateFileUrlKey:()=> 'synthetic-key'},'../../utils/memberCard':{cardFields:()=>({})},
      '../utils/clients':{verifyClient:asyncNoop,countOtherSessions:()=>0,syncAllClients:noop,broadcastMemberList:noop},'../utils/server':{sendInfo:asyncNoop,sendServerDetails:noop},'../../utils/isPrivateIp':{isPrivateIp:()=>true},
      './joinHelpers':{registerJoinHelpers:()=>({}),getInviteCooldownKey:()=> 'test-key',getInviteCooldownState:()=>({cooldownUntilMs:options.locked?Date.now()+5000:0}),getInviteIpCooldownState:()=>({}),applyInviteFailure:noop,applyInviteIpFailure:noop,clearInviteCooldown:noop,clearInviteIpCooldown:noop}};
    const ctx={socket:{id:'test-socket',emit:(...a)=>events.push(a),handshake:{headers:{host:'test.invalid'}}},clientId:'test-socket',serverId:'test-community',clientsInfo:{'test-socket':{}},getClientIp:()=> '127.0.0.1',clientAddressIsOwn:()=>true};
    const handlers=load('socket/handlers/join.ts',modules).registerJoinHandlers(ctx);
    await handlers['server:verify']({certificate:'synthetic',assertion:'synthetic',communityPassword:options.password});
    assert(!JSON.stringify(logs).includes(synthetic),'Password must not be logged');
    scenarios++;return {events,roles,writes,logs};
  }
  for(const opts of [{},{password:'wrong'},{bot:true},{cfg:{join_policy:'invite'}},{cfg:{join_policy:'open',lan_open:true}}]) {
    const r=await join(opts);assert.equal(r.events[0][1].error,'password_required',r.logs.map(a=>a.map(x=>x instanceof Error?x.message:String(x)).join(' ')).join(';'));assert.deepEqual(r.writes,[]);
  }
  const admitted=await join({password:synthetic});assert(admitted.events.some(e=>e[0]==='server:joined'&&e[1].serverId==='test-community'));assert.deepEqual(admitted.roles,['member']);assert.deepEqual(admitted.writes,['upsert']);
  const missing=await join({cfg:{password_hash:null,join_policy:'password'}});assert.equal(missing.events[0][1].error,'password_not_configured');assert.deepEqual(missing.writes,[]);
  const locked=await join({password:synthetic,locked:true});assert.equal(locked.events[0][1].error,'rate_limited');assert.deepEqual(locked.writes,[]);
  for (const opts of [{active:true},{owner:true}]) {const r=await join(opts);assert(r.events.some(e=>e[0]==='server:joined'),JSON.stringify(r.events)+' '+r.logs.map(a=>a.map(String).join(' ')).join(';'));if(opts.active)assert(!r.writes.includes('invite'));}
  const failed=await join({dbFailure:true,password:synthetic});assert.equal(failed.events[0][1].error,'join_failed');assert.deepEqual(failed.writes,[]);
  let adminScenarios=0;
  for (const setting of [{authorized:true,password:synthetic},{authorized:false,password:synthetic},{authorized:true,password:''},{authorized:true,password:'x'.repeat(129)}]) {
    const updated=[],audits=[],events=[];
    const handlers=load('socket/handlers/admin.ts',{'../../db':{hashServerPassword:crypto.hashServerPassword,updateServerConfig:async v=>updated.push(v),insertServerAudit:async v=>audits.push(v)},'../../utils/rateLimiter':{checkRateLimit:()=>({allowed:true})},'../middleware/auth':{requireAuth:async(_,__,requirement)=>{assert.equal(requirement.permission,'manage_server');return setting.authorized?{tokenPayload:{serverUserId:'existing-owner'}}:null;}},'./adminChannels':{registerAdminChannelHandlers:()=>({})},'../utils/server':{broadcastServerUiUpdate:noop},'consola':{error:noop}}).registerAdminHandlers({socket:{emit:(...v)=>events.push(v)},getClientIp:()=> 'test',clientsInfo:{}});
    await handlers['server:password:set']({accessToken:'synthetic-access',password:setting.password});
    if(setting.authorized&&setting.password===synthetic) {assert.equal(updated.length,1);assert.equal(updated[0].joinPolicy,'password');assert.equal(updated[0].lanOpen,false);assert(await crypto.verifyServerPassword(synthetic,updated[0].passwordSalt,updated[0].passwordHash));assert.equal(audits.length,1);assert(!JSON.stringify(audits).includes(synthetic));assert(!JSON.stringify(events).includes(synthetic));}
    else {assert.equal(updated.length,0);assert.equal(audits.length,0);}
    adminScenarios++;
  }
  console.log(JSON.stringify({passed:true,actualJoinHandlerScenarios:scenarios,actualAdminHandlerScenarios:adminScenarios,scryptChecks:8,realDatabaseOrNetwork:false,passwordPrinted:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
