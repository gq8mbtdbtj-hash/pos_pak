# 公网加密访问方案（Personal OS 纯 Web 版）

把私有实例安全地暴露到公网，随时随地访问。先读**安全模型**，再选一种**接入方式**。

---

## 1. 安全模型（务必先懂）

Personal OS 的三层保护：

1. **静止加密**：数据以主密码派生密钥（Argon2id + AES-256-GCM）加密为 `personal.db.enc`；多设备同步的包也是密文。
2. **主密码锁**：所有业务接口在解锁前一律返回 `401`；解锁后发放 HttpOnly 会话 Cookie。服务端内置**登录爆破退避**（连续输错 5 次后指数级锁定，最长 15 分钟，返回 HTTP 429）。
3. **传输加密（你要补上的一环）**：公网访问**必须走 HTTPS/TLS**，否则主密码与数据在链路上明文暴露。本文的每种方式都提供 TLS。

> ⚠️ 注意：这不是「零知识」架构 —— 服务端在**解锁期间**持有明文数据（磁盘上存在明文 `personal.db`）。因此**运行实例的机器本身的安全**（物理访问、root、系统补丁）同样重要。公网只应在满足下列清单后开启。

### 上线前安全清单

- [ ] **强主密码**（长、随机、唯一）——公网下这是最后一道门。
- [ ] **全程 HTTPS**（下面任选其一，均含 TLS）。
- [ ] 后端只监听本机 `127.0.0.1:8787`，由反代/隧道对外（`deploy/personal-os.service` 默认如此）。
- [ ] TLS 由反代/隧道终止时，设 `POS_SECURE_COOKIE=1`（Cookie 加 `Secure`）；直连 TLS 时设 `POS_TLS_CERT/KEY` 会自动加 `Secure`。
- [ ] 可选：在反代上再加一层 **HTTP Basic Auth**（额外挡爆破/扫描）。
- [ ] 系统与本程序保持更新；开启防火墙（仅放行必要端口）。
- [ ] 定期备份（设置页下载 ZIP，或备份 `data/default/`）。

---

## 2. 相关环境变量

| 变量 | 说明 |
|------|------|
| `POS_ADDR` | 监听地址，默认 `0.0.0.0:8787`。走反代/隧道时改 `127.0.0.1:8787`。 |
| `POS_DATA_DIR` | 数据目录（默认 `./data/personal-os`）。 |
| `POS_DIST_DIR` | 生产托管的前端 `dist/` 目录。 |
| `POS_TLS_CERT` / `POS_TLS_KEY` | 设置后**直接以 HTTPS 监听**（内置 TLS）。 |
| `POS_SECURE_COOKIE` | `=1` 时给会话 Cookie 加 `Secure`（反代终止 TLS 时用）。 |
| `POS_ALLOWED_ORIGIN` | 跨域来源白名单（逗号分隔）。默认空 = **仅同源**（最安全，一般无需设置）。 |

---

## 3. 接入方式（任选其一）

### 方式 A：Cloudflare Tunnel（**家庭网络首选**，无需公网 IP / 不开端口）

适合家宽在 NAT/CGNAT 后、没有公网 IP 的情况。Cloudflare 提供免费 TLS，且**不需要在路由器开任何端口**。

前提：有一个域名并已托管在 Cloudflare。

```bash
# 树莓派上安装 cloudflared 后：
cloudflared tunnel login
cloudflared tunnel create personal-os           # 记下 <TUNNEL_ID>
cloudflared tunnel route dns personal-os os.example.com
# 用仓库示例（改好 TUNNEL_ID、hostname、credentials-file 路径）：
cloudflared tunnel --config deploy/cloudflared-config.example.yml run
```

后端保持 `POS_ADDR=127.0.0.1:8787` 且 `POS_SECURE_COOKIE=1`。访问 `https://os.example.com` 即可。
建议开启 Cloudflare Access 再加一层身份校验。

---

### 方式 B：反向代理 + 自动 HTTPS（Caddy）

适合有**公网 IP**且能放行 80/443、并有域名的情况。Caddy 自动申请/续期 Let's Encrypt 证书。

```bash
# 域名 A 记录指向你的公网 IP，路由器把 80/443 转发到本机。
sudo caddy run --config deploy/Caddyfile.example   # 改好域名
```

后端 `POS_ADDR=127.0.0.1:8787` + `POS_SECURE_COOKIE=1`。Caddyfile 里可选打开 `basic_auth` 再加一层。

---

### 方式 C：花生壳（Oray）内网穿透

没有公网 IP 又不想用 Cloudflare 时，花生壳是国内常用的内网穿透（DDNS/穿透）方案。

1. 在花生壳客户端（可装在树莓派或路由器）新增一条**映射**：
   - 内网地址：`127.0.0.1`，内网端口：`8787`；
   - 应用类型选 **HTTPS**（由花生壳侧提供 TLS 域名），得到一个 `https://xxx.取名.某域名` 的公网地址。
2. 后端保持只监听本机：`POS_ADDR=127.0.0.1:8787`，并设 `POS_SECURE_COOKIE=1`（因为对外是 HTTPS）。
3. 访问花生壳给的 HTTPS 域名即可。

要点与加固：

- **务必用 HTTPS 映射**，不要用纯 TCP/HTTP 映射暴露 8787（否则链路明文）。
- 免费版有带宽/流量限制，个人自用一般够；介意稳定性可用其付费套餐或改用方式 A/B。
- 花生壳属于「信任第三方隧道」：数据在到达花生壳边缘前后仍需 TLS。若你希望**端到端**只有自己可解，可改为：花生壳做 TCP 穿透到本机，本机用**内置 TLS**（见方式 E）自持证书，做到隧道商也看不到明文。
- 建议再叠加主密码之外的一层（如在前面放一个带 Basic Auth 的 Caddy）。

---

### 方式 D：frp + 自有 VPS（完全自控）

有一台带公网 IP 的小 VPS 时，用 frp 把树莓派的 8787 穿透到 VPS，再在 VPS 上用 Caddy 终止 HTTPS。

1. VPS 上跑 `frps`（配置 `bindPort=7000` 与 `auth.token`）。
2. 树莓派上跑 `frpc`（用仓库示例 `deploy/frpc.example.toml`，`useEncryption=true`）。
3. VPS 上再用 Caddy 反代 `127.0.0.1:8787`（即 frp 暴露的本地端口）到你的域名，获得自动 HTTPS。

后端 `POS_SECURE_COOKIE=1`。这套完全自控，隧道链路加密由 frp + VPS 上的 TLS 共同保证。

---

### 方式 E：内置 TLS 直连（自持证书）

不想用反代时，让程序**自己以 HTTPS 监听**：

```bash
POS_ADDR=0.0.0.0:8443 \
POS_TLS_CERT=/opt/personal-os/tls/fullchain.pem \
POS_TLS_KEY=/opt/personal-os/tls/privkey.pem \
POS_DIST_DIR=/opt/personal-os/dist \
POS_DATA_DIR=/opt/personal-os/data \
./personal-os-server
```

- 证书可用 Let's Encrypt（`certbot certonly --standalone -d os.example.com`，注意续期后 reload 服务），或自签（仅自用、浏览器会警告）。
- 设了 `POS_TLS_CERT/KEY` 会自动给 Cookie 加 `Secure`。
- 常与「方式 C/D 的 TCP 穿透」组合，做到隧道商也看不到明文。

---

### 方式 F：Tailscale / WireGuard（私有组网，最省心且安全）

严格说这不是「公网」，而是把你的设备组进一个加密私有网。装 Tailscale 后，手机通过树莓派的 Tailscale IP（`100.x.x.x`）直接访问 `http://100.x.x.x:8787`，链路由 WireGuard 加密，**无需域名、无需开端口、无需自己搞证书**。若你只需要「自己在外面能用」，这是最简单安全的选择。

---

## 4. 该选哪个？

| 场景 | 推荐 |
|------|------|
| 只要自己在外能用，最省心 | **F（Tailscale）** |
| 想要真正的公网 HTTPS 域名，家宽无公网 IP | **A（Cloudflare Tunnel）** |
| 有公网 IP + 域名，能开 80/443 | **B（Caddy）** |
| 国内、无公网 IP、习惯用花生壳 | **C（花生壳 HTTPS 映射）** |
| 有自己的 VPS，想完全自控 | **D（frp + VPS + Caddy）** |

无论哪种，**强主密码 + 全程 HTTPS** 是底线；本程序已内置登录爆破退避与安全响应头。

---

## 5. 中国网络环境专用建议

### 构建期依赖下载（避开被墙的默认源）

- **Go 模块**：`go env -w GOPROXY=https://goproxy.cn,direct`（七牛 Goproxy 中国）。否则首次 `go run`/构建会卡在 `proxy.golang.org`。
- **npm 依赖**：`npm config set registry https://registry.npmmirror.com`（淘宝镜像），或临时 `npm install --registry=https://registry.npmmirror.com`。
- **最省事**：在**能顺畅联网的电脑**上 `npm run release` 构建好产物，再拷到树莓派离线运行——树莓派上零依赖、零下载。

### 多设备同步优先用 Gitee

GitHub 在国内访问慢/不稳。本程序**已支持 Gitee 私有仓**：设置页「配置新建」→ 平台选 **Gitee**，填仓库 HTTPS 地址 + 私人令牌（需仓库读写权限）。注意 **Gitee 新建空仓默认分支常为 `master`**，分支名要与设置里填的一致。数据在传输与远端均为密文。

### 内网穿透 / 公网方式选型（按国内可用性）

| 方式 | 国内可用性 | 备注 |
|------|-----------|------|
| **花生壳（Oray）HTTPS 映射** | 好 | 国内老牌，免注册域名即用；免费版有带宽/流量限制。见上文方式 C。 |
| **frp + 国内 VPS**（阿里云/腾讯云） | 好 | 完全自控、稳定；VPS 上用 Caddy 出 HTTPS。见方式 D。 |
| NATAPP / cpolar 等 | 中 | 与花生壳类似的商业穿透，按需选。 |
| **Tailscale / WireGuard** | 中 | 私有组网、最省心；Tailscale 依赖 DERP 中继，个别网络下偶有连通问题，可自建 headscale/DERP。 |
| Cloudflare Tunnel | 偏低 | 边缘节点在国内速度/连通性不稳，酌情使用。 |

**只需要自己在外面用**：优先 **Tailscale**（无需域名、无需备案、WireGuard 加密）。
**要真正的公网 HTTPS 域名**：优先 **花生壳 HTTPS** 或 **frp + 国内 VPS + 自有域名**。

### ICP 备案

若使用**中国大陆服务器 + 自有域名**对外提供 HTTP(S) 服务，域名需完成 **ICP 备案**，否则大陆机房会阻断 80/443。
规避备案的做法：用花生壳提供的二级域名、或走 Tailscale（不对公网暴露、无需域名）。

### 时区（务必设对）

服务端按**运行机的本地时区**计算「发薪周期」「打卡日期」等。请确保时区为 `Asia/Shanghai`：

```bash
sudo timedatectl set-timezone Asia/Shanghai      # 系统级（推荐）
# 或仅给进程设置（deploy/personal-os.service 已内置 TZ=Asia/Shanghai）
```

### 字体与离线

应用字体已**随包自带**（不再访问 Google Fonts），国内网络与完全离线环境下都能正常显示。
