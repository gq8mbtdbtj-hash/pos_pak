import { useEffect, useState } from "react";

export type ToastKind = "ok" | "err" | "info";

type ToastItem = {
  id: number;
  kind: ToastKind;
  text: string;
};

type Listener = (items: ToastItem[]) => void;

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = items.slice();
  listeners.forEach((l) => l(snapshot));
}

/** Floating toast — prefer over page banners for action feedback. */
export function showToast(kind: ToastKind, text: string, ms?: number) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const id = ++seq;
  const duration = ms ?? (kind === "err" ? 4200 : 2800);
  items = [...items.filter((t) => t.text !== trimmed), { id, kind, text: trimmed }].slice(-3);
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, duration);
}

export function toastOk(text: string) {
  showToast("ok", text);
}

export function toastErr(text: string) {
  showToast("err", text);
}

export function toastInfo(text: string) {
  showToast("info", text);
}

function useToastItems() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    setList(items.slice());
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

export function ToastHost() {
  const list = useToastItems();
  if (list.length === 0) return null;
  return (
    <div className="toast-host" aria-live="polite" aria-relevant="additions">
      {list.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role="status">
          {t.text}
        </div>
      ))}
    </div>
  );
}
