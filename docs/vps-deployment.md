# GitHub 构建，Ubuntu VPS 拉取运行

## 先了解兼容性

目标是保留两个游戏现有玩法和页面，但修改了联机协议，前端与服务端必须同版更新，
旧页面需要刷新。完整的浏览器界面、动画及多设备同步仍需要人工回归，不能仅凭构建成功
就断言全部功能完全一致。

明确的行为变化：联机掉线会结束本局；房间空闲 30 分钟或存在 6 小时后关闭；
一个连接只能加入一个房间；消息过快可能被断开；昵称/成绩有长度和数值边界；
生产环境必须填写实际 PUBLIC_ORIGIN；不再允许别的网站用 iframe 嵌入游戏。

Docker 代理环境下真实来源 IP 尚未配置，玩家会共享保守的 IP 配额。
首次先少量玩家试玩，扩大范围前需完善代理的真实 IP 传递和信任规则。
单人成绩仍由浏览器上报，不能作为可信竞赛成绩。其他边界见 security-and-deployment.md。

## 1. GitHub Actions 构建

工作流位于 .github/workflows/docker.yml，推送 main 或 security-hardening 分支的代码时触发，
也支持手动触发（GitHub 的手动运行入口通常需要该工作流先存在于默认分支）。
文档修改不会单独触发构建。构建在 GitHub 官方 ARM64 runner 上完成，不使用 VPS runner。

流程：ARM64 构建 → JavaScript 语法/规则测试 → 受限容器 HTTP/Socket.IO 检查 →
依赖高危/严重漏洞检查 → 发布 GHCR。任何检查失败都不发布该次镜像。
依赖检查需要 npm 官方审计接口可用，网络失败也会阻止发布，不会自动运行 audit fix。

在你的 Fork 中启用 GitHub Actions。工作流使用最小需要的 contents:read 和 packages:write，
通过平台自带的 GITHUB_TOKEN 发布，无需配置 VPS SSH 密钥或个人 PAT。

构建成功后到 Actions 对应运行的 Summary，复制类似下面的完整行：

```dotenv
GAME_IMAGE=ghcr.io/dmcdark/bible-game-online:build-123456789-1
```

这个只是格式示例，必须使用实际成功运行的输出。每次运行/重试使用独立标签，避免 latest 漂移。

第一次发布的 GHCR 包通常为 private，即使源码仓库是 public，也要单独检查：
GitHub 个人主页 → Packages → bible-game-online → Package settings → Change visibility。
若希望 VPS 匿名下载，把包设为 Public；公开镜像不要包含任何密钥或私有数据。
需要保持 private 时，VPS 必须使用具有 read:packages 权限的凭据登录 ghcr.io，不要把凭据写进仓库。

## 2. VPS 准备运行配置

已有 Docker，无需安装 Node.js、npm 或在 VPS 构建源码。
先确认 Compose 插件可用：

```bash
docker compose version
```

保存配置文件（不覆盖其他网站或节点配置）：

```bash
mkdir -p ~/bible-game-online
cd ~/bible-game-online
curl -fL https://raw.githubusercontent.com/dmcdark/Bible-Game-Online/security-hardening/compose.yaml -o compose.yaml
curl -fL https://raw.githubusercontent.com/dmcdark/Bible-Game-Online/security-hardening/.env.example -o .env.example
test -f .env || cp .env.example .env
nano .env
```

在 .env 中填写实际域名，以及本次 Actions Summary 中的 GAME_IMAGE。
正式维护时可将上面下载地址中的 security-hardening 替换成构建对应的提交 SHA，保持配置与镜像同版。

```dotenv
PUBLIC_ORIGIN=https://sse.com
GAME_IMAGE=ghcr.io/dmcdark/bible-game-online:build-实际运行编号-实际重试编号
```

## 3. 拉取并启动

```bash
sudo docker compose pull
sudo docker compose up -d --no-build
sudo docker compose ps
sudo docker compose logs --tail=50 game
curl -f http://127.0.0.1:13000/healthz
```

最后应返回 {"status":"ok"}。compose.yaml 没有 build 字段，--no-build 也明确禁止本机构建。
容器健康检查会定期检查进程 HTTP 可用性；unhealthy 本身不触发 Docker 自动重启，进程退出时重启策略才生效。
游戏只在本机 13000 提供服务，不需放行公网 3000/13000。

若拉取时报 denied/unauthorized，先检查 GHCR 包是否 Public；不要通过开放 Docker 管理端口解决。
如果 sudo 仍报告 Oracle Cloud Agent 规则解析错误，需要单独维护 sudoers，不能删除整个规则文件。

## 4. 接入 Nginx

新域名先解析到 VPS，并准备有效的域名证书。
现有 443 被 rw-core 占用，Nginx 只监听本机 8443。新增游戏虚拟主机，不替换原网站配置。
该虚拟主机反代到 http://127.0.0.1:13000，支持 WebSocket Upgrade，保留原有节点链路。
是否需要调整 REALITY 的入口规则，必须结合新域名的实际访问情况确认。
下载并启动镜像只完成后端运行，域名、证书和反代仍是首次部署必需步骤。

## 5. 更新与回滚

更新前记录 .env 中原 GAME_IMAGE，并备份排行榜数据。不要在正在进行的游戏中更新，
因为容器重启会丢失房间和对局状态。

构建成功后，把 .env 的 GAME_IMAGE 改成新运行的完整镜像名，再执行：

```bash
sudo docker compose pull
sudo docker compose up -d --no-build
sudo docker compose ps
```

回滚时将 GAME_IMAGE 改回旧值，重复 pull 和 up 命令。排行榜保存在独立命名卷，
不要执行 docker compose down -v 或 docker volume prune。
代码回滚不自动回滚数据格式；上游将来改变数据结构时，需要先检查迁移兼容性。
