import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, KnowledgeFile, KnowledgeTreeNode } from "../services/api";

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
  const [tree, setTree] = useState<KnowledgeTreeNode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<KnowledgeFile | null>(null);
  const [content, setContent] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newFolder, setNewFolder] = useState("ai");

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
    if (!selected || !file) return;
    const updated = await api.knowledgeUpdate(selected, { content });
    setFile(updated);
    setContent(updated.content);
  };

  const create = async () => {
    if (!newTitle.trim()) return;
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
    if (!selected) return;
    if (!confirm("确定删除此文档？")) return;
    await api.knowledgeDelete(selected);
    setSelected(null);
    setFile(null);
    setContent("");
    loadTree();
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Knowledge</p>
          <h2 className="page-title">知识库</h2>
        </div>
      </header>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="form-row">
          <select value={newFolder} onChange={(e) => setNewFolder(e.target.value)}>
            {["cpp", "graphics", "android", "linux", "ai", "work", "life", "reading"].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            placeholder="新文档标题"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={create}>
            创建
          </button>
        </div>
      </div>

      <div className="knowledge-layout">
        <div className="tree-panel">
          {tree ? (
            <TreeNode node={tree} selected={selected} onSelect={openFile} />
          ) : (
            <p className="muted">加载中…</p>
          )}
        </div>
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
        <div className="preview-panel">
          {content ? (
            <ReactMarkdown>{content.replace(/^---[\s\S]*?---\n/, "")}</ReactMarkdown>
          ) : (
            <p className="empty-state">预览</p>
          )}
        </div>
      </div>
    </div>
  );
}
