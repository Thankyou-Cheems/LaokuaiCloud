# Fixed EasyTier Windows compatibility component

`provenance.json` is the component's immutable-base / pending-delivery contract.
The upstream base is v2.7.0 prerelease commit
`8b7f1f0196edb5b580829ed5f135050fb5853478`. This is a minimal downstream Windows
compatibility patch, not a downgrade or a change to Tencent Linux public nodes.

The ET owner must deliver the fixed-base source commit, cumulative patch and each
patch SHA256. Task-6 reviews the delivery before the single private compile/pack.
The intended changes disable global NetworkList cleanup by default, make automatic
firewall/category policy explicitly controllable, and gracefully stop the owned
instance without deleting persistent configuration. Their implementation and real
Windows acceptance are pending; no equivalent patch is implemented in this tree.

Private source/tree, patchset, build receipt, runtime file and package SHA256 slots
stay empty until actual delivery/review/build evidence exists. The official Windows
archive and five extracted file hashes are retained as reference only. Final
private packaging rejects them as the patched payload. No binaries, configurations,
credentials, profiles or raw host diagnostics are imported here.

The root release manifest remains the release authority. Parent preflight reported
an existing private ET adapter and upstream TUN firewall/profile side effects.
An administrator token is not compatibility acceptance. The current forceful
owned-process exit also does not prove that OS routes were cleaned up.
