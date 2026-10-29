/**
 * 시작 창 — 프로젝트가 없는 창 (창 하나 = 프로젝트 하나, 4.0).
 *
 * 두 칸이다. 왼쪽은 **최근 프로젝트**(최근 활동 순, 줄마다 오늘 기록 수와 확인할 것) —
 * 「열기」를 누르면 **이 창이** 그 프로젝트가 된다(이미 다른 창에 열려 있으면 그 창이
 * 앞으로 온다). 오른쪽은 **처음이라면 세 단계**: 폴더 고르기 → 기록 켜기 → 에이전트 연결.
 * 기록을 켠 뒤 첫 일지가 오면 이 창이 그 프로젝트로 넘어간다.
 *
 * 3.x 의 시작 탭·첫 실행 마법사·프로젝트 관리 시트·새 프로젝트 마법사를 이 한 장이
 * 대신한다. 서버도 계정도 없다 — 기록은 전부 프로젝트 폴더의 마크다운이다.
 */
import { useCallback, useEffect, useState } from "react";

import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { projectsApi } from "@/api/projects";
import { windowApi } from "@/api/window";
import { CopyCommand } from "@/components/CopyCommand";
import { Check, X } from "@/components/Icons";
import { useConfirm } from "@/hooks/useConfirm";
import { useT, type Lang } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { Project } from "@/lib/bindings";
import { CLAUDE_PLUGIN_INSTALL } from "@/lib/agentCommands";
import { blocked } from "@/lib/blocked";
import { kbd, readChord } from "@/lib/kbd";
import { tildePath } from "@/lib/osPath";
import { dragRegion, isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { localWorkdayKey, shiftWorkday } from "@/lib/workday";
import { TermsChip } from "@/features/terminal/TermsChip";
import { useTermOverview } from "@/features/terminal/status";
import { addProjectFromFolder } from "./addFolder";
import { useRecentProjects, type RecentProject } from "./useRecentProjects";
import "./start.css";

/** 세 단계가 지금 들고 있는 프로젝트 — 폴더를 고른 뒤에만 있다. */
interface Setup {
  project: Project;
  recording: boolean;
}

function dayLabel(row: RecentProject, lang: Lang, t: ReturnType<typeof useT>["t"]): string {
  const today = localWorkdayKey();
  const { lastWorkday, dayCount } = row;
  if (!lastWorkday) return t("start.noRecords");
  if (lastWorkday === today) return t("start.today", { n: dayCount ?? 0 });
  if (lastWorkday === shiftWorkday(today, -1)) return t("start.yesterday", { n: dayCount ?? 0 });
  const y = Number(lastWorkday.slice(0, 4));
  const m = Number(lastWorkday.slice(4, 6));
  const d = Number(lastWorkday.slice(6, 8));
  return new Date(y, m - 1, d).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", {
    month: "long",
    day: "numeric",
  });
}

export function StartWindow() {
  const { t, lang } = useT();
  const { rows, loaded, reload } = useRecentProjects();
  const { confirm, confirmDialog } = useConfirm();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState<"picking" | "recording" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openElsewhere, setOpenElsewhere] = useState<number[]>([]);
  const terms = useTermOverview();

  useEffect(() => {
    let alive = true;
    const off = windowApi.onOpenProjectsChanged((open) => {
      if (alive) setOpenElsewhere(open);
    });
    void windowApi
      .openProjectIds()
      .then((open) => {
        if (alive) setOpenElsewhere(open);
      })
      .catch(() => {});
    return () => {
      alive = false;
      void off.then((fn) => fn());
    };
  }, []);

  /** 이 창이 그 프로젝트가 된다 — 다른 창에 열려 있으면 그 창이 앞으로 온다(I1). */
  const adopt = useCallback(
    (project: Project) => {
      windowApi
        .adoptProject(project.id)
        .catch((e: unknown) => toast.destructive(t("project.openWindowFailed", { error: tError(toAppError(e)) })));
    },
    [t],
  );

  const pickFolder = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy("picking");
    const result = await addProjectFromFolder();
    setBusy(null);
    if (result.kind === "cancelled") return;
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    reload();
    // 이미 들인 폴더를 다시 고른 사람은 세 단계가 필요 없다 — 바로 연다.
    if (result.kind === "existing") {
      adopt(result.project);
      return;
    }
    setSetup({ project: result.project, recording: false });
  }, [adopt, busy, reload]);

  const turnOnRecording = async () => {
    if (!setup || busy) return;
    setError(null);
    setBusy("recording");
    try {
      await oculpmApi.init(setup.project.id);
      // 앱 시작 때의 감시 목록에 없던 프로젝트다 — 첫 일지를 들으려면 지금 띄운다.
      await oculpmApi.watcherStart(setup.project.id).catch(() => {});
      setSetup({ ...setup, recording: true });
    } catch (e) {
      setError(t("start.recordFailed", { error: tError(toAppError(e)) }));
    } finally {
      setBusy(null);
    }
  };

  // 첫 일지가 오면 이 창이 그 프로젝트로 넘어간다.
  useEffect(() => {
    if (!setup?.recording) return;
    const target = setup.project;
    let alive = true;
    const off = projectsApi.onJournalAdded((projectId) => {
      if (alive && projectId === target.id) adopt(target);
    });
    return () => {
      alive = false;
      void off.then((fn) => fn());
    };
  }, [setup, adopt]);

  // ⌘O — 폴더 열기 (Windows·Linux 는 Ctrl+O).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = readChord(e);
      if (!c.mod || c.shift || c.alt || c.key.toLowerCase() !== "o") return;
      e.preventDefault();
      void pickFolder();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickFolder]);

  const forget = async (project: Project) => {
    const ok = await confirm({
      title: t("start.forgetTitle", { name: project.name }),
      message: t("start.forgetBody"),
      confirmLabel: t("start.forget"),
    });
    if (!ok) return;
    try {
      await projectsApi.forget(project.id);
      if (setup?.project.id === project.id) setSetup(null);
      reload();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  };

  const drag = dragRegion();
  const stepsDone = { pick: setup != null, record: setup?.recording === true };

  return (
    <div className={"start" + (isMac() ? " is-mac" : "")}>
      <header className="start-bar" {...drag}>
        <span className="start-bar-title" {...drag}>
          Ocul-PM
        </span>
      </header>

      <div className="start-body">
        <section className="card start-card" aria-labelledby="start-recent-title">
          <div className="start-card-head">
            <h2 id="start-recent-title">{t("start.recent")}</h2>
            <span className="start-spacer" />
            <button type="button" className="btn sm" onClick={() => void pickFolder()} aria-busy={busy === "picking"}>
              {t("start.openFolder")}
              <kbd className="kbd">{kbd("⌘O")}</kbd>
            </button>
          </div>
          {loaded && rows.length === 0 ? (
            <p className="start-empty">{t("start.empty")}</p>
          ) : (
            <ul className="start-list">
              {rows.map((row) => {
                const p = row.project;
                const elsewhere = openElsewhere.includes(p.id);
                return (
                  <li key={p.id} className="start-row">
                    <div className="start-row-main">
                      <div className="start-row-name">
                        {p.name}
                        {elsewhere ? <span className="chip sm accent">{t("start.openChip")}</span> : null}
                        <TermsChip terms={terms.get(p.id)} />
                      </div>
                      <div className="start-row-path mono" title={p.root_path}>
                        {tildePath(p.root_path)}
                      </div>
                    </div>
                    <span className="start-row-day">{dayLabel(row, lang, t)}</span>
                    {row.toCheck != null ? (
                      <span className={"chip sm" + (row.toCheck > 0 ? " warn" : "")} title={t("start.toCheckTitle")}>
                        {t("start.toCheck", { n: row.toCheck })}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => adopt(p)}
                      aria-label={t("start.openAria", { name: p.name })}
                    >
                      {t("start.open")}
                    </button>
                    <button
                      type="button"
                      className="iconbtn sm start-row-forget"
                      onClick={() => void forget(p)}
                      aria-label={t("start.forgetAria", { name: p.name })}
                      title={t("start.forget")}
                    >
                      <X size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="start-foot">{t("start.footRecent")}</p>
        </section>

        <section className="card start-card" aria-labelledby="start-steps-title">
          <div className="start-card-head">
            <h2 id="start-steps-title">{t("start.steps.title")}</h2>
          </div>
          <ol className="start-steps">
            <li className="start-step" data-done={stepsDone.pick || undefined}>
              <span className={"chip sm start-step-n" + (stepsDone.pick ? " ok" : " accent")} aria-hidden="true">
                {stepsDone.pick ? <Check size={11} /> : 1}
              </span>
              <div className="start-step-body">
                <h3>{t("start.step1.title")}</h3>
                <p>{t("start.step1.body")}</p>
                {setup ? (
                  <p className="start-step-picked">
                    <b>{setup.project.name}</b> <span className="mono">{tildePath(setup.project.root_path)}</span>
                  </p>
                ) : (
                  <button type="button" className="btn sm" onClick={() => void pickFolder()} aria-busy={busy === "picking"}>
                    {t("start.openFolder")}
                  </button>
                )}
              </div>
            </li>
            <li className="start-step" data-done={stepsDone.record || undefined}>
              <span className={"chip sm start-step-n" + (stepsDone.record ? " ok" : stepsDone.pick ? " accent" : "")} aria-hidden="true">
                {stepsDone.record ? <Check size={11} /> : 2}
              </span>
              <div className="start-step-body">
                <h3>{t("start.step2.title")}</h3>
                <p>{t("start.step2.body")}</p>
                {stepsDone.record ? (
                  <p className="start-step-picked">{t("start.step2.done")}</p>
                ) : (
                  <button
                    type="button"
                    className={"btn sm" + (stepsDone.pick ? " primary" : "")}
                    onClick={() => void turnOnRecording()}
                    {...blocked(stepsDone.pick ? null : t("start.step2.needsStep1"))}
                    disabled={busy === "recording"}
                  >
                    {t("start.step2.action")}
                  </button>
                )}
              </div>
            </li>
            <li className="start-step">
              <span className={"chip sm start-step-n" + (stepsDone.record ? " accent" : "")} aria-hidden="true">
                3
              </span>
              <div className="start-step-body">
                <h3>{t("start.step3.title")}</h3>
                <p>{t("start.step3.body")}</p>
                <CopyCommand lines={CLAUDE_PLUGIN_INSTALL} label={t("start.step3.title")} />
                <p>{t("start.step3.after")}</p>
                {setup ? (
                  <button type="button" className="btn ghost sm" onClick={() => adopt(setup.project)}>
                    {t("start.step3.openNow", { name: setup.project.name })}
                  </button>
                ) : null}
              </div>
            </li>
          </ol>
          {error ? (
            <p className="start-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="start-foot">{t("start.footSteps")}</p>
        </section>
      </div>
      {confirmDialog}
    </div>
  );
}
