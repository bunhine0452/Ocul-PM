/**
 * 설정 · 에이전트의 한 줄 — Claude Code 테마 파일 (11-15, `features/theme/claudeTheme.ts`).
 *
 * 앱이 `~/.claude/themes/ocul.json` 하나를 앱 테마에 맞춰 둔다. 사용자는 Claude 안에서 `/theme` 으로 고른다 —
 * 그 줄은 글자로만 안내하고 앱이 터미널에 치지 않는다(앱이 치는 줄은 정해진 몇 개뿐이다). 색은 예외에만:
 * 맞춰 둠은 회색 ✓, Claude Code 가 없는 기기는 중립 한 줄, 쓰기 실패만 경고 칩이고 맨 위 「고칠 것」 에 오른다.
 * 경로는 백엔드가 푼 실제 경로를 mono 로 보인다(영수증 규칙 2) — Windows 는 프로필 아래라 문구에 박지 않는다.
 */
import { useEffect } from "react";

import { useSettings } from "@/contexts/SettingsContext";
import { claudeThemeStatus, syncClaudeTheme } from "@/features/theme/claudeTheme";
import { useT } from "@/i18n";
import { tildePath } from "@/lib/osPath";
import { useSaveSetting } from "./saveSetting";
import { PrefsRow, useReportFix } from "./prefsUi";

export function ClaudeThemeRow({ tick }: { tick: number }) {
  const { t } = useT();
  const { settings, loaded } = useSettings();
  const save = useSaveSetting();
  const on = settings.claudeTheme !== "off";
  const status = claudeThemeStatus.useValue();

  // 칸이 열릴 때 · 「다시 확인」 · 창이 앞으로 올 때 다시 맞춘다 — 그 사이 Claude Code 를 깔았을 수 있다.
  // 같은 내용이면 백엔드가 쓰지 않는다. 설정을 읽기 전에는 쓰지 않는다: 기본값(켜짐)으로 끈 사람의 파일을 덮는다.
  useEffect(() => {
    if (loaded && on) void syncClaudeTheme(settings.colorTheme);
  }, [loaded, on, tick, settings.colorTheme]);

  const label = t("prefs.claudeTheme.label");
  const failed = loaded && on && status.kind === "failed";
  useReportFix("claudeTheme", failed ? { section: "agents", label, detail: t("prefs.claudeTheme.failed") } : null);

  const outcome = status.kind === "done" ? status.outcome : null;
  let body;
  if (!loaded || (on && status.kind === "idle")) body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (!on) body = <span className="prefs-dim">{t("prefs.claudeTheme.off")}</span>;
  else if (status.kind === "failed") body = <span className="chip sm warn">{t("prefs.claudeTheme.failed")}</span>;
  else if (outcome?.state === "no_claude")
    body = (
      <>
        <span className="prefs-dim">{t("prefs.claudeTheme.noClaude")}</span>
        <span className="prefs-ver mono">{tildePath(outcome.dir)}</span>
      </>
    );
  else if (outcome)
    body = (
      <>
        <span className="chip sm ok">{t("prefs.claudeTheme.ready")}</span>
        <span className="prefs-ver mono">{tildePath(outcome.path)}</span>
      </>
    );
  else body = <span className="prefs-dim">{t("prefs.unknown")}</span>;

  return (
    <PrefsRow
      label={label}
      meta={t("prefs.claudeTheme.meta")}
      actions={
        <button type="button" className="btn sm" onClick={() => save("claudeTheme", on ? "off" : "on")}>
          {on ? t("prefs.claudeTheme.turnOff") : t("prefs.claudeTheme.turnOn")}
        </button>
      }
    >
      {body}
    </PrefsRow>
  );
}
