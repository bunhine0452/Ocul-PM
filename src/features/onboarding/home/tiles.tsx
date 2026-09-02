/**
 * 시작 화면의 큰 조각들 — 오늘의 흐름 레일 · 추가 카드 · 온보딩.
 *
 * 2026-08-12 대격변에서 벤토(사령탑/판)는 사라졌다. 크기로 위계를 만들던
 * 구조가 프로젝트 9개에서 무너졌기 때문이다 — 지금은 같은 크기의 카드
 * 격자(`ProjectCard`)가 순위만으로 그 일을 한다.
 */
import { Cpu, NotebookText, Plus, FolderPlus, FolderOpen } from "@/components/Icons";
import type { HomeBrief, Project } from "@/lib/bindings";

import { Skel, TriggerKicker } from "./atoms";
import { useT } from "@/i18n";
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
      <header className="flex items-center justify-between gap-3">
        <h2 className="home-eyebrow flex items-center gap-1.5">
          <NotebookText className="w-3.5 h-3.5 text-[var(--accent)]" strokeWidth={2} />
          {t("home.todayFlow")}
        </h2>
        {brief && (
          <span className="home-when">
            {t("home.todayCountPrefix")}{" "}
            <span className="text-[var(--text)] font-bold">{brief.today_total}</span>{" "}
            {t("home.todayCountSuffix")}
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
        <p className="mt-4 text-[12.5px] text-[var(--text-2)] leading-relaxed">
          {t("home.briefFailed")}
          <br />
          <span className="text-[11px] text-[var(--text-3)]">
            {t("home.briefFailedHint")}
          </span>
        </p>
      )}
      {!loading && feed.length === 0 && !failed && (
        <p className="mt-4 text-[12.5px] text-[var(--text-2)] leading-relaxed">
          {t("home.briefEmpty")}
          <br />
          <span className="text-[11px] text-[var(--text-3)]">
            {t("home.briefEmptyHint")}
          </span>
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
                disabled={!p}
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

// ── 추가 카드 ───────────────────────────────────────────────────────────

/**
 * 격자 마지막 칸의 추가 카드. 프로젝트 카드와 **같은 크기**라 격자가 깨지지
 * 않고, "여기서 늘린다" 가 목록의 끝에 자연스럽게 놓인다.
 */
export function AddCard({
  onAddExisting,
  onStartNew,
}: {
  onAddExisting: () => void;
  onStartNew: () => void;
}) {
  const { t } = useT();
  return (
    <li className="hg-card hg-add">
      <Plus className="w-5 h-5" strokeWidth={1.6} aria-hidden="true" />
      <span className="hg-add-title">{t("home.addProject")}</span>
      <span className="hg-add-actions">
        <button type="button" onClick={onAddExisting} className="home-chipbtn">
          <FolderOpen className="w-3 h-3" />
          {t("home.existingFolder")}
        </button>
        <button type="button" onClick={onStartNew} className="home-chipbtn">
          <FolderPlus className="w-3 h-3" />
          {t("home.brandNew")}
        </button>
      </span>
    </li>
  );
}

// ── 온보딩 (프로젝트 0개) ───────────────────────────────────────────────

/**
 * 첫 사용자에게 **수동 기록이 아니라는** 멘탈 모델을 준다.
 *
 * ⚠️ 이 안의 한국어 문자열 5개는 `src/__tests__/start_screen.test.tsx` 의
 * 계약이다 ("Ocul-PM 은 이렇게 동작해요" / "평소처럼 에이전트로 코딩" /
 * "자동으로 기록·정리" / aria-label "프로젝트 추가하고 시작하기").
 * 바꾸려면 그 테스트도 같은 커밋에서 고쳐야 한다.
 */
export function OnboardingTile({ onStart }: { onStart: () => void }) {
  const { t } = useT();
  // `as const` 로 titleKey/bodyKey 가 리터럴 타입이 돼 I18nKey 에 맞는다
  // (명시 애노테이션은 lucide 아이콘 타입과 싸운다).
  const steps = [
    {
      n: 1,
      Icon: FolderOpen,
      titleKey: "home.how1Title",
      bodyKey: "home.how1Body",
    },
    {
      n: 2,
      Icon: Cpu,
      titleKey: "home.how2Title",
      bodyKey: "home.how2Body",
    },
    {
      n: 3,
      Icon: NotebookText,
      titleKey: "home.how3Title",
      bodyKey: "home.how3Body",
    },
  ] as const;

  return (
    <article className="home-how">
      <div className="home-how-head">
        <h2 className="home-how-title">{t("home.howTitle")}</h2>
        <p className="home-how-body">
          {t("home.howBodyPrefix")}
          <b>{t("home.howBodyEmphasis")}</b>
          {t("home.howBodySuffix")}
        </p>
      </div>

      {/* 세 줄의 목록 — 아이콘, 제목, 한 문장. 숫자 1·2·3 을 큼직하게 박은 3열
          카드 + "→" CTA 는 랜딩 페이지의 How-it-works 관용구라 뺐다 (2026-09-02).
          앱 안의 안내는 광고가 아니라 설명이다. */}
      <ol className="home-how-steps">
        {steps.map(({ n, Icon, titleKey, bodyKey }) => (
          <li key={n} className="home-how-step">
            <Icon className="home-how-ico" strokeWidth={1.75} aria-hidden="true" />
            <div>
              <h3>{t(titleKey)}</h3>
              <p>{t(bodyKey)}</p>
            </div>
          </li>
        ))}
      </ol>

      <button type="button" onClick={onStart} className="btn primary" aria-label={t("home.ctaAddProject")}>
        <Plus size={14} />
        {t("home.ctaAddProject")}
      </button>
    </article>
  );
}
