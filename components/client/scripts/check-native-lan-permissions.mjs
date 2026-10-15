import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {argv} from 'node:process';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const contractSource=stripTypeScriptTypes(readFileSync(new URL('../src/lib/nativeLanAudio.ts',import.meta.url),'utf8'),{mode:'transform'});
const contract=await import(data(contractSource));
const sessionSource=stripTypeScriptTypes(readFileSync(new URL('../src/lib/nativeRoomSession.ts',import.meta.url),'utf8'),{mode:'transform'}).replace('"./nativeLanAudio"',JSON.stringify(data(contractSource)));
const session=await import(data(sessionSource));
const compile=relative=>ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const hooks=[],effects=[],callbacks=new Map(),timers=new Map(),requests=[],messages=[];
let cursor=0,timerId=0;
const same=(left,right)=>left&&right&&left.length===right.length&&left.every((item,index)=>Object.is(item,right[index]));
const memo=(fn,deps)=>{const index=cursor++;if(!hooks[index]||!same(hooks[index].deps,deps))hooks[index]={value:fn(),deps};return hooks[index].value;};
const react={useRef:initial=>memo(()=>({current:initial}),[]),useCallback:(fn,deps)=>memo(()=>fn,deps),useMemo:memo,
  useState(initial){const index=cursor++;hooks[index]??={value:initial};return [hooks[index].value,next=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;}];},
  useEffect(fn,deps){const index=cursor++;if(!hooks[index]||!same(hooks[index].deps,deps)){effects.push(()=>{hooks[index]?.cleanup?.();hooks[index]={deps,cleanup:fn()};});}},useId:()=> 'test-id'};
const jsx=(type,props)=>({type,props});
const socket={id:'generation',connected:true,on(name,fn){callbacks.set(name,fn);},off(name,fn){if(callbacks.get(name)===fn)callbacks.delete(name);},emit(){}};
const prefs={isMuted:true,isServerMuted:false,isDeafened:false,isServerDeafened:false,inputMode:'voice_activity',micVolume:100,outputVolume:100,userVolumes:{},
  setIsMuted(value){prefs.isMuted=value;},setIsDeafened(value){prefs.isDeafened=value;},setMicVolume(){},setOutputVolume(){}};
const details={server_info:{server_id:'server',native_lan_voice_enabled:true,role:'owner',permissions:['speak']},channels:[{id:'room',type:'voice',myPermissions:['speak']}]};
const native={async reconcile(value){requests.push(value);return {};},async getBinding(){return {v:1,communityId:'community',deviceId:'device',nativeInstanceId:'instance',grantId:'grant'};},onStatus(){return()=>{};}};
const deps={react,'react/jsx-runtime':{jsx,jsxs:jsx},'@gryt/voice':{SFUConnectionState:{DISCONNECTED:'disconnected',REQUESTING_ACCESS:'requesting_access',CONNECTING:'connecting',CONNECTED:'connected',RECONNECTING:'reconnecting'}},
  '@/common':{useUserId:()=> 'account'},'@/settings':{useSettings:()=>prefs},'@/socket':{useServerManagement:()=>({currentlyViewingServer:{host:'host'}}),useSockets:()=>({sockets:{host:socket},serverDetailsList:{host:details}})},
  '../../../../lib/nativeRoomSession':session,'../../../../lib/nativeLanAudio':contract,'../../../../lib/voiceFacade':{NativeVoiceContext:{Provider:'NativeContext'}},
  '../../../socket/src/utils/tokenManager':{emitAuthenticated:async(s,event,payload,host,valid)=>{if(valid()){s.emit(event,payload);return true;}return false;}},
  '../components/EffectiveVoicePolicy':{EffectiveVoicePolicyProvider:'Policy'},'../components/ReceiveLevelingAdapter':{ReceiveLevelingProvider:'Level'},'../components/TransmitSpeechAdapter':{TransmitSpeechProvider:'Speech'},
  './useSquadProtection':{useSquadProtection(){}},'./useVoiceLifecycle':{useVoiceLifecycle(){}},'./useVoiceModes':{useVoiceModes(){}},'./usePeerVoiceCues':{usePeerVoiceCues(){}}};
const providerExports={};
vm.runInNewContext(compile('../src/packages/webRTC/src/adapters/NativeVoiceProvider.tsx'),{exports:providerExports,window:{nativeLanAudio:native},setInterval(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearInterval:id=>timers.delete(id),setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),require:name=>{assert.ok(name in deps,name);return deps[name];}});
let policy;
const controlDeps={react,'react/jsx-runtime':{jsx,jsxs:jsx},'@gryt/ui':{Button:'SettingsButton',Slider:'Slider'},'react-hot-toast':{default:value=>messages.push(value)},
  '@/i18n':{useTranslation:()=>({t:key=>key})},'@/lib/audioVolume':{MAX_VOLUME_PERCENT:200},'@/settings':{useSettings:()=>prefs},
  '../../../../lib/icons':{PiMicrophoneFill:'Mic',PiMicrophoneSlashFill:'Muted',PiSpeakerHighFill:'Speaker',PiSpeakerSlashFill:'Deaf'},
  './CallControlButton':{CallControlButton:'ControlButton'},'./EffectiveVoicePolicy':{useEffectiveVoicePolicy:()=>policy},
  './HoverAudioControl':{HoverAudioControl:'Hover'},'./ReceiveLevelingAdapter':{useReceiveLeveling:()=>({available:false,runtime:'unknown'})}};
const controlExports={};
vm.runInNewContext(compile('../src/packages/webRTC/src/components/VoiceAudioControls.tsx'),{exports:controlExports,require:name=>{assert.ok(name in controlDeps,name);return controlDeps[name];}});
function render(){cursor=0;const tree=providerExports.NativeVoiceProvider({children:'child'});while(effects.length)effects.shift()();policy=tree.props.children.props.value;return tree.props.value;}
function micClick(){const tree=controlExports.VoiceAudioControls({});const microphone=tree.props.children.find(child=>child?.props?.label==='voiceAudio.microphone');assert.ok(microphone);microphone.props.action.props.onClick();}
const facade=render();
await facade.sfu.connect('room');
let revision=0;
const snapshotsArg=argv.indexOf('--native-snapshots');
const backend=snapshotsArg<0 ? null : JSON.parse(readFileSync(argv[snapshotsArg+1],'utf8'));
function snapshot(fields={}){callbacks.get('voice:native:snapshot')({v:1,serverId:'server',channelId:'room',epoch:'epoch',localIp:'10.203.217.1',key:'a'.repeat(64),peers:[],serverTimeMs:1000,expiresAtMs:16000,canPublish:false,canReceive:true,requirePTT:false,...fields,revision:++revision});render();}
snapshot(backend?.self_muted ?? {canSpeak:true});
assert.equal(requests.at(-1)?.roomId,'room','the actual backend snapshot must pass the native address/session boundary');
micClick();assert.equal(prefs.isMuted,false,'actual microphone control must allow self-unmute');
assert.equal(policy.canSpeak,true,'self-muted owner still has channel speech permission');
assert.equal(messages.length,0,'self-mute must not show the channel permission toast');
prefs.isDeafened=true;snapshot(backend?.self_deafened ?? {canSpeak:true,canReceive:false});
assert.equal(policy.canSpeak,true,'self-deafen must not masquerade as channel denial');
prefs.isDeafened=false;prefs.isServerMuted=true;snapshot(backend?.server_muted ?? {canSpeak:true});
assert.equal(policy.canSpeak,true,'moderator mute has its separate control');
micClick();assert.equal(messages.at(-1),'ui.youAreServerMutedByAnAdmin');
prefs.isServerMuted=false;prefs.isMuted=true;snapshot(backend?.denied ?? {canSpeak:false});
micClick();assert.equal(prefs.isMuted,true);assert.equal(messages.at(-1),'pureVoice.speakDenied');
// Old v1 snapshots lack canSpeak: use only this authenticated channel's
// permissions, never effective canPublish or the broader owner role label.
snapshot();assert.equal(policy.canSpeak,true);micClick();assert.equal(prefs.isMuted,false);
details.channels[0].myPermissions=[];snapshot();assert.equal(policy.canSpeak,false);
delete details.channels[0].myPermissions;snapshot();assert.equal(policy.canSpeak,false,'unknown old-backend channel authority fails closed');
details.channels[0].myPermissions=['speak'];snapshot({canSpeak:false});assert.equal(policy.canSpeak,false,'new private denial overrides stale details');
await facade.sfu.disconnect();render();prefs.isMuted=true;micClick();assert.equal(prefs.isMuted,false,'idle microphone preference stays usable');
assert.equal(timers.size,0);
console.log('Native permissions: actual provider/session/audio controls preserve self-unmute/deafen, moderator mute, explicit deny, old-v1 known/unknown channel authority and idle preferences; fake IPC/socket, no device media.');
