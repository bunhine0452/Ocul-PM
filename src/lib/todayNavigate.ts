/**
 * `todayNavigate` — single contract Overview widgets use to jump into the
 * Today screen. Encodes three target shapes (workday focus, specific entry
 * focus, or filter-only) so callers don't reach into the workspace store
 * directly.
 *
 * Implementation note (W5-PR5): the agent filter target (`{ kind: "filter",
 * filter: { agents: ... } }`) is wired by W5-PR6 — until then it's a
 * no-op-with-warning. The `workday` / `workday-entry` paths work today.
 */

import type { Difficulty } from "@/lib/bindings";

export type TodayNavTarget =
  | { kind: "workday"; workday: string }
  | { kind: "workday-entry"; workday: string; relativePath: string }
  | {
      kind: "filter";
      filter: {
        difficulties?: ReadonlyArray<Difficulty>;
        agents?: ReadonlyArray<string>;
      };
    };

/** Global bus for handing off a one-shot nav intent to TodayScreen. Set by a
 *  caller (Overview widget click), read+cleared by TodayScreen on mount.
 *  This avoids a zustand store dependency just for one cross-screen handoff.
 */
let pendingTarget: TodayNavTarget | null = null;
const subscribers = new Set<() => void>();

export function navigateToToday(target: TodayNavTarget): void {
  pendingTarget = target;
  // Notify subscribers (typically TodayScreen mount listeners) so they can
  // pull the intent on the next render tick.
  for (const s of subscribers) s();
  // The actual route change (showing TodayScreen) is the caller's
  // responsibility — they pass an `onNavigate` callback or use the existing
  // workspace tab state. The bus only transports the *intent*.
}

/** TodayScreen reads + clears in one shot. Returns the most-recent intent
 *  pushed since the last clear. */
export function consumePendingNavTarget(): TodayNavTarget | null {
  const t = pendingTarget;
  pendingTarget = null;
  return t;
}

/** Subscribe to nav-intent pushes — useful if TodayScreen is already mounted
 *  and needs to react. Returns an unsubscribe function. */
export function subscribeNavTarget(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
