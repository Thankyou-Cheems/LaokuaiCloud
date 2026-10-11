import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { fakeFacts,token } from './owned-tun-snapshot-fixture.mjs';
import { configurationDifferences,tableDifferences,validateFacts,decodeFacts } from './owned-tun-snapshot-semantics.mjs';
const guid='00000000-0000-4000-8000-000000000001';
let count=0;const test=(name,fn)=>{fn();console.log(`ok ${++count} ${name}`);};
test('explicit primitive facts roundtrip, including null and empty arrays',()=>{
  const facts=fakeFacts(guid);validateFacts(facts);
  assert.deepEqual(decodeFacts({schema:1,encoding:'gzip-base64',data:gzipSync(JSON.stringify(facts)).toString('base64')}),facts);
});
test('record order and unordered packet-condition arrays do not imply config drift',()=>{
  const a={semanticFacts:fakeFacts(guid)},b=structuredClone(a);
  b.semanticFacts.tables.profiles.rows.reverse();
  a.semanticFacts.tables.address.rows[0][1]=[token('a'),token('b')];b.semanticFacts.tables.address.rows[0][1]=[token('b'),token('a')];
  assert.deepEqual(configurationDifferences(a,b),[]);
});
test('same primary key route records compare as a sorted multiset, preserving multiplicity',()=>{
  const a={semanticFacts:fakeFacts(guid)},b=structuredClone(a);
  const row=[...a.semanticFacts.tables.default4.rows[0]];row[2]='n:50';
  a.semanticFacts.tables.default4.rows.push(row);b.semanticFacts.tables.default4.rows.unshift([...row]);
  assert.deepEqual(configurationDifferences(a,b),[]);
  b.semanticFacts.tables.default4.rows.push([...row]);assert.ok(configurationDifferences(a,b).length);
});
test('rule action/enablement/source and each associated filter stay material',()=>{
  for(const [name,index]of [['rules',1],['rules',3],['rules',5],['address',1],['port',2],['application',1],['service',1],['interface',1],['interfaceType',1],['security',4]]) {
    const a={semanticFacts:fakeFacts(guid)},b=structuredClone(a);b.semanticFacts.tables[name].rows[0][index]=token('changed');
    const diff=configurationDifferences(a,b);assert.equal(diff[0].field,b.semanticFacts.tables[name].columns[index]);
  }
});
test('swapping program conditions between rules remains detectable despite identical flat totals',()=>{
  const a={semanticFacts:fakeFacts(guid)};const id2=token('second-rule');
  for(const name of ['rules','address','port','application','service','interface','interfaceType','security']) {
    const row=structuredClone(a.semanticFacts.tables[name].rows[0]);row[0]=id2;a.semanticFacts.tables[name].rows.push(row);
  }
  a.semanticFacts.tables.application.rows[1][1]=token('second-program');const b=structuredClone(a);
  [b.semanticFacts.tables.application.rows[0][1],b.semanticFacts.tables.application.rows[1][1]]=[b.semanticFacts.tables.application.rows[1][1],b.semanticFacts.tables.application.rows[0][1]];
  assert.equal(configurationDifferences(a,b).length,2);
});
test('default next hop/metrics and DNS priority changes remain material',()=>{
  const a={semanticFacts:fakeFacts(guid)},b=structuredClone(a);b.semanticFacts.interfaces[guid].dns.rows[0][1].reverse();
  assert.equal(configurationDifferences(a,b)[0].field,'ServerAddresses');
  b.semanticFacts.interfaces[guid].dns=structuredClone(a.semanticFacts.interfaces[guid].dns);b.semanticFacts.tables.default4.rows[0][2]='n:99';
  assert.equal(configurationDifferences(a,b)[0].field,'RouteMetric');
});
test('malformed schema, missing fields, unlinked or duplicate rule filters fail closed',()=>{
  for(const edit of [f=>{delete f.tables.port;},f=>{f.tables.port.rows[0][0]=token('unlinked');},f=>{f.tables.rules.rows.push([...f.tables.rules.rows[0]]);},f=>{f.tables.port.columns.pop();}]) {
    const f=fakeFacts(guid);edit(f);assert.throws(()=>validateFacts(f));
  }
});
test('raw endpoints and unknown provider objects cannot enter safe fact journals',()=>{
  for(const value of ['203.0.113.1','network_secret=value',{CimProperties:123}]) {const f=fakeFacts(guid);f.tables.application.rows[0][1]=value;assert.throws(()=>validateFacts(f));}
});
test('absent facts cannot silently fall back to unstable aggregate hashes',()=>{
  assert.throws(()=>configurationDifferences({firewallSha256:'same'},{firewallSha256:'same'}));
});
test('decompression is bounded and invalid/truncated encodings cannot pass',()=>{
  for(const data of ['invalid','AA==',gzipSync('x'.repeat(16777217)).toString('base64')]) assert.throws(()=>decodeFacts({schema:1,encoding:'gzip-base64',data}));
});
console.log(`${count} pure semantic checks passed; no OS/native queries`);
