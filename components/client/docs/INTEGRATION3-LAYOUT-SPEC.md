# integration.3 layout scope

Baseline: client 68416c657de570369f5212f6af3fa48342a43a44 (integration.2).
Authorized by the user's actual trial and parent task 01a11620-5669-7460-a755-9937719310d8.

- Names and IDs remain the primary readable information in voice member rows. Auxiliary voice mode, Squad and receive correction are compact glyphs/readouts with accessible details; speaking, mute, deafen and no-send warnings remain apparent.
- Joining voice alone must not reserve the large avatar/latency media panel. Show it only with a live enabled, unmuted local/remote camera or screen video in the connected room. Loading, failed, ended and unrelated-room media leave space to chat. Preserve media, popouts, focus and video controls.
- Keep microphone, speaker, receive leveling, camera, sharing and leave controls in an independent persistent compact bottom call bar, including narrow windows, an open media overlay and fullscreen. Keep hover sliders and existing permissions/state handling.
- Separate fullscreen/media actions from leave controls so their hit targets never overlap. Fullscreen enter/exit must not hang up, and the last video stopping must release fullscreen and chat space.
- Add a pointer/keyboard resizable left channel sidebar, sane minimum/maximum and local persistence. Shrinking the viewport must not overwrite the preferred width. Account for it when deciding if media, threads and members fit. No horizontal page overflow at narrow sizes.
- Compact channel description and ordinary empty-channel heading/paragraphs into details. Do not translate user content or remove DM encryption or automated-channel notices.
- Validate long/short names, multiple participants, media lifecycle/replacement, width reload, zoom and narrow heights, fullscreen and controls. Use synthetic headless fixtures only; no real profile, device capture, foreground app activation or current-call interruption.
- Preserve the exact frozen Voice longterm.1 package (SHA256 2197b780fba5de6a11fe1078c58ce6538b1731ac5a35578fe039c2c43b76b889), DSP mathematics/defaults, UI dependency, full existing UI, administrator data directory and previous releases.
- Deliver local integration.3 portable/source/licenses/evidence, then update only the shortcut target preserving its administrator argument. Do not push, publish, deploy, restart or force-close the live client.
