const p=require('node:path'),fs=require('node:fs'),c=require('node:crypto'),a=require('node:assert/strict');
const root=p.resolve(__dirname,'../source/components/client'),config=require(p.join(root,'electron-builder.laokuai.cjs'));
config.directories.output=p.resolve(__dirname,'../artifacts');config.electronDist=p.join(root,'node_modules/electron/dist');
a.equal(c.createHash('sha256').update(fs.readFileSync(p.join(config.electronDist,'electron.exe'))).digest('hex'),'28f3330c766aac1f8f8f7e1b472c720dc7cb1efc352d8ef30271335e0c7fa4d8');
a.equal(config.publish,null);
// Normal beforePack and distribution/source gates remain intact.
module.exports=config;
