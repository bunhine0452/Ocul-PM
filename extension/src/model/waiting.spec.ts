// 앱(Rust)과 같은 사례표 — `src-tauri/src/oculpm/waiting_cases.json`. Rust 쪽은 `claude_waiting.rs::shared_waiting_cases`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyWaiting, parseQuestion, waitingFrom, type HookEvent, type Waiting } from "./waiting";

const cases = JSON.parse(
  readFileSync(new URL("../../../src-tauri/src/oculpm/waiting_cases.json", import.meta.url), "utf8"),
) as { cases: { name: string; events: HookEvent[]; waiting: [string, string][] }[] };

describe("waiting — shared cases with the app", () => {
  it.each(cases.cases)("$name", (c) => {
    const map = new Map<string, Waiting>();
    for (const ev of c.events) applyWaiting(map, ev, "2026-11-03T00:00:00Z");
    const got = [...map.values()].map((w) => [w.sessionId, w.kind]).sort((a, b) => a[0].localeCompare(b[0]));
    expect(got).toEqual(c.waiting);
  });
});

describe("waiting from the inbox", () => {
  const now = Date.parse("2026-11-03T10:00:00Z");
  const line = (o: object) => JSON.stringify(o);

  it("reads JSON lines, skips a torn last line, and drops waits older than 30 minutes", () => {
    const text = [
      line({ hook_event_name: "Notification", session_id: "old", notification_type: "idle_prompt", oculpm_ts: "2026-11-03T09:00:00Z" }),
      line({ hook_event_name: "Notification", session_id: "new", notification_type: "permission_prompt", message: "Bash?", oculpm_ts: "2026-11-03T09:55:00Z" }),
      '{"hook_event_name":"Notif',
    ].join("\n");
    expect(waitingFrom(text, now)).toEqual([{ sessionId: "new", kind: "permission", message: "Bash?", since: "2026-11-03T09:55:00Z" }]);
  });
});

describe("questions", () => {
  it("reads the app's question file and refuses odd ids", () => {
    expect(parseQuestion(JSON.stringify({ id: "q-1", question: "어느 쪽?", options: ["A", 2, "B"], asked_at: "t" }))).toEqual({
      id: "q-1",
      question: "어느 쪽?",
      options: ["A", "B"],
      askedAt: "t",
    });
    expect(parseQuestion(JSON.stringify({ id: "../x", question: "q", asked_at: "t" }))).toBeNull();
    expect(parseQuestion("{")).toBeNull();
  });
});
