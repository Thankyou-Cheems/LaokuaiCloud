# 唠蒯云社区 EasyTier 云端交接包

本包供设备恢复供电后，由唯一集成 owner 对照最新本地源码实施。主要结论是：复用 EasyTier 2.7.0 的凭据和 Noise 身份机制即可完成社区入网边界，不需要另造 PKI；入网、成员身份和媒体物理直连必须分别验证。

## 范围与版本

- 已核对的官方源码：`EasyTier/EasyTier@8b7f1f0196edb5b580829ed5f135050fb5853478`，v2.7.0 prerelease。
- 已查看的私仓：`Thankyou-Cheems/LaokuaiCloud@cb209bd24fd47f2d0ff6841e5032c118678c441f`。
- owner 提供的实施基点：`71b4f57ad2931e32690efbd8e9940122a112550d`。它的未推送内容不在云端；本包没有读取、修改或接入该版本。
- 本轮只创建此独立交接包，在云端执行无网络纯 JS 测试。未使用用户电脑或另建 Codex session，未签发真实凭据、启动 ET、创建 TUN、修改防火墙或部署服务器。

## 文件

1. `INTERFACE-CONTRACT.md`：事实、字段来源、建议接口、续期撤销状态机和 owner 接入边界。
2. `TEST-MATRIX.md`：已跑的纯测试与尚未执行的产品、RPC、原生网络验收。
3. `contract-prototype.mjs`：无第三方依赖、未接入产品的 DTO 和状态机示范。
4. `contract-prototype.test.mjs`：合成边界测试，使用公开固定 fixture 字节。
5. `upstream-evidence.json`：固定源码引用和审查要点。
6. `test-results.tap`：本轮实际测试输出。
7. `SHA256SUMS`：交接文件完整性摘要。

## 运行

需要支持 ES 私有字段、`structuredClone` 和 `node:test` 的 Node，建议 Node 20 以上。本轮实际使用 Node v24.19.0。

```sh
node --test contract-prototype.test.mjs
```

无安装步骤，不读取产品源码、配置或凭据。prototype 仅依赖 Node 内建 `crypto` 做公钥字节的 SHA-256，不生成密钥，也不调用 ET。

## 实施时必须保留的区别

- `credential_id` 是管理 ID，不是公钥。生成、列表及连接观察提供的字段不同。
- `reusable=false` 禁止多 peer 并发复用，不是一次性凭据或硬件证明。
- 续期使用同身份的 `UpsertCredential` 并回读；重复 Generate 不会延长已有有效凭据的 expiry。
- `PeerVerified` 与 `PeerIdentityType.Credential` 是两个字段；固定版没有 `CredentialAuthenticated` 枚举。
- ListRoute 单独不能证明账号与设备公钥；同实例连接证据和 route 必须关联。
- 本包所有状态、即使绑定成功，也保持 `physicalDirectVerified=false`。屏幕直连另有媒体和数据面验收。

本包可以直接辅助实现和移植测试，但不能直接替换现有 IPC、Manager 或 native adapter。prototype 不验证真实 JWT/HTTPS、密钥对关系、官方 RPC、OS 进程归属或实际数据路径。

## 独立复核后的修订

修复了两项 prototype 状态机缺陷：旧 grant 的撤销不再取消无 active 状态下的新 acquire；closed 保持终态，disabled 不被迟到撤销改写。另对同一 peer 的矛盾 adapter 公钥/身份样本增加 fail-closed 检查。官方固定版本本身已拒绝同一 peer 的不同公钥/身份连接，因此第三项是采样适配边界加固，不是 EasyTier 漏洞。修订后 97 项纯测试全部通过。
