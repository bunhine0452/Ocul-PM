// 참조 결과 패널 — 편집 창 아래에 가로로 앉는다.
//
// 왜 사이드바가 아니라 아래인가: 참조 한 줄은 `경로 + 줄번호 + 원문` 이라
// 가로로 길다. 264px 사이드바에 넣으면 미리보기가 전부 잘려 목록을 훑는
// 의미가 사라진다 (VS Code 도 같은 이유로 아래에 둔다).
import { memo, useState } from "react";

import { X, ChevronRight } from "@/components/Icons";
import { FileIcon } from "./FileIcon";
import { t, useT } from "@/i18n";
import type { LspReferenceFile } from "@/lib/bindings";

export interface ReferencesQuery {
  /** 찾은 심볼 이름 — 패널 제목이 무엇의 참조인지 말한다. */
  symbol: string;
  status: "loading" | "ready";
  files: LspReferenceFile[];
}

interface CodeReferencesProps {
  query: ReferencesQuery;
  onClose: () => void;
  /** 프로젝트 안 참조로 점프 (0-based 줄). */
  onOpen: (path: string, line: number) => void;
}

export const CodeReferences = memo(function CodeReferences({
  query,
  onClose,
  onOpen,
}: CodeReferencesProps) {
  useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const total = query.files.reduce((n, f) => n + f.hits.length, 0);

  return (
    <div className="code-refs" role="region" aria-label={t("code.refs.title")}>
      <div className="code-refs-head">
        <strong className="code-refs-title">{t("code.refs.title")}</strong>
        <span className="code-refs-sub">
          {query.status === "loading"
            ? t("code.refs.searching", { symbol: query.symbol })
            : t("code.refs.summary", {
                symbol: query.symbol,
                count: total,
                files: query.files.length,
              })}
        </span>
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
        {query.status === "ready" && query.files.length === 0 ? (
          <div className="code-refs-hint">{t("code.refs.none")}</div>
        ) : null}
        {query.files.map((file) => {
          const key = file.display;
          const open = !collapsed.has(key);
          return (
            <div key={key} className="code-refs-file">
              <button
                type="button"
                className="code-refs-file-head"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                <ChevronRight size={12} className={"code-tree-caret" + (open ? " open" : "")} />
                <FileIcon name={file.display.slice(file.display.lastIndexOf("/") + 1)} size={14} className="code-refs-ico" />
                <span className="code-refs-path">{file.display}</span>
                <span className="code-refs-count">{file.hits.length}</span>
                {/* 프로젝트 밖(의존성·표준 라이브러리)은 열 수 없다 — 목록에는
                    남기되 왜 눌러도 안 열리는지 그 자리에서 밝힌다. */}
                {file.path == null ? (
                  <span className="code-refs-outside">{t("code.refs.outside")}</span>
                ) : null}
              </button>
              {open
                ? file.hits.map((hit) => {
                    const path = file.path;
                    return (
                      <button
                        key={`${hit.line}:${hit.character}`}
                        type="button"
                        className="code-refs-hit"
                        disabled={path == null}
                        onClick={() => path && onOpen(path, hit.line)}
                      >
                        <span className="code-refs-line">{hit.line + 1}</span>
                        <span className="code-refs-preview">{hit.preview}</span>
                      </button>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});
