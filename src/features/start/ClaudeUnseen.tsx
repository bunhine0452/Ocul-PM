/**
 * 시작 창의 「Claude Code 를 아직 못 봤어요」 (love-round #first-run-find-claude, 11-23).
 *
 * 「다음」 · 「터미널에서 맡기기」 는 새 세션에서 `claude "…"` 를 친다 — claude 가 없으면 빈 셸이 첫 클릭의 답이었다.
 * 앱은 자식 프로세스를 띄우지 않고 파일만 본다(`~/.claude` · `~/.local/bin/claude` · PATH, `agent_link.rs`). 그래서
 * 「없어요」 가 아니라 「아직 못 봤어요」 라고 말하고, 다른 에이전트를 쓰는 사람에게는 무시해도 된다고 한다. 할 일은
 * 공식 설치 줄 복사 하나(앱은 돌리지 않는다 · 바깥에 닿지 않는다). 봤으면 아무것도 그리지 않는다 — 예외만.
 * 창이 앞으로 오면 다시 묻는다(설치하고 돌아온 사람에게 줄이 남지 않게).
 */
import { useEffect, useState } from "react";

import { hooksApi } from "@/api/claudeSurface";
import { CopyCommand } from "@/components/CopyCommand";
import { useT } from "@/i18n";
import { claudeCliInstall } from "@/lib/agentCommands";
import { getPlatform } from "@/lib/platform";

export function ClaudeUnseen() {
  const { t } = useT();
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const ask = () =>
      void Promise.resolve()
        .then(() => hooksApi.linkHealth(null))
        .then((h) => alive && setSeen(h.claude_seen))
        .catch(() => {});
    ask();
    window.addEventListener("focus", ask);
    return () => {
      alive = false;
      window.removeEventListener("focus", ask);
    };
  }, []);
  if (seen !== false) return null;
  return (
    <div className="start-claude">
      <p className="start-claude-text">{t("start.claudeUnseen")}</p>
      <CopyCommand lines={claudeCliInstall(getPlatform() === "windows")} label={t("start.claudeInstall")} />
    </div>
  );
}
