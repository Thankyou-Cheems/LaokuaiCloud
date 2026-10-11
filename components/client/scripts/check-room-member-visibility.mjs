// Executes the actual existing ChannelList room renderer with pure captured dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/packages/socket/src/components/ChannelList.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('ChannelList.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let initializer;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='renderChannel')initializer=node.initializer;ts.forEachChild(node,visit);}visit(ast);assert.ok(initializer);
const code=ts.transpileModule('export const renderChannel='+initializer.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props,key)=>({type,props,key});const exports={};let joinedClicks=0,foldedClicks=0;
const clients={local:{nickname:'我',serverUserId:'local',hasJoinedChannel:true,voiceChannelId:'a',streamID:'local-pub',isConnectedToVoice:true},
 remote:{nickname:'很长的同房昵称',serverUserId:'remote',hasJoinedChannel:true,voiceChannelId:'a',streamID:'remote-pub',isConnectedToVoice:true},
 other:{nickname:'另一个聊天室成员',serverUserId:'other',hasJoinedChannel:true,voiceChannelId:'b',streamID:'other-pub',isConnectedToVoice:true},
 ghost:{nickname:'未入房的旧分配',serverUserId:'ghost',hasJoinedChannel:false,voiceChannelId:'b',streamID:'ghost-pub'}};
const ctx={exports,require(name){assert.equal(name,'react/jsx-runtime');return{jsx,jsxs:jsx};},channelById:new Map(['a','b','empty'].map(id=>[id,{id,name:'聊天室 '+id,type:'voice',canJoin:id!=='b'}])),
 serverHost:'fixture-server',currentServerConnected:'fixture-server',currentChannelId:'a',currentConnectionId:'local',selectedChannelId:null,
 clients,clientsSpeaking:{remote:true},memberByServerUserId:new Map(),avatarByServerUserId:new Map(),wornByServerUserId:new Map(),streamSources:{},microphoneBuffer:{finalAnalyser:undefined},prefs:{servers:{}},
 resolveLevel:()=> 'all',getPlacement:()=>({}),isConnecting:false,unreadCounts:undefined,threadUnreadCounts:undefined,mentionCounts:undefined,collapsed:new Set(),
 tr:(key,values)=>key==='voiceRoom.members'?values.count+' 人':key,socketI18n:{t:key=>key},resolveAvatarSrc:()=>undefined,getUploadsFileUrl(){throw Error('no uploads');},
 onDisconnectUser:undefined,adminActions:undefined,currentUserRole:undefined,onChannelClick(){joinedClicks++;},toggleCollapsed(id){foldedClicks++;ctx.collapsed.has(id)?ctx.collapsed.delete(id):ctx.collapsed.add(id);},
 Button:'ChannelButton',ConnectedUser:'ConnectedUser',UnreadIndicator:'UnreadIndicator',EmojiText:'EmojiText',Skeleton:'Skeleton',Tooltip:'Tooltip',AnimatePresence:'AnimatePresence',motion:{div:'motion.div'}};
for(const icon of ['PiCaretDownFill','PiCaretRightFill','PiLockSimpleFill','PiRobotFill','PiChatsFill','PiSpeakerHighFill','PiChatCircleFill','PiGameControllerFill','PiKeyboardFill','PiGaugeFill'])ctx[icon]=icon;
vm.runInNewContext(code,ctx);
const collect=tree=>Array.isArray(tree)?tree.flatMap(collect):tree&&typeof tree==='object'?[tree,...collect(tree.props?.children)]:[];
const render=id=>collect(exports.renderChannel({id,channelId:id,kind:'channel'}));
const badge=nodes=>nodes.find(n=>n.type==='button'&&n.props['aria-controls']);const members=nodes=>nodes.filter(n=>n.type==='ConnectedUser');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('each occupied room shows its actual joined members, independent of joining it',()=>{assert.equal(members(render('a')).length,2);assert.equal(members(render('b')).length,1);assert.equal(members(render('b'))[0].props.serverUserId,'other');assert.match(badge(render('b')).props['aria-label'],/1 人/);});
check('empty rooms remain compact and stale voice assignments do not inflate counts',()=>{assert.equal(members(render('empty')).length,0);assert.equal(badge(render('empty')).props.disabled,true);assert.match(badge(render('empty')).props['aria-label'],/0 人/);assert.ok(!members(render('b')).some(n=>n.props.serverUserId==='ghost'));});
check('observer sees occupants of a visible locked room but gets no media path badges',()=>{ctx.currentServerConnected=null;const nodes=render('b');assert.equal(members(nodes).length,1);assert.equal(members(nodes)[0].props.showVoiceMediaPath,false);ctx.currentServerConnected='fixture-server';});
check('own room stays expanded; other room toggling never joins or starts media',()=>{ctx.collapsed.add('a');assert.equal(badge(render('a')).props['aria-expanded'],true);assert.equal(badge(render('a')).props.disabled,true);const button=badge(render('b'));assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(members(render('b')).length,0);assert.equal(foldedClicks,1);assert.equal(joinedClicks,0);badge(render('b')).props.onClick();assert.equal(members(render('b')).length,1);});
check('current exact room and connected stream are required for a path badge',()=>{const same=members(render('a')).find(n=>n.props.serverUserId==='remote');assert.equal(same.props.showVoiceMediaPath,true);assert.equal(members(render('b'))[0].props.showVoiceMediaPath,false);clients.remote.isConnectedToVoice=false;assert.equal(members(render('a')).find(n=>n.props.serverUserId==='remote').props.showVoiceMediaPath,false);clients.remote.isConnectedToVoice=true;});
check('count toggle is a sibling of the join button with scoped accessible member target',()=>{const tree=exports.renderChannel({id:'b',channelId:'b',kind:'channel'});const nodes=collect(tree);const join=nodes.find(n=>n.type==='ChannelButton');assert.ok(!collect(join).some(n=>n.type==='button'));assert.equal(badge(nodes).props['aria-controls'],'voice-members-fixture-server-b');assert.ok(nodes.some(n=>n.props?.id===badge(nodes).props['aria-controls']));});
console.log(checks+' actual ChannelList renderer scenarios passed; real roster permissions, browser geometry and media wiring untested.');
