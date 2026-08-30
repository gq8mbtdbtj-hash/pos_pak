const WEB_VERSION = "0.1.2";

/** Pure-web header shown on the desktop layout (no window chrome). */
export default function TitleBar() {
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-mark" aria-hidden />
        <span className="titlebar-name">Personal OS</span>
        <span className="titlebar-version">v{WEB_VERSION}</span>
      </div>
    </header>
  );
}
