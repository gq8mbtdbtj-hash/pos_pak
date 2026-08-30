import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import InputDock from "../components/InputDock";
import PageShell from "../components/PageShell";
import Select from "../components/Select";
import { toastErr, toastOk } from "../components/Toast";
import { canEditKnowledge, isDesktop } from "../lib/platform";
import { api, KnowledgeFile, KnowledgeTreeNode, SearchResult } from "../services/api";

function TreeNode({
  node,
  selected,
  onSelect,
  depth = 0,
}: {
  node: KnowledgeTreeNode;
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  if (node.isDir) {
    return (
      <>
        {node.path && (
          <div className="tree-item dir" style={{ paddingLeft: depth * 12 }}>
            {node.name}
          </div>
        )}
        {node.children.map((child) => (
          <TreeNode
            key={child.path || child.name}
            node={child}
            selected={selected}
            onSelect={onSelect}
            depth={depth + (node.path ? 1 : 0)}
          />
        ))}
      </>
    );
  }

  return (
    <div
      className={`tree-item ${selected === node.path ? "selected" : ""}`}
      style={{ paddingLeft: depth * 12 }}
      onClick={() => onSelect(node.path)}
    >
      {node.name}
    </div>
  );
}

function typeLabel(t: string) {
  const map: Record<string, string> = {
    task: "任务",
    habit: "习惯",
    transaction: "记账",
    quick_note: "快记",
    knowledge: "知识",
  };
  return map[t] || t;
}

export default function KnowledgePage() {
  const editable = canEditKnowledge();
  const desktop = isDesktop();
  const [tree, setTree] = useState<KnowledgeTreeNode | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<KnowledgeFile | null>(null);
  const [content, setContent] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newFolder, setNewFolder] = useState("ai");
  const [folderName, setFolderName] = useState("");
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [ask, setAsk] = useState("");
  const [askResults, setAskResults] = useState<SearchResult[]>([]);
  const [asked, setAsked] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<SearchResult[]>([]);
  const [globalSearched, setGlobalSearched] = useState(false);

  const loadTree = useCallback(async () => {
    const [t, f] = await Promise.all([api.knowledgeTree(), api.knowledgeListFolders()]);
    setTree(t);
    setFolders(f);
    setNewFolder((prev) => (f.includes(prev) ? prev : f[0] || ""));
    setRenameFrom((prev) => (f.includes(prev) ? prev : f[0] || ""));
  }, []);

  useEffect(() => {
    loadTree().catch((e) => toastErr(String(e)));
  }, [loadTree]);

  const folderOptions = useMemo(
    () => folders.map((f) => ({ value: f, label: f })),
    [folders],
  );

  const openFile = async (path: string) => {
    setSelected(path);
    const f = await api.knowledgeRead(path);
    setFile(f);
    setContent(f.content);
  };

  const save = async () => {
    if (!editable || !selected || !file) return;
    try {
      const updated = await api.knowledgeUpdate(selected, { content });
      setFile(updated);
      setContent(updated.content);
      toastOk("已保存");
    } catch (e) {
      toastErr(String(e));
    }
  };

  const create = async () => {
    if (!editable || !newTitle.trim() || !newFolder) return;
    try {
      const f = await api.knowledgeCreate({
        folder: newFolder,
        title: newTitle,
        content: `# ${newTitle}\n\n`,
      });
      setNewTitle("");
      await loadTree();
      await openFile(f.meta.filePath);
    } catch (e) {
      toastErr(String(e));
    }
  };

  const remove = async () => {
    if (!editable || !selected) return;
    if (!confirm("确定删除此文档？")) return;
    try {
      await api.knowledgeDelete(selected);
      setSelected(null);
      setFile(null);
      setContent("");
      await loadTree();
    } catch (e) {
      toastErr(String(e));
    }
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    try {
      const created = await api.knowledgeCreateFolder(name);
      setFolderName("");
      await loadTree();
      setNewFolder(created);
      setRenameFrom(created);
      toastOk(`已创建分类「${created}」`);
    } catch (e) {
      toastErr(String(e));
    }
  };

  const renameFolder = async () => {
    if (!renameFrom || !renameTo.trim()) return;
    try {
      const next = await api.knowledgeRenameFolder(renameFrom, renameTo.trim());
      setRenameTo("");
      await loadTree();
      setNewFolder(next);
      setRenameFrom(next);
      if (selected?.startsWith(`${renameFrom}/`)) {
        setSelected(null);
        setFile(null);
        setContent("");
      }
      toastOk(`已重命名为「${next}」`);
    } catch (e) {
      toastErr(String(e));
    }
  };

  const deleteFolder = async () => {
    if (!renameFrom) return;
    if (!confirm(`确定删除分类「${renameFrom}」及其下全部文档？`)) return;
    try {
      await api.knowledgeDeleteFolder(renameFrom);
      if (selected?.startsWith(`${renameFrom}/`)) {
        setSelected(null);
        setFile(null);
        setContent("");
      }
      await loadTree();
      toastOk("分类已删除");
    } catch (e) {
      toastErr(String(e));
    }
  };

  const runAsk = async () => {
    const q = ask.trim();
    if (!q) return;
    try {
      const all = await api.search(q, 30);
      const hits = all.filter((r) => r.sourceType === "knowledge");
      setAskResults(hits);
      setAsked(true);
    } catch (e) {
      toastErr(String(e));
    }
  };

  const runGlobalSearch = async () => {
    const q = globalQuery.trim();
    if (!q) return;
    try {
      setGlobalResults(await api.search(q));
      setGlobalSearched(true);
    } catch (e) {
      toastErr(String(e));
    }
  };

  const previewBody = content.replace(/^---[\s\S]*?---\n/, "");

  return (
    <PageShell
      className={editable ? "" : "page-knowledge--readonly"}
      eyebrow="Knowledge"
      title="知识库"
      subtitle={
        !editable ? (
          <p className="muted hint">
            手机可管理分类、问答检索与阅读；新建/编辑文档请在桌面端操作。
          </p>
        ) : (
          <p className="muted hint">桌面已合并全局搜索；下方可管理知识分类。</p>
        )
      }
      dock={
        editable ? (
          <InputDock label="创建文档">
            <Select
              size="sm"
              ariaLabel="文件夹"
              noTabSwipe
              value={newFolder}
              options={folderOptions}
              onChange={setNewFolder}
            />
            <input
              placeholder="新文档标题"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              data-no-tab-swipe
            />
            <button className="btn" type="button" onClick={create} disabled={!newFolder}>
              创建
            </button>
          </InputDock>
        ) : (
          <InputDock label="知识问答">
            <input
              placeholder="输入问题或关键词，检索知识库…"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runAsk()}
              data-no-tab-swipe
            />
            <button className="btn" type="button" onClick={runAsk}>
              提问
            </button>
          </InputDock>
        )
      }
    >
      {desktop && (
        <section className="panel knowledge-search-panel">
          <h3 className="section-label">全局搜索</h3>
          <div className="search-bar">
            <input
              className="search-box"
              placeholder="搜索任务、记账、知识、快记……"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runGlobalSearch()}
            />
            <button className="btn" type="button" onClick={runGlobalSearch}>
              搜索
            </button>
          </div>
          {globalSearched && globalResults.length === 0 && (
            <p className="empty-state compact">无结果</p>
          )}
          {globalResults.map((r) => (
            <button
              key={`${r.sourceType}-${r.id}`}
              type="button"
              className="search-result knowledge-ask-hit"
              onClick={() => {
                if (r.sourceType === "knowledge" && (r.reference || r.id)) {
                  void openFile(r.reference || r.id);
                }
              }}
            >
              <span className="type-badge">{typeLabel(r.sourceType)}</span>
              <strong>{r.title}</strong>
              <div className="muted" dangerouslySetInnerHTML={{ __html: r.snippet }} />
            </button>
          ))}
        </section>
      )}

      <section className="panel knowledge-folder-panel">
        <h3 className="section-label">知识分类</h3>
        <div className="knowledge-folder-row">
          <input
            placeholder="新分类名"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
          />
          <button className="btn" type="button" onClick={createFolder}>
            新建分类
          </button>
        </div>
        <div className="knowledge-folder-row">
          <Select
            size="sm"
            ariaLabel="要修改的分类"
            value={renameFrom}
            options={folderOptions}
            onChange={setRenameFrom}
          />
          <input
            placeholder="重命名为…"
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renameFolder()}
          />
          <button className="btn" type="button" onClick={renameFolder} disabled={!renameFrom}>
            重命名
          </button>
          <button
            className="btn btn-danger"
            type="button"
            onClick={deleteFolder}
            disabled={!renameFrom}
          >
            删除分类
          </button>
        </div>
      </section>

      {!editable && asked && (
        <section className="panel knowledge-ask-results">
          <h3 className="section-label">问答结果</h3>
          {askResults.length === 0 ? (
            <p className="empty-state compact">未找到相关文档</p>
          ) : (
            askResults.map((r) => (
              <button
                key={`${r.sourceType}-${r.id}`}
                type="button"
                className="search-result knowledge-ask-hit"
                onClick={() => openFile(r.reference || r.id)}
              >
                <strong>{r.title}</strong>
                <div className="muted" dangerouslySetInnerHTML={{ __html: r.snippet }} />
              </button>
            ))
          )}
        </section>
      )}

      <div className={`knowledge-layout${editable ? "" : " knowledge-layout--readonly"}`}>
        <div className="tree-panel">
          {tree ? (
            <TreeNode node={tree} selected={selected} onSelect={openFile} />
          ) : (
            <p className="muted">加载中…</p>
          )}
        </div>
        {editable && (
          <div className="editor-panel">
            {selected ? (
              <>
                <div style={{ marginBottom: "0.5rem", display: "flex", gap: "0.5rem" }}>
                  <button className="btn" onClick={save}>
                    保存
                  </button>
                  <button className="btn btn-danger" onClick={remove}>
                    删除
                  </button>
                </div>
                <textarea value={content} onChange={(e) => setContent(e.target.value)} />
              </>
            ) : (
              <p className="empty-state">选择或创建文档</p>
            )}
          </div>
        )}
        <div className="preview-panel">
          {content ? (
            <ReactMarkdown>{previewBody}</ReactMarkdown>
          ) : (
            <p className="empty-state">
              {editable ? "预览" : "选择文档阅读，或在下方提问检索"}
            </p>
          )}
        </div>
      </div>
    </PageShell>
  );
}
