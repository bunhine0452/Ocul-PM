/**
 * 변경 화면 시험의 가짜 백엔드 (11-15) — 새 시험 여럿이 같은 모양을 쓴다. 시험 파일은
 *
 *   vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
 *   vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());
 *
 * 로 갈아 끼우고, `fx` 를 고쳐 답을 바꾼다. 이 파일은 앱 모듈을 들이지 않는다 — 들이면 가짜 공장이
 * 자기 자신을 기다리며 멈춘다(그리는 도우미는 `diffScreenFx.tsx`).
 */
import { vi } from "vitest";

export const GIT_PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " context line",
  "-old line",
  "+new line",
].join("\n");

export interface SentCtx {
  kind: string;
  label: string;
  ref: string;
  note?: string;
  prefill?: string;
  onSent?: () => void;
}

export const fx = {
  /** 경로 → DiffResult. 문자열이면 compute_diff 오류 봉투. */
  diffByPath: {} as Record<string, unknown>,
  computeCalls: [] as unknown[][],
  groups: null as unknown,
  brief: [] as unknown[],
  uncommitted: [] as unknown[],
  lastCommit: null as unknown,
  generated: [] as string[],
  /** 경로 → 본문, 또는 오류 문장(read_project_file 봉투 오류). 없으면 「없음(os error 2)」. */
  files: new Map<string, { ok: string } | { err: string }>(),
  /** read_project_file 을 부른 경로들. */
  reads: [] as string[],
  journal: null as unknown,
  openInEditor: vi.fn((..._args: unknown[]) => Promise.resolve({ status: "ok" as const, data: null })),
  sent: [] as SentCtx[],
};

export function resetBackend(): void {
  for (const k of Object.keys(fx.diffByPath)) delete fx.diffByPath[k];
  fx.computeCalls.length = 0;
  fx.groups = null;
  fx.brief = [];
  fx.uncommitted = [];
  fx.lastCommit = null;
  fx.generated = [];
  fx.files.clear();
  fx.reads.length = 0;
  fx.journal = null;
  fx.openInEditor.mockClear();
  fx.sent.length = 0;
}

const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
const err = (error: string) => Promise.resolve({ status: "error" as const, error });

export function bindingsMock() {
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "computeDiff":
              return (...args: unknown[]) => {
                fx.computeCalls.push(args);
                const path = String(args[1]);
                const v = fx.diffByPath[path];
                if (typeof v === "string") return err(v);
                return ok(v ?? { path, source: { source: "git", patch: GIT_PATCH }, truncated: null });
              };
            case "oculpmGroupChanges":
              return () => ok(fx.groups);
            case "oculpmWorkdayBrief":
              return () => ok({ days: [{ workday: "20260820", entries: fx.brief }] });
            case "gitUncommittedChanges":
              return () => ok(fx.uncommitted);
            case "gitLastCommitChanges":
              return () => ok(fx.lastCommit);
            case "diffGeneratedFiles":
              return () => ok(fx.generated);
            case "readProjectFile":
              return (_pid: number, path: string) => {
                fx.reads.push(path);
                const f = fx.files.get(path);
                if (!f) return err("Failed to read file: No such file or directory (os error 2)");
                return "ok" in f ? ok(f.ok) : err(f.err);
              };
            case "oculpmGetJournalEntry":
              return () => ok(fx.journal);
            case "openInEditor":
              return fx.openInEditor;
            case "settingsGetAll":
              return () => ok([] as Array<[string, string]>);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
}

export function sendMock() {
  return {
    requestSendToClaude: (ctx: SentCtx) => {
      fx.sent.push(ctx);
    },
    sendOrRun: async () => null,
    toastQueued: () => {},
  };
}
