# 中国快速上手（三步）

面向中国网络环境、**只用免费且好维护的方案**：树莓派常开 + 远程加密访问 + 多设备加密同步。

> 仓库已预置国内镜像：npm 用 `registry.npmmirror.com`（`.npmrc`），构建脚本默认走 Go 代理 `goproxy.cn`。无需手动设置。

---

## 第 1 步：树莓派上线（开机自启）

**在能联网的电脑上**构建产物（最省事，树莓派零依赖）：

```bash
npm install
npm run release          # 生成 release/：dist/ + 各架构服务端二进制
```

查树莓派架构：`uname -m`（`aarch64`→arm64，`armv7l`→armv7）。传到树莓派并做成服务：

```bash
# 传输（64 位系统示例）
ssh pi@raspberrypi.local 'sudo mkdir -p /opt/personal-os && sudo chown pi /opt/personal-os'
scp release/personal-os-server-linux-arm64 pi@raspberrypi.local:/opt/personal-os/personal-os-server
scp -r release/dist pi@raspberrypi.local:/opt/personal-os/dist

# 在树莓派上：装成 systemd 服务（含 TZ=Asia/Shanghai）
sudo useradd --system --home /opt/personal-os --shell /usr/sbin/nologin personalos || true
sudo mkdir -p /opt/personal-os/data && sudo chown -R personalos:personalos /opt/personal-os
sudo chmod +x /opt/personal-os/personal-os-server
# 取仓库里的 deploy/personal-os.service（默认只监听 127.0.0.1，配合下一步的隧道）
sudo cp deploy/personal-os.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now personal-os
```

> 只在**局域网直连**先试用：把单元里的 `POS_ADDR` 改成 `0.0.0.0:8787`、去掉 `POS_SECURE_COOKIE=1`，
> `sudo systemctl daemon-reload && sudo systemctl restart personal-os`，然后手机同 WiFi 打开 `http://<树莓派IP>:8787`。
> 详见 [`docs/deploy-raspberry-pi.md`](./deploy-raspberry-pi.md)。

---

## 第 2 步：远程加密访问（二选一）

### 方案 A（推荐，最省心）：Tailscale —— 免费 / 免域名 / 免备案

Tailscale 个人版免费，基于 WireGuard 加密组网，无需公网 IP、无需域名、无需 ICP 备案，几乎零维护。

```bash
# 树莓派上
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # 按提示用浏览器登录授权
tailscale ip -4              # 记下树莓派的 100.x.x.x 地址
```

手机 / 电脑装 **Tailscale** 并登录同一账号，即可在任意网络下访问：

```
http://<树莓派的 100.x.x.x>:8787
```

链路由 WireGuard 端到端加密。此时后端保持默认（局域网监听）即可，把 systemd 里的 `POS_ADDR` 设为 `0.0.0.0:8787`（Tailscale 走的是虚拟网卡）。

### 方案 B：花生壳 + 内置 TLS —— 需要一个「公网 HTTPS 网址」时

免费版花生壳可给你一个公网 HTTPS 地址。为了**连隧道商也看不到明文**，用「花生壳 TCP 转发 + 程序自带 TLS」端到端加密。详细步骤见
[`docs/deploy-public-internet.md` → 方式 C / 内置 TLS 端到端](./deploy-public-internet.md#方式-c花生壳oray内网穿透)。要点：

```bash
# 树莓派上生成自签证书（10 年有效、免费；HOST 用花生壳给你的域名）
./scripts/gen-cert.sh os.xxxxx.gicp.net /opt/personal-os/tls
```

把 systemd 单元改成直接以 HTTPS 监听（编辑 `/etc/systemd/system/personal-os.service`）：

```ini
Environment=POS_ADDR=0.0.0.0:8443
Environment=POS_TLS_CERT=/opt/personal-os/tls/fullchain.pem
Environment=POS_TLS_KEY=/opt/personal-os/tls/privkey.pem
# 直连 TLS 时 Secure Cookie 会自动打开，无需 POS_SECURE_COOKIE
```

花生壳新增一条 **TCP** 映射：外网 → 内网 `127.0.0.1:8443`。访问花生壳给的地址即可（自签证书浏览器首次会提示，确认继续一次即可）。

> 免费但更省心的仍是方案 A（Tailscale）。方案 B 适合你确实需要一个公网网址分享给自己在任意浏览器直接打开。

---

## 第 3 步：多设备加密同步（Gitee 私有仓，免费）

用 **Gitee 免费私有仓**做加密包同步（数据在传输与远端均为密文；比 GitHub 在国内更稳）。

1. Gitee 上新建一个**私有**仓库（可空仓，记住默认分支名，通常是 `master`）。
2. Gitee → 设置 → 私人令牌，生成一个有**仓库读写权限**的 PAT。
3. 在**电脑端**打开应用 → 设置 → 「配置新建」：平台选 **Gitee**，填仓库 HTTPS 地址、用户名、分支（与仓库一致，常为 `master`）、PAT → 保存 → 左下角「推」上传。
4. 在**手机端**：设置 →「配置同步」→ 设一个传输密码 → 在电脑端「配置同步」里「复制加密配置」，把文本发到手机粘贴 + 填同一传输密码 → 导入 → 左下角「拉」。

之后各设备用左下角浮标 `拉 / 推` 手动同步即可（主密码可各设备不同，传输密码需一致）。

---

## 小结（都免费、好维护）

| 环节 | 选择 |
|------|------|
| 常开服务 | 树莓派 + systemd（本仓库 `deploy/personal-os.service`） |
| 远程访问 | **Tailscale**（首选）/ 花生壳+内置 TLS |
| 多设备同步 | **Gitee** 私有仓加密包同步 |
| 依赖镜像 | 已预置（npmmirror + goproxy.cn） |
| 时区 | `Asia/Shanghai`（systemd 已内置 `TZ`） |
