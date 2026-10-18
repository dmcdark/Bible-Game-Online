# 安全修改与部署说明

源码和配置检查不等于完整兼容性验证。自动构建、规则测试、接口与联机检查的实际结果
以 GitHub Actions 对应运行日志为准；浏览器界面回归和负载验证仍需单独完成。
本文件不是安全认证。具体 GitHub 构建及 VPS 拉取步骤见 vps-deployment.md。

## 已修改

- 联机昵称、排行榜及其他动态 HTML 文本进行转义，动态颜色只允许六位十六进制色值。
- 增加 CSP、禁止嵌入、禁止 MIME 嗅探等响应头；将两款游戏的 HTML 内联事件移到外部脚本。
- 网站根目录不再直接公开，服务端代码、依赖清单、环境文件和持久数据不可作为静态文件下载。
- 对 HTTP JSON、Socket.IO 消息体、参数类型、整数范围和昵称长度设置限制。
- 房间使用 Map，仅接受四位数字编号；每连接一个房间，最多 100 间房，每间最多 8 人。
- 全局最多 200 个 Engine.IO 连接，每个识别出的来源地址最多 40 个已建立游戏连接；
  增加连接、建房、入房、消息和排行榜写入限流，限流表本身有容量和清理上限。
- 所有联机行动检查房间成员、当前行动者、回合编号和阶段，拒绝重复答题、重复掷骰和重复结算。
- 服务端加载现有题库、卡牌、棋盘规则，计算联机位置、信心值、禁食和同格效果；
  忽略浏览器提交的 playersState、firstFinished、题库长度、玩家昵称和颜色覆盖值。
- 保留原规则：卡牌位移不递归触发目的格事件，直接投骰抵达终点才设置原有抵达标记；
  首位抵达后，本轮结束时结算。没有趁安全修改改变这些游戏规则。
- 房间 30 分钟无有效进度或存在满 6 小时后关闭；对局中任何玩家断线会结束本局。
  尚未实现断线恢复。等待中的玩家离开时重排编号，必要时转移房主。
- 排行榜保存在独立目录，使用异步串行写入和临时文件原子替换，失败时不更新内存成绩。

## 仍存在的边界

- 单人排行榜由浏览器上报。范围检查和限流不能证明成绩真实，不应用于奖品或可信竞赛。
- 题库答案仍随前端公开，服务器判断答案不能阻止玩家查询答案。
- 4 位房间号是方便加入的编号，不是身份认证或私密邀请凭据。
- Origin 检查与 CORS 不是身份认证：非浏览器可以省略或伪造 Origin。
- 客户端传来的日志只做长度和数量限制，按纯文本显示，不作为服务端判定依据。
- 房间和限流状态仅在单进程内存中，重启会丢失；当前只能运行一个游戏实例。
- 容器共享宿主机内核；独立 Docker 网络不等于禁止出站访问，仍需按实际环境限制
  对宿主机、其他内网服务及云元数据地址的访问。不能据此承诺不会影响同机节点。
- GitHub Actions 发布前执行规则测试、接口与 Socket.IO 检查以及依赖高危/严重漏洞检查；
  这些检查不能代替双浏览器界面验证、渗透测试或负载测试。

## 可继续优化的项目（尚未实现）

| 项目 | 成本较低的做法 | 限制与取舍 |
| --- | --- | --- |
| 容器出站访问 | 先确认应用所需出站连接，再针对游戏容器网络限制宿主机、内网和云元数据访问 | 优先考虑；需要核对 VPS 实际路由和 Docker 防火墙，不套用全局规则，以免影响节点；仍共享宿主机内核 |
| 四位房间号 | 保留房间号，增加可选的随机邀请凭据和入房失败限流 | 开启私密邀请的房间需要凭据；不能只在前端隐藏编号，服务端必须验证 |
| 玩家断线导致整局结束 | 增加短时间重连和随机恢复凭据 | 先保留单实例；需要处理座位冒领、超时和回合恢复，属于游戏行为修改 |
| 单人成绩不可信 | 先在榜单标明“浏览器上报成绩” | 成本最低，但不防作弊；可信成绩需要服务器维护单人对局状态并判定结果 |
| 答案公开 | 联机改为只下发当前题目，服务器保留答案，结算后才揭示 | 需要同步调整前端；公开仓库中的相同题库仍可查询，客户端离线模式也无法真正保密 |
| Origin 不能认证玩家 | 私密房间采用邀请凭据；只有需要稳定身份或权限时再加入登录 | 公开匿名游戏无需为了 CORS 增加账号系统；登录也不能独自阻止刷请求 |
| 客户端日志可伪造 | 服务端根据已接受的动作生成重要对局日志 | 当前纯文本处理已降低脚本注入风险；主要改善日志可信度，不改变规则 |
| 共享来源限额 | 先按小规模玩家验证，再设计准确的代理来源识别 | REALITY 已把来源变成本机地址时，仅信任 Docker 网桥不能恢复真实 IP，不能直接放开信任所有代理头 |
| 重启丢失房间、只能单实例 | 小规模先保留单实例，在无人对局时更新 | 需要恢复对局时再做状态持久化；多实例还需共享状态、原子操作及连接路由，不是只加 Redis 即可 |
| 自动检查覆盖有限 | 先完成双设备对局和实际代理入口验证，再安排受控负载测试 | 任何自动测试都不能保证不存在漏洞；不在正在使用的 VPS 上直接压测 |

建议先做发布记录、备份和少量玩家验证，再处理出站限制、邀请凭据及重连。
以上是改进方案，不代表已经修改代码或 VPS。需要独立内核隔离时，应使用另一台 VM/VPS；Docker 本身不是这一层隔离。

## 运行配置

| 环境变量 | 默认值 / 含义 |
| --- | --- |
| PORT | 3000 |
| HOST | 127.0.0.1；Dockerfile 中设为 0.0.0.0，以便容器端口转发 |
| NODE_ENV | production 时必须设置 PUBLIC_ORIGIN |
| PUBLIC_ORIGIN | 当前为 https://sse.qinsbro.com；只接受不带路径、凭据、查询和片段的来源地址 |
| DATA_DIR | 项目目录下的 .data；应持久保存且不公开 |
| TRUST_LOCAL_PROXY | 默认关闭；仅本机回环代理且覆写 X-Forwarded-For 时可设为 1 |

本地开发默认允许 http://localhost:3000 和 http://127.0.0.1:3000。
PUBLIC_ORIGIN 的 https 是浏览器入口；Nginx 到游戏内部仍可使用 HTTP。

注意：Docker 端口映射后，游戏看到的 Nginx 来源地址通常是 Docker 网桥地址而非回环地址。
因此 compose.yaml 没有启用 TRUST_LOCAL_PROXY，不信任任意 X-Forwarded-For。
此时代理后的玩家共享按来源 IP 计算的配额，包括 40 连接和排行榜每分钟 10 次提交限制。
小规模试玩可以先保持这一保守限制；扩容前应基于实际代理地址配置精确的信任规则，
不能简单信任所有代理头或把公网服务设为 trust proxy=true。

如果 .data 中没有排行榜文件，启动时会尝试导入原根目录 leaderboard.json 中格式有效的记录。
Docker 镜像不打包这个历史数据文件，首次容器运行从空榜开始；需要旧成绩时应另行迁移。
数据文件损坏会阻止启动并记录错误，不会悄悄覆盖旧成绩。

## Docker 配置

Dockerfile 使用官方 Node 24 Debian slim 镜像（支持 ARM64）、非 root 用户和依赖锁文件。
安装依赖时不执行生命周期脚本；当前依赖不需要原生构建。以后上游依赖变化需要重新检查。
基础镜像 tag 会变化，正式发布建议记录构建使用的 digest，并定期更新安全补丁。

compose.yaml 仅绑定 127.0.0.1:13000，不占用现有 80/443/8443。
限制 0.5 CPU、384 MiB 内存、64 个进程，删除 Linux capabilities、禁止提权，程序目录只读。
排行榜位于独立命名卷 game-data 中，日志总量约受 3 × 5 MiB 的轮转配置限制。
镜像升级不应删除数据卷；不要使用 docker compose down -v。

compose.yaml 只引用 GAME_IMAGE 指定的已发布镜像，没有本机构建入口。
按 [VPS 部署命令](vps-deployment.md) 下载 Compose 和环境模板，检查 .env 中的域名和镜像版本，再拉取启动。
.github/workflows/docker.yml 在 GitHub 官方 ARM64 runner 构建和检查后发布 GHCR，
支持手动触发及推送 main/security-hardening 分支触发，不需要 VPS SSH 密钥。
各第三方 Action 已固定为经官方仓库核对的提交 SHA，更新版本时需要主动检查。
完整操作见 [VPS 部署命令](vps-deployment.md)。

## 游戏 Nginx 反向代理配置

- 为游戏配置独立的 `server_name` 和对应的 HTTPS 证书。
- 将游戏请求转发到 `http://127.0.0.1:13000`，由 Docker 映射到容器内的 `3000` 端口。
- 使用 HTTP/1.1，并配置 `Upgrade`、`Connection` 请求头及合适的读超时，支持 Socket.IO / WebSocket。
- 在 `http` 块加载公共配置中的 `map`、`limit_req_zone` 和 `limit_conn_zone`；在游戏站点应用请求及连接限制。
- 由 Nginx 使用 `$remote_addr` 覆写 `X-Forwarded-For`；应用是否信任代理头需按实际代理来源单独配置。
- 为游戏设置独立的访问日志和错误日志。HTTP 限流不能代替应用内的游戏消息限流。
- 启用前执行 `sudo nginx -t`，通过后执行 `sudo systemctl reload nginx`；随后验证游戏 HTTPS、健康接口和 WebSocket 连接。

## 待执行验证

下面列出完整验证范围；实际已完成的项目以本地检查记录和 Actions 日志为准。
未完成的浏览器和部署环境验证不能因为镜像构建成功就省略。

1. `npm ci --ignore-scripts` 安装锁定依赖；检查支持的 Node 版本。
2. `node --test tests/online-rules.test.js` 检查服务端规则：8 个用例，覆盖原状态隔离、
   答案边界、重复动作、阶梯/蛇/安息、卡牌、禁食、同格和终点。
3. 双浏览器进入房间，交替掷骰，验证问答、提示、各格事件、禁食及本轮结束结算；
   加入一个含 `<`、`>`、引号的昵称，确认等待列表、玩家列表、排行榜均按文本显示。
4. 确认 /server.js、/package.json、/online-rules.js、/.env、/.data/leaderboard.json、
   /leaderboard.json 返回 404；两款游戏静态文件和 /socket.io/socket.io.js 正常。
5. 使用受控 Socket.IO 客户端检查缺失/空/错误类型消息、房外调用、越权行动、重复消息、
   旧 turnId、伪造 playersState 和昵称颜色覆盖值，不得使进程退出或改变服务端结果。
6. 检查请求体过大、非整数/超范围排行榜字段、错误 JSON、跨来源请求和突发限流；
   确认代理下共享来源配额不会妨碍目标人数。
7. 验证断线关闭、等待室房主转移、房间过期、排行榜写入失败和重新启动后的数据保留。
8. 构建 ARM64 镜像，检查非 root、只读目录、端口仅回环可见、数据卷权限和资源限制。
9. 通过新域名验证 HTTPS、WebSocket、两个游戏按钮、现有网站及节点仍然正常。

## 跟随上游

保留安全修改与 Docker 配置为独立提交，更新时先合并上游，再对照变更检查 online-rules.js
与前端游戏规则的一致性。上游改变规则时不能只更新前端而不更新服务端。
不要把 .env、证书、SSH 密钥、排行榜数据或节点配置提交到 Git。
每次发布记录代码提交及镜像 digest，保留上一镜像和数据备份用于回滚。当前完成情况和操作如下。

### 哪些已自动记录

- Git 保存源码提交；Actions Summary 写入构建的代码提交 SHA 和镜像标签。
- 镜像内的 `org.opencontainers.image.revision` 标签保存构建时的代码提交 SHA。
- `docker push` 日志包含镜像 digest，但当前工作流没有把 digest 汇总到 Summary，也没有自动创建 GitHub Release。
- Git 不保存 VPS 排行榜、环境文件或实际部署版本。文档中的备份命令必须在 VPS 手动执行，当前没有自动备份任务。
- 文档提交不触发构建，因此 GitHub 分支的最新提交不一定是当前镜像使用的代码提交；以镜像标签和对应 Actions 为准。

### 在 VPS 记录当前运行版本

在更新前执行一次，成功更新并验证后再执行一次。整块复制到 VPS 的 SSH 终端；
命令只读取运行容器和本地镜像信息，写入私有 backups 目录，不重启服务、不构建、不备份排行榜。

```bash
(
  set -eu
  umask 077
  cd /home/ubuntu/bible-game-online
  mkdir -p backups
  chmod 700 backups
  GAME_CONTAINER_ID="$(sudo docker compose ps -q game)"
  test -n "$GAME_CONTAINER_ID"
  GAME_IMAGE_ID="$(sudo docker inspect --format '{{.Image}}' "$GAME_CONTAINER_ID")"
  GAME_SOURCE_SHA="$(sudo docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$GAME_IMAGE_ID")"
  GAME_REPO_DIGESTS="$(sudo docker image inspect --format '{{json .RepoDigests}}' "$GAME_IMAGE_ID")"
  test -n "$GAME_SOURCE_SHA"
  test "$GAME_SOURCE_SHA" != '<no value>'
  test "$GAME_REPO_DIGESTS" != '[]'
  test "$GAME_REPO_DIGESTS" != 'null'
  GAME_RECORD="backups/release-$(date -u +%Y%m%dT%H%M%S)-$$.txt"
  {
    date -u '+recorded_at=%Y-%m-%dT%H:%M:%SZ'
    printf 'source_commit=%s\n' "$GAME_SOURCE_SHA"
    printf 'image_id=%s\n' "$GAME_IMAGE_ID"
    printf 'repo_digests=%s\n' "$GAME_REPO_DIGESTS"
    sudo docker inspect --format 'configured_image={{.Config.Image}}' "$GAME_CONTAINER_ID"
  } > "$GAME_RECORD.download"
  mv "$GAME_RECORD.download" "$GAME_RECORD"
  cat "$GAME_RECORD"
)
```

`repo_digests` 中的 `ghcr.io/...@sha256:...` 是可用于 .env 的精确镜像引用；
`image_id` 是本地镜像 ID，不能代替仓库 digest 来拉取镜像。
记录文件格式说明见 [Docker image inspect](https://docs.docker.com/reference/cli/docker/image/inspect/)。

### 更新与回滚时还要做什么

1. 更新前按 [部署命令第 12 节](vps-deployment.md#12-备份并更新镜像) 备份 .env、Compose 和排行榜，再修改 GAME_IMAGE。
2. 保留上一版本在 GHCR 的镜像和 VPS 上的本地镜像，不执行镜像清理；版本记录本身不会防止镜像被删除。
3. 需要不依赖 GHCR 的离线回滚时，可另外导出旧镜像；这会占用磁盘，当前未自动执行。
4. 将数据备份安全复制到另一台设备；只存在同一 VPS 上的备份不能防范整机丢失。
5. 回滚代码按第 13 节把 GAME_IMAGE 改回记录的旧仓库 digest。仅更换镜像不会恢复旧排行榜；数据恢复需停止写入，保留当前数据，再核对格式并恢复备份。

现有已发布镜像的对应关系（源码版本，不是最新文档版本）：

| 项目 | 值 |
| --- | --- |
| 代码提交 | `6305b4006259920444eeea6cebfd9a13d797b577` |
| 镜像标签 | `ghcr.io/dmcdark/bible-game-online:build-39085806588-1` |
| 镜像 digest | `sha256:bf96e3253f4c2cb1b43e3778aaba3d89c1e2ca2da47e1554d99841c3a931622f` |
| Actions | https://github.com/dmcdark/Bible-Game-Online/actions/runs/39085806588 |
