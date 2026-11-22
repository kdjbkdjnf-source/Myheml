# 部署到服务器

项目本身是单机自包含的：一个 Node 进程 + 一个 SQLite 文件 + 一个图片目录，没有数据库服务器、没有 Redis、没有对象存储。所以部署只需要把这三样东西放对位置。

## 0. 需要准备

| 东西 | 说明 | 花费 |
|---|---|---|
| 服务器 | 1 核 1G 起，Ubuntu 22.04 / 24.04 | 约 $6/月 |
| 域名 | 可不要，直接用 IP 也能跑 | ￥30–80/年 |
| HTTPS 证书 | Let's Encrypt，certbot 一条命令 | 免费 |
| 备案 | **只有大陆机房需要**，香港/新加坡/东京不需要 | 免费，7–20 天 |

机房建议选香港、新加坡或东京。Vultr / 阿里云香港轻量都支持支付宝，按小时计费，**删机才停止扣费**，关机照样算钱。

## 1. 传代码

```bash
# 代码走 git（推荐），数据单独传
ssh root@你的IP "mkdir -p /opt/yujian"
rsync -avz --exclude node_modules --exclude data --exclude uploads \
  ./ root@你的IP:/opt/yujian/
```

第一次部署不要传本地的 `data/`：服务器上要生成全新的库和密钥。

## 2. 起服务

### 方式 A：一键脚本（systemd）

```bash
ssh root@你的IP
cd /opt/yujian && bash deploy/setup.sh
```

脚本做的事：装 Node 22 和 nginx → 建 `yujian` 运行用户 → 生成 `.env`（含随机 `JWT_SECRET`）→ 装 `yujian.service` 并启动 → curl 自检。

```bash
systemctl status yujian            # 看状态
journalctl -u yujian -n 50         # 起不来时看日志
```

### 方式 B：Docker

```bash
# 先改 docker-compose.yml 里的 JWT_SECRET / ALLOWED_ORIGINS / MEMBER_MODE
docker compose up -d --build
docker compose logs -f
```

`./data` 和 `./uploads` 已经挂到宿主机，重建容器不丢数据。

## 3. 反代 + HTTPS

```bash
sed "s/YOUR_DOMAIN_OR_IP/你的域名/" deploy/nginx-site.conf > /etc/nginx/sites-available/yujian
ln -sf /etc/nginx/sites-available/yujian /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d 你的域名          # 选 2 强制跳转 HTTPS
```

签完证书后把 `.env` 改成：

```bash
ALLOWED_ORIGINS=https://你的域名
FORCE_HTTPS=1
```

然后 `systemctl restart yujian`。

> `ALLOWED_ORIGINS` 是给写请求校验来源用的。服务端优先看 `Sec-Fetch-Site`，被 CDN/WAF 吃掉时回落到 `Origin` 比对，这时必须显式列出域名，否则登录、发布、下单都会被判成跨站请求挡掉。
> 反代一定要透传 `X-Forwarded-Host` 和 `X-Forwarded-Proto`，否则同样会误判。

## 4. 数据备份 / 迁移

SQLite 跑着的时候**不能直接 cp**，WAL 可能只写了一半。用 `.backup`：

```bash
# 系统有 sqlite3
sqlite3 data/app.db ".backup '/tmp/app.db'"

# 没有 sqlite3，用 Node 自带的模块
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('data/app.db').exec(\"VACUUM INTO '/tmp/app.db'\")"
```

迁移 = 拷 `data/app.db` + 整个 `uploads/`，起服务就自动读，没有迁移脚本要跑。

日常备份用 `deploy/backup.sh`（保留最近 7 份，库和图片分开打包）：

```bash
cp deploy/backup.sh /opt/yujian/ && chmod +x /opt/yujian/backup.sh
( crontab -l 2>/dev/null; echo "0 3 * * * /opt/yujian/backup.sh >> /var/log/yujian-backup.log 2>&1" ) | crontab -
```

## 5. 更新代码

```bash
rsync -avz --exclude data --exclude uploads ./ root@你的IP:/opt/yujian/
ssh root@你的IP "systemctl restart yujian"
```

数据库表结构变更没有迁移框架，靠 `server/lib/db.js` 里的 `CREATE TABLE IF NOT EXISTS` 和 seed 兜底。改字段要自己写 `ALTER TABLE`。

## 6. 常见问题

**登录报「跨站请求已被拦截」**
反代没透传 `X-Forwarded-Host`，或 `Sec-Fetch-Site` 被中间层吃了。设 `ALLOWED_ORIGINS` 再重启。

**上传图片 413**
Nginx 的 `client_max_body_size` 太小，`deploy/nginx-site.conf` 里已经设成 12m。

**重启后数据没了**
用了 `docker compose down -v`，或者 volume 没挂对。数据必须在宿主机目录里。

**端口被占**
改 `PORT` 环境变量，Nginx 的 `proxy_pass` 跟着改。

## 7. 上线前

1. 改掉 `admin` / `Demo@123456` 演示账号
2. `SEED_DEMO=0`，清掉 `station` 账号下的 48 个演示主页
3. 换掉 `JWT_SECRET`，不要用默认值
4. `MEMBER_MODE` 想清楚：没拿到 ICP 许可证就保持 `free`
5. 支付接口目前是模拟实现，接真实支付必须以后端回调验签为准，前端返回一律不可信
