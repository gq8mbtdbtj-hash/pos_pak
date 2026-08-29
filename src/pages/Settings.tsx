import { useEffect, useState } from "react";
import {
  api,
  VaultStatus,
  SyncConfigView,
  SyncRemoteView,
  SyncRemotesView,
  SyncPullResult,
  GitCommitInfo,
  GitConfigImportResult,
} from "../services/api";
import { isMobile } from "../lib/platform";
import Select from "../components/Select";
import { showToast, type ToastKind } from "../components/Toast";

type Props = {
  onLocked?: () => void;
};

type Feedback = { kind: ToastKind; text: string };

const emptyForm = (): SyncConfigView => ({
  id: undefined,
  label: "",
  provider: "github",
  repoUrl: "",
  username: "",
  branch: "main",
  hasPat: false,
});

function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    try {
      return JSON.stringify(e);
    } catch {
      /* ignore */
    }
  }
  return String(e);
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "gitee":
      return "Gitee";
    case "atomgit":
      return "AtomGit";
    default:
      return "GitHub";
  }
}

export default function SettingsPage({ onLocked }: Props) {
  const mobile = isMobile();
  const [outputPath, setOutputPath] = useState("");
  const [importPath, setImportPath] = useState("");
  const [gitBundlePath, setGitBundlePath] = useState("");
  const [gitBundleText, setGitBundleText] = useState("");
  const [gitTransferPw, setGitTransferPw] = useState("");
  const [connFeedback, setConnFeedback] = useState<Feedback | null>(null);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [remotesView, setRemotesView] = useState<SyncRemotesView>({
    remotes: [],
    needsDefaultRemote: false,
  });
  const [config, setConfig] = useState<SyncConfigView>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pat, setPat] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<SyncPullResult | null>(null);

  const applyRemotes = (view: SyncRemotesView) => {
    setRemotesView({
      remotes: Array.isArray(view?.remotes) ? view.remotes : [],
      needsDefaultRemote: Boolean(view?.needsDefaultRemote),
    });
  };

  const refresh = async () => {
    const s = await api.vaultStatus();
    setStatus(s);
    if (s.unlocked) {
      try {
        const view = await api.syncListRemotes();
        applyRemotes(view);
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    if (!mobile && !gitBundlePath) {
      setGitBundlePath("C:\\Users\\ikjm\\Desktop\\personal-os-git.posgit");
    }
  }, [mobile, gitBundlePath]);

  useEffect(() => {
    refresh().catch((e) => showToast("err", errText(e)));
  }, []);

  const flash = (kind: ToastKind, text: string) => {
    showToast(kind, text);
  };

  const startNew = () => {
    setEditingId(null);
    setConfig(emptyForm());
    setPat("");
    setConnFeedback(null);
  };

  const startEdit = (remote: SyncRemoteView) => {
    setEditingId(remote.id);
    setConfig({
      id: remote.id,
      label: remote.label,
      provider: remote.provider,
      repoUrl: remote.repoUrl,
      username: remote.username,
      branch: remote.branch,
      hasPat: remote.hasPat,
    });
    setPat("");
    setConnFeedback(null);
  };

  const exportData = async () => {
    if (!outputPath.trim()) {
      flash("err", "请输入导出路径");
      return;
    }
    try {
      await api.exportBackup(outputPath);
      flash("ok", "备份已导出");
    } catch (e) {
      flash("err", errText(e));
    }
  };

  const importData = async () => {
    if (!importPath.trim()) {
      flash("err", "请输入导入路径");
      return;
    }
    if (
      !window.confirm(
        "导入将覆盖当前档案中的数据库与知识库，此操作不可撤销。是否继续？",
      )
    ) {
      return;
    }
    try {
      await api.importBackup(importPath);
      flash("ok", "备份已导入，页面将刷新");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      flash("err", errText(e));
    }
  };

  const applyGitImportResult = async (result: GitConfigImportResult) => {
    await refresh();
    if (result.sync?.conflict) {
      setConflict(result.sync);
      flash("info", "配置已导入，同步存在冲突，请选择提交");
    } else if (result.syncNote) {
      flash("info", result.syncNote);
    } else if (result.sync) {
      flash(
        "ok",
        `Git 配置已导入并同步（${result.sync.status}${
          result.sync.contentHash
            ? ` · ${result.sync.contentHash.slice(0, 12)}`
            : ""
        }）`,
      );
    } else {
      flash("ok", "Git 配置已导入");
    }
    setGitTransferPw("");
  };

  const copyGitConfig = async () => {
    if (!gitTransferPw.trim()) {
      flash("err", "请设置传输密码（跨设备导入时使用）");
      return;
    }
    setBusy(true);
    try {
      const text = await api.exportGitConfigText(gitTransferPw);
      setGitBundleText(text);
      try {
        await navigator.clipboard.writeText(text);
        flash("ok", "已复制加密配置到剪贴板，可粘贴到手机");
      } catch {
        flash("ok", "已生成配置文本，请手动全选复制下方内容");
      }
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const exportGitConfig = async () => {
    if (!gitBundlePath.trim()) {
      flash("err", "请输入导出路径");
      return;
    }
    if (!gitTransferPw.trim()) {
      flash("err", "请设置传输密码（跨设备导入时使用）");
      return;
    }
    setBusy(true);
    try {
      await api.exportGitConfig(gitBundlePath.trim(), gitTransferPw);
      flash("ok", `已导出到 ${gitBundlePath.trim()}，可用微信等发到手机后按文档导入`);
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const importGitConfig = async () => {
    if (!gitTransferPw.trim()) {
      flash("err", "请输入传输密码");
      return;
    }
    const text = gitBundleText.trim();
    const path = gitBundlePath.trim();
    if (!text && !path) {
      flash("err", mobile ? "请粘贴电脑导出的配置文本" : "请粘贴配置文本或填写文件路径");
      return;
    }
    if (
      !window.confirm(
        "导入将覆盖当前档案的 Git 远程配置（含 PAT）。是否继续？",
      )
    ) {
      return;
    }
    setBusy(true);
    setConflict(null);
    try {
      const result = text
        ? await api.importGitConfigText(text, gitTransferPw)
        : await api.importGitConfig(path, gitTransferPw);
      await applyGitImportResult(result);
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSync = async () => {
    setBusy(true);
    setConnFeedback(null);
    try {
      const view = await api.syncUpsertRemote({
        id: editingId ?? undefined,
        label: config.label,
        provider: config.provider,
        repoUrl: config.repoUrl,
        username: config.username,
        branch: config.branch || "main",
        pat: pat.trim() ? pat : undefined,
      });
      applyRemotes(view);
      setPat("");
      await refresh();
      if (editingId) {
        const updated = view.remotes.find((r) => r.id === editingId);
        if (updated) startEdit(updated);
      } else {
        const created = view.remotes[view.remotes.length - 1];
        if (created) startEdit(created);
      }
      flash("ok", "远端配置已保存（PAT 已加密存入保险库）");
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteRemote = async (id: string) => {
    if (!window.confirm("确定删除该 Git 远端？本地已保存的 PAT 也会一并移除。")) {
      return;
    }
    setBusy(true);
    try {
      const view = await api.syncDeleteRemote(id);
      applyRemotes(view);
      if (editingId === id) startNew();
      await refresh();
      flash("ok", "已删除远端");
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (id: string) => {
    setBusy(true);
    try {
      const view = await api.syncSetDefaultRemote(id);
      applyRemotes(view);
      await refresh();
      flash("ok", "已设为默认访问远端");
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const testConn = async () => {
    setTesting(true);
    setConnFeedback({ kind: "info", text: "正在测试远端连接…" });
    try {
      const msg = await api.syncTestConnection({
        provider: config.provider,
        repoUrl: config.repoUrl,
        username: config.username,
        branch: config.branch || "main",
        pat: pat.trim() || undefined,
        remoteId: editingId ?? undefined,
      });
      setConnFeedback({ kind: "ok", text: msg });
      flash("ok", msg);
    } catch (e) {
      const text = errText(e);
      setConnFeedback({ kind: "err", text });
      flash("err", text);
    } finally {
      setTesting(false);
    }
  };

  const handlePull = async () => {
    setBusy(true);
    try {
      const r = await api.syncPull();
      if (r.status === "conflict") {
        setConflict(r);
        flash("err", "存在冲突，请选择提交");
      } else {
        flash(
          "ok",
          `拉取：${r.status}${r.revision ? ` @ ${r.revision.slice(0, 8)}` : ""}`,
        );
        await refresh();
      }
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePush = async () => {
    setBusy(true);
    try {
      const r = await api.syncPush();
      if (r.status === "conflict") {
        setConflict(r);
        flash("err", "存在冲突，请选择提交后再推送");
      } else {
        const label =
          r.status === "pushed"
            ? "已上传到远端"
            : r.status === "up_to_date"
              ? "远端已是最新"
              : r.status;
        flash(
          "ok",
          `推送：${label}${r.contentHash ? ` · ${r.contentHash.slice(0, 12)}` : ""}`,
        );
        await refresh();
      }
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const resolveCommit = async (commit: GitCommitInfo) => {
    setBusy(true);
    try {
      await api.syncResolveCommit(commit.id);
      setConflict(null);
      flash("ok", `已采用提交 ${commit.shortId}`);
      await refresh();
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      await api.vaultChangePassword(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      flash("ok", "主密码已更新");
      await refresh();
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      // Do not push on logout — upload can hang and feels like a freeze.
      // Use「推送到远端」explicitly when needed.
      await api.vaultLogout();
      onLocked?.();
    } catch (e) {
      flash("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remotes = remotesView.remotes;
  const multi = remotes.length > 1;
  const syncBlocked = remotesView.needsDefaultRemote;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2 className="page-title">设置</h2>
        </div>
      </header>

      <div className="card">
        <h3 style={{ marginBottom: "0.5rem" }}>主密码</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          本地数据库与同步令牌均由主密码保护。不同主密码对应独立数据与远端配置。
          登录后会在本机应用数据目录保存脱敏会话，下次启动无需再输密码；登出后才会要求重新输入。
          关闭窗口与登出不会自动推送远端，需在下方手动「立即推送」。
        </p>
        {status?.passwordMask && (
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            当前会话密码形如 {status.passwordMask}
            {status.profileId ? ` · 空间 ${status.profileId.slice(0, 8)}` : ""}
          </p>
        )}
        <div className="form-col">
          <input
            type="password"
            placeholder="当前主密码"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
          />
          <input
            type="password"
            placeholder="新主密码（至少 8 位）"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <div className="form-row">
            <button className="btn" disabled={busy} onClick={changePassword}>
              修改主密码
            </button>
            <button className="btn btn-ghost danger" disabled={busy} onClick={logout}>
              登出
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3 style={{ marginBottom: "0.5rem" }}>加密 Git 同步</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          通过 GitHub / Gitee 私有仓以 HTTPS+PAT 推拉 AES 加密快照（桌面与 Android
          同一路径，无需系统 git）。AtomGit 暂未接入。可配置多个远端；多个时需选择默认远端。
          PAT 需具备仓库读写权限（GitHub：`repo`；Gitee：私有仓读写）。
          Gitee 空仓默认分支常为 master，请把下方「分支」改成与网页一致，否则仓库首页可能看起来是空的。
        </p>

        {remotes.length > 0 && (
          <div className="remote-list">
            {multi && syncBlocked && (
              <p className="settings-banner settings-banner--info" role="status">
                已配置多个远端，请选择默认访问远端后再拉取 / 推送。
              </p>
            )}
            {remotes.map((r) => (
              <div
                key={r.id}
                className={`remote-item${r.isDefault ? " remote-item--default" : ""}${
                  editingId === r.id ? " remote-item--editing" : ""
                }`}
              >
                <div className="remote-item__main">
                  <div className="remote-item__title">
                    <span className="remote-item__name">{r.displayLabel}</span>
                    {r.isDefault && <span className="remote-badge">默认</span>}
                    {!r.hasPat && <span className="remote-badge remote-badge--warn">无 PAT</span>}
                  </div>
                  <p className="remote-item__meta muted">
                    {providerLabel(r.provider)} · {r.branch || "main"}
                  </p>
                  <p className="remote-item__url muted" title={r.repoUrl}>
                    {r.repoUrl || "（未填写仓库 URL）"}
                  </p>
                  {r.username && (
                    <p className="remote-item__meta muted">用户 {r.username}</p>
                  )}
                </div>
                <div className="remote-item__actions">
                  {multi && !r.isDefault && (
                    <button
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => setDefault(r.id)}
                    >
                      设为默认
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => startEdit(r)}
                  >
                    查看 / 编辑
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => deleteRemote(r.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {remotes.length === 0 && (
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            尚未配置 Git 远端，请在下方添加。
          </p>
        )}

        <div className="form-col">
          <div className="form-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <label className="muted" style={{ margin: 0 }}>
              {editingId ? "编辑远端" : "添加远端"}
            </label>
            {editingId && (
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={startNew}>
                改为新增
              </button>
            )}
          </div>
          <input
            placeholder="备注名称（可选）"
            value={config.label}
            onChange={(e) => setConfig({ ...config, label: e.target.value })}
          />
          <label className="muted">平台</label>
          <Select
            ariaLabel="平台"
            value={config.provider}
            options={[
              { value: "github", label: "GitHub" },
              { value: "gitee", label: "Gitee" },
              { value: "atomgit", label: "AtomGit" },
            ]}
            onChange={(provider) => setConfig({ ...config, provider })}
          />
          <input
            placeholder="仓库 HTTPS URL"
            value={config.repoUrl}
            onChange={(e) => setConfig({ ...config, repoUrl: e.target.value })}
          />
          <input
            placeholder="用户名"
            value={config.username}
            onChange={(e) => setConfig({ ...config, username: e.target.value })}
          />
          <input
            placeholder="分支（默认 main）"
            value={config.branch}
            onChange={(e) => setConfig({ ...config, branch: e.target.value })}
          />
          <input
            type="password"
            placeholder={config.hasPat ? "PAT（留空则保留已保存令牌）" : "Personal Access Token"}
            value={pat}
            onChange={(e) => setPat(e.target.value)}
          />
          <div className="form-row" style={{ flexWrap: "wrap" }}>
            <button className="btn" disabled={busy || testing} onClick={saveSync}>
              {editingId ? "保存修改" : "添加并保存"}
            </button>
            <button className="btn btn-ghost" disabled={busy || testing} onClick={testConn}>
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || testing || syncBlocked || remotes.length === 0}
              onClick={handlePull}
            >
              立即拉取
            </button>
            <button
              className="btn"
              disabled={busy || testing || syncBlocked || remotes.length === 0}
              onClick={handlePush}
            >
              立即推送
            </button>
          </div>
          {connFeedback && (
            <p
              className={`sync-feedback sync-feedback--${connFeedback.kind}`}
              role="status"
              aria-live="polite"
            >
              {connFeedback.text}
            </p>
          )}
        </div>
        {status && (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            上次同步：{status.lastSyncAt ?? "—"}
            {status.lastRevision ? ` · ${status.lastRevision.slice(0, 8)}` : ""}
            {status.lastContentHash ? ` · hash ${status.lastContentHash.slice(0, 12)}` : ""}
            {status.defaultRemoteId && remotes.length > 0
              ? ` · 默认 ${
                  remotes.find((r) => r.id === status.defaultRemoteId)?.displayLabel ?? "—"
                }`
              : ""}
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3 style={{ marginBottom: "0.5rem" }}>跨设备 Git 配置</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          {mobile
            ? "在电脑设置里「复制加密配置」或导出 .posgit，发到手机粘贴后填同一传输密码导入。步骤见 docs/git-config-transfer.md。"
            : "先「立即推送」数据，再设传输密码 →「复制加密配置」或「导出到文件」。完整步骤：docs/git-config-transfer.md。"}
        </p>
        <div className="form-col">
          <input
            type="password"
            placeholder="传输密码"
            value={gitTransferPw}
            onChange={(e) => setGitTransferPw(e.target.value)}
            autoComplete="new-password"
          />
          <textarea
            className="unlock-input"
            rows={mobile ? 5 : 3}
            placeholder={
              mobile
                ? "粘贴电脑导出的加密配置 JSON…"
                : "导出后会出现在此；也可粘贴他人发来的配置再导入"
            }
            value={gitBundleText}
            onChange={(e) => setGitBundleText(e.target.value)}
            data-no-tab-swipe
          />
          {!mobile && (
            <input
              placeholder="可选：文件路径，例如 C:\\Users\\you\\git-sync.posgit"
              value={gitBundlePath}
              onChange={(e) => setGitBundlePath(e.target.value)}
            />
          )}
          <div className="form-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            {!mobile && (
              <>
                <button className="btn" disabled={busy} onClick={copyGitConfig}>
                  复制加密配置
                </button>
                <button className="btn btn-ghost" disabled={busy} onClick={exportGitConfig}>
                  导出到文件
                </button>
              </>
            )}
            <button className="btn" disabled={busy} onClick={importGitConfig}>
              {mobile ? "导入配置" : "导入"}
            </button>
          </div>
        </div>
      </div>

      {conflict?.conflict && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h3>选择提交以解决冲突</h3>
          <p className="muted">{conflict.conflict.message}</p>
          <ul className="commit-list">
            {conflict.conflict.commits.map((c) => (
              <li key={c.id}>
                <button className="btn commit-pick" disabled={busy} onClick={() => resolveCommit(c)}>
                  <strong>{c.shortId}</strong>
                  <span>{c.summary}</span>
                  <span className="muted">
                    {c.author} · {c.time}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3 style={{ marginBottom: "0.5rem" }}>数据备份</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          本地导出 / 导入 SQLite 数据库与 Markdown 知识库（ZIP）。导入会覆盖当前档案数据，请先自行备份。
        </p>
        <div className="form-row" style={{ marginBottom: "0.5rem" }}>
          <input
            placeholder="导出路径，例如 C:\Users\you\backup.zip"
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={exportData}>
            导出
          </button>
        </div>
        <div className="form-row">
          <input
            placeholder="导入路径，例如 C:\Users\you\backup.zip"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-ghost" onClick={importData}>
            导入
          </button>
        </div>
      </div>
    </div>
  );
}
