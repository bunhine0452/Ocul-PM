/**
 * 시작 화면의 큰 조각들 — 오늘의 흐름 레일 · 온보딩.
 *
 * 추가 카드는 2026-09-11 원장 리디자인에서 빠졌다 — 원장에는 격자의 "마지막
 * 칸" 이 없고, 추가는 레일의 버튼과 바닥 명령(⌘O·⌘N)이 이미 두 번 말한다.
 */
import { NotebookText, Plus, FolderOpen } from "@/components/Icons";
import type { HomeBrief, Project } from "@/lib/bindings";

import { Skel, TriggerKicker } from "./atoms";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { dayLabel, FEED_MAX, hhmm } from "./homeModel";

export function FlowTile({
  brief,
  projects,
  loading,
  failed,
  onOpenEntry,
}: {
  brief: HomeBrief | null;
  projects: Project[];
  loading: boolean;
  /** 집계 자체가 실패했는가. `기록 0건` 과 반드시 구분해야 한다. */
  failed: boolean;
  /** 그 프로젝트를 열고 **이 일지 항목까지** 펼친다. */
  onOpenEntry: (p: Project, relativePath: string) => void;
}) {
  const { t } = useT();
  const feed = (brief?.feed ?? []).slice(0, FEED_MAX);
  const byId = new Map(projects.map((p) => [p.id, p]));

  return (
    <article className="home-flow" aria-label={t("home.todayFlow")}>
      {/* 머리는 원장 머리(검색)와 같은 높이·같은 밑줄 — 두 칸이 한 줄에서 만난다. */}
      <header className="hf-head">
        <h2 className="hf-title-head">
          <NotebookText size={15} strokeWidth={2} aria-hidden="true" />
          {t("home.todayFlow")}
        </h2>
        {brief && (
          <span className="hf-count">
            {t("home.todayCountPrefix")} <b>{brief.today_total}</b> {t("home.todayCountSuffix")}
          </span>
        )}
      </header>

      {loading && feed.length === 0 && (
        <ul className="hf-list">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="hf-item">
              <span className="hf-skel">
                <Skel w="88%" h={12} />
                <Skel w="45%" h={9} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 집계가 실패했을 때 "아직 기록이 없어요" 라고 말하면 거짓말이다 —
          기록은 있는데 못 읽어온 것일 수 있다. 두 상태를 구분한다. */}
      {!loading && feed.length === 0 && failed && (
        <p className="hf-empty">
          {t("home.briefFailed")}
          <br />
          <span className="hl-dim">{t("home.briefFailedHint")}</span>
        </p>
      )}
      {!loading && feed.length === 0 && !failed && (
        <p className="hf-empty">
          {t("home.briefEmpty")}
          <br />
          <span className="hl-dim">{t("home.briefEmptyHint")}</span>
        </p>
      )}

      {/* 행 하나 = **제목 한 덩이 + 곁줄 한 줄**.
          예전에는 유형·제목·프로젝트가 각자 한 줄씩 서고 왼쪽에 시각 기둥까지
          있어서, 한 항목이 세 가지 크기의 글자로 네 줄을 먹었다 — 목록 전체가
          "무엇이 제목인지" 를 매번 다시 찾게 만드는 벽이 됐다. 이제 제목이
          가장 크고 진한 유일한 요소이고, 유형·프로젝트·시각은 그 아래 흐린
          한 줄로 모인다. 시각 기둥을 걷어낸 폭(약 34px)은 그대로 제목이 쓴다. */}
      <ul className="hf-list">
        {feed.map((it) => {
          const p = byId.get(it.project_id);
          const day = brief ? dayLabel(it.workday, brief.today_workday) : null;
          const when = day ? `${day} ${hhmm(it.created_at)}` : hhmm(it.created_at);
          return (
            <li key={`${it.project_id}:${it.relative_path}`} className="hf-item">
              <button
                type="button"
                {...blocked(p ? null : t("home.blockedNoProject"))}
                onClick={() => p && onOpenEntry(p, it.relative_path)}
                className="hf-row"
                aria-label={
                  p ? t("home.openWithEntryAria", { name: p.name, title: it.title }) : it.title
                }
              >
                <span className="hf-title">{it.title}</span>
                <span className="hf-meta">
                  <TriggerKicker type={it.type} title={null} />
                  {p && <span className="hf-proj">{p.name}</span>}
                  <span className="hf-when">{when}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// ── 온보딩 (프로젝트 0개) ───────────────────────────────────────────────

/**
 * 첫 실행 — 빈 목록 대신 **한 가지 행동** (UI 밀도 라운드 3, 시안 I).
 *
 * 폴더를 추가하면 규칙 파일 하나가 심어지고, 터미널의 Claude Code 가 작업을 끝낼 때마다
 * 사람이 읽는 일지를 남긴다 — 서버도 계정도 없다. 두 버튼(폴더 열기 · 새 프로젝트)과 메모
 * 둘(이미 추적 중인 폴더는 그대로 열림 · git 은 필수가 아님)만. 광고가 아니라 설명이다.
 *
 * ⚠️ 제목·버튼 라벨은 `src/__tests__/start_screen.test.tsx` 의 계약이다 — 바꾸면 그 테스트도
 * 같은 커밋에서 고친다.
 */
export function OnboardingTile({ onStart, onNew }: { onStart: () => void; onNew?: () => void }) {
  const { t } = useT();
  return (
    <article className="home-how">
      <span className="home-how-mark" aria-hidden="true">
        <NotebookText size={22} strokeWidth={2} />
      </span>
      <div className="home-how-head">
        <h2 className="home-how-title">{t("home.howTitle")}</h2>
        <p className="home-how-body">{t("home.howBody")}</p>
      </div>
      <div className="home-how-drop">
        <span>{t("home.howDrop")}</span>
        <span className="home-how-btns">
          <button type="button" onClick={onStart} className="btn primary" aria-label={t("home.ctaAddProject")}>
            <FolderOpen size={15} />
            {t("home.ctaAddProject")}
          </button>
          {onNew ? (
            <button type="button" onClick={onNew} className="btn">
              <Plus size={15} />
              {t("home.howNew")}
            </button>
          ) : null}
        </span>
      </div>
      <ul className="home-how-notes">
        <li>{t("home.howNote1")}</li>
        <li>{t("home.howNote2")}</li>
      </ul>
    </article>
  );
}
