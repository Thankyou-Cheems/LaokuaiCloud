# Endpoint evidence source follow-up

Owner commit `17f3dd1fd73b2efa4dc1042f18437799c35b20e5`, based on `d8a2eeb6ba796fc218442dcb03abba22cf53f4ae`, is imported as thirteen exact script Git blobs. Original patch SHA256 is `3b6eedf3e52eeec35f186f6c4c63f32b3827b7e140b7ec0e7722ffc61299bbf5`. This sanitized record and LF attributes are local integration adaptations. Raw endpoint observations and the owner's historical machine diagnosis are not imported.

The source now saves masked endpoint protocol/address/port/state, UTC query intervals and PID creation identity before rejecting unexpected evidence. UDP remote address/port remain explicitly unavailable. Unknown fields, changed PID identity, query failure, truncation and aggregate/detail disagreement reject; every owned UDP endpoint remains forbidden. The loopback RPC-only TCP rule is preserved. No endpoint-purpose exception is added.

Task6 passed 101 pure checks (20 trial,14 snapshot,10 semantic,5 observer,29 socket,23 mocked production adapter), plus eight planning checks. The socket test only calls its fake-data PowerShell projector and parser. Its first sandbox run failed AuthorizationManager access; the identical source passed a narrowly unsandboxed fake-data retry. Logs are preserved outside Git. Task6 executed no OS socket collector, native/core/TUN, build or production helper.

The strongest source candidate is the OSPF startup UDP NAT collector binding before the empty STUN-list check. The historical first unexpected endpoint was not retained; its protocol/purpose/call-site attribution is still unknown. Source confirmation or a reviewed standard disable path remains with the ET owner. This patch does not disable connectivity or authorize another activation.

New diagnostic scope is schema5 / 17 source pins / `425b0131d0bf016a9ee5d4000b3fec492b5c637dcfe5d30dff1300386bce022c`. The consumed schema4 scope is rejected. No new activation approval exists. These diagnostic pins still refer to the immutable dbaf binary payload; any future rebuilt native payload needs its own fresh hashes, reviewed scope and authorization. The actual65s failure/owned graceful cleanup remains historical and unchanged.
