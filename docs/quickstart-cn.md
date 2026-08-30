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

## 第 2 步：远程访问（按需求二选一）

### 需要「公网可用、手机浏览器直接输网址打开」→ 花生壳 HTTPS（推荐）

免费版花生壳送你一个公网二级域名 + HTTPS，手机在**任意网络（含 4G/5G）**浏览器直接打开、**无需装任何 App**。

要点（完整傻瓜步骤见 **[`docs/deploy-oray-public.md`](./deploy-oray-public.md)**）：

1. 树莓派装花生壳客户端 `phddns` 并登录（实名认证一次）。
2. 花生壳后台加一条**映射类型 = HTTPS** 的映射：外网二级域名 → 内网 `127.0.0.1:8787`。
3. systemd 单元保持 `POS_ADDR=127.0.0.1:8787` 并加 `POS_SECURE_COOKIE=1`，重启服务。
4. 手机浏览器打开花生壳给的 `https://xxxx.gicp.net` 即可，加到主屏当 App 用。

> 想连隧道商也看不到明文（端到端）：改「花生壳 TCP 映射 + 内置 TLS」（`scripts/gen-cert.sh` 生成自签证书，`POS_TLS_CERT/KEY` 直连 HTTPS），代价是自签证书首次提示一次。见 `deploy-oray-public.md`。

### 只给自己的设备用、可装 App、最省心 → Tailscale

不追求「浏览器公网直连」时，Tailscale 个人版免费、免域名、免备案、WireGuard 加密、几乎零维护：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # 浏览器登录授权
tailscale ip -4              # 记下 100.x.x.x
```

手机装 Tailscale 登录同账号，访问 `http://<派的100.x.x.x>:8787`（后端 `POS_ADDR=0.0.0.0:8787`）。缺点：每台设备要装 App，不是「浏览器直接公网访问」。

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
| 远程访问 | 公网+手机浏览器直连 → **花生壳 HTTPS**；仅自用可装 App → Tailscale |
| 多设备同步 | **Gitee** 私有仓加密包同步 |
| 依赖镜像 | 已预置（npmmirror + goproxy.cn） |
| 时区 | `Asia/Shanghai`（systemd 已内置 `TZ`） |
