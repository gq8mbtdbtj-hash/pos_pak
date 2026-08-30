import { useMemo } from "react";
import Select from "./Select";
import { isMobile } from "../lib/platform";

type Props = {
  label: string;
  value: string;
  onChange: (isoDate: string) => void;
  ariaLabel: string;
};

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function parseParts(iso: string): { y: string; m: string; d: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return { y: "", m: "", d: "" };
  return { y: m[1], m: m[2], d: m[3] };
}

function compose(y: string, m: string, d: string): string {
  if (!y || !m || !d) return "";
  const yi = Number(y);
  const mi = Number(m);
  const di = Number(d);
  if (!Number.isFinite(yi) || !Number.isFinite(mi) || !Number.isFinite(di)) return "";
  const maxD = daysInMonth(yi, mi);
  const day = Math.min(di, maxD);
  return `${y}-${m}-${String(day).padStart(2, "0")}`;
}

/** Dock date field: native date on desktop; year/month/day picks on mobile (year is reachable). */
export default function DockDateField({ label, value, onChange, ariaLabel }: Props) {
  const mobile = useMemo(() => isMobile(), []);
  const parts = parseParts(value);
  const nowY = new Date().getFullYear();

  const yearOptions = useMemo(() => {
    const opts = [{ value: "", label: "年" }];
    for (let y = nowY - 1; y <= nowY + 10; y++) {
      opts.push({ value: String(y), label: `${y}年` });
    }
    return opts;
  }, [nowY]);

  const monthOptions = useMemo(
    () => [
      { value: "", label: "月" },
      ...Array.from({ length: 12 }, (_, i) => {
        const v = String(i + 1).padStart(2, "0");
        return { value: v, label: `${i + 1}月` };
      }),
    ],
    [],
  );

  const dayOptions = useMemo(() => {
    const opts = [{ value: "", label: "日" }];
    const y = Number(parts.y) || nowY;
    const m = Number(parts.m) || 1;
    const max = parts.y && parts.m ? daysInMonth(y, m) : 31;
    for (let d = 1; d <= max; d++) {
      opts.push({ value: String(d).padStart(2, "0"), label: `${d}日` });
    }
    return opts;
  }, [parts.y, parts.m, nowY]);

  if (!mobile) {
    return (
      <label className="dock-date-field">
        <span>{label}</span>
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel}
          data-no-tab-swipe
        />
      </label>
    );
  }

  const setPart = (next: { y?: string; m?: string; d?: string }) => {
    const y = next.y !== undefined ? next.y : parts.y;
    const m = next.m !== undefined ? next.m : parts.m;
    let d = next.d !== undefined ? next.d : parts.d;
    if (y && m && d) {
      const max = daysInMonth(Number(y), Number(m));
      if (Number(d) > max) d = String(max).padStart(2, "0");
    }
    onChange(compose(y, m, d));
  };

  return (
    <div className="dock-date-field dock-date-field--parts" role="group" aria-label={ariaLabel}>
      <span>{label}</span>
      <div className="dock-date-parts">
        <Select
          size="sm"
          value={parts.y}
          options={yearOptions}
          onChange={(y) => setPart({ y })}
          ariaLabel={`${ariaLabel} 年`}
          placeholder="年"
          noTabSwipe
          className="dock-date-parts__y"
        />
        <Select
          size="sm"
          value={parts.m}
          options={monthOptions}
          onChange={(m) => setPart({ m })}
          ariaLabel={`${ariaLabel} 月`}
          placeholder="月"
          noTabSwipe
          className="dock-date-parts__m"
        />
        <Select
          size="sm"
          value={parts.d}
          options={dayOptions}
          onChange={(d) => setPart({ d })}
          ariaLabel={`${ariaLabel} 日`}
          placeholder="日"
          noTabSwipe
          className="dock-date-parts__d"
        />
      </div>
    </div>
  );
}
