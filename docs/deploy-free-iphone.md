# 免费让 iPhone 用起来（不用买服务器）

先别被"服务器"吓到 👇

- 这个 App 需要一个**一直在跑的小服务**来存数据、做加密。但这个"服务器"**不一定要花钱买**——可以是你**已有的一台电脑 / 旧安卓手机 / 路由器 / NAS**，甚至一个**免费云**。
- iPhone 端**永远是免费的**：用 **Safari 打开网址 → 分享 → 添加到主屏幕**，就能像 App 一样用（这就是 PWA）。

下面三条路，**按"省事程度"排序**，任选其一。

---

## iPhone 通用最后一步（三条路都一样）

在 iPhone **Safari** 打开你的网址后：

1. 点底部「分享」按钮（方框向上箭头）。
2. 选「添加到主屏幕」。
3. 桌面上会出现 Personal OS 图标，点开即全屏，像原生 App。

> 首次进入设置主密码（≥8 位），以后用它解锁。

---

## 路 A：用你已有的一台常开设备（最省事、最省钱）

家里任意一台**能一直开着**的设备（旧电脑 / 旧安卓装 Termux / 群晖 NAS / 软路由）都行。

### A1. 装了 Docker 的话——**一条命令**

```bash
docker compose up -d
```

（仓库根目录已带 `Dockerfile` 和 `docker-compose.yml`，会自动构建并在 `:8787` 跑起来，数据存在 `./data`。）
不想用 compose 也可以：

```bash
docker build -t personal-os-web .
docker run -d -p 8787:8787 -v personal-os-data:/data personal-os-web
```

### A2. 不想装 Docker——用免编译的二进制

在能联网的电脑 `npm run release` 生成 `release/`，把对应架构的二进制 + `dist/` 拷到那台设备运行即可（见 [`deploy-raspberry-pi.md`](./deploy-raspberry-pi.md)）。

### 然后 iPhone 怎么用

- **同一个 WiFi**：iPhone Safari 打开 `http://<那台设备的IP>:8787` → 添加到主屏。够日常在家用。
- **在外面也要用（4G/5G）**：给它加一个**免费花生壳 HTTPS**，得到一个公网网址，iPhone 任意网络直接打开。详细步骤见 [`deploy-oray-public.md`](./deploy-oray-public.md)。

> 缺点：那台设备关机时用不了。优点：完全免费、数据在你自己手里。

---

## 路 B：不想开自己任何设备 → 免费云（Fly.io）

把服务丢到**免费云**上跑，你自己的电脑可以关机，iPhone 随时用一个 `https://xxx.fly.dev` 网址。

```bash
# 安装 flyctl 后，在项目根目录：
fly launch --no-deploy         # 交互式创建 app（参考 deploy/fly.toml.example）
fly volumes create data --size 1   # 1GB 持久卷（免费额度内）
fly deploy
```

- 参考模板：[`deploy/fly.toml.example`](../deploy/fly.toml.example)。`primary_region` 选**离你近的节点**（如 `hkg` 香港 / `nrt` 东京 / `sin` 新加坡），国内访问更快。
- Fly 免费额度足够个人自用；对外自带 HTTPS（模板已设 `POS_SECURE_COOKIE=1`）。空闲会自动停、来请求自动拉起。
- 说明（如实）：Fly 注册需绑卡（有免费额度）；`*.fly.dev` 在国内访问速度随节点/网络波动，选港/日/新节点通常可用。

> iPhone：Safari 打开 `https://xxx.fly.dev` → 添加到主屏。

---

## 路 C：完全无服务器（纯浏览器本地）——规划中

最理想的"零服务器、iPhone 直接免费用"是：应用**整个跑在浏览器里**，数据存在 iPhone 浏览器本地，静态文件挂在**免费静态托管**（GitHub Pages / Cloudflare Pages），同步走浏览器直连 Git。

- 现状：当前业务逻辑在 Go 后端；要做到纯浏览器需把后端逻辑搬进浏览器（WASM/IndexedDB），是一项**较大的改造**，且 Gitee 的浏览器跨域（CORS）可能受限。
- 已经落地的一半：应用已是 **PWA**（可添加到主屏、外壳离线可用）。真正的"本地数据 + 无后端"作为后续方向，见 [`parity-and-roadmap.md`](./parity-and-roadmap.md)。

---

## 怎么选（都免费）

| 你的情况 | 选 |
|----------|-----|
| 家里有台能常开的设备，想最省心/数据自己留 | **路 A**（Docker 一条命令 + 花生壳 HTTPS） |
| 不想开自己任何设备，接受简单云部署 | **路 B**（Fly.io 免费云） |
| 只在家用、连外网都不需要 | 路 A 的「同 WiFi」即可，连花生壳都不用 |

**安全提醒**：无论哪条路，**主密码要强**（公网暴露时这是最后一道门）；程序已内置登录爆破退避与全程需要 HTTPS 的建议。
