# integration.4 pure voice specification

Authorized baseline: ce41ad6c737140a91a8b7ac34c6206837f78f305 (integration.3).
This document records the parent/user contract; it does not authorize production policy changes.

1. Remove camera and screen sharing from this private client. No capture, publication, subscription, reconnect resurrection, settings preview, native capture, or shortcut entry for camera/screen, including screen audio. Preserve microphone permission and voice identity.
2. Remove the duplicate sidebar call capsule, preserving the personal-avatar/account entry. Keep one persistent call toolbar reachable when viewing other servers/DMs, connecting or recovering.
3. Toolbar order: VA/PTT segmented control, microphone, speaker, receive leveling, separate Squad toggle, leave. Main buttons have persistent localized text; arrows belong to their controls. PTT key appears beside its mode. Segment supports pointer and keyboard; mode changes never unmute manual/server mute.
4. Explain: automatic leveling brings speech levels closer; total receive volume determines final listening level and lowering it is not automatically compensated. Fixed target is dBFS, not LUFS. Actual master routing must follow the new Voice contract, not assumptions about the old graph.
5. Member row: avatar/name left, compact states right. Preserve nickname room and a compact dynamic correction ring; numerical details in accessible popup. Self speaking uses actual post-transmission-gate speech evidence; never light while muted, unpressed PTT, Squad suppression, disconnected or forbidden. Reduced motion uses a static border.
6. Audit channel details/settings, member profile/volume, devices, PTT, Squad, context menus and confirmations for overlap/scale. Use a shared popup root, collision flip/avoidance, bounded scrollable content rather than only z-index. Toolbar wraps by groups without covering chat input.
7. Check 100/125/150/200% UI scaling, smallest windows, long names/device labels and resizing/sidebar drag while popup is open.
8. Voice owner provides sudden-loud protection and safe learned-prior restore; client does not change DSP parameters or directly apply historical gain.
9. Client prior persistence keys local stable account + stable server instance + remote stable user + processing schema; no channel/nickname/receiver/track in cache key. 30-day TTL, 500-entry LRU; lastVerified renewed only from real accepted speech. Store statistics, no audio, local only. Single-person/all-clear, corrupted/unavailable storage cold-start, account isolation and invalidation of late writes after clear.
10. Implement missing authenticated atomic member move locally across server/SFU/SDK. No pretend kick/rejoin. Preparation retains the source, reserves one destination transaction, and only authority commit switches membership/media. Test permissions, capacity, identity, concurrent/disconnect/query/rollback boundaries. New production acceptance rules and audio-only enforcement remain separate deployment approval; absence of the old protocol does not cancel this requirement.
11. Audible distinct short join/leave cues for genuine other-member events in current room. Investigate event delivery, output sink, gain and autoplay before increasing volume. Separate cue volume/preview; obey disabled sounds, DND and mute semantics; explain master relation. Reconnect snapshots do not count as joins; deduplicate, coalesce/rate-limit bursts and cancel old-room pending playback. Admin moves reuse the same authoritative events exactly once. Test only synthetic/isolated audio; never surprise current call with test playback.
12. Independent server-capacity fact collection: CPU quota/affinity, memory limits, SFU forwarding, bandwidth evidence, Opus bitrate/packet rate/DTX, one/multiple rooms. Distinguish online/channel/speaking populations. No saturation test, resource changes or speculative capacity numbers.

Regression seams continue the authorized isolated browser controls/layout tests and public module APIs. New Voice owner verifies actual audio-only negotiation and gate/VAD/prior DSP seams; client validates binding/persistence and public UI. Server investigation is read-only until policy confirmation.

Release: local integration.4 portable, exact corresponding client/UI/Voice sources, licenses, patches and bounded headless evidence. No current-session termination, foreground activation, public push/PR or production deployment. Keep integration.3 and its shortcut unchanged until cross-module acceptance passes.

## 13. 每位成员网络质量
以本人客户端到 SFU/server 的实测为来源。低频认证摘要，身份绑定、有限数值、序号/时间/TTL和断线清空。低包量/DTX不是零丢包优秀；缺测显示未知。无IP、candidate或接口信息。旧estimated latency不得冒充逐成员双向质量。

## 更新说明
私版不提供官方更新按钮/自动更新/渠道开关；保留准确版本与手动定制包更新说明，不新建更新服务。
