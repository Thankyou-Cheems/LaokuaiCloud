# EasyTier component provenance and patch ownership

The ET feature owner develops and delivers the minimal Windows compatibility
patch against fixed upstream v2.7.0. Task-6 alone reviews/integrates that immutable
delivery and coordinates the private build/package hashes. Do not duplicate the
core patch here or use floating latest/older source as its base.

Keep official Windows binaries as reference evidence. They are not the patched
payload. No Tencent Linux node changes, existing ET process termination, TUN
activation, firewall changes, NetworkList profile cleanup or real-profile import
are authorized by this provenance work. Preserve existing source/archive hashes.

Until patch review and exact private build/resource verification complete, the
package payload remains blocked and release readiness remains false.
The immutable dbaf0453 corrective source is accepted for isolated compilation:
see REVIEW.md for source resolution of ET-OWNERSHIP-001. Prior 1a44 files/patches
remain frozen. Keep build, actual native acceptance and payload approval separate.
Do not implement the same fix here or approve merely because static tests pass.
