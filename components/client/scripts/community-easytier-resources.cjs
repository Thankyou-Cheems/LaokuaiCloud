/* eslint-env node */
// Static, immutable v2.7.0 Windows x64 sidecar resources. No executable is run.
const directory = "community-lan/runtime/790fd9be347b00753570ac2b65f874a591ede9427603fe34e74a86b2b084847f";
module.exports = ["easytier-core.exe", "easytier-cli.exe", "Packet.dll", "WinDivert64.sys", "wintun.dll"]
  .map(name => ({ from: `build/${directory}/${name}`, to: `${directory}/${name}` }));
