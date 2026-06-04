import { useEffect } from "react";
import { events } from "@/lib/bindings";

// PR-UI 8b follow-up — the watcher indexes new/changed journal files and emits
// oculpm-journal-{added,updated,path-changed}. The legacy TimelineView listened
// to these; the V2 timeline/Today did not, so an agent writing an entry didn't
// show up until a remount. This hook restores the live refresh: subscribe to the
// three events and call `onChange` (debounced) whenever one fires for this
// project. Frontend-only — no backend change.

/** Subscribe to the watcher's journal events for `projectId` and call
 *  `onChange` (250ms-debounced) on add / update / path-change. */
export function useJournalEvents(
  projectId: number | null,
  enabled: boolean,
  onChange: () => void,
): void {
  useEffect(() => {
    if (!enabled || projectId == null) return;
    let active = true;
    let timer: number | null = null;
    const schedule = () => {
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        onChange();
      }, 250);
    };
    const offs: Array<() => void> = [];
    const sub = <T extends { project_id: number }>(ev: {
      listen: (cb: (e: { payload: T }) => void) => Promise<() => void>;
    }) => {
      // Defensive: in jsdom / non-Tauri contexts the event channel is absent —
      // swallow so there's no unhandled rejection and the UI just doesn't
      // live-update (mount-time fetch still works).
      try {
        void ev
          .listen((e) => {
            if (e.payload.project_id === projectId) schedule();
          })
          .then((off) => {
            if (active) offs.push(off);
            else off();
          })
          .catch(() => {});
      } catch {
        /* event channel unavailable */
      }
    };
    sub(events.oculpmJournalAdded);
    sub(events.oculpmJournalUpdated);
    sub(events.oculpmJournalPathChanged);
    return () => {
      active = false;
      if (timer != null) window.clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [projectId, enabled, onChange]);
}
