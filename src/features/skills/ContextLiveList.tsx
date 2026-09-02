// AD-3 존 2 — 걸려 있는 것 (docs/agent-discipline/00-master-plan.md D2).
//
// 스킬·규칙·CLAUDE.md 를 **한 목록**으로 본다. 종류는 탭이 아니라 필터다 —
// 사용자가 묻는 건 "스킬 탭에 뭐가 있지" 가 아니라 "지금 에이전트가 뭘 읽고
// 있지" 이기 때문이다.
//
// 기본 정렬은 발동 많은 순. 30일 발동 0회는 하단 **휴면**으로 자동 강등된다 —
// 목록이 스스로 청소되는 쪽이, 사용자가 정리를 결심하기를 기다리는 것보다 낫다.
import { useMemo, useState } from "react";

import { ChevronDown, ChevronRight, Plus, SearchIcon } from "@/components/Icons";
import { t, useT } from "@/i18n";
import type { RuleEntry, RuleScopeFinding } from "@/lib/bindings";
import { FiringBadge } from "./FiringBadge";
import {
  filterItems,
  globReach,
  indexFindings,
  KIND_LABEL_KEY,
  partitionItems,
  type ContextItem,
  type ContextKind,
  type GlobReach,
} from "./contextModel";

type Filter = ContextKind | "all";

const FILTERS: { id: Filter; labelKey: Parameters<typeof t>[0] }[] = [
  { id: "all", labelKey: "ctx.filter.all" },
  { id: "skill", labelKey: "ctx.kind.skill" },
  { id: "rule", labelKey: "ctx.kind.rule" },
  { id: "memory", labelKey: "ctx.kind.memory" },
  { id: "agent", labelKey: "ctx.kind.agent" },
  { id: "command", labelKey: "ctx.kind.command" },
];

interface ContextLiveListProps {
  items: ContextItem[];
  /** AD-6 범위 감사 결과 — glob 이 실제로 무는 파일 수의 출처. */
  findings: RuleScopeFinding[];
  /** 감사가 센 프로젝트 파일 수 (0 = 감사 전). */
  totalFiles: number;
  /** 원장이 한 번이라도 스캔됐는가 — false 면 휴면 강등을 하지 않는다. */
  measured: boolean;
  days: number;
  /**
   * 아직 만들지 않은 CLAUDE.md 슬롯. 걸려 있는 것은 아니지만 *만들 수 있는*
   * 자리라 목록 끝에 유령 행으로 남긴다 — 예전 규칙 탭의 어포던스를 잃지 않는다.
   */
  missingMemory: RuleEntry[];
  onCreateMemory: (entry: RuleEntry) => void;
  onOpen: (item: ContextItem) => void;
  /** Cursor 병행 배포 옵인 (config `agents.rules_translate`). */
  cursorTranslate: boolean;
  onToggleTranslate: () => void;
  translateBusy: boolean;
}

export function ContextLiveList({
  items,
  findings,
  totalFiles,
  measured,
  days,
  missingMemory,
  onCreateMemory,
  onOpen,
  cursorTranslate,
  onToggleTranslate,
  translateBusy,
}: ContextLiveListProps) {
  useT();
  const findingIndex = useMemo(() => indexFindings(findings), [findings]);
  const reachOf = (item: ContextItem) => globReach(findingIndex.get(item.id), totalFiles);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [dormantOpen, setDormantOpen] = useState(false);

  const { live, dormant } = useMemo(
    () => partitionItems(filterItems(items, filter, query), measured),
    [items, filter, query, measured],
  );
  // 유령 행은 종류 필터가 메모리를 포함하고 검색 중이 아닐 때만 — 검색 결과에
  // "아직 없는 것" 이 섞이면 목록이 거짓말을 한다.
  const showMemorySlots = (filter === "all" || filter === "memory") && query.trim() === "";

  return (
    <section className="ctx-live" aria-label={t("ctx.live.aria")}>
      <div className="ctx-zone-head">
        <h3>{t("ctx.live.title")}</h3>
        <span className="ctx-zone-sub">{t("ctx.live.sub", { n: live.length })}</span>
        <div className="ctx-filters" role="tablist" aria-label={t("ctx.filter.aria")}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? "on" : ""}
              onClick={() => setFilter(f.id)}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <label className="ctx-search">
          <SearchIcon size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ctx.live.searchPlaceholder")}
            aria-label={t("ctx.live.searchAria")}
            spellCheck={false}
          />
        </label>
      </div>

      {live.length === 0 ? (
        <div className="ctx-empty">{t("ctx.live.empty")}</div>
      ) : (
        <ul className="ctx-rows">
          {live.map((item) => (
            <Row
              key={item.id}
              item={item}
              reach={reachOf(item)}
              measured={measured}
              days={days}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}

      {showMemorySlots
        ? missingMemory.map((entry) => (
            <button
              key={`${entry.scope}:${entry.rel_path}`}
              type="button"
              className="ctx-row ghost"
              title={t("rules.seedTitle")}
              onClick={() => onCreateMemory(entry)}
            >
              <span className="ctx-row-top">
                <Plus size={11} />
                {t("rules.createNamed", {
                  path: entry.scope === "global" ? `~/${entry.rel_path}` : entry.rel_path,
                })}
              </span>
            </button>
          ))
        : null}

      {dormant.length > 0 ? (
        <div className="ctx-dormant">
          <button
            type="button"
            className="ctx-dormant-head"
            aria-expanded={dormantOpen}
            onClick={() => setDormantOpen((v) => !v)}
          >
            {dormantOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {t("ctx.dormant.title", { n: dormant.length, d: days })}
          </button>
          {dormantOpen ? (
            <ul className="ctx-rows">
              {dormant.map((item) => (
                <Row
              key={item.id}
              item={item}
              reach={reachOf(item)}
              measured={measured}
              days={days}
              onOpen={onOpen}
            />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* 규칙을 다른 에이전트로도 내보내는 옵인. 규칙 목록과 같은 자리에 둔다 —
          "무엇이 걸려 있는가" 의 대상이 Claude Code 만은 아니기 때문이다. */}
      <div className="sk-translate">
        <label className="sk-translate-label">
          <input
            type="checkbox"
            checked={cursorTranslate}
            disabled={translateBusy}
            onChange={onToggleTranslate}
          />
          {t("rules.mirrorToCursor")}
        </label>
        <p className="sk-translate-hint">
          {t("rules.mirrorHint1")} <code>.cursor/rules/*.mdc</code> {t("rules.mirrorHint2")}{" "}
          {t("rules.mirrorHint3")}
          <code>paths</code>→<code>globs</code>
          {t("rules.mirrorHint4")}
        </p>
      </div>
    </section>
  );
}

/**
 * `paths` 배지 — glob **개수**가 아니라 그게 실제로 무는 **파일 수**를 말한다.
 *
 * 종전에는 `paths 2` 였다. 그 2개가 모든 .ts·.tsx 를 무는 glob 이라 프런트 파일
 * 한 줄만 고쳐도 통째로 딸려온다는 사실이 배지에 전혀 없었다 — 감사는 이미
 * 답을 갖고 있었는데 화면이 안 물었다.
 */
function PathsChip({ pathCount, reach }: { pathCount: number; reach: GlobReach | null }) {
  // 감사 전 — 아는 척하지 않는다.
  if (!reach) return <span className="sk-chip">{t("ctx.paths.count", { n: pathCount })}</span>;
  if (reach.dead) {
    return (
      <span className="sk-chip off" title={t("ctx.paths.deadTitle")}>
        {t("ctx.paths.dead")}
      </span>
    );
  }
  return (
    <>
      <span
        className="sk-chip"
        title={reach.unparsed ? t("ctx.paths.unparsedTitle") : t("ctx.paths.filesTitle")}
      >
        {t("ctx.paths.files", { n: pathCount, files: reach.files })}
        {reach.unparsed ? " ?" : ""}
      </span>
      {reach.deFactoAlways ? (
        <span className="sk-chip warn" title={t("ctx.paths.deFactoTitle")}>
          {t("ctx.paths.deFacto")}
        </span>
      ) : null}
    </>
  );
}

function Row({
  item,
  reach,
  measured,
  days,
  onOpen,
}: {
  item: ContextItem;
  /** glob 실측 (감사 전이거나 조건부가 아니면 null). */
  reach: GlobReach | null;
  measured: boolean;
  days: number;
  onOpen: (item: ContextItem) => void;
}) {
  // 에이전트·커맨드는 규칙 허브가 여는 파일이 아니다 (`rules_read` 의 범위는
  // CLAUDE.md 계열과 `.claude/rules/**` 뿐). 열 수 없는 것을 누르게 두면 빈
  // 편집기가 뜨므로, 비용만 밝히는 **정보 행**으로 그린다.
  const openable = item.kind !== "agent" && item.kind !== "command";
  const inner = (
    <>
        <span className="ctx-row-top">
          <span className={`ctx-kind ${item.kind}`}>{t(KIND_LABEL_KEY[item.kind])}</span>
          <span className="ctx-row-name">{item.name}</span>
          {item.scope === "global" ? <span className="sk-chip">{t("rules.scope.global")}</span> : null}
          {item.disabled ? <span className="sk-chip off">{t("sk.inactive")}</span> : null}
          {item.alwaysOn ? (
            <span className="sk-chip" title={t("firing.alwaysTitle")}>
              {t("firing.always")}
            </span>
          ) : item.measurable ? (
            <FiringBadge stat={item.firing} measured={measured} days={days} />
          ) : null}
          {item.kind === "rule" && item.pathCount > 0 ? (
            <PathsChip pathCount={item.pathCount} reach={reach} />
          ) : null}
          {item.rule?.mirror === "mirrored" ? <span className="sk-chip">Cursor</span> : null}
          {item.rule?.mirror === "conflict" ? (
            <span className="sk-chip off">{t("rules.conflict")}</span>
          ) : null}
        </span>
        {item.sub ? <span className="ctx-row-desc">{item.sub}</span> : null}
    </>
  );
  return (
    <li>
      {openable ? (
        <button type="button" className="ctx-row" onClick={() => onOpen(item)}>
          {inner}
        </button>
      ) : (
        <div className="ctx-row ctx-row-static" title={item.path}>
          {inner}
        </div>
      )}
    </li>
  );
}
