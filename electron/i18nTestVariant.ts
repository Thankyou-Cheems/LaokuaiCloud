// Local test packaging only. This file is excluded from the upstream i18n PR.
import { app } from "electron";
import { mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

import { privateProfilePaths } from "./privateProfile";

export function isI18nTestPackage(): boolean {
  const metadata = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"));
  return metadata.grytI18nTest === true;
}

export function isLaokuaiPackage(): boolean {
  const metadata = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"));
  return metadata.grytLaokuai === true;
}

export function isolateI18nTestData(): void {
  const own = isLaokuaiPackage();
  // The portable wrapper supplies its permanent directory, rather than its
  // temporary extraction directory. Unpacked builds use their own executable dir.
  const root = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath);
  const { data, sessions, reuseExisting } = privateProfilePaths(own, process.argv, root);
  if (!reuseExisting) mkdirSync(sessions, { recursive: true });
  app.setName(own ? "唠蒯" : "唠蒯 汉化测试");
  app.setPath("userData", data);
  app.setPath("sessionData", sessions);
  app.setAppUserModelId(own ? "local.laokuai.chat" : "local.laokuai.chat.i18n-test");
}
