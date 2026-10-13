import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Tests the current policy source without rebuilding or replacing the frozen SDK dist.
const dist=new URL('../dist/shared/mediaPolicy.js',import.meta.url).href;
const source=new URL('../src/shared/mediaPolicy.ts',import.meta.url);
export async function load(url,context,nextLoad){
  if(url!==dist)return nextLoad(url,context);
  const compiled=ts.transpileModule(readFileSync(source,'utf8'),{fileName:fileURLToPath(source),
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
  if(compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('media policy test source did not transpile');
  return {format:'module',shortCircuit:true,source:compiled.outputText};
}
