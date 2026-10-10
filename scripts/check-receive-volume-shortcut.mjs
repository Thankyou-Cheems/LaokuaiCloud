// Source invariants only: real React/pointer/audio QA must run separately.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || '.');
const read = path => readFileSync(resolve(root,path),'utf8');
const path = 'src/packages/webRTC/src/components/';
const trio = read(path+'VoiceAudioControls.tsx');
const hover = read(path+'HoverAudioControl.tsx');
const adapter = read(path+'ReceiveLevelingAdapter.tsx');
const audio = read('src/packages/settings/src/components/audioSettings.tsx');
const controls = read(path+'controls.tsx');
const mini = read(path+'miniControls.tsx');
let count=0;
function check(label,fn){fn();console.log(`PASS ${++count} ${label}`);}
check('both surfaces use the same three-control component',()=>{
 assert.match(controls,/<VoiceAudioControls \/>/);assert.match(mini,/<VoiceAudioControls direction=\{direction\} iconSize=\{iconSize\} \/>/);
 assert.equal((trio.match(/<HoverAudioControl /g)||[]).length,3);
});
check('settings receive volume remains at top with unique search anchor',()=>{
 assert(audio.indexOf('<ReceiveVolumeSetting anchorId="output-volume" />')<audio.indexOf('<SettingGroup anchorId="input-mode"'));
});
check('microphone and output persist through existing distinct setters',()=>{
 for(const [state,setter] of [['micVolume','setMicVolume'],['outputVolume','setOutputVolume']]){
  assert(trio.includes(`value={${state}} min={0} max={MAX_VOLUME_PERCENT} step={1}`));
  assert(trio.includes(`onValueChange={(next) => ${setter}(Number(next))}`));
 }
});
check('original click mute and deafen retain administrator guards',()=>{
 assert.match(trio,/if \(isServerMuted\)/);assert.match(trio,/if \(isServerDeafened\)/);
 assert.match(trio,/setIsMuted\(!isMuted\)/);assert.match(trio,/setIsDeafened\(!isDeafened\)/);
 assert.match(trio,/voiceAudio.muted/);assert.match(trio,/receiveVolume.deafened/);
});
check('shortcut never requests capture or mounts audio settings',()=>{
 assert.doesNotMatch(trio+hover,/useMicrophone|useSpeakers|getUserMedia|<AudioSettings/);
});
check('hover opens after 150ms and tolerates 220ms crossing gap',()=>{
 assert.match(hover, /setOpen\(true\); \}, 150\)/);assert.match(hover,/\}, 220\)/);
 assert.match(hover,/onPointerEnter/);assert.match(hover,/overPanel.current = true; clearTimer/);
});
check('drag cannot close popup before pointer release',()=>{
 assert.match(hover,/!dragging.current/);assert.match(hover,/dragging.current = true; clearTimer/);
 assert.match(hover,/addEventListener\("pointerup", release\)/);assert.match(hover,/addEventListener\("pointercancel", release\)/);
});
check('focus does not leave mouse-open popup stuck after dragging',()=>{
 assert.match(hover,/keyboardMode.current && focusInside\(\)/);
 assert.match(hover,/onKeyDownCapture/);assert.match(hover,/keyboardMode.current = false/);
});
check('separate action and expansion arrow support touch and keyboard',()=>{
 assert(hover.indexOf('{action}') < hover.indexOf('<Popover.Trigger'));
 assert.match(hover,/event.pointerType === "touch"/);assert.match(hover,/aria-label=\{tr\("voiceAudio.expand"/);
 assert.match(hover,/finalFocus=\{returnFocus && !hoverOpen \? arrow : false\}/);
 assert.match(hover,/<Popover.Close/);
});
check('side capsule opens right; collision and reduced motion are configured',()=>{
 assert.match(trio,/direction === "column" \? "right" : "top"/);
 assert.match(hover,/collisionPadding=\{8\}/);assert.match(hover,/max-w-\[calc\(100vw-16px\)\]/);
 assert.match(hover,/motion-reduce:!transition-none/);assert.match(hover,/transition-\[opacity,transform\] duration-150/);
});
check('no fake leveling state or placebo parameter',()=>{
 assert.match(adapter,/available: false, enabled: null, runtime: "unknown"/);
 assert.match(trio,/disabled=\{!leveling.available\}/);assert.match(trio,/leveling.setEnabled\(!leveling.enabled\)/);
 assert.match(trio,/parameter.setValue\(Number\(next\)\)/);assert.match(trio,/voiceAudio.noParameter/);
 const leveling=trio.slice(trio.indexOf('<HoverAudioControl label={tr("voiceAudio.leveling")}'));
 assert.doesNotMatch(leveling,/setOutputVolume|setMicVolume/);
});
check('setting and runtime are separate and use a shared provider',()=>{
 for(const state of ['active','loading','degraded','disabled','unknown'])assert(adapter.includes(`"${state}"`));
 assert.match(adapter,/Context.Provider value=\{value\}/);assert.match(trio,/voiceAudio.setting/);assert.match(trio,/voiceAudio.actual/);
});
check('explicit/touch opening survives pointer release and stale panel flags reset',()=>{
 assert.match(hover,/explicitlyOpened.current = next/);
 assert.match(hover,/!explicitlyOpened.current && !dragging.current/);
 assert.match(hover,/if \(!open\) \{[\s\S]*overPanel.current = false/);
 assert.match(hover,/if \(event.pointerType === "touch"\) explicitlyOpened.current = true/);
});
check('live color comes from runtime rather than enabled preference',()=>{
 assert.match(trio,/leveling.runtime === "active" \? "live"/);
 assert.match(trio,/aria-pressed=\{leveling.available \? leveling.enabled : undefined\}/);
});
check('English and Chinese resources agree recursively' ,()=>{
 const en=JSON.parse(read('src/packages/i18n/locales/en.json'));const zh=JSON.parse(read('src/packages/i18n/locales/zh-CN.json'));
 function compare(a,b){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const key of Object.keys(a)){
  if(typeof a[key]==='object')compare(a[key],b[key]);else{assert(a[key].length&&b[key].length);assert.deepEqual(a[key].match(/\{\{[^}]+\}\}/g),b[key].match(/\{\{[^}]+\}\}/g));}
 }}
 compare(en.voiceAudio,zh.voiceAudio);compare(en.receiveVolume,zh.receiveVolume);
});
console.log(`${count} source checks passed; not a typecheck/build/React/pointer/audio-device test.`);
