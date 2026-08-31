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
import type { RuleEntry } from "@/lib/bindings";
import { FiringBadge } from "./FiringBadge";
import { filterItems, partitionItems, type ContextItem, type ContextKind } from "./contextModel";

type Filter = ContextKind | "all";

const FILTERS: { id: Filter; labelKey: Parameters<typeof t>[0] }[] = [
  { id: "all", labelKey: "ctx.filter.all" },
  { id: "skill", labelKey: "ctx.kind.skill" },
  { id: "rule", labelKey: "ctx.kind.rule" },
  { id: "memory", labelKey: "ctx.kind.memory" },
];

interface ContextLiveListProps {
  items: ContextItem[];
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
            <Row key={item.id} item={item} measured={measured} days={days} onOpen={onOpen} />
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
                <Row key={item.id} item={item} measured={measured} days={days} onOpen={onOpen} />
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

const KIND_KEY = {
  skill: "ctx.kind.skill",
  rule: "ctx.kind.rule",
  memory: "ctx.kind.memory",
} as const;

function Row({
  item,
  measured,
  days,
  onOpen,
}: {
  item: ContextItem;
  measured: boolean;
  days: number;
  onOpen: (item: ContextItem) => void;
}) {
  return (
    <li>
      <button type="button" className="ctx-row" onClick={() => onOpen(item)}>
        <span className="ctx-row-top">
          <span className={`ctx-kind ${item.kind}`}>{t(KIND_KEY[item.kind])}</span>
          <span className="ctx-row-name">{item.name}</span>
          {item.scope === "global" ? <span className="sk-chip">{t("rules.scope.global")}</span> : null}
          {item.disabled ? <span className="sk-chip off">{t("sk.inactive")}</span> : null}
          {item.alwaysOn ? (
            <span className="sk-chip" title={t("firing.alwaysTitle")}>
              {t("firing.always")}
            </span>
          ) : (
            <FiringBadge stat={item.firing} measured={measured} days={days} />
          )}
          {item.kind === "rule" && item.pathCount > 0 ? (
            <span className="sk-chip">paths {item.pathCount}</span>
          ) : null}
          {item.rule?.mirror === "mirrored" ? <span className="sk-chip">Cursor</span> : null}
          {item.rule?.mirror === "conflict" ? (
            <span className="sk-chip off">{t("rules.conflict")}</span>
          ) : null}
        </span>
        {item.sub ? <span className="ctx-row-desc">{item.sub}</span> : null}
      </button>
    </li>
  );
}
