// 하네스 진입점 — harness.html 이 이것 하나만 싣는다. 개발 전용(scripts/harness/README.md).
// 1) 시계를 픽스처의 마지막 작업일(기본 18:20 KST, `now=`)로 고정 — 오늘 화면이 그날 일지를 본다.
// 2) mockWindows("main") + mockIPC — Tauri 가 없는 브라우저에서도 앱 전체가 뜬다.
// 3) 그 **다음에** 실제 src/main.tsx 를 불러온다(bindings 가 IPC 를 잡기 전에 목업이 서 있어야 한다).
// 부른 명령은 window.__ipcLog, 핸들러 없는 명령은 window.__ipcMissing, 던진 오류는 window.__ipcErrors.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createHandle } from "./handlers";
import type { Fixtures } from "./types";

const qs = new URLSearchParams(location.search);

// 찍기마다 새 워크스페이스 — 앞 장이 저장한 화면 · 필터가 다음 장에 새지 않게(keep=1 이면 둔다).
if (qs.get("keep") !== "1") {
  try {
    localStorage.clear();
  } catch {
    /* 저장소가 없으면 지울 것도 없다 */
  }
}

// 픽스처는 실행 때 만든 파일(`pnpm harness:fixtures`)이라 빌드 그래프 밖에서 URL 로 읽는다 —
// 변수 경로라 tsc 도 번들러도 이 파일을 모른다(커밋되는 픽스처는 없다).
const FIXTURES_URL = "/scripts/harness/generated/fixtures.json";
let fx: Fixtures;
try {
  fx = (await import(/* @vite-ignore */ FIXTURES_URL)).default as Fixtures;
} catch {
  document.body.textContent = "픽스처가 없어요 — pnpm harness:fixtures (또는 pnpm harness) 를 먼저 돌려요.";
  throw new Error("harness fixtures missing");
}

const fixed = new Date(qs.get("now") ?? fx.nowIso).getTime();
const realNow = Date.now();
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fixed + (RealDate.now() - realNow));
    // @ts-expect-error 가변 인자
    else super(...args);
  }
  static now() {
    return fixed + (RealDate.now() - realNow);
  }
}
// @ts-expect-error 하네스 전용 시계
window.Date = FakeDate;

const w = window as unknown as { __ipcLog: string[]; __ipcMissing: Record<string, number>; __ipcErrors: string[] };
w.__ipcLog = [];
w.__ipcMissing = {};
w.__ipcErrors = [];

const handle = createHandle(fx, qs);
mockWindows("main");
mockIPC(
  async (cmd, args) => {
    w.__ipcLog.push(cmd);
    try {
      return await handle(cmd, (args ?? {}) as Record<string, unknown>);
    } catch (e) {
      w.__ipcErrors.push(`${cmd}: ${String(e)}`);
      throw e;
    }
  },
  { shouldMockEvents: true },
);

await import("../../src/main");
