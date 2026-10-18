# Ubuntu 部署命令：sse.qinsbro.com

除特别注明外，命令均在 VPS 的 ubuntu 用户 SSH 终端执行。逐块执行，报错就暂停。
首次部署按第 1–9 节；第 10–13 节仅在维护时使用。已完成的步骤不用重做，已上线不要重复安装站点。
只执行 bash 代码块；nginx、dotenv 代码块是查看或编辑文件时对照的内容。

## 1. 检查环境

查看用户、架构、Docker、Compose、Nginx 和端口。预期 ubuntu、aarch64，443 为 rw-core，8443 为 Nginx。

```bash
whoami
uname -m
docker --version
docker compose version
sudo nginx -t
sudo ss -lntp | grep -E ':(80|443|8443|13000)[[:space:]]'
```

查看容器，确认 13000 是否已由本项目占用；若被其他应用占用，先暂停，不停止未知服务。

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

仅缺少 Compose 时：先查询可安装的插件。

```bash
apt-cache policy docker-compose-plugin docker-compose-v2
```

docker-compose-plugin 有 Candidate 时安装这一项：

```bash
sudo apt-get install docker-compose-plugin
```

只有 docker-compose-v2 有 Candidate 时改装这一项；两种插件二选一，不重装 Docker。

```bash
sudo apt-get install docker-compose-v2
```

## 2. 检查证书

确认现有证书和私钥可读；路径已填写，不安装新的证书工具，不上传私钥。

```bash
sudo test -r /home/ubuntu/fullchain.pem && echo '证书可读'
sudo test -r /home/ubuntu/privkey.pem && echo '私钥可读'
```

## 3. 检查 DNS

先在 DNS 管理界面将 qinsbro.com 的 A 记录 sse 指向 VPS 公网 IPv4；IPv6 可用时才添加 AAAA。
下面查询解析结果；未配置 IPv6 时第二条无输出正常，启用 CDN 时可能返回 CDN 地址。不修改其他域名记录。

```bash
getent ahostsv4 sse.qinsbro.com
getent ahostsv6 sse.qinsbro.com
```

## 4. 下载部署文件

检查下载和模板工具是否存在。

```bash
command -v curl
command -v envsubst
```

仅缺少工具时安装：

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends curl gettext-base
```

整块执行：下载 Compose 和模板，备份已有 Compose，保留已有 .env；不改变正在运行的服务。

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

下载成功后打开环境文件：

```bash
nano /home/ubuntu/bible-game-online/.env
```

.env 应包含以下两行（文件内容，不是命令）。Ctrl+O、回车保存，Ctrl+X 退出。

```dotenv
PUBLIC_ORIGIN=https://sse.qinsbro.com
GAME_IMAGE=ghcr.io/dmcdark/bible-game-online:build-39085806588-1
```

## 5. 拉取镜像并启动

整块执行，等待容器健康；最后应返回 {"status":"ok"}。提示不支持 --wait 时先暂停，检查 Compose 插件版本。

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

## 6. 备份并检查 Nginx

备份保存到 /root，随后检查配置；不修改或重载 Nginx。备份含敏感配置，不上传。

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

读取主配置，确认两条 include 位于 http 块内：

```bash
sudo cat /etc/nginx/nginx.conf
```

对照下面的配置示例，不执行、不覆盖原文件；缺少 include 或无法确认括号范围时先暂停。

```nginx
http {
    # 其他现有配置……
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
```

检查游戏域名是否已配置。无输出表示未匹配；有输出或出现 conflicting server name 时先核对，不重复安装。

```bash
sudo nginx -T 2>/dev/null | grep -E '^[[:space:]]*server_name[[:space:]].*sse[.]qinsbro[.]com([;[:space:]]|$)' || true
```

## 7. 生成游戏 Nginx 配置

整块执行，只在 generated 目录生成文件供检查。域名和证书路径已填好，变量会重新设置，不依赖之前的 SSH 会话。

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

核对输出：域名为 sse.qinsbro.com，证书为 /home/ubuntu/fullchain.pem，私钥为 /home/ubuntu/privkey.pem；$host、$http_upgrade 等原生变量应保留，不能残留 ${GAME_...}。

## 8. 安装并启用游戏站点

仅首次安装时执行。新增游戏文件，不编辑原网站或 Xray，不新增公网 443 监听。
已有同名文件会停止；检查失败会撤下本次新增启用项。执行失败不要重复整块运行，先查看报错。

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

模板沿用原站点的 listen ... http2 写法，可能出现弃用警告；不影响本次检查通过。只有 nginx -t 成功才重载，不改用 restart。

## 9. 验证访问

检查容器接口，预期返回 {"status":"ok"}。

```bash
curl --fail --show-error http://127.0.0.1:13000/healthz
```

检查本机 Nginx：第一条返回 status:ok，第二条返回以 0{ 开头、含 sid 的握手。不要加 -k 忽略证书错误。

```bash
curl --fail --show-error \
  --resolve 'sse.qinsbro.com:8443:127.0.0.1' \
  https://sse.qinsbro.com:8443/healthz

curl --fail --show-error \
  --resolve 'sse.qinsbro.com:8443:127.0.0.1' \
  -H 'Origin: https://sse.qinsbro.com' \
  'https://sse.qinsbro.com:8443/socket.io/?EIO=4&transport=polling'
```

检查公网入口，预期返回 {"status":"ok"}；8443 正常而公网失败时，先查 DNS、REALITY 转交和云网络规则。

```bash
curl --fail --show-error https://sse.qinsbro.com/healthz
```

随后用两台设备打开 https://sse.qinsbro.com 测试同房间对局，并确认原网站和节点正常。

## 10. 证书续期后重载

现有工具更新 /home/ubuntu/fullchain.pem 和 /home/ubuntu/privkey.pem 后，执行检查和重载；不需要重启容器。

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 11. 查看状态和日志

查看容器状态、应用日志及游戏 Nginx 日志；日志可能含访问信息，不公开完整日志。

```bash
cd /home/ubuntu/bible-game-online
sudo docker compose ps
sudo docker compose logs --tail=100 game
sudo tail -n 50 /var/log/nginx/bible-game.error.log
sudo tail -n 20 /var/log/nginx/bible-game.access.log
```

## 12. 备份并更新镜像

仅更新时执行，先让玩家退出，重启会中断当前对局。整块备份 .env、Compose 和排行榜；失败时先暂停。

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

打开 .env，将 GAME_IMAGE 改为新 Actions 成功运行 Summary 提供的值，保留 PUBLIC_ORIGIN。

```bash
nano /home/ubuntu/bible-game-online/.env
```

保存后整块执行更新，最后应返回 status:ok。仅更新镜像不需要重载 Nginx。

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

## 13. 回滚或暂停（需要时才执行）

回滚镜像：打开 .env，将 GAME_IMAGE 改回之前成功的版本，保留域名。

```bash
nano /home/ubuntu/bible-game-online/.env
```

保存后执行，数据卷保留；不要使用 docker compose down -v 或 docker volume prune。

```bash
(
  set -eu
  cd /home/ubuntu/bible-game-online
  sudo docker compose config --quiet
  sudo docker compose pull
  sudo docker compose up -d --no-build --wait --wait-timeout 60
)
```

仅需撤下游戏 Nginx 站点时执行：移除游戏软链接，将游戏公共配置移出加载目录，再检查和重载；不整体恢复或覆盖 /etc/nginx。

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

仅需暂停游戏容器时执行，保留数据卷：

```bash
cd /home/ubuntu/bible-game-online
sudo docker compose stop game
```

撤下站点后，sites-available/bible-game.conf 仍保留；重新安装前先检查并备份，不直接重复第 8 节。
