# UI and approved-logo build handoff

Source commit: c75e6802ac9971b7d4139df8f97b99c7398efd7d
Source tree: c772bf0235e4f1696a3bc12e69025517f2295cec
Client tree: fdba7f4b377933411a5adb2c932e389ca8ec0d0e
Branch: integration/lifecycle3-20261012

27 client paths only. SDK/server/SFU/native, package versions and both locks are unchanged. Exact lifecycle.3 SDK remains 897b597926cad23447f057e2b45e95f47806ddfba2f6808e6beb32f80eec49ae; custom UI remains a2f38b3efb98dec64df486d11472d93e0c61bc7e36770a19f27d12b15f8d9822. Preserve modern runtime ZIP17bdccba and all old packages/evidence.

## Reviewable layout

Before: app-wide fixed EasyTier aside below/over the left footer, permanently showing a long missing-configuration message. After: one 18px link glyph with small status dot in the normal-flow rail, near LAN controls; top rail scrolls and nickname/settings footer is shrink-0. Explicit click opens a non-modal right-side 288px details popup capped by viewport height/width with wrapping/scroll. It reports community service connection and actual channel-array receipt separately from ET. Tiny-window view has the same compact control in normal flow. No fixed ET banner remains. Settings entry shows approved Kiriye; the existing avatar and nickname remain in the account popup and nickname edit remains at the footer. This is a source/SSR description, not a product screenshot or mounted layout acceptance.

Unconfigured ET is neutral pending setup, disabled is separate, real errors remain actionable. A closing session is not called stopped before confirmation; cleanup failure remains available while disabled. Normal authenticated community and SFU code is unchanged. App children remain rendered when ET API or server is absent; ET sync/rejection failures are contained.

## Checks and sole next builder

Full readonly app/node types 0/0, focused13-file lint 0/0, 72 pure/SSR/file checks pass (acceptance/community-ui-brand-source.json). Manual scripts: check-community-lan-isolation.mjs, check-laokuai-approved-brand.mjs, check-private-startup.mjs, check-laokuai-package-audit.mjs. Borrowed dependencies were used locally, so next builder must use one fresh offline frozen ignore-scripts install and verify installed212 SDK bytes. Build web/desktop, then only the parent-assigned internal portable with existing reviewed internal-only wrapper; retain production license/activation gates false. Verify new PNG/ICO in renderer, actual EXE PE resources, window and all11 tray mappings; report source/ASAR/EXE SHA and full payload parity. No native rebuild or application launch is part of packaging.

The old b38566f portable3a8065e5 and its bootstrap acceptance remain historical and do not cover this source. Root release verifier still insists the old lifecycle receipt's client tree is current; with this new recorded client tree it intentionally rejects Lifecycle current component mismatch. Do not weaken or delete this check to obtain a green release. The next integration must add a tested superseding current-client evidence scope, then index the new exact build/UI evidence. ready=false/finalPackage=null; no remote sync or public distribution.
