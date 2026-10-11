import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/components/ConnectionTopologyIcon.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
assert.deepEqual(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
const exports={},jsx=(type,props)=>({type,props});vm.runInNewContext(compiled.outputText,{exports,require(name){assert.equal(name,'react/jsx-runtime');return{jsx,jsxs:jsx};}});
const paths=new Set();for(const kind of ['direct','member-relay','server-relay','connecting','disconnected','unknown']){
 const svg=exports.ConnectionTopologyIcon({kind});assert.equal(svg.props.viewBox,'0 0 16 16');assert.equal(svg.props.width,"14");assert.equal(svg.props.height,"14");assert.equal(svg.props.strokeWidth,'1.4');assert.equal(svg.props['aria-hidden'],'true');paths.add(svg.props.children.props.d);
 if(kind==='connecting'){assert.match(svg.props.className,/motion-safe:animate-spin motion-reduce:animate-none/);assert.equal(svg.props.style.animationDuration,'2.8s');}else assert.doesNotMatch(svg.props.className,/animate-spin/);
}assert.equal(paths.size,6);assert.ok(paths.has(exports.ConnectionTopologyIcon({kind:'invalid'}).props.children.props.d));console.log('6 distinct icon geometries, shared grid/stroke, reduced-motion and safe fallback passed.');
