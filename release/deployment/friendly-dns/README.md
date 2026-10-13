# Friendly DNS backend candidate

This update changes only the Gryt server image. It adds explicitly negotiated
memorable device names and retains the legacy `.7` directory response. Stable
member/device IPs, old names, grants, relay policy, members and chat are retained.
The client/helper counterpart is required for short names; older clients keep
their existing names. See `components/server/COMMUNITY-DNS-FRIENDLY.md`.

`operator.py` reuses read-only Compose/Docker utilities from the previous operator
but has separate activation guards. It requires the currently deployed V2 Gryt
image, backend relay gate1 and proxy gate2, discovers **all** current Compose
overlays, creates an online SQLite backup, and builds offline by copying only the
frozen bundle onto the current image. Production activation is a separate phase.
SFU, EasyTier and the management proxy are not restarted or reconfigured.

The candidate must be frozen to a clean source commit, hash-pinned and built
before activation approval. Private convenience scripts live in
`.local/friendly-dns-20261013/`. Never upload raw profiles or credentials.

Activation preserves environment, mounts, ports, 12-person limit and both relay
gates. Failure restores the exact preceding **already V2-capable** image with
all preceding overlays; it does not roll back to a pre-V2 image or rewrite the
database. New name tables are additive and can remain after code rollback.

No activation is established by this preparation document. A separate measured
receipt must record the exact deployed source/image and actual verification.
