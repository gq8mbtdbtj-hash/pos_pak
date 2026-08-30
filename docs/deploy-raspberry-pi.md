# 树莓派部署指南（Personal OS 纯 Web 版）

本指南把 Personal OS 部署到树莓派，作为家里 7×24 常开的私有服务；手机 / 电脑在**同一 WiFi**下即可访问，配合 [公网方案](./deploy-public-internet.md) 还能在外网加密访问。

后端是**纯 Go 单二进制**（`CGO_ENABLED=0`，内置 SQLite，无需 C 编译器），资源占用很低，树莓派 3/4/5 乃至 Zero 2 W 都能跑得动。

---

## 0. 准备

- 一台树莓派，装好 **Raspberry Pi OS**（推荐 64 位；32 位也支持）。
- 能 SSH 登录树莓派。
- 一台开发电脑（Windows/macOS/Linux）用来构建产物（推荐），或直接在树莓派上构建。

查看树莓派架构：

```bash
uname -m
# aarch64  → 用 arm64 版二进制（64 位系统）
# armv7l   → 用 armv7 版二进制（32 位系统）
```

---

## 1. 构建部署产物

有两种方式，**推荐方式 A**（在电脑上交叉编译，树莓派上零依赖）。

### 方式 A：在电脑上一键构建（推荐）

在项目根目录：

```bash
npm install        # 首次
npm run release
```

产物在 `release/`：

```text
release/
  dist/                              前端静态资源（所有架构共用）
  personal-os-server-linux-arm64     树莓派 64 位系统
  personal-os-server-linux-armv7     树莓派 32 位系统
  personal-os-server-linux-amd64     通用 x86-64（如小主机/NAS）
```

把「匹配架构的二进制」和 `dist/` 传到树莓派，例如（64 位系统）：

```bash
ssh pi@raspberrypi.local 'mkdir -p /home/pi/personal-os'
scp release/personal-os-server-linux-arm64 pi@raspberrypi.local:/home/pi/personal-os/personal-os-server
scp -r release/dist pi@raspberrypi.local:/home/pi/personal-os/dist
```

### 方式 B：在树莓派上直接构建

在树莓派上装好 **Go 1.22+** 与 **Node.js LTS**，然后：

```bash
git clone <本仓库地址> personal-os && cd personal-os
npm install
npm run build                         # 生成 dist/
cd server && go build -o personal-os-server ./cmd/server
```

> 32 位树莓派内存较小，首次编译较慢，请耐心等待。

---

## 2. 首次手动运行（先确认能跑通）

在树莓派上：

```bash
cd /home/pi/personal-os
chmod +x personal-os-server
POS_DATA_DIR=/home/pi/personal-os/data \
POS_DIST_DIR=/home/pi/personal-os/dist \
POS_ADDR=0.0.0.0:8787 \
./personal-os-server
```

看到 `personal-os-server listening on http://0.0.0.0:8787` 即成功。

用同 WiFi 的手机 / 电脑浏览器打开 `http://<树莓派IP>:8787`（树莓派 IP 用 `hostname -I` 查看）。**首次进入会要求设置主密码（≥8 位）**，之后用它解锁。确认无误后按 `Ctrl+C` 停止，进入下一步做成开机自启服务。

---

## 3. 做成 systemd 服务（开机自启、崩溃自拉起）

推荐用独立用户与固定目录 `/opt/personal-os`。

```bash
# 独立系统用户（无登录 shell）
sudo useradd --system --home /opt/personal-os --shell /usr/sbin/nologin personalos || true
sudo mkdir -p /opt/personal-os/data

# 放置二进制与前端（按你的实际路径调整）
sudo cp /home/pi/personal-os/personal-os-server /opt/personal-os/
sudo cp -r /home/pi/personal-os/dist /opt/personal-os/
sudo chown -R personalos:personalos /opt/personal-os
sudo chmod +x /opt/personal-os/personal-os-server
```

安装服务单元（仓库已提供示例 `deploy/personal-os.service`）：

```bash
sudo cp deploy/personal-os.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now personal-os
sudo systemctl status personal-os        # 应为 active (running)
journalctl -u personal-os -f             # 看实时日志
```

默认单元里 `POS_ADDR=127.0.0.1:8787`（只监听本机，配合反代/隧道用，见公网文档）。
**若只在局域网直连**，把单元里的 `POS_ADDR` 改成 `0.0.0.0:8787` 并去掉 `POS_SECURE_COOKIE=1`，然后 `sudo systemctl daemon-reload && sudo systemctl restart personal-os`。

---

## 4. 数据、备份与升级

### 数据位置

默认在 `POS_DATA_DIR` 下的 `default/`：

```text
/opt/personal-os/data/default/
  vault.json            主密码校验 + 分密钥盐
  personal.db           解锁期间的明文工作副本
  personal.db.enc       锁定 / 退出时的加密存盘（静止态）
  knowledge/            Markdown 知识库
  app_prefs.json        发薪日等偏好
```

> ⚠️ 解锁运行期间磁盘上存在明文 `personal.db`（与桌面版一致的模型）。请确保树莓派本身的物理与账号安全。

### 备份

- **应用内**：设置页「备份」→ 下载 ZIP（含数据库与知识库）；换机 / 恢复时上传该 ZIP。
- **服务器侧**：直接备份 `data/default/` 目录（先 `systemctl stop personal-os` 保证一致性，或至少复制 `personal.db.enc` + `vault.json` + `knowledge/`）。
- **多设备加密同步**：见设置页「配置新建 / 配置同步」，用 GitHub/Gitee 私有仓做加密包同步（数据在传输与远端均为密文）。

### 升级

1. 重新 `npm run release` 生成新产物；
2. `scp` 覆盖 `/opt/personal-os/personal-os-server` 与 `dist/`；
3. `sudo systemctl restart personal-os`。

数据目录不受影响。

---

## 5. 局域网访问小贴士

- 给树莓派配**静态内网 IP** 或在路由器里绑定 MAC，避免 IP 变动。
- 也可用 `raspberrypi.local`（mDNS）访问：`http://raspberrypi.local:8787`。
- 想在外网访问、并做传输加密与防爆破，见 **[公网加密部署方案](./deploy-public-internet.md)**。

---

## 6. 排错

| 现象 | 排查 |
|------|------|
| 服务起不来 | `journalctl -u personal-os -e`；确认二进制架构与系统匹配（`uname -m` vs `file personal-os-server`）。 |
| 打不开页面 | 确认 `POS_ADDR` 是 `0.0.0.0:8787`（局域网直连）；`hostname -I` 拿对 IP；防火墙放行 8787。 |
| 页面白屏 / 404 | `POS_DIST_DIR` 是否指向包含 `index.html` 的 `dist/`。 |
| 解锁总失败被限流 | 连续输错会触发退避（HTTP 429）。等提示的秒数后重试；密码正确即恢复。 |
