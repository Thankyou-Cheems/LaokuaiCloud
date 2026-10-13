# Community ET management proxy

This is the current Linux proxy source for the existing member-device channel.
The RPC parser and credential policy are unchanged from the frozen
`release/deployment/community-password-beta-20261012/proxy.py` (SHA256
`94e2725fb50e007b80464d720f163d9974a339515e5ab5b2fbd931b40194fb29`).
The backend, SFU and EasyTier core remain separate services.

The old unit preserved its runtime directory while the proxy rejected every
existing socket. After a restart, the leftover socket therefore prevented startup
and `/api/community-et/acquire` returned 503. The proxy now holds an exclusive
listener lock, removes only a same-owner 0600 socket whose connection is refused,
and verifies its inode before unlinking. A live listener, symlink, ordinary file,
wrong permissions or a replaced inode is preserved. Normal context exit removes
only the socket created by that listener. SIGTERM leftovers recover on restart.

Keep `RuntimeDirectoryPreserve=yes`: both the Docker bind-mounted directory inode
and renewal ledger must survive a restart. The unit retries failures with a
three-second delay and a five-starts-per-minute limit. Existing UID, network,
filesystem and capability restrictions remain in force.

On Linux, run `python3 -I test_proxy.py -v`. Tests use temporary Unix sockets and
synthetic data; they do not contact the real issuer, create TUN devices or read
credentials.

The deployed paths remain `/usr/local/libexec/laokuai-community-et-management/proxy.py`
and `/etc/systemd/system/laokuai-community-et-management.service`. Back up those
two files before replacing them, keep the program root-owned 0755 and unit 0644,
reload systemd, and restart only `laokuai-community-et-management.service`.
Do not recreate the runtime directory. Verify actual backend-to-issuer RPC as well
as service state: the presence of a socket file alone did not detect this failure.
Deployment and validation are recorded in
`release/acceptance/community-management-recovery-20261013.json` at repository root.
