/* eslint-env node */
// Use project TypeScript or an explicit offline GRYT_TYPESCRIPT_PATH.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require(process.env.GRYT_TYPESCRIPT_PATH || "typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const sourcePath = "src/packages/settings/src/hooks/settingsSearch.ts";
const keysPath = "src/packages/settings/src/hooks/settingsSearchKeys.ts";
const en = JSON.parse(read("src/packages/i18n/locales/en.json"));
const zh = JSON.parse(read("src/packages/i18n/locales/zh-CN.json"));
const originalRoutes = JSON.parse(read("scripts/fixtures/settings-search-routes.json"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const lookup = (locale, key) => key.split(".").reduce((value, part) => value?.[part], locale);
const route = ({ id, destination, page, panel }) => plain({ id, destination, page, panel });
const calls = [];
let language = "en";
const translation = {
  t(key, options) {
    calls.push({ key, language: options?.lng ?? language });
    const result = lookup((options?.lng ?? language) === "zh-CN" ? zh : en, key);
    assert.equal(typeof result, "string", `missing display key ${key}`);
    assert.ok(!result.includes("{{"), `search label needs interpolation: ${key}`);
    return result;
  },
  changeLanguage() { throw new Error("search must never change the language"); },
};

function evaluate(path, dependencies, dev = false) {
  const source = read(path).replaceAll("import.meta.env.DEV", String(dev));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
    fileName: path,
  });
  assert.deepEqual(compiled.diagnostics, [], `TypeScript transpilation: ${path}`);
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
      return dependencies[name];
    },
    fetch() { throw new Error("search must never make a network request"); },
    localStorage: new Proxy({}, { get() { throw new Error("search must never access business storage"); } }),
  }, { filename: path });
  return module.exports;
}

const keyModule = evaluate(keysPath, {});
const keys = keyModule.SETTINGS_SEARCH_KEYS;
assert.deepEqual(Object.keys(keys).sort(), originalRoutes.map((entry) => entry.id).sort(), "every fixed entry has exactly one explicit mapping");
for (const [id, fields] of Object.entries(keys)) {
  assert.deepEqual(Object.keys(fields).sort(), ["description", "section", "title"]);
  for (const key of Object.values(fields)) {
    assert.equal(typeof lookup(en, key), "string", `${id}: missing English key`);
    assert.match(lookup(zh, key), /[\u3400-\u9fff]/, `${id}: missing Chinese translation`);
  }
}

const desktopIds = new Set(["my-servers", "open-at-login", "start-with-windows", "start-minimized-on-login", "minimize-to-tray-on-close", "hardware-acceleration"]);
const devIds = new Set(["fake-participants", "in-the-voice-channel-with-you", "in-the-server-not-in-voice", "how-many-are-muted", "one-is-deafened", "they-talk", "fake-screen-share", "fake-chat", "a-message-every"]);
let assertions = 0;
for (const environment of ["browser", "windows", "mac"]) {
  for (const dev of [false, true]) {
    const module = evaluate(sourcePath, {
      "@/i18n": { i18n: translation },
      "./settingsSearchKeys": keyModule,
      "../../../../lib/electron": {
        isElectron: () => environment !== "browser",
        isMacDesktop: () => environment === "mac",
      },
    }, dev);
    const { SETTINGS_INDEX, searchSettings, settingAnchorId } = module;
    const expected = originalRoutes.filter(({ id }) => {
      if (!dev && devIds.has(id)) return false;
      if (environment === "browser" && desktopIds.has(id)) return false;
      if (environment === "mac" && ["start-with-windows", "start-minimized-on-login"].includes(id)) return false;
      if (environment === "windows" && id === "open-at-login") return false;
      return true;
    });
    assert.deepEqual(plain(SETTINGS_INDEX.map(route)), expected, `${environment}/${dev}: routes and platform gates unchanged`);
    const baseline = JSON.stringify(SETTINGS_INDEX);
    SETTINGS_INDEX.forEach(Object.freeze);
    Object.freeze(SETTINGS_INDEX);
    for (const entry of SETTINGS_INDEX) {
      for (const field of ["title", "description", "section"]) {
        assert.equal(lookup(en, keys[entry.id][field]), entry[field], `${entry.id}: source English remains the alias`);
        for (const active of ["en", "zh-CN"]) {
          language = active;
          for (const query of [entry[field], lookup(zh, keys[entry.id][field])]) {
            const results = searchSettings(query);
            const hit = results.find(({ id }) => id === entry.id);
            assert.ok(hit, `${environment}/${dev}/${active}: ${query} finds ${entry.id}`);
            assert.deepEqual(route(hit), route(entry), `${entry.id}: localized result must keep its navigation`);
            for (const label of ["title", "description", "section"]) {
              assert.equal(hit[label], lookup(active === "en" ? en : zh, keys[entry.id][label]));
            }
            assert.deepEqual(plain(results.map(({ id }) => id)), plain(SETTINGS_INDEX.filter(({ id }) => results.some((result) => result.id === id)).map(({ id }) => id)), "screen order unchanged");
            assertions++;
          }
        }
      }
    }
    assert.equal(JSON.stringify(SETTINGS_INDEX), baseline, "search never mutates fixed source or routing fields");
    for (const query of ["", " ", "\t\n"]) assert.deepEqual(plain(searchSettings(query)), []);
    assert.deepEqual(plain(searchSettings("unrelated user content <script>中文自定义名字</script>")), []);
    language = "zh-CN";
    assert.equal(searchSettings("  MICROPHONE VOLUME  ")[0].id, "microphone-volume", "English aliases remain case-insensitive");
    assert.equal(settingAnchorId("Microphone volume: 120%"), "microphone-volume");
    assert.equal(settingAnchorId("Input mode"), "input-mode");

    // Same imported search function, query, and translator reference must reflect
    // language switches immediately; no module reload or catalog recreation.
    const stableTranslator = (key) => translation.t(key);
    for (const active of ["zh-CN", "en", "zh-CN"]) {
      language = active;
      const viaDefault = searchSettings("camera").find(({ id }) => id === "flip-camera");
      const viaReact = searchSettings("camera", stableTranslator).find(({ id }) => id === "flip-camera");
      assert.equal(viaDefault.title, active === "zh-CN" ? "翻转摄像头" : "Flip camera");
      assert.deepEqual(plain(viaDefault), plain(viaReact));
      assert.equal(language, active, "Chinese alias lookup must not switch app language");
    }
  }
}

// Strict semantic TypeScript check of the real changed modules. The only stubs
// are their existing environment boundaries; React/app packages are not needed.
const stub = join(root, "__settings_search_test_boundaries__.d.ts");
const stubText = 'export declare const i18n: { t(key: string, options?: { lng: string }): string };\nexport declare function isElectron(): boolean;\nexport declare function isMacDesktop(): boolean;\n';
const globals = join(root, "__settings_search_test_globals__.d.ts");
const globalsText = 'interface ImportMeta { readonly env: { readonly DEV: boolean }; }';
const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
const host = ts.createCompilerHost(options);
const originalRead = host.readFile.bind(host);
const originalExists = host.fileExists.bind(host);
host.readFile = (path) => resolve(path) === stub ? stubText : resolve(path) === globals ? globalsText : originalRead(path);
host.fileExists = (path) => resolve(path) === stub || resolve(path) === globals || originalExists(path);
host.resolveModuleNames = (names, containingFile) => names.map((name) => {
  if (name === "@/i18n" || name === "../../../../lib/electron") return { resolvedFileName: stub, extension: ts.Extension.Dts };
  return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
});
const program = ts.createProgram([join(root, sourcePath), join(root, keysPath), globals], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.deepEqual(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], "focused strict TypeScript check");
assert.ok(calls.length > 0);
console.log(`settings search i18n: ${originalRoutes.length} explicit mappings, ${assertions} bilingual query cases, 6 platform/build variants, live language switching, immutable routing, no storage/network writes, and focused strict TypeScript check passed`);
