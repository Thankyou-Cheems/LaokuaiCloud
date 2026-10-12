# Exact-image offline backend protocol rehearsal

Run from an owner-local checkout with Python 3 and the existing local Docker CLI/Engine:

```powershell
python release/tests/offline-backend/run-image-protocol.py --output-dir C:/owner-local/new-empty-evidence-dir
```

The runner does not start/install Docker or pull/load/build an image. It requires the exact locally built OCI image `sha256:e45e9c27fe391aa9281365745a54c34529b502f09fa79a2d8e68fcc5486d1eba`, checks its Linux/amd64/source/tree/user identity, then pins the actual bundle SHA inside the image. A classic Docker import uses a different config ID; this runner intentionally rejects that unqualified identity instead of resolving a tag. Qualify the target import separately before adapting that ID.

One uniquely labelled container uses network=none, no port publish, read-only rootfs, one read-only script mount, disposable /data and /tmp tmpfs, UID1001, one CPU, 1GiB memory, no capabilities and no restart policy. The normal immutable `node /app/bundle.js` runs as a child of the fixture orchestrator with production mode retained. HTTP/WebSocket listeners and client requests are loopback inside this container only. The fixture is not a source-module mock and does not patch the bundle.

All signing keys, JWT secret, server identity and member/refresh records are ephemeral synthetic data. They are never printed or exported. The result reports check names, component hashes, runtime versions and container configuration. No real account is registered, production credential read, persistent credential written to the host, production service contacted or image modified. Only the exact owned labelled container is stopped/removed; its tmpfs is discarded. An existing nonempty evidence directory is rejected.

The production guard that rejects absent/default JWT_SECRET is retained. The builder's empty-config exit1 was that guard, before DB initialization. This fixture supplies a fresh test-only random value inside its process rather than turning off production mode.

The 20 checks cover actual legacy join/certificate/assertion messages, actual refresh/access-token branches and negative cases, pre-copy refresh reconnect, marked-schema migration replay/config preservation, stopped WAL checkpoint + consistent synthetic copy, rollback-byte preservation, restored snapshot/resume, default account policy rejection of the local test certificate and four bounded TERM exit0 shutdowns.

The synthetic baseline was initialized with this candidate's schema and given existing members/config/migration markers matching the inspected production schema version. This proves marked-schema replay, not every historical schema transition or real data migration. Snapshot restoration uses the same exact candidate bundle; it does not prove the old production binary can reopen a candidate-mutated database. External account/CA validation, actual old client binary, backend/SFU control and media remain outside this test. Do not use the script with production mounts or credentials.

Current evidence and deployment prerequisites are in `release/BACKEND-OFFLINE-PROTOCOL-REVIEW.md` and `release/acceptance/backend-image-protocol.json`. Neither a passing fixture nor a build grants production deployment approval.
