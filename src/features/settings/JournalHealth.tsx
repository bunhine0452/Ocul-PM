/**
 * 설정 · 에이전트 칸의 「일지가 안 와요」 — 원인을 한 줄에서 (love-round #no-journal-diagnosis, 11-23).
 *
 * 새 화면이 아니라 에이전트 칸의 줄이다. 증거로만 말한다:
 * - 실시간 갱신이 꺼졌다 — 이 창이 감시를 시작하지 못한 원인(`watcherCause`). 토스트를 놓치면 끝이던 것.
 * - 플러그인 신호가 안 온다 — 이 창의 터미널에서 Claude 가 일한 첫 때(OSC 7501, `claudeWorked`)보다 이 프로젝트의
 *   훅 인박스가 한참 옛날이거나 아예 없다. 플러그인이 꺼졌거나 다른 프로젝트에만 켜졌다는 확실한 증거다.
 * 둘 다 맨 위 「고칠 것」 에도 오른다. 본 적 없는 것으로 경고하지 않는다 — 이 창이 Claude 를 못 봤으면 말하지 않고,
 * 아무것도 못 찾았으면 「이 창에서 본 막힘은 없어요」 다(「문제 없음」 이라 단언하지 않는다).
 */
import { useEffect, useState } from "react";

import { hooksApi } from "@/api/claudeSurface";
import { oculpmApi } from "@/api/oculpm";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";
import { noteWatcherFailure, useWatcherFailure } from "@/features/oculpm/watcherCause";
import { WATCHER_CAUSE_KEY } from "@/features/oculpm/watcherToast";
import { useClaudeWorkedAt } from "@/features/terminal/claudeWorked";
import { PrefsRow, useReportFix } from "./prefsUi";

/** SessionStart · UserPromptSubmit 이 일하기 전에 쓰므로 넉넉한 여유 — 시계 어긋남 · 늦은 첫 상태를 덮는다. */
export const HOOK_GRACE_MS = 2 * 60_000;

/** 이 창에서 Claude 가 일했는데 그 무렵 이후로 훅 신호가 없다. 모르면(어느 하나를 못 읽음) `false`. */
export function hookSilent(workedAt: number | null, hookLastAt: string | null | undefined): boolean {
  if (workedAt == null || hookLastAt === undefined) return false;
  if (hookLastAt === null) return true;
  const last = Date.parse(hookLastAt);
  return Number.isFinite(last) && last < workedAt - HOOK_GRACE_MS;
}

export function JournalHealthRows({ tick }: { tick: number }) {
  const { t } = useT();
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;
  const failure = useWatcherFailure(projectId);
  const workedAt = useClaudeWorkedAt(projectId);
  // undefined = 아직 못 읽음(또는 실패) — 그때는 플러그인 신호를 말하지 않는다.
  const [hookLastAt, setHookLastAt] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (projectId == null || workedAt == null) return;
    let alive = true;
    void Promise.resolve()
      .then(() => hooksApi.linkHealth(projectId))
      .then((h) => alive && setHookLastAt(h.hook_last_at))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, workedAt, tick]);

  // 감독관(`supervisor.rs`)은 멈춘 감시를 1분마다 조용히 되살리고 이벤트를 쏘지 않는다 — 남겨 둔 원인만 믿으면
  // 이미 돌아온 감시를 「갱신 꺼짐」 이라 말하게 된다. 그릴 때마다 지금 상태를 물어, 돌고 있으면 원인을 지운다.
  useEffect(() => {
    if (projectId == null || !failure) return;
    let alive = true;
    void Promise.resolve()
      .then(() => oculpmApi.getStatus(projectId))
      .then((s) => {
        if (alive && s.watcher_state === "running") noteWatcherFailure(projectId, null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, failure, tick]);

  const label = t("prefs.agents.diag");
  const watcherText = failure ? t(WATCHER_CAUSE_KEY[failure.cause], { error: failure.detail ?? "" }) : null;
  const silent = hookSilent(workedAt, hookLastAt);
  useReportFix("journalWatcher", watcherText ? { section: "agents", label, detail: t("prefs.agents.diagWatcher") } : null);
  useReportFix("journalHooks", silent ? { section: "agents", label, detail: t("prefs.agents.diagHooks") } : null);
  if (projectId == null) return null;

  return (
    <PrefsRow label={label} meta={t("prefs.agents.diagMeta")}>
      {watcherText || silent ? (
        <div className="prefs-diag">
          {watcherText ? (
            <p>
              <span className="chip sm warn">{t("prefs.agents.diagWatcher")}</span> {watcherText}
            </p>
          ) : null}
          {silent ? (
            <p>
              <span className="chip sm warn">{t("prefs.agents.diagHooks")}</span> {t("prefs.agents.diagHooksBody")}
            </p>
          ) : null}
        </div>
      ) : (
        <span className="prefs-dim">{t("prefs.agents.diagNone")}</span>
      )}
    </PrefsRow>
  );
}
