/**
 * Minimal toast store + dispatcher — backs the W4-PR8 event-to-toast layer.
 *
 * Why hand-rolled instead of `sonner`: we'd otherwise pull a new dep just to
 * render 1-2 lines of text on a corner. The store is module-scoped, uses
 * `useSyncExternalStore` so React 18 renders stay consistent, and only the
 * `<Toaster />` mounted in `App.tsx` subscribes. Anyone else calls `toast.*`.
 *
 * Dedup: callers can pass `dedupKey` + `dedupWindowMs` to drop repeats of the
 * same key inside the window (used by `integrity_warning` and `agent_drift`
 * so a single bad file doesn't spam 30 toasts).
 *
 * Cooldown: `agent_drift` also uses sessionStorage for the [무시] action
 * — see `DriftCooldown` below.
 */

export type ToastKind = "info" | "warning" | "destructive";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional headline above `message`. */
  title?: string;
  actions?: ToastAction[];
  /** Auto-dismiss after this many ms. Default 5000 (info) / 8000 (warning) / 10000 (destructive). */
  durationMs?: number;
}

export interface ToastOpts extends Omit<Toast, "id"> {
  dedupKey?: string;
  dedupWindowMs?: number;
}

let nextId = 1;
let toasts: Toast[] = [];
const subscribers = new Set<() => void>();
const recentByKey = new Map<string, number>();

function emit() {
  for (const fn of subscribers) fn();
}

export function subscribeToasts(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function defaultDurationFor(kind: ToastKind): number {
  switch (kind) {
    case "info":
      return 5_000;
    case "warning":
      return 8_000;
    case "destructive":
      return 10_000;
  }
}

function push(opts: Omit<Toast, "id"> & { dedupKey?: string; dedupWindowMs?: number }): number | null {
  if (opts.dedupKey) {
    const last = recentByKey.get(opts.dedupKey) ?? 0;
    const window = opts.dedupWindowMs ?? 30_000;
    if (Date.now() - last < window) return null;
    recentByKey.set(opts.dedupKey, Date.now());
  }
  const id = nextId++;
  const t: Toast = {
    id,
    kind: opts.kind,
    message: opts.message,
    title: opts.title,
    actions: opts.actions,
    durationMs: opts.durationMs ?? defaultDurationFor(opts.kind),
  };
  toasts = [...toasts, t];
  emit();
  if (t.durationMs && t.durationMs > 0) {
    setTimeout(() => dismissToast(id), t.durationMs);
  }
  return id;
}

export const toast = {
  info: (message: string, opts: Partial<ToastOpts> = {}) =>
    push({ ...opts, message, kind: "info" }),
  warning: (message: string, opts: Partial<ToastOpts> = {}) =>
    push({ ...opts, message, kind: "warning" }),
  destructive: (message: string, opts: Partial<ToastOpts> = {}) =>
    push({ ...opts, message, kind: "destructive" }),
};

// ─────────────────────────────────────────────────────────────────────────────
// W4-PR4 — drift "무시" 5분 쿨다운 (sessionStorage)
// ─────────────────────────────────────────────────────────────────────────────

const DRIFT_COOLDOWN_MS = 5 * 60_000;

// 프로젝트별로 가른다 (2026-09-01) — `agentId` 는 어느 프로젝트에서나
// `claude-code` 라, 키에 프로젝트가 없으면 A 에서 「무시」를 누른 순간 B 의
// 드리프트 경고까지 5분간 잠긴다 (크롬식 탭은 창 하나에 프로젝트 여럿).
function driftCooldownKey(projectId: number, agentId: string) {
  return `oculpm.drift.dismissed.p${projectId}.${agentId}`;
}

export const DriftCooldown = {
  isDismissed(projectId: number, agentId: string): boolean {
    try {
      const raw = sessionStorage.getItem(driftCooldownKey(projectId, agentId));
      if (!raw) return false;
      const at = Number(raw);
      if (!Number.isFinite(at)) return false;
      return Date.now() - at < DRIFT_COOLDOWN_MS;
    } catch {
      return false;
    }
  },
  dismiss(projectId: number, agentId: string) {
    try {
      sessionStorage.setItem(driftCooldownKey(projectId, agentId), String(Date.now()));
    } catch {
      // private mode / quota — silently degrade.
    }
  },
  clear(projectId: number, agentId: string) {
    try {
      sessionStorage.removeItem(driftCooldownKey(projectId, agentId));
    } catch {
      // ignore
    }
  },
};
