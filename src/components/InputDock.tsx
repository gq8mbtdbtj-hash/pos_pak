import type { ReactNode } from "react";

type Props = {
  label: string;
  message?: string;
  children: ReactNode;
};

/** Fixed bottom add/capture bar — same pattern as dashboard quick capture. */
export default function InputDock({ label, message, children }: Props) {
  return (
    <section className="dash-capture-dock" aria-label={label}>
      <div className="dash-capture-dock__inner">
        <div className="quick-capture">{children}</div>
        {message ? <p className="dash-capture-dock__msg">{message}</p> : null}
      </div>
    </section>
  );
}
