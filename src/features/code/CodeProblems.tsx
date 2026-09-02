// 문제 패널 (B6) — 지금 언어 서버가 아는 이 프로젝트의 진단.
//
// 설계 SSOT: docs/20260902_vscode-borrows/05-problems.md
//
// 참조 패널(`CodeReferences`)과 **같은 자리·같은 규약**이다. 새 패널 껍데기를
// 만들지 않는다 — 편집 영역 아래 전체 폭, 파일별 접기, 항목 클릭은 이동.
import { memo, useMemo, useState } from "react";

import { X, ChevronRight, CircleX, TriangleAlert, Info } from "@/components/Icons";
import { FileIcon } from "./FileIcon";
import { t, useT } from "@/i18n";
import type { I18nKey } from "@/i18n";
import type { LspDiagnostic, LspSeverity } from "@/lib/bindings";
import {
  filterBySeverity,
  groupByFile,
  ITEMS_PER_FILE,
  MAX_FILES,
  totalCounts,
  type ProblemEntries,
} from "./problemsModel";

/** 필터 세 칸 — "이 이상만". `hint` 는 사실상 전부다. */
const FILTERS: { min: LspSeverity; labelKey: I18nKey }[] = [
  { min: "hint", labelKey: "code.problems.filter.all" },
  { min: "warning", labelKey: "code.problems.filter.warning" },
  { min: "error", labelKey: "code.problems.filter.error" },
];

const SEVERITY_ICON = {
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
  hint: Info,
} as const;

interface CodeProblemsProps {
  /** `경로 → 진단` (스토어의 스냅샷 그대로). */
  problems: ProblemEntries;
  onClose: () => void;
  /** 그 파일 그 자리로 이동 (1-based 줄, 0-based 열). */
  onOpen: (path: string, line: number, character: number) => void;
}

export const CodeProblems = memo(function CodeProblems({
  problems,
  onClose,
  onOpen,
}: CodeProblemsProps) {
  useT();
  const [min, setMin] = useState<LspSeverity>("hint");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const all = useMemo(() => groupByFile(problems), [problems]);
  const files = useMemo(() => filterBySeverity(all, min), [all, min]);
  const total = useMemo(() => totalCounts(files), [files]);
  const shown = files.slice(0, MAX_FILES);

  return (
    <div className="code-refs code-problems" role="region" aria-label={t("code.problems.title")}>
      <div className="code-refs-head">
        <strong className="code-refs-title">{t("code.problems.title")}</strong>
        <span className="code-refs-sub">
          {t("code.problems.summary", {
            errors: total.error,
            warnings: total.warning,
            files: files.length,
          })}
        </span>
        <div className="seg code-problems-filter" role="tablist" aria-label={t("code.problems.filterAria")}>
          {FILTERS.map((f) => (
            <button
              key={f.min}
              type="button"
              role="tab"
              className="seg-item"
              aria-selected={min === f.min}
              onClick={() => setMin(f.min)}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="code-refs-close"
          onClick={onClose}
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <X size={13} strokeWidth={2.5} />
        </button>
      </div>

      <div className="code-refs-body">
        {files.length === 0 ? (
          // "문제 없음" 이 아니다 — 이 패널이 아는 것은 **서버가 연 파일**뿐이고,
          // 그 한계를 여기서 말하지 않으면 빈 목록이 보증서처럼 읽힌다.
          <div className="code-refs-hint">{t("code.problems.empty")}</div>
        ) : null}
        {shown.map((file) => {
          const open = !collapsed.has(file.path);
          const limit = expanded.has(file.path) ? file.items.length : ITEMS_PER_FILE;
          const rest = file.items.length - limit;
          return (
            <div key={file.path} className="code-refs-file">
              <button
                type="button"
                className="code-refs-file-head"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(file.path)) next.delete(file.path);
                    else next.add(file.path);
                    return next;
                  })
                }
              >
                <ChevronRight size={12} className={"code-tree-caret" + (open ? " open" : "")} />
                <FileIcon
                  name={file.path.slice(file.path.lastIndexOf("/") + 1)}
                  size={14}
                  className="code-refs-ico"
                />
                <span className="code-refs-path">{file.path}</span>
                <span className="code-refs-count">{file.items.length}</span>
              </button>
              {open ? (
                <>
                  {file.items.slice(0, limit).map((item, i) => (
                    <ProblemRow
                      key={`${item.start_line}:${item.start_character}:${i}`}
                      item={item}
                      onClick={() => onOpen(file.path, item.start_line + 1, item.start_character)}
                    />
                  ))}
                  {rest > 0 ? (
                    <button
                      type="button"
                      className="code-refs-hit code-problems-more"
                      onClick={() =>
                        setExpanded((prev) => new Set(prev).add(file.path))
                      }
                    >
                      {t("code.problems.more", { count: rest })}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
        {files.length > MAX_FILES ? (
          <div className="code-refs-hint">
            {t("code.problems.truncated", { count: files.length - MAX_FILES })}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function ProblemRow({ item, onClick }: { item: LspDiagnostic; onClick: () => void }) {
  const Icon = SEVERITY_ICON[item.severity];
  return (
    <button type="button" className="code-refs-hit code-problems-hit" onClick={onClick}>
      <Icon size={12} className={"code-problems-sev s-" + item.severity} aria-hidden />
      <span className="code-refs-line">{item.start_line + 1}</span>
      <span className="code-refs-preview">{item.message}</span>
      {/* 어느 도구가 한 말인지 — 같은 줄에 rustc 와 clippy 가 겹칠 때 필요하다. */}
      {item.source ? <span className="code-problems-source">{item.source}</span> : null}
    </button>
  );
}
