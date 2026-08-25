// 전역 검색 패널 (#project-search) — 파일 트리 자리를 통째로 바꿔 앉는 VS Code
// 식 검색 사이드바. 검색어를 치는 대로 디바운스로 찾고, 결과는 파일별로 묶어
// 접었다 편다. 치환은 디스크를 **직접** 고친다 — 열려 있는 깨끗한 버퍼는
// watcher 가 알아서 최신화하고, 미저장 파일은 건너뛰어 편집을 지키는 계약은
// 호출자(CodeScreenV2)가 넘겨준 dirtyPaths 로 지킨다.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CaseSensitive,
  ChevronRight,
  Regex,
  Replace,
  ReplaceAll,
  Search,
  WholeWord,
  X,
} from "@/components/Icons";
import { commands, type CodeSearchHit, type CodeSearchResult } from "@/lib/bindings";
import { AppDialog } from "@/components/ui/AppDialog";
import { toast } from "@/lib/toast";
import { t, useT } from "@/i18n";
import { FileIcon } from "./FileIcon";
import {
  dropFile,
  previewSegments,
  replaceablePaths,
  splitPath,
  type SearchOpts,
} from "./searchPanelModel";

/** 타이핑 → 검색 사이의 디바운스. VS Code 와 비슷한 체감(즉답도, 낭비도 아님). */
const SEARCH_DEBOUNCE_MS = 300;

interface CodeSearchPanelProps {
  projectId: number;
  opts: SearchOpts;
  onOptsChange: (next: SearchOpts) => void;
  /** 미저장 경로들 — 배지로 알리고 치환에서 건너뛴다. */
  dirtyPaths: Set<string>;
  /** 매치 클릭 — 파일을 열고 그 범위를 선택한다 (line 1-based, ch/len UTF-16). */
  onOpenHit: (path: string, line: number, ch: number, len: number) => void;
  /** 파일 트리로 돌아가기. */
  onClose: () => void;
  /** ⇧⌘F 재입력 — 이미 열려 있으면 입력창만 다시 포커스한다. */
  focusSeq: number;
}

export const CodeSearchPanel = memo(function CodeSearchPanel({
  projectId,
  opts,
  onOptsChange,
  dirtyPaths,
  onOpenHit,
  onClose,
  focusSeq,
}: CodeSearchPanelProps) {
  useT();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [result, setResult] = useState<CodeSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  // 응답 순서 가드 — 늦게 온 낡은 응답이 새 결과를 덮지 않게.
  const seqRef = useRef(0);
  const runSearch = useCallback(
    (q: string, o: SearchOpts) => {
      const seq = ++seqRef.current;
      if (!q) {
        setResult(null);
        setError(null);
        setSearching(false);
        return;
      }
      setSearching(true);
      void commands.codeSearch(projectId, q, o.caseSensitive, o.wholeWord, o.regex).then((res) => {
        if (seq !== seqRef.current) return;
        setSearching(false);
        if (res.status === "error") {
          setResult(null);
          setError(res.error);
          return;
        }
        setError(null);
        setResult(res.data);
        setCollapsed(new Set());
      });
    },
    [projectId],
  );

  // 검색어·토글이 바뀌면 디바운스로 다시 찾는다.
  useEffect(() => {
    const timer = window.setTimeout(() => runSearch(query, opts), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, opts, runSearch]);

  const toggle = useCallback(
    (key: keyof SearchOpts) => onOptsChange({ ...opts, [key]: !opts[key] }),
    [opts, onOptsChange],
  );

  // ── 치환 ────────────────────────────────────────────────────────────────
  //
  // 세 층위(한 매치 / 한 파일 / 전부) 모두 같은 커맨드를 탄다. 끝나면 항상
  // 다시 검색한다 — 디스크가 진실이고, 지역적으로 목록을 고치는 것보다
  // "치환 후 실제로 남은 매치" 를 보여주는 쪽이 정직하다.
  const applyReplace = useCallback(
    async (paths: string[], target: { path: string; line: number; col: number } | null) => {
      if (replacing) return;
      setReplacing(true);
      try {
        const res = await commands.codeSearchReplace(
          projectId,
          query,
          replacement,
          opts.caseSensitive,
          opts.wholeWord,
          opts.regex,
          paths,
          target,
        );
        if (res.status === "error") {
          toast.destructive(t("code.search.failed", { error: res.error }));
          return;
        }
        const out = res.data;
        if (out.errors.length > 0) {
          toast.destructive(
            t("code.search.replaceErrors", { count: out.errors.length, first: out.errors[0] }),
          );
        }
        if (out.hits_replaced > 0) {
          toast.info(
            t("code.search.replaced", { count: out.hits_replaced, files: out.files_changed }),
          );
        } else if (out.errors.length === 0) {
          toast.info(t("code.search.replaceNone"));
        }
        runSearch(query, opts);
      } finally {
        setReplacing(false);
      }
    },
    [projectId, query, replacement, opts, replacing, runSearch],
  );

  const replaceAll = useCallback(() => {
    if (!result || result.files.length === 0) return;
    setConfirmAll(false);
    const { paths, skippedDirty } = replaceablePaths(result.files, dirtyPaths);
    if (skippedDirty > 0) toast.warning(t("code.search.skippedDirty", { count: skippedDirty }));
    if (paths.length === 0) return;
    void applyReplace(paths, null);
  }, [result, dirtyPaths, applyReplace]);

  const replaceFile = useCallback(
    (path: string) => {
      if (dirtyPaths.has(path)) {
        toast.warning(t("code.search.skippedDirty", { count: 1 }));
        return;
      }
      void applyReplace([path], null);
    },
    [dirtyPaths, applyReplace],
  );

  const replaceHit = useCallback(
    (path: string, hit: CodeSearchHit) => {
      if (dirtyPaths.has(path)) {
        toast.warning(t("code.search.skippedDirty", { count: 1 }));
        return;
      }
      void applyReplace([], { path, line: hit.line, col: hit.col });
    },
    [dirtyPaths, applyReplace],
  );

  const summary = useMemo(() => {
    if (!result) return null;
    if (result.files.length === 0) return t("code.search.none");
    return t("code.search.summary", { files: result.files.length, count: result.total_hits });
  }, [result]);

  const canReplace = replaceOpen && query !== "" && !replacing;

  return (
    <div className="code-search" role="region" aria-label={t("code.search.title")}>
      <div className="code-search-head">
        <strong className="code-search-title">{t("code.search.title")}</strong>
        {searching ? <span className="code-search-spin" aria-hidden /> : null}
        <span className="code-search-spacer" />
        <button
          type="button"
          className="code-tool-btn sm"
          onClick={onClose}
          title={t("code.search.close")}
          aria-label={t("code.search.close")}
        >
          <X size={14} />
        </button>
      </div>

      <div className="code-search-input-row">
        <div className="code-filter code-search-input">
          <Search size={13} className="code-filter-ico" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query, opts);
            }}
            placeholder={t("code.search.placeholder")}
            aria-label={t("code.search.placeholder")}
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          className={"code-tool-btn sm" + (opts.caseSensitive ? " on" : "")}
          onClick={() => toggle("caseSensitive")}
          aria-pressed={opts.caseSensitive}
          title={t("code.search.caseSensitive")}
          aria-label={t("code.search.caseSensitive")}
        >
          <CaseSensitive size={14} />
        </button>
        <button
          type="button"
          className={"code-tool-btn sm" + (opts.wholeWord ? " on" : "")}
          onClick={() => toggle("wholeWord")}
          aria-pressed={opts.wholeWord}
          title={t("code.search.wholeWord")}
          aria-label={t("code.search.wholeWord")}
        >
          <WholeWord size={14} />
        </button>
        <button
          type="button"
          className={"code-tool-btn sm" + (opts.regex ? " on" : "")}
          onClick={() => toggle("regex")}
          aria-pressed={opts.regex}
          title={t("code.search.regex")}
          aria-label={t("code.search.regex")}
        >
          <Regex size={14} />
        </button>
      </div>

      <div className="code-search-input-row">
        <button
          type="button"
          className="code-search-replace-toggle"
          onClick={() => setReplaceOpen((v) => !v)}
          aria-expanded={replaceOpen}
          title={t("code.search.toggleReplace")}
          aria-label={t("code.search.toggleReplace")}
        >
          <ChevronRight size={12} className={"code-tree-caret" + (replaceOpen ? " open" : "")} />
        </button>
        {replaceOpen ? (
          <>
            <div className="code-filter code-search-input">
              <input
                type="text"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder={t("code.search.replacePlaceholder")}
                aria-label={t("code.search.replacePlaceholder")}
                spellCheck={false}
              />
            </div>
            <button
              type="button"
              className="code-tool-btn sm"
              disabled={!canReplace || !result || result.files.length === 0}
              onClick={() => setConfirmAll(true)}
              title={t("code.search.replaceAll")}
              aria-label={t("code.search.replaceAll")}
            >
              <ReplaceAll size={14} />
            </button>
          </>
        ) : (
          <span className="code-search-replace-hint">{t("code.search.replacePlaceholder")}</span>
        )}
      </div>

      {error ? (
        <div className="code-search-error">{t("code.search.invalid", { error })}</div>
      ) : null}
      {summary ? <div className="code-search-summary">{summary}</div> : null}
      {result?.truncated ? (
        <div className="code-search-truncated">{t("code.search.truncated")}</div>
      ) : null}

      <div className="code-search-results">
        {result?.files.map((file) => {
          const open = !collapsed.has(file.path);
          const { name, dir } = splitPath(file.path);
          const dirty = dirtyPaths.has(file.path);
          return (
            <div key={file.path} className="code-search-file">
              <div className="code-search-file-row">
                <button
                  type="button"
                  className="code-search-file-head"
                  aria-expanded={open}
                  title={file.path}
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
                  <FileIcon name={name} size={14} className="code-search-ico" />
                  <span className="code-search-name">{name}</span>
                  {dir ? <span className="code-search-dir">{dir}</span> : null}
                </button>
                {dirty ? <span className="code-search-dirty">{t("code.search.dirty")}</span> : null}
                <span className="code-search-count">{file.hits.length}</span>
                <span className="code-search-file-actions">
                  {canReplace && !dirty ? (
                    <button
                      type="button"
                      className="code-tool-btn sm"
                      onClick={() => replaceFile(file.path)}
                      title={t("code.search.replaceFile")}
                      aria-label={t("code.search.replaceFile")}
                    >
                      <ReplaceAll size={13} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="code-tool-btn sm"
                    onClick={() => setResult((prev) => (prev ? dropFile(prev, file.path) : prev))}
                    title={t("code.search.dismissFile")}
                    aria-label={t("code.search.dismissFile")}
                  >
                    <X size={13} />
                  </button>
                </span>
              </div>
              {open
                ? file.hits.map((hit, i) => (
                    <div key={`${hit.line}:${hit.col}:${i}`} className="code-search-hit-row">
                      <button
                        type="button"
                        className="code-search-hit"
                        onClick={() => onOpenHit(file.path, hit.line, hit.col, hit.len)}
                      >
                        <span className="code-search-line">{hit.line}</span>
                        <span className="code-search-preview">
                          {previewSegments(hit.preview, hit.preview_col, hit.len).map(
                            (seg, j) =>
                              seg.hit ? (
                                <mark key={j} className="s-hit">
                                  {seg.text}
                                </mark>
                              ) : (
                                <span key={j}>{seg.text}</span>
                              ),
                          )}
                        </span>
                      </button>
                      {canReplace && !dirty ? (
                        <button
                          type="button"
                          className="code-tool-btn sm code-search-hit-replace"
                          onClick={() => replaceHit(file.path, hit)}
                          title={t("code.search.replaceHit")}
                          aria-label={t("code.search.replaceHit")}
                        >
                          <Replace size={13} />
                        </button>
                      ) : null}
                    </div>
                  ))
                : null}
            </div>
          );
        })}
      </div>

      <AppDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        label={t("code.search.confirmTitle")}
        width={420}
      >
        <div className="code-search-confirm">
          <strong>{t("code.search.confirmTitle")}</strong>
          <p>
            {t("code.search.confirmBody", {
              files: result?.files.length ?? 0,
              count: result?.total_hits ?? 0,
              replacement,
            })}
          </p>
          <div className="code-search-confirm-actions">
            <button type="button" className="btn ghost sm" onClick={() => setConfirmAll(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn sm" onClick={replaceAll}>
              {t("code.search.confirm")}
            </button>
          </div>
        </div>
      </AppDialog>
    </div>
  );
});
