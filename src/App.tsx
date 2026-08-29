import { useState } from "react";
import "./App.css";
import TitleBar from "./components/TitleBar";
import UnlockGate from "./components/UnlockGate";
import DebtReminderPopups from "./components/DebtReminderPopups";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Habits from "./pages/Habits";
import Finance from "./pages/Finance";
import Debts from "./pages/Debts";
import Knowledge from "./pages/Knowledge";
import Search from "./pages/Search";
import Settings from "./pages/Settings";
import type { VaultStatus } from "./services/api";

const PAGES = [
  { id: "dashboard", label: "首页" },
  { id: "tasks", label: "任务" },
  { id: "habits", label: "习惯" },
  { id: "finance", label: "记账" },
  { id: "debts", label: "外债" },
  { id: "knowledge", label: "知识库" },
  { id: "search", label: "搜索" },
  { id: "settings", label: "设置" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [unlocked, setUnlocked] = useState(false);
  const [, setVaultStatus] = useState<VaultStatus | null>(null);

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard onNavigate={setPage} />;
      case "tasks":
        return <Tasks />;
      case "habits":
        return <Habits />;
      case "finance":
        return <Finance />;
      case "debts":
        return <Debts />;
      case "knowledge":
        return <Knowledge />;
      case "search":
        return <Search />;
      case "settings":
        return (
          <Settings
            onLocked={() => {
              setUnlocked(false);
              setVaultStatus(null);
            }}
          />
        );
    }
  };

  return (
    <div className="app">
      <TitleBar />
      {!unlocked ? (
        <UnlockGate
          onUnlocked={(s) => {
            setVaultStatus(s);
            setUnlocked(true);
          }}
        />
      ) : (
        <div className="app-body">
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-mark" aria-hidden />
              <h1>Personal OS</h1>
              <p>Local-first life OS</p>
            </div>
            <nav>
              {PAGES.map((p) => (
                <button
                  key={p.id}
                  className={page === p.id ? "active" : ""}
                  onClick={() => setPage(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </nav>
          </aside>
          <main className="main">{renderPage()}</main>
          <DebtReminderPopups enabled={unlocked} />
        </div>
      )}
    </div>
  );
}

export default App;
