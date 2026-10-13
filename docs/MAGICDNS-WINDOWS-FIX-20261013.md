# MagicDNS Windows 规则兼容修复

`.7` 成员域名不显示的实机原因是 NRPT 辅助程序错误解释 Windows DNS
provider 的结果，界面因此保持 `dnsReady=false` 并隐藏不可用的域名。

实机逐段复现发现三个问题：

- 没有现存规则时，`Get` 方法返回 null；原代码将空列表误判为失败。
- 显式传入空的 DirectAccess/IPsec 可选参数会被 Windows 拒绝。
- 禁用 DNSSEC/DirectAccess 时，其依赖布尔字段可以为 null；原转换要求
  所有字段都是 bool，导致刚创建的规则无法回读。

修复接受正常空输出，保留显式非零返回码/调用异常检查；只传创建普通解析
规则所需参数。依赖布尔字段仅在父功能明确禁用时接受 null。每次创建、删除
仍回读完整所有权标记和规则内容，不凭调用无异常认定成功。

验证结果：

- 同一个实际源码只读复现从 `dns-policy-invalid` 转为读取空列表通过。
- 实际管理员临时规则创建、回读、幂等准备、删除通过；前后原规则相同。
  中间失败试验产生的两条临时规则已按精确临时所有权清理，未遗留。
- 根 `tools/check-core-contracts.ps1` 31 组检查通过，新增空输出和禁用功能
  空字段回归检查。
- 桌面 `.7` 仅更新 helper EXE 和匹配的 build receipt，原文件保存在
  忽略的私有操作目录。原 `.7` ZIP 保持不变，未改用户数据或重启 ET/SFU。
- 更新后真实社区设备域名通过 `127.0.0.153` 和 Windows 默认解析器均返回
  已分配虚拟 IP；用户确认右侧已出现可复制域名。

这证明本机规则/解析/显示已工作，不扩展为其他设备、游戏或断线恢复验收。
用户随后要求将内部长名称替换为好记的短地址；该变更另行记录并兼容旧客户端。

Windows provider 的输入/输出文档：
[Get](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/dnsclientpsprov/get-ps-dnsclientnrptrule)、
[Add](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/dnsclientpsprov/add-ps-dnsclientnrptrule)。
