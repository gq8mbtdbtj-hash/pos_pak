import type { ReactNode } from "react";

type Props = {
  eyebrow: string;
  title: ReactNode;
  /** Extra line under title (e.g. knowledge mobile hint) */
  subtitle?: ReactNode;
  /** Right-side or stacked tools (jump buttons, segmented controls) */
  actions?: ReactNode;
  /** Stack actions under the title row (finance / habits) */
  stack?: boolean;
  className?: string;
  children: ReactNode;
  /** Bottom input dock — stays fixed like this chrome */
  dock?: ReactNode;
};

/**
 * Shared page frame: fixed top chrome (eyebrow / title / actions) + scroll body
 * + optional bottom dock. Mirrors InputDock “always reachable” pattern for back jumps.
 */
export default function PageShell({
  eyebrow,
  title,
  subtitle,
  actions,
  stack = false,
  className = "",
  children,
  dock,
}: Props) {
  return (
    <div
      className={`page page-shell${dock ? " page-shell--dock" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="page-shell__chrome">
        <header className={`page-header${stack ? " page-header--stack" : ""}`}>
          <div className="page-shell__titles">
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="page-title">{title}</h2>
            {subtitle ? <div className="page-shell__subtitle">{subtitle}</div> : null}
          </div>
          {actions ? (
            stack ? (
              <div className="page-header-tools">{actions}</div>
            ) : (
              actions
            )
          ) : null}
        </header>
      </div>
      <div className="page-shell__scroll">{children}</div>
      {dock ?? null}
    </div>
  );
}
