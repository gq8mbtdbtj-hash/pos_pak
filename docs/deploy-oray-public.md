# 公网访问 · 手机浏览器直接打开（花生壳，免费）

目标：**任意网络（含 4G/5G）下，手机浏览器输入一个网址就能用**；免费、无需装 App、好维护。

家宽通常在 NAT 后、没有公网 IP，所以用「内网穿透」把树莓派的服务映射到一个公网地址。**花生壳（Oray）免费版**送一个公网二级域名 + HTTPS，正好满足「浏览器直接打开、不用装客户端」。

> 对比 Tailscale：Tailscale 每台设备都要装 App、属私有组网，**不满足**「浏览器直接公网访问」。所以「手机直连公网」选花生壳。

---

## 前提

1. 树莓派已按 [快速上手第 1 步](./quickstart-cn.md) 跑起来（服务在本机监听）。
2. 注册**花生壳账号**并完成**实名认证**（国内内网穿透的合规要求，一次性、免费）。

---

## 步骤（约 10 分钟）

### 1）树莓派安装花生壳客户端并登录

到花生壳官网「下载中心」下载对应架构的 **Linux 客户端 phddns**（树莓派 64 位选 `arm64`，32 位选 `armhf/arm`），按官网说明安装后启动并用你的账号/SN 登录，例如：

```bash
sudo phddns start           # 启动
sudo phddns status          # 查看在线状态与 SN
```

> 客户端也可以装在**路由器**或另一台常开设备上；只要它能访问到树莓派的 `127.0.0.1:8787`（同机最简单）。

### 2）在花生壳后台加一条 HTTPS 映射

登录花生壳管理后台（`console.hsk.oray.com`）→「内网穿透」→ 新增映射：

| 字段 | 填写 |
|------|------|
| 应用名称 | 随意，如 `personal-os` |
| **映射类型** | **HTTPS**（关键：对外是 https，手机浏览器无证书警告） |
| 外网域名 | 选免费赠送的二级域名，如 `xxxx.gicp.net` |
| 内网主机 | `127.0.0.1` |
| 内网端口 | `8787` |

保存。

> 若你的套餐**只允许 HTTP/TCP、没有 HTTPS 映射**：改用「TCP 映射 + 服务端内置 TLS」做端到端加密（见下方「更安全的变体」），代价是自签证书浏览器首次会提示一次。

### 3）服务端配置（只监听本机 + 标记 Secure Cookie）

编辑 `/etc/systemd/system/personal-os.service`，确保：

```ini
Environment=POS_ADDR=127.0.0.1:8787
Environment=POS_SECURE_COOKIE=1
Environment=POS_DIST_DIR=/opt/personal-os/dist
Environment=POS_DATA_DIR=/opt/personal-os/data
Environment=TZ=Asia/Shanghai
```

应用：

```bash
sudo systemctl daemon-reload && sudo systemctl restart personal-os
```

### 4）手机直接访问

手机（任意网络，切到 4G/5G 也行）浏览器打开花生壳给的：

```
https://xxxx.gicp.net
```

**首次进入设置主密码（≥8 位）**，之后用它解锁。加到手机主屏即可像 App 一样用。

---

## 安全（务必看）

- **强主密码**：公网下这是最后一道门。程序已内置**登录爆破退避**（连错 5 次指数级锁定，返回 429）。
- **信任模型**：花生壳 HTTPS 在其边缘终止 TLS，理论上隧道商能看到明文。数据静止仍是加密的（`personal.db.enc`），但传输经过第三方。个人自用可接受；若要**端到端只有你能解**，见下方变体。
- **可选再加一层**：如果你在树莓派前放了 Caddy，可开 Basic Auth 再挡一层扫描（非必需）。

### 更安全的变体：端到端加密（花生壳 TCP + 内置 TLS，仍免费）

让程序自持证书出 HTTPS，花生壳只做 **TCP** 转发，隧道商也看不到明文：

```bash
# 生成自签证书（10 年、免费；HOST 用花生壳给你的域名）
./scripts/gen-cert.sh xxxx.gicp.net /opt/personal-os/tls
```

systemd 改为直接以 HTTPS 监听，并在花生壳加 **TCP** 映射（外网 → `127.0.0.1:8443`）：

```ini
Environment=POS_ADDR=0.0.0.0:8443
Environment=POS_TLS_CERT=/opt/personal-os/tls/fullchain.pem
Environment=POS_TLS_KEY=/opt/personal-os/tls/privkey.pem
```

代价：自签证书手机浏览器首次提示「不受信任」，确认继续一次即可。

---

## 维护与限制

- 花生壳客户端设**开机自启**即可，基本零维护；免费二级域名固定不变。
- 免费版**带宽/流量有限**（约 1Mbps / 约 1GB·月）。本应用首屏约几百 KB、之后接口都是很小的 JSON，个人日常足够；不够就升级套餐，或改用下面的完全自控方案。

---

## 想完全自控、无第三方、无证书警告？（进阶，仍可免费）

用 **frp + 一台永久免费 VPS**（如 Oracle Cloud「Always Free」ARM 实例）：

1. VPS 上跑 `frps` + Caddy（Caddy 用 Let's Encrypt 自动签发**有效证书**，无警告）。
2. 树莓派上跑 `frpc`（仓库示例 `deploy/frpc.example.toml`，隧道加密）。
3. 需要一个域名（可用便宜/免费域名）解析到 VPS。

这条路无第三方隧道、证书有效、手机浏览器直连无警告，但设置最重。日常最省心仍推荐花生壳 HTTPS。详见 [`deploy-public-internet.md`](./deploy-public-internet.md) 方式 D。
