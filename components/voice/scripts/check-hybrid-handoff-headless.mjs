import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const root = resolve('dist');
const server = createServer((request, response) => {
  if (request.url === '/') { response.end('<title>Isolated hybrid WebAudio handoff</title>'); return; }
  const file = resolve(root, '.' + decodeURIComponent(request.url));
  if (!file.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try { response.setHeader('Content-Type', 'application/javascript'); response.end(readFileSync(file)); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => { throw Error('real_capture_forbidden'); }; });
  await page.goto(url);
  const results = await page.evaluate(async () => {
    const { HybridReceiveInput } = await import('/webrtc/hybrid/HybridReceiveInput.js');
    const rows = [];
    for (const rate of [44100, 48000]) for (const mode of ['handoff', 'revoke', 'dispose-restore', 'outgoing-error']) {
      const revoke = mode === 'revoke';
      const context = new OfflineAudioContext(1, rate, rate);
      const sfu = context.createConstantSource(), peer = context.createConstantSource();
      sfu.offset.value = 0.4; peer.offset.value = 0.8;
      const downstream = context.createGain(); downstream.connect(context.destination); sfu.connect(downstream);
      const track = id => ({ id, kind: 'audio', readyState: 'live' });
      const sfuTrack = track('synthetic-sfu'), peerTrack = track('synthetic-peer');
      const candidate = { track: peerTrack, stream: { getAudioTracks: () => [peerTrack] } };
      const input = new HybridReceiveInput({ sfuNode: sfu, downstream, sfuTrack,
        createCandidateNode: () => peer, isCurrent: () => true,
        getSfuMediaSequence: () => 1, waitForSfuMedia: async () => { throw Error('not_used'); } });
      sfu.start(); peer.start();
      const suspended = context.suspend(0.1), finished = context.startRendering(); await suspended;
      const start = context.currentTime;
      if (mode === 'outgoing-error') {
        const disconnect = sfu.disconnect.bind(sfu);
        sfu.disconnect = target => { if (target === downstream) throw Error('injected_disconnect_failure'); return disconnect(target); };
        let failed = false;
        try { input.select('p2p', candidate, 1); } catch (error) { failed = error.message === 'injected_disconnect_failure'; }
        if (!failed || input.getSelectedKind() !== 'sfu') throw Error('failed_handoff_did_not_preserve_original');
        sfu.disconnect = disconnect;
      } else input.select('p2p', candidate, 1);
      let complete = false;
      const completion = input.waitForSelection(1).then(() => { complete = true; return 'completed'; }, () => 'revoked');
      await Promise.resolve(); if (complete && mode !== 'outgoing-error') throw Error('handoff_completed_before_audio_time');
      if (mode === 'dispose-restore') input.dispose(true);
      let revokedAt = null;
      if (revoke) {
        const suspendAgain = context.suspend(start + 0.012); await context.resume(); await suspendAgain;
        revokedAt = context.currentTime; input.select('none', undefined, 2);
      }
      await context.resume(); const rendered = await finished, verdict = await completion;
      const samples = rendered.getChannelData(0); let maxError = 0, maxPeak = 0, afterRevokePeak = 0;
      for (let i = 0; i < samples.length; i++) {
        const at = i / rate;
        const expected = mode === 'dispose-restore' || mode === 'outgoing-error' ? 0.4 : revoke && at >= revokedAt ? 0 : at < start ? 0.4 : at < start + 0.012
          ? 0.4 * (1 - (at - start) / 0.012) : at < start + 0.024 ? 0.8 * (at - start - 0.012) / 0.012 : 0.8;
        maxError = Math.max(maxError, Math.abs(samples[i] - expected)); maxPeak = Math.max(maxPeak, Math.abs(samples[i]));
        if (revoke && at >= revokedAt) afterRevokePeak = Math.max(afterRevokePeak, Math.abs(samples[i]));
      }
      input.dispose(); rows.push({ rate, mode, revoke, start, verdict, maxError, maxPeak, afterRevokePeak });
    }
    // Real GainNode cleanup and successor ownership, without a microphone or PC.
    const context = new AudioContext(); await context.resume();
    const sfu = context.createConstantSource(), peer = context.createConstantSource(), downstream = context.createGain();
    const track = { id: 'sfu', kind: 'audio', readyState: 'live' }, remote = { ...track, id: 'peer' };
    sfu.connect(downstream); downstream.connect(context.destination); sfu.start(); peer.start();
    const options = { sfuNode: sfu, downstream, sfuTrack: track, createCandidateNode: () => peer,
      isCurrent: () => true, getSfuMediaSequence: () => 1, waitForSfuMedia: async () => { throw Error('not_used'); } };
    const first = new HybridReceiveInput(options);
    first.select('p2p', { track: remote, stream: { getAudioTracks: () => [remote] } }, 1);
    await first.waitForSelection(1);
    first.select('sfu', undefined, 2); await first.waitForSelection(2);
    const successor = new HybridReceiveInput(options); first.dispose();
    if (!successor.isCurrent() || successor.getSelectedKind() !== 'sfu') throw Error('successor_ownership_lost');
    successor.relinquishSfu();
    const suspendedOwner = new HybridReceiveInput(options); await context.suspend();
    suspendedOwner.select('p2p', { track: remote, stream: { getAudioTracks: () => [remote] } }, 3);
    const timedAt = performance.now(); let failure;
    try { await suspendedOwner.waitForSelection(3); } catch (error) { failure = error.message; }
    const waitMs = performance.now() - timedAt;
    if (failure !== 'operation_timeout' || waitMs > 3000) throw Error('suspended_handoff_not_bounded');
    suspendedOwner.dispose(true); await context.resume();
    const retiring = new HybridReceiveInput(options);
    retiring.select('p2p', { track: remote, stream: { getAudioTracks: () => [remote] } }, 5);
    const retiredWait = retiring.waitForSelection(5).then(() => 'completed', () => 'revoked');
    const replacement = new HybridReceiveInput(options);
    if (replacement.getSelectedKind() !== 'none' || await retiredWait !== 'revoked') throw Error('pending_owner_not_retired');
    replacement.select('sfu', undefined, 6); await replacement.waitForSelection(6); retiring.dispose();
    replacement.relinquishSfu(); await context.close();
    return { rows, suspendedWaitMs: waitMs };
  });
  for (const row of results.rows) {
    assert(row.maxError < 2e-5, JSON.stringify(row));
    assert(row.maxPeak <= 0.80001, 'two encodings mixed above the louder source');
    assert.equal(row.verdict, row.revoke || row.mode === 'dispose-restore' ? 'revoked' : 'completed');
    if (row.revoke) assert.equal(row.afterRevokePeak, 0, 'revocation waited for scheduled fade');
  }
  console.log(JSON.stringify({ result: 'pass', kind: 'real-chromium-webaudio-synthetic', realCapture: false,
    realPeerConnection: false, realSfuAck: false, timeAlignedEncodings: false, results }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
