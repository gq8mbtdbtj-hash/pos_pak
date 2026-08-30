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
import PageShell from "../components/PageShell";
import { showToast, type ToastKind } from "../components/Toast";

type Props = {
  onLocked?: () => void;
};

type Feedback = { kind: ToastKind; text: string };
type Panel = "home" | "login" | "remote" | "configSync" | "backup";

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
  const [panel, setPanel] = useState<Panel>("home");
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
    if (!mobile && !outputPath) {
      setOutputPath("C:\\Users\\ikjm\\Desktop\\personal-os-backup.zip");
    }
  }, [mobile, outputPath]);

  useEffect(() => {
    refresh().catch((e) => showToast("err", errText(e)));
  }, []);

  const flash = (kind: ToastKind, text: string) => {
    showToast(kind, text);
  };

  const goHome = () => setPanel("home");

  const startNew = () => {
    setEditingId(null);
    setConfig(emptyForm());
    setPat("");
    setConnFeedback(null);
    setPanel("remote");
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
    setPanel("remote");
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
      setPanel("home");
    } else if (result.syncNote) {
      flash("info", result.syncNote);
    } else if (result.sync) {
      flash(
        "ok",
        `配置已导入并同步（${result.sync.status}${
          result.sync.contentHash
            ? ` · ${result.sync.contentHash.slice(0, 12)}`
            : ""
        }）`,
      );
    } else {
      flash("ok", "配置已导入");
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
        flash("ok", "已复制加密配置到剪贴板");
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
      flash("ok", `已导出到 ${gitBundlePath.trim()}`);
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
      flash("err", "请粘贴配置文本" + (mobile ? "" : "或填写文件路径"));
      return;
    }
    if (!window.confirm("导入将覆盖当前档案的 Git 远程配置（含 PAT）。是否继续？")) {
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
        if (updated) {
          setEditingId(updated.id);
          setConfig({
            id: updated.id,
            label: updated.label,
            provider: updated.provider,
            repoUrl: updated.repoUrl,
            username: updated.username,
            branch: updated.branch,
            hasPat: updated.hasPat,
          });
        }
      } else {
        const created = view.remotes[view.remotes.length - 1];
        if (created) {
          setEditingId(created.id);
          setConfig({
            id: created.id,
            label: created.label,
            provider: created.provider,
            repoUrl: created.repoUrl,
            username: created.username,
            branch: created.branch,
            hasPat: created.hasPat,
          });
        }
      }
      flash("ok", "远端配置已保存");
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
      if (editingId === id) {
        setEditingId(null);
        setConfig(emptyForm());
        setPanel("home");
      }
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
      flash("ok", "已设为默认");
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
      flash("ok", "登录码已更新");
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

  const panelTitle =
    panel === "login"
      ? "登录码"
      : panel === "remote"
        ? editingId
          ? "编辑配置"
          : "配置新建"
        : panel === "configSync"
          ? "配置同步"
          : panel === "backup"
            ? "备份"
            : "设置";

  return (
    <PageShell
      className="page-settings"
      eyebrow="Settings"
      title={panelTitle}
      actions={
        panel !== "home" ? (
          <div className="segmented segmented--jump" role="group" aria-label="返回设置">
            <button type="button" onClick={goHome}>
              设置
            </button>
          </div>
        ) : undefined
      }
    >
      {panel === "home" && (
        <>
          <section className="settings-group">
            <p className="settings-group__label">Git 配置</p>
            <div className="settings-group__card">
              {remotes.length === 0 ? (
                <p className="settings-empty muted">尚未添加远端，请到「配置新建」添加。</p>
              ) : (
                <>
                  {multi && syncBlocked && (
                    <p className="settings-banner settings-banner--info" role="status">
                      多个远端时请选择一个作为默认后再拉取 / 推送。
                    </p>
                  )}
                  <ul className="settings-remote-list" role="listbox" aria-label="Git 远端">
                    {remotes.map((r) => (
                      <li key={r.id} className="settings-remote-row">
                        <label className="settings-remote-pick">
                          <input
                            type="radio"
                            name="default-remote"
                            checked={r.isDefault}
                            disabled={busy || (!multi && r.isDefault)}
                            onChange={() => {
                              if (!r.isDefault) void setDefault(r.id);
                            }}
                          />
                          <span className="settings-remote-pick__body">
                            <span className="settings-remote-pick__title">
                              {r.displayLabel}
                              {r.isDefault && <span className="remote-badge">默认</span>}
                              {!r.hasPat && (
                                <span className="remote-badge remote-badge--warn">无 PAT</span>
                              )}
                            </span>
                            <span className="muted settings-remote-pick__meta">
                              {providerLabel(r.provider)} · {r.branch || "main"}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="settings-remote-edit"
                          disabled={busy}
                          onClick={() => startEdit(r)}
                        >
                          编辑
                        </button>
                      </li>
                    ))}
                  </ul>
                  {status && (
                    <p className="muted settings-sync-meta">
                      上次同步：{status.lastSyncAt ?? "—"}
                      {status.lastRevision ? ` · ${status.lastRevision.slice(0, 8)}` : ""}
                      。需要同步时用「拉 / 推」图标（可左右拖动换边）。
                    </p>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="settings-group">
            <p className="settings-group__label">功能</p>
            <div className="settings-group__card settings-menu">
              <button type="button" className="settings-menu__item" onClick={() => setPanel("login")}>
                <span className="settings-menu__text">
                  <strong>登录码</strong>
                  <span className="muted">修改解锁码或登出本机会话</span>
                </span>
                <span className="settings-menu__chevron" aria-hidden>
                  ›
                </span>
              </button>
              <button type="button" className="settings-menu__item" onClick={startNew}>
                <span className="settings-menu__text">
                  <strong>配置新建</strong>
                  <span className="muted">添加 GitHub / Gitee 加密同步远端</span>
                </span>
                <span className="settings-menu__chevron" aria-hidden>
                  ›
                </span>
              </button>
              <button
                type="button"
                className="settings-menu__item"
                onClick={() => setPanel("configSync")}
              >
                <span className="settings-menu__text">
                  <strong>配置同步</strong>
                  <span className="muted">跨设备导出 / 导入 Git 配置</span>
                </span>
                <span className="settings-menu__chevron" aria-hidden>
                  ›
                </span>
              </button>
              <button type="button" className="settings-menu__item" onClick={() => setPanel("backup")}>
                <span className="settings-menu__text">
                  <strong>备份</strong>
                  <span className="muted">本地数据包导出与导入</span>
                </span>
                <span className="settings-menu__chevron" aria-hidden>
                  ›
                </span>
              </button>
            </div>
          </section>
        </>
      )}

      {panel === "login" && (
        <section className="settings-group">
          <div className="settings-group__card settings-detail">
            <p className="muted settings-detail__hint">
              本地数据库与同步令牌由登录码保护。不同登录码对应独立数据空间。
              解锁后会在本机保存脱敏会话，下次启动可免密；登出后需重新输入。
              关闭窗口或登出不会自动推送远端。
            </p>
            {status?.passwordMask && (
              <p className="muted">
                当前会话形如 {status.passwordMask}
                {status.profileId ? ` · 空间 ${status.profileId.slice(0, 8)}` : ""}
              </p>
            )}
            <div className="form-col">
              <input
                type="password"
                placeholder="当前登录码"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
              />
              <input
                type="password"
                placeholder="新登录码（至少 8 位）"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
              <div className="form-row">
                <button className="btn" disabled={busy} onClick={changePassword}>
                  修改登录码
                </button>
                <button className="btn btn-ghost danger" disabled={busy} onClick={logout}>
                  登出
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {panel === "remote" && (
        <section className="settings-group">
          <div className="settings-group__card settings-detail">
            <p className="muted settings-detail__hint">
              通过 GitHub / Gitee 私有仓以 HTTPS+PAT 推拉加密快照（桌面与手机同一路径）。
              AtomGit 暂未接入。Gitee 空仓默认分支常为 master，请与网页分支名保持一致。
            </p>
            <div className="form-col">
              {editingId && (
                <div className="form-row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" type="button" disabled={busy} onClick={startNew}>
                    改为新建
                  </button>
                </div>
              )}
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
                {editingId && (
                  <button
                    className="btn btn-ghost danger"
                    disabled={busy}
                    onClick={() => deleteRemote(editingId)}
                  >
                    删除
                  </button>
                )}
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
          </div>
        </section>
      )}

      {panel === "configSync" && (
        <section className="settings-group">
          <div className="settings-group__card settings-detail">
            <p className="muted settings-detail__hint">
              {mobile
                ? "在另一台设备「配置同步」里复制或导出加密配置，粘贴到下方并填同一传输密码后导入。登录码不会被导出。"
                : "建议先用左下角「推」上传数据，再设传输密码并复制/导出配置。登录码不会被导出。"}
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
                rows={mobile ? 5 : 4}
                placeholder={
                  mobile
                    ? "粘贴其它设备导出的加密配置…"
                    : "导出后会出现在此；也可粘贴后再导入"
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
                <button className="btn" disabled={busy} onClick={copyGitConfig}>
                  复制加密配置
                </button>
                {!mobile && (
                  <button className="btn btn-ghost" disabled={busy} onClick={exportGitConfig}>
                    导出到文件
                  </button>
                )}
                <button className="btn" disabled={busy} onClick={importGitConfig}>
                  导入配置
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {panel === "backup" && (
        <section className="settings-group">
          <div className="settings-group__card settings-detail">
            <p className="muted settings-detail__hint">
              {mobile
                ? "导出 / 导入本机 SQLite 与知识库（ZIP）。请填写应用可写的绝对路径；导入会覆盖当前档案，请先确认路径无误。"
                : "导出 / 导入本机 SQLite 与知识库（ZIP）。路径需为可读写的本地文件；导入会覆盖当前档案，建议先导出一份再操作。"}
            </p>
            <div className="form-col">
              <label className="muted">导出</label>
              <div className="form-row">
                <input
                  placeholder={
                    mobile
                      ? "导出路径（设备可写绝对路径）"
                      : "导出路径，例如 C:\\Users\\you\\backup.zip"
                  }
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={exportData}>
                  导出
                </button>
              </div>
              <label className="muted">导入</label>
              <div className="form-row">
                <input
                  placeholder={
                    mobile
                      ? "导入路径（ZIP 绝对路径）"
                      : "导入路径，例如 C:\\Users\\you\\backup.zip"
                  }
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
        </section>
      )}

      {conflict?.conflict && (
        <section className="settings-group">
          <p className="settings-group__label">冲突</p>
          <div className="settings-group__card settings-detail">
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
        </section>
      )}
    </PageShell>
  );
}
