# Explicit reuse of an existing Gryt profile

This private startup fix preserves the default isolated `laokuai-chat-data` directory.
An explicit `--user-data-dir=<absolute existing profile>` selects that profile in place.
It must contain `gryt-global.json` and `IndexedDB`; no identity or credential file is copied,
exported, imported, replaced, or printed. Conflicting/relative/missing paths fail at startup.
Official Gryt stores the renderer session in the profile root, so both `userData` and
`sessionData` select that root for explicit reuse. The renderer origin remains
`http://127.0.0.1:15738`, compatible with the original IndexedDB origin.

Exit the running Gryt/LaoKuai normally before using the launcher, since both need that
same renderer port and a profile must not be concurrently opened by two clients.
Normal application usage may update preferences/cache in the selected profile; this is
session reuse, not a read-only view. Original and anonymous entry points are retained.
No new account, server owner, permission grant or persistent authentication is configured.
