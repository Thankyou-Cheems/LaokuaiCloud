import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/roomAccessCooldown.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,performance});
export const RoomAccessCooldown=exports.RoomAccessCooldown;
export function coordinatorTestDependency(name) {
  if(name.endsWith('/roomAccessCooldown'))return exports;
  if(name.endsWith('/localDiagnostics'))return {localDiagnostic(){},diagnosticHostSlot:()=>0};
  if(name==='@/socket/src/utils/rateLimitHandler')return {handleRateLimitError(){}};
  throw new Error('Unexpected coordinator dependency');
}
