import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import InputDock from "../components/InputDock";
import Select from "../components/Select";
import { canEditKnowledge } from "../lib/platform";
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

export default function KnowledgePage() {
  const editable = canEditKnowledge();
  const [tree, setTree] = useState<KnowledgeTreeNode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<KnowledgeFile | null>(null);
  const [content, setContent] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newFolder, setNewFolder] = useState("ai");
  const [ask, setAsk] = useState("");
  const [askResults, setAskResults] = useState<SearchResult[]>([]);
  const [asked, setAsked] = useState(false);

  const loadTree = useCallback(async () => {
    setTree(await api.knowledgeTree());
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const openFile = async (path: string) => {
    setSelected(path);
    const f = await api.knowledgeRead(path);
    setFile(f);
    setContent(f.content);
  };

  const save = async () => {
    if (!editable || !selected || !file) return;
    const updated = await api.knowledgeUpdate(selected, { content });
    setFile(updated);
    setContent(updated.content);
  };

  const create = async () => {
    if (!editable || !newTitle.trim()) return;
    const f = await api.knowledgeCreate({
      folder: newFolder,
      title: newTitle,
      content: `# ${newTitle}\n\n`,
    });
    setNewTitle("");
    await loadTree();
    await openFile(f.meta.filePath);
  };

  const remove = async () => {
    if (!editable || !selected) return;
    if (!confirm("确定删除此文档？")) return;
    await api.knowledgeDelete(selected);
    setSelected(null);
    setFile(null);
    setContent("");
    loadTree();
  };

  const runAsk = async () => {
    const q = ask.trim();
    if (!q) return;
    const all = await api.search(q, 30);
    const hits = all.filter((r) => r.sourceType === "knowledge");
    setAskResults(hits);
    setAsked(true);
  };

  const previewBody = content.replace(/^---[\s\S]*?---\n/, "");

  return (
    <div className={`page page--with-dock${editable ? "" : " page-knowledge--readonly"}`}>
      <div className="page-scroll">
        <header className="page-header">
          <div>
            <p className="eyebrow">Knowledge</p>
            <h2 className="page-title">知识库</h2>
            {!editable && (
              <p className="muted hint">手机端可问答检索与阅读；新建、编辑、导入请在桌面端操作。</p>
            )}
          </div>
        </header>

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
                  <div
                    className="muted"
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
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
              <p className="empty-state">{editable ? "预览" : "选择文档阅读，或在下方提问检索"}</p>
            )}
          </div>
        </div>
      </div>

      {editable ? (
        <InputDock label="创建文档">
          <Select
            size="sm"
            ariaLabel="文件夹"
            noTabSwipe
            value={newFolder}
            options={["cpp", "graphics", "android", "linux", "ai", "work", "life", "reading"].map(
              (f) => ({ value: f, label: f }),
            )}
            onChange={setNewFolder}
          />
          <input
            placeholder="新文档标题"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            data-no-tab-swipe
          />
          <button className="btn" type="button" onClick={create}>
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
      )}
    </div>
  );
}
