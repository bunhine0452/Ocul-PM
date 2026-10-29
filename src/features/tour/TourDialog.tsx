/**
 * 처음 쓰는 법 (ocul-next #tour-modal) — 네 쪽짜리 첫 실행 안내.
 *
 * 하는 일 → 다섯 화면 → 에이전트 연결 → 손에 익히기. 처음 한 번은 저절로 뜨고(`TourHost`),
 * 도움말 메뉴 · ⌘K 「처음 쓰는 법」에서 다시 연다. 시작 창의 「처음 쓰는 방법」 세 단계 칸을
 * 대신한다(#tour-retire) — 폴더를 고르면 그 창이 곧 프로젝트가 되고, 기록 파일은 프로젝트 창이
 * 열리며 만든다(오늘의 첫 활성화 카드가 무엇을 만들었는지 보여 준다).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { CopyCommand } from "@/components/CopyCommand";
import { AppDialog } from "@/components/ui/AppDialog";
import type { UiV2View } from "@/contexts/uiV2View";
import { projectSlotLabel } from "@/features/shell/projectKeys";
import { useT, type I18nKey } from "@/i18n";
import { CLAUDE_PLUGIN_INSTALL } from "@/lib/agentCommands";
import { kbd } from "@/lib/kbd";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";
import "./tour.css";

const PAGES = 4;

/** 화면마다 한 줄 — 무엇을 보러 가는 곳인가. */
const SCREEN_LINE: Partial<Record<UiV2View, I18nKey>> = {
  today: "tour.screen.today",
  journal: "tour.screen.journal",
  planner: "tour.screen.planner",
  diff: "tour.screen.diff",
  terminal: "tour.screen.terminal",
};

function KeyRow({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="tour-row">
      <span className="tour-row-label">{label}</span>
      <kbd className="kbd">{keys}</kbd>
    </li>
  );
}

export function TourDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [page, setPage] = useState(0);
  const nextRef = useRef<HTMLButtonElement | null>(null);

  // 다시 열면 첫 쪽부터.
  useEffect(() => {
    if (open) setPage(0);
  }, [open]);

  const last = page === PAGES - 1;
  const forward = () => (last ? onClose() : setPage((p) => p + 1));
  const back = () => setPage((p) => Math.max(0, p - 1));

  // ← → 로 쪽을 넘긴다. 입력칸(복사 명령의 버튼 등) 안의 화살표는 건드리지 않는다.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (!last) setPage((p) => p + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
  };

  const pages: ReactNode[] = [
    <>
      <h2 className="tour-title">{t("tour.p1.title")}</h2>
      <p className="tour-text">{t("tour.p1.body")}</p>
      <p className="tour-text tour-quiet">{t("tour.p1.local")}</p>
    </>,
    <>
      <h2 className="tour-title">{t("tour.p2.title")}</h2>
      <ul className="tour-list">
        {NAV_ENTRIES.map((e) => {
          const line = SCREEN_LINE[e.id];
          return (
            <li key={e.id} className="tour-row">
              <span className="tour-row-label">
                <b>{t(e.labelKey)}</b>
                {line ? <span className="tour-quiet"> · {t(line)}</span> : null}
              </span>
              <kbd className="kbd">{navShortcutLabel(e.id)}</kbd>
            </li>
          );
        })}
      </ul>
    </>,
    <>
      <h2 className="tour-title">{t("tour.p3.title")}</h2>
      <p className="tour-text">{t("tour.p3.body")}</p>
      <CopyCommand lines={CLAUDE_PLUGIN_INSTALL} label={t("tour.p3.title")} />
      <p className="tour-text tour-quiet">{t("tour.p3.others")}</p>
      <p className="tour-text tour-quiet">{t("tour.p3.folder")}</p>
    </>,
    <>
      <h2 className="tour-title">{t("tour.p4.title")}</h2>
      <ul className="tour-list">
        <KeyRow keys={kbd("⌘K")} label={t("tour.key.find")} />
        <KeyRow keys={kbd("⌃Tab")} label={t("tour.key.screens")} />
        <KeyRow keys={`${projectSlotLabel(0)} ~ 9`} label={t("tour.key.projects")} />
        <KeyRow keys={`${kbd("⌘[")} / ${kbd("⌘]")}`} label={t("tour.key.back")} />
        <KeyRow keys="v · r" label={t("tour.key.today")} />
        <KeyRow keys={kbd("⌘/")} label={t("tour.key.all")} />
      </ul>
    </>,
  ];

  return (
    <AppDialog open={open} onClose={onClose} label={t("tour.title")} width={520} initialFocusRef={nextRef} onKeyDown={onKeyDown}>
      <div className="tour">
        <div className="tour-head">
          <span className="tour-kicker">{t("tour.title")}</span>
          <span className="tour-count" aria-live="polite">
            {t("tour.page", { n: page + 1, total: PAGES })}
          </span>
        </div>
        <div className="tour-body">{pages[page]}</div>
        <div className="tour-foot">
          {last ? null : (
            <button type="button" className="btn ghost sm" onClick={onClose}>
              {t("tour.skip")}
            </button>
          )}
          <span className="tour-spacer" />
          {page > 0 ? (
            <button type="button" className="btn sm" onClick={back}>
              {t("tour.prev")}
            </button>
          ) : null}
          <button ref={nextRef} type="button" className="btn primary sm" onClick={forward}>
            {last ? t("tour.done") : t("tour.next")}
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
