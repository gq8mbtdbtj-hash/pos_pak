import { useState } from "react";
import { api, SearchResult } from "../services/api";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    const r = await api.search(query);
    setResults(r);
    setSearched(true);
  };

  const typeLabel = (t: string) => {
    const map: Record<string, string> = {
      task: "任务",
      habit: "习惯",
      transaction: "记账",
      quick_note: "快记",
      knowledge: "知识",
    };
    return map[t] || t;
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Search</p>
          <h2 className="page-title">搜索</h2>
        </div>
      </header>
      <div className="search-bar">
        <input
          className="search-box"
          placeholder="搜索任务、记账、知识、快记……"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="btn" onClick={search}>
          搜索
        </button>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        {searched && results.length === 0 && <p className="empty-state">无结果</p>}
        {results.map((r) => (
          <div key={`${r.sourceType}-${r.id}`} className="search-result">
            <span className="type-badge">{typeLabel(r.sourceType)}</span>
            <strong>{r.title}</strong>
            <div
              className="muted"
              dangerouslySetInnerHTML={{ __html: r.snippet }}
              style={{ marginTop: "0.25rem" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
