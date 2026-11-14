/**
 * Minimal toast store + dispatcher — backs the W4-PR8 event-to-toast layer.
 *
 * Why hand-rolled instead of `sonner`: we'd otherwise pull a new dep just to
 * render 1-2 lines of text on a corner. The store is module-scoped, uses
 * `useSyncExternalStore` so React 18 renders stay consistent, and only the
 * `<Toaster />` mounted in `App.tsx` subscribes. Anyone else calls `toast.*`.
 *
 * Dedup (11-15 — 접기): 같은 `dedupKey` 의 토스트가 **떠 있으면** 새로 띄우지 않고 그 토스트의 글을
 * 바꾸고 수를 하나 올린다(「읽음 5 · 되돌리기」). 예전엔 버리기만 해서, 떠 있는 동안 온 소식이 사라지거나
 * (경고) 열쇠가 없는 자리에서는 같은 토스트가 다섯 장 쌓였다(읽음 다섯 번). 이미 닫힌 뒤
 * `dedupWindowMs`(기본 30초) 안에 다시 온 것은 예전처럼 버린다 — 사람이 방금 치운 것을 되살리지 않는다
 * (`integrity_warning` · `agent_drift` 가 그 창에 기댄다).
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
  /**
   * Auto-dismiss after this many ms. 0 = 사용자가 닫을 때까지 남는다.
   * 기본값은 5000(info) / 8000(warning) / 10000(destructive) 이고,
   * **액션이 달렸으면 최소 15초** 다 (아래 ACTION_MIN_MS).
   */
  durationMs?: number;
  /** 같은 열쇠로 접힌 수 — 1 이면 접힌 것이 없다(영수증 규칙 5: 접힌 것은 숫자로). */
  count: number;
  /** 접기 열쇠 (`dedupKey`). */
  key?: string;
}

export interface ToastOpts extends Omit<Toast, "id" | "count" | "key"> {
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

/**
 * 자동 닫힘 타이머 — 토스트별로 남은 시간을 들고 있다.
 *
 * `setTimeout` 하나로는 **멈출 수가 없다**. 읽으려고 마우스를 올려도 시계가
 * 계속 가서, 액션 버튼을 누르려는 순간 토스트가 사라지는 일이 생긴다.
 */
type Timer = { remaining: number; startedAt: number; handle: ReturnType<typeof setTimeout> | null };
const timers = new Map<number, Timer>();

function arm(id: number, timer: Timer) {
  timer.startedAt = Date.now();
  timer.handle = setTimeout(() => dismissToast(id), timer.remaining);
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** 호버·포커스 동안 시계를 멈춘다. 이미 멈췄으면 아무것도 하지 않는다. */
export function pauseToast(id: number) {
  const timer = timers.get(id);
  if (!timer?.handle) return;
  clearTimeout(timer.handle);
  timer.handle = null;
  timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
}

/** 멈춘 시계를 남은 시간부터 다시 돌린다. */
export function resumeToast(id: number) {
  const timer = timers.get(id);
  if (!timer || timer.handle) return;
  arm(id, timer);
}

/**
 * 액션이 달린 토스트의 하한 (2026-09-09).
 *
 * `useFileOps` 의 파일 옮기기 [되돌리기] 가 durationMs 를 안 줘서 info 기본값
 * 5초에 걸려 있었다. 그 토스트가 되돌리기의 **유일한** 경로였다 — `undoMoves`
 * 호출부는 코드베이스 전체에서 그 한 줄뿐이고 메뉴도 ⌘Z 도 없다. 드래그로
 * 잘못 옮긴 걸 알아채는 데 5초는 짧다.
 *
 * 그래서 기본값에 기대는 것을 막는 대신 **바닥을 올린다** — 호출부가 잊어도
 * 손해가 안 나게. `durationMs: 0`(고정)은 그대로 존중한다.
 */
const ACTION_MIN_MS = 15_000;

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

function durationFor(opts: ToastOpts): number {
  const hasActions = (opts.actions?.length ?? 0) > 0;
  const requested = opts.durationMs ?? (hasActions ? ACTION_MIN_MS : defaultDurationFor(opts.kind));
  // 0 은 "사용자가 닫을 때까지" 라는 뜻이므로 하한을 씌우지 않는다.
  return hasActions && requested > 0 ? Math.max(requested, ACTION_MIN_MS) : requested;
}

/** 시계를 처음부터 다시 — 접혀 들어온 소식은 방금 일어난 일이다. 0(고정)이면 시계를 걷는다. */
function rearm(id: number, durationMs: number) {
  const old = timers.get(id);
  if (old?.handle) clearTimeout(old.handle);
  timers.delete(id);
  if (durationMs <= 0) return;
  const timer: Timer = { remaining: durationMs, startedAt: 0, handle: null };
  timers.set(id, timer);
  // 읽는 중(호버 · 포커스로 멈춤)이었으면 멈춘 채로 둔다 — 떼는 순간 새 시간부터 간다.
  if (old && !old.handle) return;
  arm(id, timer);
}

function push(opts: ToastOpts): number | null {
  const key = opts.dedupKey;
  if (key) {
    const live = toasts.find((t) => t.key === key);
    if (live) {
      const durationMs = durationFor(opts);
      const folded: Toast = {
        ...live,
        kind: opts.kind,
        message: opts.message,
        title: opts.title,
        actions: opts.actions,
        durationMs,
        count: live.count + 1,
      };
      toasts = toasts.map((t) => (t.id === live.id ? folded : t));
      rearm(live.id, durationMs);
      emit();
      return live.id;
    }
    const last = recentByKey.get(key) ?? 0;
    const window = opts.dedupWindowMs ?? 30_000;
    if (Date.now() - last < window) return null;
    recentByKey.set(key, Date.now());
  }
  const id = nextId++;
  const durationMs = durationFor(opts);
  const t: Toast = {
    id,
    kind: opts.kind,
    message: opts.message,
    title: opts.title,
    actions: opts.actions,
    durationMs,
    count: 1,
    key,
  };
  toasts = [...toasts, t];
  emit();
  rearm(id, durationMs);
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
