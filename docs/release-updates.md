# 应用发版与自动更新

源码不必公开。发布仓：`gq8mbtdbtj-hash/pos_pak`（仅 Release 产物）。

## 本地 / 真机调试

**不需要**签名、不需要上传 Release：

```bash
npm run tauri
npm run android:dev
```

## 一次性：签名密钥

密钥已生成在本机：

- 私钥：`src-tauri/keys/updater.key`（**已 gitignore，勿提交**）
- 公钥：已写入 `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`

生成时私钥密码为 `.`（一个英文句点）。发版时脚本会自动读取 `src-tauri/keys/updater.key` 并设置 `TAURI_SIGNING_PRIVATE_KEY`（私钥密码默认 `.`）。手动构建时可：

```bat
set TAURI_SIGNING_PRIVATE_KEY=<粘贴 updater.key 全文，或设为该文件绝对路径>
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=.
```

若丢失私钥，已安装用户将无法再通过自动更新升级，只能重装。

## 一键发版脚本（推荐）

```bat
set POS_PAK_GITHUB_TOKEN=ghp_你的PAT
npm run release:pos-pak -- --version 0.1.1 --notes "首次支持自动更新" -y
```

可选 `--android` 同时构建并上传 `personal-os.apk`；`--skip-build` 跳过桌面重编（若加了 `--android` 且本地无 release APK，仍会打 Android）；`--skip-upload` 只构建并生成本地 `scripts/.release-out/latest.json`。

**仅修正 `latest.json`（安装包已在 Release、不必重传）：**

```bat
npm run release:pos-pak -- --version 0.1.1 --notes "..." --manifest-only -y
```

**桌面已发、补传 Android APK：**

```bat
npm run release:pos-pak -- --version 0.1.1 --notes "..." --android --skip-build -y
```

交互模式（省略 `--version` / `--notes` 时会提示输入）：

```bash
npm run release:pos-pak
```

Token 需对 `pos_pak` 仓库有 **Contents** 写权限（经典 PAT 勾选 `repo` 即可）。若发布仓尚无任何 commit，脚本会自动提交一份 README 再创建 Release。

## 桌面正式包（手动）

1. 升版本号：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 保持一致（如 `0.1.2`）。
2. 设置上方环境变量后执行：

```bash
npm run tauri build
```

3. 在 `src-tauri/target/release/bundle/` 找到安装包与 `.sig`。
4. 编写并上传 `latest.json` 到 GitHub Release（与安装包同一次 Release）：

```json
{
  "version": "0.1.2",
  "notes": "发薪日同步与养成改进",
  "pub_date": "2026-08-30T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<粘贴 .sig 文件全文>",
      "url": "https://github.com/gq8mbtdbtj-hash/pos_pak/releases/download/v0.1.2/Personal.OS_0.1.2_x64-setup.exe"
    }
  }
}
```

文件名以实际产物为准。上传资产名建议固定，便于 `releases/latest/download/...`。

客户端 endpoint：

`https://github.com/gq8mbtdbtj-hash/pos_pak/releases/latest/download/latest.json`

## Android APK

1. `npm run android:build` 得到 APK。
2. 上传到同一 Release，**资产名必须为**：`personal-os.apk`
3. 下载直链：

`https://github.com/gq8mbtdbtj-hash/pos_pak/releases/latest/download/personal-os.apk`

手机端：启动检查 / 设置「查看最新版本」→ 弹窗「去下载」打开该链接；不自动安装。

## 应用内行为

- **解锁后**：请求 `latest.json`，若远端版本更新则弹窗（样式同还款提醒弹窗）。
- **设置 → 关于 → 查看最新版本**：手动检查；已最新则 toast。
- 「稍后」仅本会话内不再提示同一版本。

## 与数据同步的区别

设置里的 GitHub/Gitee 远端是加密**数据**同步；`pos_pak` 是**安装包**分发，职责不同。
