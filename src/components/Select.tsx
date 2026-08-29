import { useEffect, useId, useRef, useState } from "react";

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  /** sm: dock / compact fields; md: forms */
  size?: "sm" | "md";
  disabled?: boolean;
  placeholder?: string;
  noTabSwipe?: boolean;
};

/** Pick-only dropdown — no keyboard typing / custom values. */
export default function Select({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
  size = "md",
  disabled = false,
  placeholder = "请选择",
  noTabSwipe = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setDropUp(rect.bottom > window.innerHeight - 240);
    }
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

  const selected = options.find((o) => o.value === value);
  const display = selected?.label ?? (value || placeholder);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`ui-select ui-select--${size}${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      data-no-tab-swipe={noTabSwipe || undefined}
    >
      <button
        type="button"
        className="ui-select__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className={`ui-select__value${!selected && !value ? " is-placeholder" : ""}`}>
          {display}
        </span>
        <span className="ui-select__chevron" aria-hidden />
      </button>

      {open && (
        <div
          className={`ui-select__menu${dropUp ? " ui-select__menu--up" : ""}`}
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
        >
          <div className="ui-select__options">
            {options.length === 0 ? (
              <p className="ui-select__empty muted">暂无可选项</p>
            ) : (
              options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`ui-select__option${o.value === value ? " is-active" : ""}`}
                  onClick={() => pick(o.value)}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
