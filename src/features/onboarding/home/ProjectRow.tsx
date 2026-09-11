/**
 * 원장 행 — 시작 화면의 프로젝트 한 줄 (2026-09-11 원장 리디자인).
 *
 * 같은 크기의 카드 격자를 대체한다. 카드는 프로젝트 14개에서 "순위" 를 보여
 * 주지 못했다 — 상자 14개가 같은 무게로 늘어서면 눈은 위계 대신 격자를 읽는다.
 * 행은 상자가 없고, 위계는 묶음 헤더(시간대)와 열 정렬이 만든다.
 *
 * 한 행이 답하는 것, 왼쪽에서 오른쪽으로: 무엇(마크·이름·경로) → 다음(플랜
 * 1줄) → 지금(오늘 건수·열림·색인) → 흐름(14일 맥박) → 언제(마지막 활동).
 * 열 폭은 고정이라 이름·할 일의 길이가 오른쪽 열들을 흔들지 않는다.
 */
// 아이콘은 이 코드베이스의 단일 진입점을 쓴다 (lucide 직접 임포트 금지 규약).
import { ListTodo } from "@/components/Icons";
import type { Project } from "@/lib/bindings";
import { useT } from "@/i18n";
import { Highlight, RowActions, Sparkline } from "./atoms";
import { relativeTime, tildePath, type ProjectRowT } from "./homeModel";
import { resolveProjectColor, resolveProjectIcon } from "./projectAppearance";
import type { RowWiring } from "./rows";

export interface ProjectRowProps {
  row: ProjectRowT;
  query: string;
  now: number;
  /** 행이 아직 요약을 못 받았다 — 자리를 지키되 거짓 수치를 그리지 않는다. */
  loading: boolean;
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

export function ProjectRow({
  row,
  query,
  now,
  loading,
  quiet,
  indexing,
  opened,
  wiring,
  onOpen,
  onRename,
  onDelete,
}: ProjectRowProps) {
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
      className={"hl-row" + (quiet ? " is-quiet" : "") + (wiring.isCursor ? " is-cursor" : "")}
      onKeyDown={wiring.onRowKeyDown}
      // 커서는 포커스와 포인터를 모두 따라간다 — 마우스로 훑다가 ⏎ 를 눌러도
      // "지금 보고 있는 행" 이 열린다.
      onFocus={() => wiring.onRowFocus(row.id)}
      onPointerMove={() => wiring.onRowPointerMove(row.id)}
    >
      <span className="hl-mark" aria-hidden="true">
        <Icon strokeWidth={1.9} />
      </span>

      <div className="hl-id">
        <span className="hl-line">
          {/* `home-open` — 작은 버튼 하나가 `::after` 로 **행 전체**를 덮어
              클릭 판정이 된다. 행을 통째로 `<button>` 으로 감싸면 안의 ✎/🗑 이
              중첩 인터랙티브가 되어 axe 위반이다 (액션 버튼은 `home-above`
              로 그 위에 뜬다). */}
          <button
            type="button"
            className="hl-name home-open"
            tabIndex={wiring.tabbable ? 0 : -1}
            onClick={() => onOpen(p)}
            aria-label={t("home.openAria", { name: p.name, when })}
          >
            <Highlight text={p.name} query={query} />
          </button>
          <span className="hl-path">{tildePath(p.root_path)}</span>
        </span>
        {/* "다음 할 일" 은 이 화면이 답하려는 질문의 절반이다 — 없으면 줄을
            비워 두지 말고 마지막 기록으로 대신한다 (높이를 고정해 행이
            들쭉날쭉해지지 않게). */}
        <span className="hl-next">
          {next ? (
            <>
              <ListTodo className="hl-next-icon" strokeWidth={2} aria-hidden="true" />
              <span>{next}</span>
            </>
          ) : snap?.lastTitle ? (
            <span className="hl-dim">{snap.lastTitle}</span>
          ) : (
            <span className="hl-dim">{t("home.noRecord")}</span>
          )}
        </span>
      </div>

      <span className="hl-tags">
        {/* 요약(brief)에서 오는 값만 로딩을 탄다. 색인·열림 배지는 로컬
            상태라 요약을 기다릴 이유가 없다. */}
        {loading && !snap ? (
          <span className="hl-dim">·</span>
        ) : (
          snap &&
          snap.todayCount > 0 && (
            <span className="hl-today">{t("home.todayN", { n: snap.todayCount })}</span>
          )
        )}
        {opened && <span className="hl-chip">{t("project.opened")}</span>}
        {indexing && (
          <span className="hl-chip" role="status">
            {t("home.indexing")}
          </span>
        )}
      </span>

      <span className="hl-spark">
        <Sparkline data={snap?.spark ?? []} label={p.name} />
      </span>

      <span className="hl-when">{when}</span>

      <span className="hl-actions">
        <RowActions
          name={p.name}
          tabbable={wiring.tabbable}
          onRename={() => onRename(p)}
          onDelete={() => onDelete(p)}
        />
      </span>
    </li>
  );
}
