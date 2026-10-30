// 업데이트 재시작 뒤 claude 대화를 잇는다 (10-31 사용자 결정).
//
// 세션은 앱 프로세스 안에 살아 재시작과 함께 끝난다(PTY 호스트는 10-28 에 걷었다). 대신 재시작 직전
// claude 가 돌던 세션의 자리(프로젝트 · 레인)를 창 스냅숏에 적어 두고, 다시 뜬 창이 같은 폴더에서
// `claude --continue` 로 그 폴더의 가장 최근 대화를 연다. 한 폴더에 claude 가 둘이었으면 둘 다
// 가장 최근 대화를 연다 — 프로세스가 아니라 대화를 살리는 길의 한계다.
//
// xterm 은 무겁다 — 이을 것이 있을 때만 저장소를 지연 로드한다.

import { terminalApi } from "@/api/terminal";
import { t } from "@/i18n";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";

/** 이 창이 이을 세션을 가져와 연다. 연 수를 돌려준다 — 평소에는 빈 목록 하나를 묻고 끝난다. */
export async function resumeAfterUpdate(projectId: number): Promise<number> {
  const taken = await terminalApi.takeResume();
  const list = Array.isArray(taken) ? taken.filter((r) => r.project_id === projectId) : [];
  if (list.length === 0) return 0;
  const { openTerm } = await import("./termStore");
  let opened = 0;
  for (const r of list) {
    try {
      await openTerm(projectId, null, r.lane ?? null, true);
      opened += 1;
    } catch {
      // 그 사이 레인이 정리됐다 — 나머지는 연다.
    }
  }
  if (opened > 0) {
    window.dispatchEvent(new CustomEvent(NAV_BUS.setView, { detail: "terminal" }));
    toast.info(t("terminal.resumed", { n: opened }));
  }
  return opened;
}
