/**
 * 시작 창 — 프로젝트가 없는 창 (창 하나 = 프로젝트 하나, 4.0).
 *
 * 한 칸이다 — **최근 프로젝트**(최근 활동 순, 줄마다 오늘 기록 수와 확인할 것). 「열기」를
 * 누르면 **이 창이** 그 프로젝트가 된다(이미 다른 창에 열려 있으면 그 창이 앞으로 온다).
 * 폴더를 새로 고르면 곧바로 그 프로젝트가 되고, 기록 파일은 프로젝트 창이 열리며 만든다.
 * 「처음 쓰는 방법」 세 단계 칸은 첫 실행 안내(`features/tour`)가 대신한다(ocul-next #tour-retire).
 *
 * 3.x 의 시작 탭·첫 실행 마법사·프로젝트 관리 시트·새 프로젝트 마법사를 이 한 장이
 * 대신한다. 서버도 계정도 없다 — 기록은 전부 프로젝트 폴더의 마크다운이다.
 */
import { useCallback, useEffect, useState } from "react";

import { toAppError } from "@/api/invoke";
import { projectsApi } from "@/api/projects";
import { windowApi } from "@/api/window";
import { X } from "@/components/Icons";
import { useConfirm } from "@/hooks/useConfirm";
import { useT, type Lang } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { Project } from "@/lib/bindings";
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
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    const result = await addProjectFromFolder();
    setBusy(false);
    if (result.kind === "cancelled") return;
    if (result.kind === "error") {
      toast.destructive(result.message);
      return;
    }
    reload();
    // 새로 들인 폴더든 이미 있던 폴더든 이 창이 곧 그 프로젝트다 — 기록 파일(AGENTS.md ·
    // .oculpm/)은 프로젝트 창이 열리며 만들고, 오늘의 첫 활성화 카드가 무엇을 만들었는지 보여 준다.
    adopt(result.project);
  }, [adopt, busy, reload]);

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
      reload();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  };

  const drag = dragRegion();

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
            <button type="button" className="btn sm" onClick={() => void pickFolder()} aria-busy={busy}>
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
      </div>
      {confirmDialog}
    </div>
  );
}
