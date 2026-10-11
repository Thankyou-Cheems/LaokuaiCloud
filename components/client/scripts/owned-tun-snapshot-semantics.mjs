import { gunzipSync } from 'node:zlib';

export const TABLES = Object.freeze({
  rules:['Name','Enabled','Direction','Action','Profile','PolicyStoreSourceType'],profiles:['Name','Enabled','DefaultInboundAction','DefaultOutboundAction','AllowLocalFirewallRules'],
  address:['InstanceID','LocalAddress','RemoteAddress'],port:['InstanceID','Protocol','LocalPort','RemotePort','IcmpType','DynamicTarget'],
  application:['InstanceID','Program','Package'],service:['InstanceID','Service'],interface:['InstanceID','InterfaceAlias'],interfaceType:['InstanceID','InterfaceType'],
  security:['InstanceID','Authentication','Encryption','OverrideBlockRules','LocalUser','RemoteUser','RemoteMachine'],
  default4:['InterfaceIndex','NextHop','RouteMetric','InterfaceMetric'],default6:['InterfaceIndex','NextHop','RouteMetric','InterfaceMetric'],
  addresses:['IPAddress','PrefixLength','AddressFamily','PrefixOrigin','SuffixOrigin'],routes:['AddressFamily','DestinationPrefix','NextHop','RouteMetric','InterfaceMetric','Protocol'],dns:['AddressFamily','ServerAddresses'],
});
const sets=new Set(['LocalAddress','RemoteAddress','LocalPort','RemotePort','IcmpType','InterfaceAlias']);
const keyColumns={default4:[0,1],default6:[0,1],addresses:[0,2],routes:[0,1,2],dns:[0]};
const token=v=>typeof v==='string'&&/^(?:s:[0-9a-f]{64}|n:-?\d+|b:(?:true|false)|z:null)$/.test(v);
const invalid=()=>{throw new Error('invalid-semantic-configuration');};
export function validateFacts(facts) {
  if(facts?.schema!==1||!facts.tables||!facts.interfaces) invalid();
  const check=(name,table)=>{
    if(JSON.stringify(table?.columns)!==JSON.stringify(TABLES[name])||!Array.isArray(table.rows)) invalid();
    for(const row of table.rows) {
      if(!Array.isArray(row)||row.length!==table.columns.length) invalid();
      for(const cell of row) if(!(token(cell)||Array.isArray(cell)&&cell.every(token))) invalid();
    }
  };
  for(const name of ['rules','profiles','address','port','application','service','interface','interfaceType','security','default4','default6']) check(name,facts.tables[name]);
  const ruleKeys=facts.tables.rules.rows.map(r=>r[0]);
  const ruleSet=new Set(ruleKeys);
  if(ruleSet.size!==ruleKeys.length||facts.tables.profiles.rows.length!==3) invalid();
  // Preserve per-rule association, including dynamic/generated rules; never compare flat filter totals alone.
  for(const name of ['address','port','application','service','interface','interfaceType','security']) {
    const keys=facts.tables[name].rows.map(r=>r[0]);
    if(keys.length!==ruleKeys.length||new Set(keys).size!==keys.length||keys.some(k=>!ruleSet.has(k))) invalid();
  }
  for(const [guid,tables]of Object.entries(facts.interfaces)) {
    if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(guid)) invalid();
    for(const name of ['addresses','routes','dns']) check(name,tables[name]);
  }
  return facts;
}
export function decodeFacts(encoded) {
  if(encoded?.schema!==1||encoded.encoding!=='gzip-base64'||typeof encoded.data!=='string'||encoded.data.length>2097152||! /^[A-Za-z0-9+/]*={0,2}$/.test(encoded.data)) invalid();
  try { return validateFacts(JSON.parse(gunzipSync(Buffer.from(encoded.data,'base64'),{maxOutputLength:16777216}))); }
  catch { invalid(); }
}
function normalizedRows(name,table) {
  return table.rows.map(row=>row.map((cell,i)=>Array.isArray(cell)&&sets.has(table.columns[i])?[...new Set(cell)].sort():cell));
}
/** Stable row multisets; set fields only where packet conditions are unordered. DNS order is preserved. */
export function tableDifferences(name,left,right) {
  const a=normalizedRows(name,left),b=normalizedRows(name,right),keys=keyColumns[name]??[0];
  const keyed=rows=>{const result=new Map();for(const r of rows){const key=JSON.stringify(keys.map(i=>r[i]));const bucket=result.get(key)??[];bucket.push(r);result.set(key,bucket);}for(const bucket of result.values())bucket.sort((x,y)=>JSON.stringify(x)<JSON.stringify(y)?-1:JSON.stringify(x)>JSON.stringify(y)?1:0);return result;};
  const am=keyed(a),bm=keyed(b),differences=[];
  for(const key of [...new Set([...am.keys(),...bm.keys()])].sort()) {
    const ar=am.get(key)??[],br=bm.get(key)??[];
    for(let i=0;i<Math.max(ar.length,br.length);i++) {
      if(!ar[i]||!br[i]) {differences.push({table:name,key,occurrence:i,change:ar[i]?'removed':'added',row:ar[i]??br[i]});continue;}
      for(let j=0;j<left.columns.length;j++) if(JSON.stringify(ar[i][j])!==JSON.stringify(br[i][j])) differences.push({table:name,key,occurrence:i,field:left.columns[j],before:ar[i][j],after:br[i][j]});
    }
  }
  return differences;
}
export function configurationDifferences(before,now) {
  validateFacts(before.semanticFacts);validateFacts(now.semanticFacts);
  const differences=[];
  for(const name of Object.keys(before.semanticFacts.tables)) differences.push(...tableDifferences(name,before.semanticFacts.tables[name],now.semanticFacts.tables[name]));
  for(const [guid,old]of Object.entries(before.semanticFacts.interfaces)) {
    const current=now.semanticFacts.interfaces[guid];
    if(!current) {differences.push({interfaceGuid:guid,change:'removed'});continue;}
    for(const name of ['addresses','routes','dns']) differences.push(...tableDifferences(name,old[name],current[name]).map(d=>({...d,interfaceGuid:guid})));
  }
  return differences;
}
