// Static file bytes only. No LoadLibrary/process/driver/native execution.
const fs=require('node:fs'),crypto=require('node:crypto');
function inspectPeImports(bytes) {
 const need=(at,size)=>{if(!Number.isSafeInteger(at)||at<0||at+size>bytes.length)throw Error('PE field out of bounds');};
 const u16=at=>{need(at,2);return bytes.readUInt16LE(at);},u32=at=>{need(at,4);return bytes.readUInt32LE(at);};
 need(0,64);if(bytes.toString('ascii',0,2)!=='MZ')throw Error('Missing MZ');
 const pe=u32(0x3c);need(pe,24);if(bytes.toString('ascii',pe,pe+4)!=='PE\0\0'||u16(pe+4)!==0x8664)throw Error('Not AMD64 PE');
 const opt=pe+24,optSize=u16(pe+20),count=u16(pe+6);need(opt,optSize);
 if(optSize<112||u16(opt)!==0x20b||count<1||count>96)throw Error('Invalid PE32+ header');
 const imageBase=bytes.readBigUInt64LE(opt+24),headers=u32(opt+60),directories=u32(opt+108),sections=[];
 for(let i=0;i<count;i++){const at=opt+optSize+i*40;need(at,40);const s={rva:u32(at+12),virtualSize:u32(at+8),raw:u32(at+20),size:u32(at+16)};need(s.raw,s.size);sections.push(s);}
 const offset=(rva,size=1)=>{
  if(rva<headers&&rva+size<=headers){need(rva,size);return rva;}
  const s=sections.find(s=>rva>=s.rva&&rva<s.rva+Math.max(s.virtualSize,s.size));
  if(!s||rva-s.rva+size>s.size)throw Error('Import RVA not backed by raw bytes');const at=s.raw+rva-s.rva;need(at,size);return at;
 };
 const name=rva=>{let text='';for(let i=0;i<261;i++){const c=bytes[offset(rva+i)];if(c===0){if(!/^[A-Za-z0-9_.-]+\.dll$/i.test(text))throw Error('Invalid import DLL name');return text;}if(c<32||c>126)throw Error('Invalid import DLL encoding');text+=String.fromCharCode(c);}throw Error('Unterminated DLL name');};
 const directory=index=>{if(index>=directories)return {rva:0,size:0};if(112+(index+1)*8>optSize)throw Error('Directory outside optional header');return {rva:u32(opt+112+index*8),size:u32(opt+116+index*8)};};
 const read=(index,stride,readName)=>{
  const d=directory(index);if(!d.rva&&!d.size)return [];if(!d.rva||d.size<stride||d.size>4*1024*1024)throw Error('Invalid import directory');
  const results=[];let terminated=false;
  for(let i=0;i<Math.min(4096,Math.floor(d.size/stride));i++){const at=offset(d.rva+i*stride,stride),fields=[];for(let j=0;j<stride;j+=4)fields.push(u32(at+j));if(fields.every(x=>x===0)){terminated=true;break;}results.push(name(readName(fields)));}
  if(!terminated)throw Error('Unterminated import descriptor table');return results;
 };
 const normalImports=read(1,20,f=>{if(!f[3])throw Error('Import name missing');return f[3];});
 const delayImports=read(13,32,f=>{
  if(f[0]&~1||!f[1])throw Error('Invalid delay descriptor');if(f[0]&1)return f[1];
  const rva=BigInt(f[1])-imageBase;if(rva<=0n||rva>0xffffffffn)throw Error('Unmappable delay VA');return Number(rva);
 });
 const captureDllImports=[...normalImports,...delayImports].filter(name=>/^(packet|wpcap)\.dll$/i.test(name)||/npcap/i.test(name));
 return {machine:'AMD64',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,
  normalImports,delayImports,captureDllImports,noCaptureDllNormalOrDelayImports:captureDllImports.length===0,executed:false};
}
if(require.main===module){if(process.argv.length<3)throw Error('Provide explicit frozen PE paths');for(const file of process.argv.slice(2))console.log(JSON.stringify(inspectPeImports(fs.readFileSync(file))));}
module.exports={inspectPeImports};
