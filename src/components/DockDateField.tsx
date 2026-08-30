import { useEffect, useId, useMemo, useRef, useState } from "react";

type Props = {
  label: string;
  value: string;
  onChange: (isoDate: string) => void;
  ariaLabel: string;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toIso(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function formatDisplay(iso: string) {
  const p = parseIso(iso);
  if (!p) return "";
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function startWeekday(y: number, m: number) {
  return new Date(y, m - 1, 1).getDay();
}

/** Unified calendar date field — same UX on desktop and mobile. */
export default function DockDateField({ label, value, onChange, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"day" | "year">("day");
  const today = useMemo(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
  }, []);
  const selected = parseIso(value);
  const [viewY, setViewY] = useState(selected?.y ?? today.y);
  const [viewM, setViewM] = useState(selected?.m ?? today.m);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    if (selected) {
      setViewY(selected.y);
      setViewM(selected.m);
    }
    setMode("day");
  }, [open, selected?.y, selected?.m]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = today.y - 2; y <= today.y + 12; y++) years.push(y);
    return years;
  }, [today.y]);

  const cells = useMemo(() => {
    const lead = startWeekday(viewY, viewM);
    const total = daysInMonth(viewY, viewM);
    const out: Array<{ day: number; iso: string } | null> = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= total; d++) {
      out.push({ day: d, iso: toIso(viewY, viewM, d) });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [viewY, viewM]);

  const display = formatDisplay(value) || "选择日期";
  const hasValue = Boolean(selected);

  const shiftMonth = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewY(y);
    setViewM(m);
  };

  const pickDay = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`dock-date-field dock-date-field--picker${open ? " is-open" : ""}`}
      data-no-tab-swipe
    >
      <span className="dock-date-field__label">{label}</span>
      <button
        type="button"
        className={`dock-date-field__trigger${!hasValue ? " is-placeholder" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {display}
      </button>

      {open && (
        <div className="dock-date-panel" id={panelId} role="dialog" aria-label={ariaLabel}>
          {mode === "day" ? (
            <>
              <div className="dock-date-panel__head">
                <button
                  type="button"
                  className="dock-date-panel__nav"
                  aria-label="上个月"
                  onClick={() => shiftMonth(-1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="dock-date-panel__title"
                  onClick={() => setMode("year")}
                >
                  {viewY}年{viewM}月
                </button>
                <button
                  type="button"
                  className="dock-date-panel__nav"
                  aria-label="下个月"
                  onClick={() => shiftMonth(1)}
                >
                  ›
                </button>
              </div>
              <div className="dock-date-panel__weekdays">
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="dock-date-panel__grid">
                {cells.map((cell, i) =>
                  cell ? (
                    <button
                      key={cell.iso}
                      type="button"
                      className={[
                        "dock-date-panel__day",
                        selected &&
                        selected.y === viewY &&
                        selected.m === viewM &&
                        selected.d === cell.day
                          ? " is-selected"
                          : "",
                        today.y === viewY && today.m === viewM && today.d === cell.day
                          ? " is-today"
                          : "",
                      ].join("")}
                      onClick={() => pickDay(cell.iso)}
                    >
                      {cell.day}
                    </button>
                  ) : (
                    <span key={`e-${i}`} className="dock-date-panel__day is-empty" />
                  ),
                )}
              </div>
            </>
          ) : (
            <>
              <div className="dock-date-panel__head">
                <span className="dock-date-panel__title dock-date-panel__title--static">选择年份</span>
                <button
                  type="button"
                  className="dock-date-panel__link"
                  onClick={() => setMode("day")}
                >
                  返回
                </button>
              </div>
              <div className="dock-date-panel__years">
                {yearOptions.map((y) => (
                  <button
                    key={y}
                    type="button"
                    className={`dock-date-panel__year${y === viewY ? " is-selected" : ""}`}
                    onClick={() => {
                      setViewY(y);
                      setMode("day");
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="dock-date-panel__foot">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              清除
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => pickDay(toIso(today.y, today.m, today.d))}
            >
              今天
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
