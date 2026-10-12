from pathlib import Path
import hashlib,json,zipfile,shutil
stage=Path(__file__).resolve().parents[1];package=stage/'source/components/client/node_modules/uiohook-napi'
pkg=json.loads((package/'package.json').read_text());out=stage/'recipient-source/Native-Hook-Corresponding-Source.zip'
if out.exists():shutil.copyfile(out,stage/'checkpoint-a5/NativeHook-preparation-incomplete.zip')
rows=[]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(package.rglob('*')):
  if not p.is_file():continue
  rel=p.relative_to(package)
  if any(x in ['.git','node_modules','prebuilds','build'] for x in rel.parts) or p.suffix.lower() in ['.node','.exe','.dll','.lib','.pdb']:continue
  b=p.read_bytes();z.writestr('uiohook-napi/'+rel.as_posix(),b);rows.append({'path':rel.as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
 dep=stage/'source/components/client/node_modules/node-gyp-build';assert dep.exists()
 for p in dep.rglob('*'):
  if p.is_file() and not any(x in ['.git','node_modules'] for x in p.relative_to(dep).parts):z.writestr('native-build-loader/node-gyp-build/'+p.relative_to(dep).as_posix(),p.read_bytes())
 z.writestr('SOURCE-MANIFEST.json',json.dumps({'package':pkg['name'],'version':pkg['version'],'files':rows,'originalSourceAndNotices':True,'hookExecuted':False,'rebuildTestedThisTurn':False},indent=2)+'\n')
 z.writestr('README.txt','Exact installed uiohook-napi1.5.4 and vendored libuiohook preferred source; original MIT/LGPL/GPL notices and node-gyp-build loader source retained. The addon is C N-API. Client yarn.lock pins dependencies. Use binding.gyp with standard node-gyp and matching Electron40.6.1/Windowsx64 headers/tools to rebuild. Replace/repack node_modules/uiohook-napi/prebuilds/win32-x64/node.napi.node with a compatible modified build; the complete open client build recipe is adjacent. No user keys, identity/profile state or signing keys are required. This export is checked, not newly rebuilt or activated.\n')
with zipfile.ZipFile(out) as z:assert z.testzip() is None
print(json.dumps({'package':pkg['name'],'version':pkg['version'],'preferredFiles':len(rows),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
