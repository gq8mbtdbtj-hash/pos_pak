import type { ReactNode } from "react";

type Props = {
  label: string;
  message?: string;
  children: ReactNode;
  /** row: single-line capture; composer: multi-field (goals) that stacks on mobile */
  variant?: "row" | "composer";
};

/** Fixed bottom add/capture bar — same pattern as dashboard quick capture. */
export default function InputDock({
  label,
  message,
  children,
  variant = "row",
}: Props) {
  return (
    <section
      className={`dash-capture-dock${variant === "composer" ? " dash-capture-dock--composer" : ""}`}
      aria-label={label}
    >
      <div className="dash-capture-dock__inner">
        <div className="quick-capture">{children}</div>
        {message ? <p className="dash-capture-dock__msg">{message}</p> : null}
      </div>
    </section>
  );
}
