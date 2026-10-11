/** One routed, cancellable Web Audio path for playback and settings previews. */
import { sliderToGain } from "./audioVolume";
import { type AudioOutput, routeOutputDevice } from "./outputDevice";

let ctx: AudioContext | null = null;
let outputDeviceID = "";
let outputRevision = 0;
const bufferCache = new Map<string, AudioBuffer>();
const rawCache = new Map<string, ArrayBuffer>();
const active = new Set<NotificationPlayback>();
export interface NotificationPlayback { stop(): void; finished: Promise<boolean> }
export interface NotificationPlaybackOptions { shouldPlay?: () => boolean }
function getContext(): AudioContext { return ctx ??= new AudioContext(); }
async function fetchRaw(url: string): Promise<ArrayBuffer> {
  const cached = rawCache.get(url); if (cached) return cached;
  const res = await fetch(url); if (!res.ok) throw new Error("notification_fetch_failed");
  const raw = await res.arrayBuffer(); rawCache.set(url,raw);
  if (rawCache.size>32) rawCache.delete(rawCache.keys().next().value!);
  return raw;
}
async function fetchBuffer(actx: AudioContext,url: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(url); if(cached)return cached;
  const raw = await fetchRaw(url); const buffer = await actx.decodeAudioData(raw.slice(0));
  rawCache.delete(url); bufferCache.set(url,buffer);
  if(bufferCache.size>32)bufferCache.delete(bufferCache.keys().next().value!);
  return buffer;
}
export function playNotificationSound(url: string, sliderValue: number, options: NotificationPlaybackOptions = {}): NotificationPlayback {
  let canceled = false; let started = false; let settled = false;
  let source: AudioBufferSourceNode | undefined; let gain: GainNode | undefined;
  let resolve!: (played:boolean)=>void;
  const finished = new Promise<boolean>(done=>{resolve=done;});
  const finish = (played:boolean) => {
    if(settled)return; settled=true; active.delete(playback);
    source?.disconnect(); gain?.disconnect(); resolve(played);
  };
  const playback: NotificationPlayback = {finished,stop(){canceled=true; if(started)source?.stop(); finish(false);}};
  const volume = sliderToGain(sliderValue);
  const revision = outputRevision;
  const current = () => !canceled && revision === outputRevision && options.shouldPlay?.() !== false;
  if(!Number.isFinite(volume) || volume<=0 || !current()){finish(false);return playback;}
  active.add(playback);
  // Resume is requested synchronously while a preview/call gesture is active.
  let actx: AudioContext; let resumed: Promise<void>;
  try { actx=getContext(); resumed=actx.state === "suspended" ? actx.resume() : Promise.resolve(); }
  catch { finish(false); return playback; }
  void (async()=>{
    try {
      await resumed;
      if(actx.state !== "running" || !current()){finish(false);return;}
      const buffer = await fetchBuffer(actx,url);
      if(!current()){finish(false);return;}
      await routeOutputDevice(actx as AudioOutput,outputDeviceID);
      if(!current() || actx.state !== "running"){finish(false);return;}
      source=actx.createBufferSource(); source.buffer=buffer;
      gain=actx.createGain(); gain.gain.value=volume;
      source.connect(gain);gain.connect(actx.destination);
      source.onended=()=>finish(!canceled);started=true;source.start();
    } catch { finish(false); }
  })();
  return playback;
}
export function preloadNotificationSound(url: string): void { void fetchRaw(url).catch(()=>{}); }
/** Establish autoplay permission during a real gesture, including first use. */
export function warmNotificationContext(): void {
  try { const actx=getContext(); if(actx.state === "suspended")void actx.resume().catch(()=>{}); } catch { /* unavailable */ }
}
export function setNotificationOutputDevice(deviceId: string): void {
  if(deviceId !== outputDeviceID) {
    outputDeviceID=deviceId;outputRevision++;
    for(const playback of [...active])playback.stop();
  }
  // A devicechange may restore the same saved ID after an unplug fallback.
  if(ctx)void routeOutputDevice(ctx as AudioOutput,deviceId);
}
