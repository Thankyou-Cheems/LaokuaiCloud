/* eslint-env node */
// Downstream bundle only. The official archive stays in its separate reference path.
const directory = "community-lan/product/2.7.0-laokuai";
module.exports = ["easytier-core.exe", "easytier-cli.exe", "WinDivert64.sys", "wintun.dll", "laokuai-build.json"]
  .map(name => ({ from: `build/${directory}/${name}`, to: `${directory}/${name}` }));
