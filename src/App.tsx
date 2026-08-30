import { useEffect, useMemo, useState } from "react";
import "./App.css";
import TitleBar from "./components/TitleBar";
import UnlockGate from "./components/UnlockGate";
import DebtReminderPopups from "./components/DebtReminderPopups";
import SyncFabs from "./components/SyncFabs";
import UpdatePopup from "./components/UpdatePopup";
import { ToastHost } from "./components/Toast";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Habits from "./pages/Habits";
import Finance from "./pages/Finance";
import Debts from "./pages/Debts";
import Knowledge from "./pages/Knowledge";
import Settings from "./pages/Settings";
import type { VaultStatus } from "./services/api";
import { isMobile } from "./lib/platform";
import { refreshLocalReminders } from "./lib/reminders";
import { useTabSwipe } from "./lib/useTabSwipe";
import { checkForAppUpdate, type UpdateInfo } from "./lib/appUpdate";

const PAGES = [
  { id: "dashboard", label: "首页", mobile: true },
  { id: "tasks", label: "任务", mobile: true },
  { id: "habits", label: "养成", mobile: true },
  { id: "finance", label: "记账", mobile: true },
  { id: "knowledge", label: "知识库", mobile: true },
  { id: "settings", label: "设置", mobile: true },
] as const;

type NavPageId = (typeof PAGES)[number]["id"];
/** 外债挂在记账下，不进主导航 */
type PageId = NavPageId | "debts";

function dismissKey(version: string) {
  return `update-prompt-dismissed:${version}`;
}

function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [unlocked, setUnlocked] = useState(false);
  const [, setVaultStatus] = useState<VaultStatus | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const mobile = useMemo(() => isMobile(), []);

  const navPages = useMemo(
    () => (mobile ? PAGES.filter((p) => p.mobile) : [...PAGES]),
    [mobile],
  );

  const mobileTabIds = useMemo(
    () => navPages.map((p) => p.id) as NavPageId[],
    [navPages],
  );

  const navActive = page === "debts" ? "finance" : page;

  const tabSwipe = useTabSwipe({
    enabled: mobile && unlocked,
    tabs: mobileTabIds,
    active: navActive,
    onChange: setPage,
  });

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await checkForAppUpdate();
        if (cancelled || !info) return;
        try {
          if (sessionStorage.getItem(dismissKey(info.latestVersion)) === "1") {
            return;
          }
        } catch {
          /* ignore */
        }
        setUpdateInfo(info);
      } catch {
        /* offline / no release yet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard onNavigate={setPage} />;
      case "tasks":
        return <Tasks />;
      case "habits":
        return <Habits />;
      case "finance":
        return <Finance onNavigate={setPage} />;
      case "debts":
        return <Debts onNavigate={setPage} />;
      case "knowledge":
        return <Knowledge />;
      case "settings":
        return (
          <Settings
            onLocked={() => {
              setUnlocked(false);
              setVaultStatus(null);
            }}
            onShowUpdate={(info) => setUpdateInfo(info)}
          />
        );
    }
  };

  return (
    <div className={`app ${mobile ? "app--mobile" : "app--desktop"}`}>
      {!mobile && <TitleBar />}
      {!unlocked ? (
        <UnlockGate
          onUnlocked={(s) => {
            setVaultStatus(s);
            setUnlocked(true);
            void refreshLocalReminders();
          }}
        />
      ) : (
        <div className="app-body">
          {!mobile && (
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
                    className={navActive === p.id ? "active" : ""}
                    onClick={() => setPage(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </nav>
            </aside>
          )}
          <main
            className={`main main--framed${
              ["dashboard", "tasks", "habits", "finance", "knowledge"].includes(page)
                ? " main--dock"
                : ""
            }`}
            {...(mobile ? tabSwipe : {})}
          >
            <div key={page} className="page-host">
              {renderPage()}
            </div>
          </main>
          {mobile && (
            <nav className="bottom-nav" aria-label="主导航">
              {navPages.map((p) => {
                const active = navActive === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={active ? "active" : ""}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setPage(p.id)}
                  >
                    {p.label}
                  </button>
                );
              })}
            </nav>
          )}
          <DebtReminderPopups enabled={unlocked} />
          {updateInfo ? (
            <UpdatePopup
              info={updateInfo}
              onDismiss={() => {
                try {
                  sessionStorage.setItem(dismissKey(updateInfo.latestVersion), "1");
                } catch {
                  /* ignore */
                }
                setUpdateInfo(null);
              }}
            />
          ) : null}
          <SyncFabs
            enabled={unlocked}
            dockLift={["dashboard", "tasks", "habits", "finance", "knowledge"].includes(page)}
          />
        </div>
      )}
      <ToastHost />
    </div>
  );
}

export default App;
