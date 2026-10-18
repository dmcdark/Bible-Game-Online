# Ubuntu 详细部署：sse.qinsbro.com

适用已确认的环境：Ubuntu 26.04 ARM64、ubuntu 用户、已有 Docker 和宿主机 Nginx。
公网 443 由 VLESS + REALITY + raw 占用，target 是 127.0.0.1:8443；Nginx 已监听本机 8443。
复用已确认的证书链 /home/ubuntu/fullchain.pem 和私钥 /home/ubuntu/privkey.pem。
你已确认这张证书覆盖 sse.qinsbro.com 且未过期；不安装 acme.sh/Certbot，不重新申请证书。

**以下命令供你在 VPS 逐段执行，尚未代你操作服务器。任一步报错就暂停，不继续执行后续步骤。**
镜像构建和自动检查已通过；本教程的 Nginx 配置尚未在你的 VPS 验证，必须执行 nginx -t。
只复制标为 bash 的操作命令；nginx、dotenv、text 代码块是配置内容或说明，不是终端命令。
依次执行第 1–9 节完成首次上线；第 10–11 节是说明，第 12–13 节是以后维护时使用，
不要首次安装后又顺手执行回滚。Windows 排查命令仅在标明的 PowerShell 环境执行。

## 0. 文件清单和访问链路

| VPS 文件 | 用途 |
| --- | --- |
| /home/ubuntu/bible-game-online/compose.yaml | 下载镜像、回环端口、数据卷、资源限制 |
| /home/ubuntu/bible-game-online/.env | 访问域名、镜像版本 |
| /etc/nginx/conf.d/bible-game-common.conf | WebSocket 变量、站点总量限流、日志格式 |
| /etc/nginx/sites-available/bible-game.conf | 新域名的 HTTPS 反代及证书路径 |
| /etc/nginx/sites-enabled/bible-game.conf | 指向上一文件的软链接 |

```text
https://sse.qinsbro.com:443
        ↓ rw-core / REALITY
127.0.0.1:8443：Nginx 按域名选择游戏站点和证书
        ↓ HTTP / WebSocket
127.0.0.1:13000 → Docker 容器 3000
```

不修改现有网站文件，不新增 Nginx 公网 443 监听，不重装 Docker，不改变节点私钥、UUID 或传输方式。
原网站配置保留原样（你之前展示的文件名用 xxx.com 代称，不需要创建或重命名这个文件），
游戏配置新建为 bible-game.conf，
两者并列监听本机 8443，由 Nginx 按访问域名区分，不需要把游戏配置粘进原网站文件。
首次只加 8443 的 HTTPS 游戏站点，用完整 https:// 地址访问。
现有 80 端口及证书续期入口保持原状；确认现有续期方式前，不新增 HTTP 跳转覆盖它。

## 1. 登录和预检查

在 VPS 的 ubuntu 用户 SSH 会话中执行，使用 Bash：

```bash
whoami
uname -m
docker --version
docker compose version
sudo nginx -t
sudo ss -lntp | grep -E ':(80|443|8443|13000)[[:space:]]'
```

预期：ubuntu、aarch64；443 为 rw-core，8443 为 Nginx，13000 尚未被其他应用占用。
首次安装时 13000 已占用要先暂停，不能直接杀掉监听者。
如果是在继续之前的部署，该端口可能就是已经启动的游戏，先用以下只读命令确认：

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

确认是本项目的游戏容器后，不要重复新建另一套部署目录或删除原数据卷。
sudo 可能仍打印 Oracle Cloud Agent 规则警告；须确认命令确实成功，不能删除整个 sudoers 文件。

只缺 Compose 插件时先看软件来源：

```bash
apt-cache policy docker-compose-plugin docker-compose-v2
```

如果 docker-compose-plugin 有 Candidate，使用：

```bash
sudo apt-get install docker-compose-plugin
```

如果使用 Ubuntu 软件源且只有 docker-compose-v2 有 Candidate，改用：

```bash
sudo apt-get install docker-compose-v2
```

以上二选一，不都安装，不卸载现有 Docker；两者都没有 Candidate 时先确认安装来源。

后续各节已各自使用固定路径或在操作块中设置变量，不需要先设置一组全局 export。
第 7 节生成模板时使用的 export 仅在当前 SSH 会话有效，复制该节整块即可重新设置。
写入 .env 和 Nginx 配置文件的内容会永久保存，服务运行和重启不依赖这些临时变量。

## 2. 使用已确认的证书路径

路径已经填好，无需再查找或替换占位路径。新游戏的 Nginx 配置最终会使用：

```nginx
server_name sse.qinsbro.com;
ssl_certificate /home/ubuntu/fullchain.pem;
ssl_certificate_key /home/ubuntu/privkey.pem;
```

上面只是完整站点配置的一部分，不单独执行或粘贴进原网站；第 7、8 节会生成并安装完整的新文件。
如果想先确认两个文件可读，只运行以下只读命令：

```bash
sudo test -r /home/ubuntu/fullchain.pem && echo '证书可读'
sudo test -r /home/ubuntu/privkey.pem && echo '私钥可读'
```

不要复制私钥进游戏目录或镜像，不要上传 GitHub，不要把整个 home 目录改成 777。
第 8 节仍必须执行 nginx -t，确认完整配置、证书读取和证书/私钥配对没有问题，成功后才 reload。
第 9 节的 HTTPS 请求还会验证浏览器入口所需的证书信任链，不用 -k 忽略错误。

## 3. DNS 解析

在 DNS 管理界面核对，仅操作新的游戏子域名：

| 类型 | 主机记录 | 值 |
| --- | --- | --- |
| A | sse | 本 VPS 的公网 IPv4 |
| AAAA（可选） | sse | 只有 IPv6 也可用时填写本 VPS 的公网 IPv6 |

不确定 IPv6 就先不给新记录配置 AAAA，不要动其他域名。
若使用 Cloudflare，只有在现有证书是公共受信任 CA 证书时，才适合切换这个新记录到 DNS only 排查。
Cloudflare Origin Certificate 不能直接供普通浏览器信任，不要为排查而盲目关闭所需的 CDN 代理。
现有节点域名保持原状。

```bash
getent ahostsv4 sse.qinsbro.com
getent ahostsv6 sse.qinsbro.com
```

没有配置 IPv6 时，第二条可能没有输出，并不代表 IPv4 部署失败。
CDN 启用时可能解析为 CDN 地址，结合控制台判断。
不重置防火墙，不启用/关闭 UFW，不额外放行公网 3000、13000、8443。

## 4. 下载 Compose、环境变量和 Nginx 模板

```bash
command -v curl
command -v envsubst
```

缺工具时才执行下面两条；不安装任何证书工具、不升级整机：

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends curl gettext-base
```

下面整个块执行。下载失败会停止；四个文件全部下载成功后才替换本地副本。
它会先备份已有 Compose，不覆盖已有 .env，也不修改正在运行的容器或 Nginx：

```bash
(
  set -eu
  export GAME_DOMAIN='sse.qinsbro.com'
  CONFIG_URL='https://raw.githubusercontent.com/dmcdark/Bible-Game-Online/security-hardening'
  mkdir -p /home/ubuntu/bible-game-online/templates /home/ubuntu/bible-game-online/generated /home/ubuntu/bible-game-online/backups
  cd /home/ubuntu/bible-game-online
  chmod 700 backups
  if [ -f compose.yaml ]; then
    cp -a compose.yaml "backups/compose.yaml.before-$(date +%Y%m%d-%H%M%S)"
  fi
  curl -fL "$CONFIG_URL/compose.yaml" -o compose.yaml.download
  curl -fL "$CONFIG_URL/docs/deploy/game.env.template" -o templates/game.env.template.download
  curl -fL "$CONFIG_URL/docs/deploy/nginx-common.conf" -o templates/nginx-common.conf.download
  curl -fL "$CONFIG_URL/docs/deploy/nginx-site.conf.template" -o templates/nginx-site.conf.template.download
  mv compose.yaml.download compose.yaml
  mv templates/game.env.template.download templates/game.env.template
  mv templates/nginx-common.conf.download templates/nginx-common.conf
  mv templates/nginx-site.conf.template.download templates/nginx-site.conf.template
  if [ ! -f .env ]; then
    envsubst '${GAME_DOMAIN}' < templates/game.env.template > .env.download
    chmod 600 .env.download
    mv .env.download .env
  fi
  chmod 600 .env
)
```

下载成功后再打开固定路径检查，不依赖终端当前目录：

```bash
nano /home/ubuntu/bible-game-online/.env
```

.env 的正确内容如下；已有 .env 不自动覆盖，要手动检查：

```dotenv
PUBLIC_ORIGIN=https://sse.qinsbro.com
GAME_IMAGE=ghcr.io/dmcdark/bible-game-online:build-39085806588-1
```

也可以将 GAME_IMAGE 换成已经核对的同一镜像摘要：

```dotenv
GAME_IMAGE=ghcr.io/dmcdark/bible-game-online@sha256:bf96e3253f4c2cb1b43e3778aaba3d89c1e2ca2da47e1554d99841c3a931622f
```

两种 GAME_IMAGE 只选一个。nano 中 Ctrl+O、回车保存，Ctrl+X 退出。
环境文件不需要证书内容、证书路径、节点配置或 GitHub 密码。

## 5. 拉取镜像并启动

```bash
(
  set -eu
  cd /home/ubuntu/bible-game-online
  sudo docker compose config --quiet
  sudo docker compose pull
  sudo docker compose up -d --no-build --wait --wait-timeout 60
  sudo docker compose ps
  sudo docker compose logs --tail=50 game
  curl --fail --show-error http://127.0.0.1:13000/healthz
)
```

最后预期返回 {"status":"ok"}。Compose 没有 build 字段，VPS 不需 Node.js/npm，不编译源码。
只发布 127.0.0.1:13000；容器内为 3000。限制 0.5 CPU、384 MiB、64 个进程，数据使用独立命名卷。
健康检查显示 unhealthy 不会自动重启容器，进程退出时才由 restart 策略重启。
denied/unauthorized 时先核对镜像名和 GHCR 可见性；本版本已验证可匿名下载。
如果旧版 Compose 提示不认识 --wait/--wait-timeout，暂停，先更新匹配现有软件来源的 Compose 插件，
不要因为参数报错就卸载 Docker、改成在 VPS 构建或停止节点。

## 6. 备份 Nginx，核对 include

```bash
(
  set -eu
  NGINX_BACKUP="/root/nginx-before-bible-game-$(date +%Y%m%d-%H%M%S).tar.gz"
  sudo tar -C /etc -czf "$NGINX_BACKUP" nginx
  sudo chmod 600 "$NGINX_BACKUP"
  echo "$NGINX_BACKUP"
  sudo nginx -t
  sudo nginx -T 2>/dev/null | grep -E 'include[[:space:]]+/etc/nginx/(conf.d|sites-enabled)/'
)
```

确认 http {} 内加载 /etc/nginx/conf.d/*.conf 及 /etc/nginx/sites-enabled/*。
没有时先暂停，核对真实配置布局；map、limit_req_zone 必须在 http {} 内，不能放入 server {}。
备份可能包含原网站敏感配置，只保存在 root 私有目录，不上传仓库。

安装前检查是否已经存在同名游戏站点，下面是只读查询，没输出表示没有匹配：

```bash
sudo nginx -T 2>/dev/null | grep -E '^[[:space:]]*server_name[[:space:]].*sse[.]qinsbro[.]com([;[:space:]]|$)' || true
```

有输出时先确认是不是之前已安装的游戏配置，不重复创建。遇到 conflicting server name 警告也要暂停，
即使 nginx -t 最后显示 successful，也不能认定新站点已被采用。

## 7. 生成两个 Nginx 文件

本节只在 /home/ubuntu/bible-game-online/generated 下生成文件供查看，不改变正在运行的 Nginx。
第 8 节才把新游戏文件放入 Nginx 目录；原网站和 Xray 配置不需要编辑。

第 4 节的模板下载完成后，直接复制下面整个块。域名和证书路径已填写好，
本节会重新设置所需变量，不依赖前面 SSH 会话是否还保留这些值，无需自行替换任何占位路径：

```bash
export GAME_DOMAIN='sse.qinsbro.com'
export GAME_DIR='/home/ubuntu/bible-game-online'
export GAME_CERT_FILE='/home/ubuntu/fullchain.pem'
export GAME_KEY_FILE='/home/ubuntu/privkey.pem'

(
  set -eu
  cd /home/ubuntu/bible-game-online
  mkdir -p generated
  envsubst '${GAME_DOMAIN} ${GAME_CERT_FILE} ${GAME_KEY_FILE}' \
    < templates/nginx-site.conf.template > generated/bible-game.conf
  cp templates/nginx-common.conf generated/bible-game-common.conf
  cat generated/bible-game.conf
)
```

这段里的 ${GAME_DOMAIN} 等是模板变量语法，保持原样复制；实际值已经在上面四行 export 中填好。
生成结果应该包含：

```nginx
server_name sse.qinsbro.com;
ssl_certificate "/home/ubuntu/fullchain.pem";
ssl_certificate_key "/home/ubuntu/privkey.pem";
```

输出中的 Nginx 原生变量 $host、$http_upgrade 等应保留，不能变为空，也不能再含未替换的 ${GAME_...}。
因此不要删掉 envsubst 后的变量名单。两份完整配置分别是
[公共配置](deploy/nginx-common.conf) 与 [站点模板](deploy/nginx-site.conf.template)。

## 8. 安装并启用独立游戏站点

下面整个块执行。预留路径已存在时停止，不能覆盖未知文件。
nginx -t 失败时撤下新软链接和公共配置，不 reload；这段命令不会 restart 当前 Nginx。

```bash
(
  set -eu
  cd /home/ubuntu/bible-game-online
  for target in \
    /etc/nginx/conf.d/bible-game-common.conf \
    /etc/nginx/sites-available/bible-game.conf \
    /etc/nginx/sites-enabled/bible-game.conf
  do
    if sudo test -e "$target" || sudo test -L "$target"; then
      echo "停止：已有文件 $target，请先检查，不覆盖。" >&2
      exit 1
    fi
  done
  sudo install -m 644 generated/bible-game-common.conf /etc/nginx/conf.d/bible-game-common.conf
  sudo install -m 644 generated/bible-game.conf /etc/nginx/sites-available/bible-game.conf
  sudo ln -s /etc/nginx/sites-available/bible-game.conf /etc/nginx/sites-enabled/bible-game.conf
  if ! sudo nginx -t; then
    sudo unlink /etc/nginx/sites-enabled/bible-game.conf
    sudo mv /etc/nginx/conf.d/bible-game-common.conf \
      "/etc/nginx/bible-game-common.failed-$(date +%Y%m%d-%H%M%S)"
    echo '配置测试失败，已撤下本次新增启用项；未重载 Nginx。' >&2
    exit 1
  fi
  if ! sudo systemctl reload nginx; then
    echo '重载失败：停止后续步骤，查看 Nginx 状态和错误日志，不要改成 restart。' >&2
    exit 1
  fi
)
```

模板匹配现有 127.0.0.1:8443 ssl http2 和 [::1]:8443 ssl 的监听选项。
listen ... http2 在新 Nginx 可能有弃用警告，本次先保持与原站点一致，不顺手改原网站。
配置错误时不要 restart；先看错误，必要时按第 13 节撤回新增配置。
如果 install、ln 或 reload 报错，不要重复整段粘贴。先看已有文件和错误日志，
必要时按第 13 节撤回本教程新增的启用项，再决定下一步。

## 9. 逐层验证

### 容器服务

```bash
curl --fail --show-error http://127.0.0.1:13000/healthz
```

### 本机 Nginx：使用正确 TLS SNI、证书和 Host

```bash
curl --fail --show-error \
  --resolve 'sse.qinsbro.com:8443:127.0.0.1' \
  https://sse.qinsbro.com:8443/healthz

curl --fail --show-error \
  --resolve 'sse.qinsbro.com:8443:127.0.0.1' \
  -H 'Origin: https://sse.qinsbro.com' \
  'https://sse.qinsbro.com:8443/socket.io/?EIO=4&transport=polling'
```

第一条返回 status:ok，第二条返回以 0{ 开头的 Engine.IO 握手，包含 sid、pingInterval 等。
一次性握手稍后自动超时，不要循环频繁测试。不要加 -k 隐藏证书问题。

### 公网 443，经 REALITY 到游戏

```bash
curl --fail --show-error https://sse.qinsbro.com/healthz
```

再用另一台设备浏览器打开：

- https://sse.qinsbro.com/
- https://sse.qinsbro.com/pilgrim-progress/
- https://sse.qinsbro.com/seventy-disciples/

绕过 DNS 排查时，在另一台 Linux/macOS 设备执行，替换 VPS_IPV4：

```bash
curl --fail --show-error --resolve 'sse.qinsbro.com:443:VPS_IPV4' https://sse.qinsbro.com/healthz
```

Windows PowerShell 用 curl.exe：

```powershell
curl.exe --fail --show-error --resolve "sse.qinsbro.com:443:VPS_IPV4" https://sse.qinsbro.com/healthz
```

8443 正常而公网 443 失败时，先检查 DNS、REALITY 转交和云网络规则，不抢占公网 443。
把测试结果反馈出来，不盲目修改节点 serverNames、target、私钥。
最后双设备完成一局，确认问答、卡牌、提示、回合、排行榜和两个游戏按钮正常；旧页面需刷新。
同时确认原网站和 Remnawave 节点仍正常。

## 10. 限流和真实 IP 的边界

REALITY 可能让 Nginx 看到的来源都是本机回环，Docker 也增加一跳代理。
因此模板按游戏站点总量限制：普通 HTTP 60 次/秒、Socket.IO HTTP 20 次/秒、最多 100 个并发请求/长连接。
这些额度只用于游戏虚拟主机，不影响原站点或节点，不是每位玩家各自的额度。
WebSocket 内的消息由应用限流，HTTP 限流不等于逐条游戏消息限流。

应用目前在代理后也会共享来源配额，包括最多 40 个已建立连接。先少量玩家试玩。
不启用 TRUST_LOCAL_PROXY，不设置全信任 X-Forwarded-For/0.0.0.0/0。
模板覆写头部但没有凭空恢复真实 IP；后续需结合实际代理协议改进。

独立 Docker 网络也不是完整的出站防火墙，对宿主机、内网、云元数据的访问控制仍需单独配置。
不要粘贴全局 iptables/nftables 清空或拒绝规则，以免影响同机节点。

## 11. 沿用现有证书续期

不安装第二套证书工具，确认原管理工具会持续更新 /home/ubuntu/fullchain.pem 和 /home/ubuntu/privkey.pem。
续期成功后应 nginx -t 再 reload Nginx；无需重启游戏容器。
如果现有工具没有 reload，在其原有的成功部署钩子中配置：

```bash
nginx -t && systemctl reload nginx
```

不是新增定时申请任务。自行确认续期成功后也可手动执行：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 12. 查看状态、更新镜像、备份排行榜

```bash
cd /home/ubuntu/bible-game-online
sudo docker compose ps
sudo docker compose logs --tail=100 game
sudo tail -n 50 /var/log/nginx/bible-game.error.log
sudo tail -n 20 /var/log/nginx/bible-game.access.log
```

确认已有 Nginx 日志轮转覆盖 /var/log/nginx/*.log。不公开 .env、私钥、完整日志或节点配置。
更新前让玩家退出，容器重启会清空当前对局。先备份：

```bash
(
  set -eu
  cd /home/ubuntu/bible-game-online
  mkdir -p backups
  chmod 700 backups
  GAME_BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
  cp -a .env "backups/env-$GAME_BACKUP_STAMP"
  cp -a compose.yaml "backups/compose-$GAME_BACKUP_STAMP.yaml"
  sudo docker compose exec -T game node -e \
    'const fs=require("node:fs");const p="/app/.data/leaderboard.json";process.stdout.write(fs.existsSync(p)?fs.readFileSync(p,"utf8"):"[]\n");' \
    > "backups/leaderboard-$GAME_BACKUP_STAMP.json.download"
  chmod 600 "backups/leaderboard-$GAME_BACKUP_STAMP.json.download"
  mv "backups/leaderboard-$GAME_BACKUP_STAMP.json.download" "backups/leaderboard-$GAME_BACKUP_STAMP.json"
)
```

把新 Actions 成功运行 Summary 中的 GAME_IMAGE 填入 .env，再拉取重启：

```bash
nano /home/ubuntu/bible-game-online/.env
```

编辑保存后再执行整个更新块；备份或编辑失败时不继续：

```bash
(
  set -eu
  cd /home/ubuntu/bible-game-online
  sudo docker compose config --quiet
  sudo docker compose pull
  sudo docker compose up -d --no-build --wait --wait-timeout 60
  curl --fail --show-error http://127.0.0.1:13000/healthz
)
```

只换镜像、不变域名和端口，不需修改或 reload Nginx。
下载新 Compose/Nginx 模板前先比较差异，不覆盖 .env 和真实证书路径。

## 13. 回滚

镜像回滚：在 .env 把 GAME_IMAGE 改回旧成功版本，保留正确域名，再执行：

```bash
nano /home/ubuntu/bible-game-online/.env
```

保存后执行：

```bash
(
  set -eu
  cd /home/ubuntu/bible-game-online
  sudo docker compose config --quiet
  sudo docker compose pull
  sudo docker compose up -d --no-build --wait --wait-timeout 60
)
```

数据卷不会随镜像更新删除。不要 docker compose down -v 或 docker volume prune。
将来数据格式变化时，旧代码和新数据是否兼容需要另行检查。

撤下新 Nginx 站点时，只操作本教程新增文件，不整体替换 /etc/nginx：

```bash
(
  set -eu
  if sudo test -L /etc/nginx/sites-enabled/bible-game.conf; then
    sudo unlink /etc/nginx/sites-enabled/bible-game.conf
  elif sudo test -e /etc/nginx/sites-enabled/bible-game.conf; then
    echo '停止：启用项不是本教程创建的软链接，请先检查。' >&2
    exit 1
  fi
  if sudo test -f /etc/nginx/conf.d/bible-game-common.conf; then
    sudo mv /etc/nginx/conf.d/bible-game-common.conf \
      "/etc/nginx/bible-game-common.disabled-$(date +%Y%m%d-%H%M%S)"
  fi
  sudo nginx -t
  sudo systemctl reload nginx
)
```

如需暂停游戏：

```bash
cd /home/ubuntu/bible-game-online
sudo docker compose stop game
```

原站点、节点和数据卷不被上述命令删除。sites-available 的游戏文件仍保留；
重新安装前先检查/备份它，不要为绕过第 8 节的检查而盲目删除文件。

## 14. 故障定位和后续维护

| 现象 | 先检查 |
| --- | --- |
| pull 报 denied/unauthorized | 镜像名、版本、GHCR 公开可见性 |
| 13000 不通 | Compose 状态/日志、端口占用、环境变量和数据卷 |
| Nginx 报 unknown variable/zone | common 文件是否在 http {} 内加载 |
| 证书错误 | /home/ubuntu/fullchain.pem、/home/ubuntu/privkey.pem 的可读性、配对及公有 CA 信任链 |
| 8443 返回旧站或旧证书 | 游戏配置启用、server_name、TLS SNI |
| 8443 正常而 443 不通 | DNS、REALITY 转交、云网络；不抢占 443 |
| 页面可开但不能联机 | PUBLIC_ORIGIN、旧页面缓存、Socket.IO 握手和 Upgrade |
| 429/连接拒绝 | 站点总量及共享来源配额，先看日志，不直接关闭防护 |
| 续期后仍出示旧证书 | 原工具部署路径和 Nginx reload 钩子 |

首次先双设备试玩。单人成绩仍由浏览器上报，不是可信竞赛成绩。
上游更新后先同步、检查安全补丁和服务端规则，再构建；不要无审核自动替换服务。
本次修改仅在 docs/** 下，不重新构建已通过检查的镜像。

参考：[Nginx WebSocket](https://nginx.org/en/docs/http/websocket.html)、
[请求限流](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)、
[连接限制](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html)。
