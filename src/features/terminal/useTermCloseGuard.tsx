/**
 * 실행 중인 터미널 세션이 있는 창을 닫거나 앱을 끄려 하면 묻는다 (ui-audit #term-close-guard).
 *
 * 닫기 · 끄기는 백엔드가 먼저 멈춘다(`commands/window/lifecycle.rs` · `lib.rs` 의
 * `ExitRequested`) — 이 창에 `TermCloseAsked` 를 보내면 여기서 묻고, 「닫기」면 세션을 끝낸 뒤
 * 다시 닫는다(그때는 도는 세션이 없어 그냥 닫힌다). 「끄기」는 프로세스 플러그인으로 끈다 —
 * 종료 코드가 붙은 끄기는 다시 묻지 않는다.
 */
import { useEffect, type ReactNode } from "react";
import { exit } from "@tauri-apps/plugin-process";

import { terminalApi, type TermCloseAsked } from "@/api/terminal";
import { windowApi } from "@/api/window";
import { useConfirm } from "@/hooks/useConfirm";
import { useT } from "@/i18n";
import type { Project } from "@/lib/bindings";
import { kbd } from "@/lib/kbd";
import { sessionWord } from "./status";

export function useTermCloseGuard(projects: Project[]): ReactNode {
  const { t } = useT();
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    let alive = true;
    const answer = async (ask: TermCloseAsked) => {
      const all = await (ask.quit ? terminalApi.overview() : terminalApi.list()).catch(() => []);
      const running = all.filter((s) => s.alive);
      const nameOf = (id: number) => projects.find((p) => p.id === id)?.name ?? "";
      const n = running.length || ask.alive;
      const ok = await confirm({
        title: ask.quit ? t("terminal.quitAsk.title", { n }) : t("terminal.closeAsk.title", { n }),
        message: ask.quit ? t("terminal.quitAsk.body", { key: kbd("⌘Q") }) : t("terminal.closeAsk.body"),
        items: running.map((s) => ({
          text: [ask.quit ? nameOf(s.project_id) : "", s.label, sessionWord(t, s)].filter(Boolean).join(" · "),
        })),
        confirmLabel: ask.quit ? t("terminal.quitAsk.confirm") : t("terminal.closeAsk.confirm"),
        danger: true,
      });
      if (!ok || !alive) return;
      if (ask.quit) {
        await exit(0);
        return;
      }
      await terminalApi.endWindow();
      await windowApi.closeThisWindow().catch(() => {});
    };
    const off = terminalApi.onCloseAsked((ask) => void answer(ask));
    return () => {
      alive = false;
      void off.then((fn) => fn());
    };
  }, [confirm, projects, t]);

  return confirmDialog;
}
