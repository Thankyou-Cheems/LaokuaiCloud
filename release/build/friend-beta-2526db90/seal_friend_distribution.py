from pathlib import Path
import hashlib,json,zipfile,shutil
stage=Path(__file__).resolve().parents[1];delivery=stage/'friend-distribution';delivery.mkdir(exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
source='2526db9081567da13f246be801a3b4662cb38102';version='1.13.22-laokuai.beta.20261012.1'
exe=next((stage/'artifacts').glob('*.exe'));audit=json.loads((stage/'PACKAGE-FINAL-AUDIT.json').read_text());smoke=json.loads((stage/'PACKAGE-SMOKE-SUMMARY.json').read_text());deployment=json.loads((stage/'DEPLOY-INSTALL.json').read_text())['result']
assert audit['status']=='passed' and smoke['scope']=='PASS-bootstrap-and-exact-package-only' and deployment['activated'] and not deployment['passwordConfigured']
assert json.loads((stage/'PACK-FINAL.json').read_text())['exit']==0
assert not (delivery/exe.name).exists(),'preserve-existing-delivery'
shutil.copyfile(exe,delivery/exe.name)
sources=delivery/'recipient-source';sources.mkdir()
for p in sorted((stage/'recipient-source').glob('*.zip')):
 with zipfile.ZipFile(p) as z:assert z.testzip() is None
 shutil.copyfile(p,sources/p.name)
assert len(list(sources.glob('*.zip')))==8
proxy=stage.parent/'laokuai-cloud-lifecycle3-integration/release/deployment/community-password-beta-20261012/proxy.py'
shutil.copyfile(proxy,sources/'community-management-proxy.py')
shutil.copyfile(stage/'SOURCE-OFFER.json',delivery/'SOURCE-OFFER.json')
shutil.copyfile(stage/'WINDIVERT-SOURCE.json',sources/'WINDIVERT-SOURCE.json')
shutil.copyfile(stage/'source/components/client/release/BETA-NOTICES.md',delivery/'BETA-NOTICES.md')
extra=[]
for n in ['Native-Hook-Corresponding-Source.zip','WinDivert-v2.2.2-Original-Source.zip','community-management-proxy.py']:
 p=sources/n;b=p.read_bytes();extra.append({'file':n,'bytes':len(b),'sha256':sha(b)})
(delivery/'ADDITIONAL-SOURCE-MANIFEST.json').write_bytes((json.dumps({'sourceCommit':source,'sources':extra,'runtimeOrHookOrDriverRecompiled':False},indent=2)+'\n').encode())
readme='''# 唠蒯云朋友测试绿色包

版本：1.13.22-laokuai.beta.20261012.1，Windows 10/11 x64。未签名，无自动更新。

请分享整个ZIP，保留recipient-source和许可说明。解压后将EXE放在固定目录运行；无需把源码包解开才能使用。新资料在EXE同目录laokuai-chat-data/sessions，每人创建自己的身份。不要发送自己的数据目录。包中不包含管理员资料、登录令牌、共享密码、ET私钥、临时激活文件、私人网络秘密或真实日志。

添加voice.ruikang.wang。后台已启用密码准入，但管理员本人尚未设置密码，因此新成员加入尚未开通。管理员用自己的既有owner身份打开社区设置，在“社区共享密码”两个遮蔽输入框手动输入并点击“保存密码并启用密码准入”；本包不会代填。新成员通过密码只取得普通成员身份，不能成为管理员；已有成员与owner保留。密码区分大小写，与邀请码不同，不放进链接。

语音可普通权限运行；联机虚拟网卡需以同一Windows用户的管理员权限启动。加入社区后首次点击开启联机，阅读本机对话框并确认。每台设备使用自己的身份与300秒凭据，自动续期；关闭联机或退出清理自己的实例和配置。没有额外试用期限、开放窗口或20台设备配额，/24地址池有自然容量。仅对既有公共2.7节点生效，不管理私人CheemsTier，不修改防火墙。

保持当前中文界面、奇丽叶品牌、已确认的语音重连修复、Squad/PTT与现代标准CRT EasyTier2.7。当前摄像头/屏幕入口限制保留。此包通过源码类型/定向检查、正常打包门禁、28个冻结运行依赖闭包、146个实际载荷文件字节一致校验，以及隐藏离线空资料真实启动：中文DOM/preload正常，13个成功端点采样为零、无前台激活、exit0/无残留。此范围不等同真实账号、成员菜单、双设备通话/联机、游戏、容量或听感验收；语音物理直连仍未证明。

精确源码：2526db9081567da13f246be801a3b4662cb38102。运行源码与首编a5c557be的Client/src、Electron、Voice、Server树完全相同；后续只修复许可遍历和收集现有运行依赖，未重复编译运行代码或原生代码。

六份主要对应源码/工具的固定hash在SOURCE-OFFER.json；额外N-API/libuiohook、官方WinDivert2.2.2源码及公共管理代理源码见ADDITIONAL-SOURCE-MANIFEST.json。原始许可证、版权和开源修改/再分发权利保留；Microsoft/Wintun系统组件适用各自原许可，不重新许可为AGPL。EXE内legal保留完整原始notice。过去构建receipt与历史notice中的未验状态按其当时范围保留，本次朋友测试范围和材料以此README、BETA-NOTICES及MANIFEST为准。无公开发布/上传。
'''
(delivery/'README.md').write_bytes(readme.encode())
rows=[]
for p in sorted(delivery.rglob('*')):
 if p.is_file():
  b=p.read_bytes();rows.append({'file':p.relative_to(delivery).as_posix(),'bytes':len(b),'sha256':sha(b)})
manifest={'version':version,'sourceCommit':source,'sourceProgramCompileCommit':'a5c557be693520ade66dd896150327252716e561','files':rows,'portable':next(r for r in rows if r['file']==exe.name),'asArSha256':audit['appAsarSha256'],'payloadFiles':146,'packageSmoke':smoke,'passwordConfigured':False,'newMemberAdmissionOpen':False,'communityMemberPolicy':'persistent-approval-short-ttl-per-device','publicReleaseOrUploadExecuted':False,'realProfilesOrCredentialsOrLogsIncluded':False,'fullAcceptanceReady':False}
(delivery/'MANIFEST.json').write_bytes((json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode())
out=stage/('唠蒯云-'+version+'-win-x64-朋友测试.zip');assert not out.exists()
with zipfile.ZipFile(out,'w',zipfile.ZIP_STORED) as z:
 for p in sorted(delivery.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(delivery).as_posix())
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 assert set(z.namelist())=={p.relative_to(delivery).as_posix() for p in delivery.rglob('*') if p.is_file()}
 for row in rows:assert sha(z.read(row['file']))==row['sha256']
receipt={'version':version,'sourceCommit':source,'portable':manifest['portable'],'distributionZip':{'file':out.name,'bytes':out.stat().st_size,'sha256':sha(out.read_bytes())},'customerFiles':len(rows)+1,'customerZipNoProfileOrLogByAllowlist':True,'eightSourceArchivesCrcVerified':True,'finalZipCrcAndAllFileShaVerified':True,'newMemberAdmissionOpen':False,'passwordConfigured':False,'readyForUserAuthorizedFriendTestDistribution':True,'publicReleaseApproved':False,'fullDeviceOrGameAcceptance':False}
(stage/'DISTRIBUTION-RECEIPT.json').write_bytes((json.dumps(receipt,ensure_ascii=False,indent=2)+'\n').encode())
print(json.dumps(receipt,ensure_ascii=False))
