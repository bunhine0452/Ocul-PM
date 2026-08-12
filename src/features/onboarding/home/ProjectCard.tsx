/**
 * 프로젝트 카드 — 시작 화면 격자의 단위 (2026-08-12 대격변).
 *
 * 예전 벤토(사령탑/판/행)를 대체한다. **모든 프로젝트가 같은 크기**라 9개든
 * 20개든 한 화면에 들어오고, 순위는 크기가 아니라 자리와 강조로만 드러난다.
 *
 * 카드 한 장이 답하는 것: 무엇(이름·경로) · 언제(마지막 활동·오늘 건수) ·
 * 흐름(14일 스파크라인) · 다음(플랜 1줄) · 지금(세션·열림·색인 배지).
 */
// 아이콘은 이 코드베이스의 단일 진입점을 쓴다 (lucide 직접 임포트 금지 규약).
import { ListTodo } from "@/components/Icons";
import type { Project } from "@/lib/bindings";
import { useT } from "@/i18n";
import { Highlight, RowActions, Sparkline } from "./atoms";
import { relativeTime, tildePath, type ProjectRowT } from "./homeModel";
import { resolveProjectColor, resolveProjectIcon } from "./projectAppearance";
import type { RowWiring } from "./rows";

export interface ProjectCardProps {
  row: ProjectRowT;
  query: string;
  now: number;
  /** 카드가 아직 요약을 못 받았다 — 자리를 지키되 거짓 수치를 그리지 않는다. */
  loading: boolean;
  /** 순위 1위 — "이어서 일하기". 크기 대신 강조로만 드러낸다. */
  lead: boolean;
  /** 2주 넘게 조용함 — 밀어내되 감추지는 않는다. */
  quiet: boolean;
  indexing: boolean;
  /** 이미 다른 탭에서 열려 있다 — 클릭하면 새 탭이 아니라 그 탭이 활성화된다. */
  opened: boolean;
  wiring: RowWiring;
  onOpen: (p: Project) => void;
  onRename: (p: Project) => void;
  onDelete: (p: Project) => void;
}

export function ProjectCard({
  row,
  query,
  now,
  loading,
  lead,
  quiet,
  indexing,
  opened,
  wiring,
  onOpen,
  onRename,
  onDelete,
}: ProjectCardProps) {
  const { t } = useT();
  const p = row.project;
  const snap = row.snap;
  const when = relativeTime(snap?.lastAt ?? null, now);
  const next = snap?.nextTasks?.[0]?.item_title ?? null;
  // 고른 값이 있으면 그것, 없으면 이름에서 결정적으로 유도한다.
  const { Icon } = resolveProjectIcon(p.name, p.icon);
  const color = resolveProjectColor(p.name, p.color);

  return (
    <li
      ref={(el) => wiring.register(row.id, el)}
      data-pc={color}
      className={
        "hg-card" +
        (lead ? " is-lead" : "") +
        (quiet ? " is-quiet" : "") +
        (wiring.isCursor ? " is-cursor" : "")
      }
      onKeyDown={wiring.onRowKeyDown}
      // 커서는 포커스와 포인터를 모두 따라간다 — 마우스로 훑다가 ⏎ 를 눌러도
      // "지금 보고 있는 카드" 가 열린다.
      onFocus={() => wiring.onRowFocus(row.id)}
      onPointerMove={() => wiring.onRowPointerMove(row.id)}
    >
      <div className="hg-top">
        <span className="hg-mark" aria-hidden="true">
          <Icon strokeWidth={1.9} />
        </span>
        <div className="hg-id">
          {/* `home-open` — 작은 버튼 하나가 `::after` 로 **카드 전체**를 덮어
              클릭 판정이 된다. 카드를 통째로 `<button>` 으로 감싸면 안의
              ✎/🗑 이 중첩 인터랙티브가 되어 axe 위반이다 (액션 버튼은
              `home-above` 로 그 위에 뜬다). */}
          <button
            type="button"
            className="hg-name home-open"
            tabIndex={wiring.tabbable ? 0 : -1}
            onClick={() => onOpen(p)}
            aria-label={t("home.openAria", { name: p.name, when })}
          >
            <Highlight text={p.name} query={query} />
          </button>
          <span className="hg-path">{tildePath(p.root_path)}</span>
        </div>
        <RowActions
          name={p.name}
          tabbable={wiring.tabbable}
          onRename={() => onRename(p)}
          onDelete={() => onDelete(p)}
        />
      </div>

      <div className="hg-meta">
        <span className="hg-when">{when}</span>
        {/* 요약(brief)에서 오는 값만 로딩을 탄다. 색인·열림 배지는 로컬
            상태라 요약을 기다릴 이유가 없다 — 기다리게 두면 요약이 실패한
            프로젝트에서 배지가 영영 안 뜬다. */}
        {loading && !snap ? (
          <span className="hg-dim">·</span>
        ) : (
          snap &&
          snap.todayCount > 0 && (
            <span className="hg-today">{t("home.todayN", { n: snap.todayCount })}</span>
          )
        )}
        {/* 상태 태그는 최대 2개까지만 줄에 선다 — '이어서' 는 순위 정보라
            깊이(카드 그림자)로도 이미 드러나므로, 실제 상태인 '열림' 이
            있으면 양보한다. 태그를 셋씩 늘어놓으면 배지 수프가 된다. */}
        {lead && !quiet && !opened && <span className="hg-lead-chip">{t("home.resume")}</span>}
        {opened && <span className="hg-chip">{t("project.opened")}</span>}
        {indexing && (
          <span className="hg-chip" role="status">
            {t("home.indexing")}
          </span>
        )}
        <span className="hg-spark">
          <Sparkline data={snap?.spark ?? []} label={p.name} />
        </span>
      </div>

      {/* "다음 할 일" 은 이 화면이 답하려는 질문의 절반이다 — 없으면 줄을
          비워 두지 말고 마지막 기록으로 대신한다 (높이를 고정해 격자가
          들쭉날쭉해지지 않게). */}
      <p className="hg-next">
        {next ? (
          <>
            {/* 프로젝트 아이콘이 아니라 **할 일** 아이콘 — 이 줄이 말하는 건
                프로젝트가 아니라 다음 작업이다. */}
            <ListTodo className="hg-next-icon" strokeWidth={2} aria-hidden="true" />
            {next}
          </>
        ) : snap?.lastTitle ? (
          <span className="hg-dim">{snap.lastTitle}</span>
        ) : (
          <span className="hg-dim">{t("home.noRecord")}</span>
        )}
      </p>
    </li>
  );
}
