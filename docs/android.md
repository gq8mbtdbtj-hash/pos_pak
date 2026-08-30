# Android 真机开发（桌面与移动同一代码库）

本项目用 **Tauri 2 单仓**：React + Rust 桌面与 Android **强制复用**，仅通过 `src/lib/platform.ts` 做能力闸门（如移动端知识库只读），不单独 fork 分支演进。

## 环境

- `ANDROID_HOME`（例：`D:\AppData\Local\Android\Sdk`）
- `JAVA_HOME`（Android Studio 自带 JBR）
- `NDK_HOME`：须指向带 `source.properties` 的 NDK（本机可用 `28.2.13676358`；`30.x` 若缺该文件勿用）
- `adb` 在 PATH 中；真机开启调试并授权

```bat
set ANDROID_HOME=D:\AppData\Local\Android\Sdk
set JAVA_HOME=D:\Program Files\Android\Android Studio\jbr
set NDK_HOME=%ANDROID_HOME%\ndk\28.2.13676358
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%NDK_HOME%\toolchains\llvm\prebuilt\windows-x86_64\bin;%PATH%
adb devices
```

## Rust Android targets（首次较慢）

```bat
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

## 初始化与运行

```bat
cd /d G:\agent_projs\me
npm run android:init

REM 真机需能访问本机 Vite；设局域网 IP（与 ipconfig 一致）
set TAURI_DEV_HOST=192.168.x.x
REM 若 cargo build-script 被「应用程序控制策略」(os 4551) 拦截：
REM set CARGO_TARGET_DIR=%TEMP%\personal-os-android-target

adb devices
npx tauri android dev 6964662f
```

## Gradle（腾讯云镜像）

Android 工程已改用腾讯云加速：

- Wrapper：`mirrors.cloud.tencent.com/gradle/`
- 依赖：`mirrors.cloud.tencent.com/nexus/repository/maven-public/`

若执行 `tauri android init` 覆盖了 `src-tauri/gen/android`，需重新改 `gradle-wrapper.properties` 与 `build.gradle.kts` / `buildSrc/build.gradle.kts`。

## 系统导航（手势 / 三段式）

`MainActivity`：软键盘给 `android.R.id.content` 加 `paddingBottom = ime`；打开时 `--sab` 置 `0`（避免输入框与键盘之间多出一条空白，像空的标签栏），并设 `data-keyboard-open` 隐藏底栏。收起键盘后恢复 `--sab` 与底栏。改 Kotlin 后须重装 APK。

## 跨端同步（不自建后端）

详见 [cross-platform-sync.md](./cross-platform-sync.md)。已实现 **HTTPS + PAT**（GitHub/Gitee Contents API）推拉加密包，Android 与桌面同一路径，无需系统 git。

**把电脑 Git 配置拷到手机：** 见 [git-config-transfer.md](./git-config-transfer.md)。

## iOS

**暂缓。**

## 图标

```bat
npx tauri icon src-tauri\icons\app-icon-1024.png
xcopy /E /Y /I src-tauri\icons\android\mipmap-hdpi src-tauri\gen\android\app\src\main\res\mipmap-hdpi\
xcopy /E /Y /I src-tauri\icons\android\mipmap-mdpi src-tauri\gen\android\app\src\main\res\mipmap-mdpi\
xcopy /E /Y /I src-tauri\icons\android\mipmap-xhdpi src-tauri\gen\android\app\src\main\res\mipmap-xhdpi\
xcopy /E /Y /I src-tauri\icons\android\mipmap-xxhdpi src-tauri\gen\android\app\src\main\res\mipmap-xxhdpi\
xcopy /E /Y /I src-tauri\icons\android\mipmap-xxxhdpi src-tauri\gen\android\app\src\main\res\mipmap-xxxhdpi\
copy /Y src-tauri\icons\android\values\ic_launcher_background.xml src-tauri\gen\android\app\src\main\res\values\
```

重装 APK 后若桌面图标仍旧，清一次启动器缓存或卸载再装。

## 共享能力约定

| 能力 | 桌面 | 移动 |
|------|------|------|
| 习惯/目标/任务/记账/外债 | 可写 | 可写 |
| 记账明细列表 | 可看可改 | 可看可改 |
| 知识库 | 可编辑（后续含导入等） | 仅问答检索 + 阅读（`canEditKnowledge` / 命令拒绝写） |
| 解锁后 Git 拉同步 | HTTPS 软拉取 | HTTPS 软拉取（失败不挡解锁） |
| Git 配置跨端 | 复制/文件导出 | 粘贴导入；同步用右下角「拉 / 推」 |
| 应用图标 | `tauri icon` | 需把 `icons/android/mipmap-*` 同步进 `gen/android/.../res` 后重装 |
| 系统通知 | 有 | 有（同一 `reminders.ts`） |
