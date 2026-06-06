import { useEffect, useId, useRef, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { Plus, X, CheckMark } from "@/components/Icons";
import type {
  Difficulty,
  EntryStatus,
  EntryType,
  FileChangeEvent,
  FileTouched,
  JournalEntry,
  ManualEntryDraft,
} from "@/lib/bindings";

// PR-R1 (A4) — 수동 일지 작성 모달 (ui_v2 토큰 셸).
//
// 직전 라운드(PR-UI 3 §0.9)에서 "ManualEntryModal 이 레거시 shadcn 이라 ui_v2 에
// 못 끼움" 으로 보류했던 ⌘N 을 PR-UI 6 의 .set-modal 패턴으로 신규 구현. 로직은
// legacy ManualEntryModal 과 동일(백엔드 oculpm_create_manual_entry 가 권위 —
// slug 검증/session 해석/파일 네이밍 담당). 프론트 slug 검사는 인라인 에러용.

const ENTRY_TYPES: EntryType[] = ["bug", "feature", "error", "refactor", "chore"];
const ENTRY_STATUSES: EntryStatus[] = ["planned", "in_progress", "done", "abandoned"];
const DIFFICULTIES: Difficulty[] = ["verylow", "low", "medium", "high", "superhigh"];

// Mirrors backend validate_slug (oculpm/manager.rs). Reject early.
const SLUG_RE = /^[a-z0-9-]{1,60}$/;

interface ManualEntryModalV2Props {
  projectId: number;
  /** YYYYMMDD — file-change autofill source + sentinel hint. */
  workday: string;
  /** Called after a successful create with the hydrated entry. */
  onCreated: (entry: JournalEntry) => void;
  onClose: () => void;
}

export function ManualEntryModalV2({
  projectId,
  workday,
  onCreated,
  onClose,
}: ManualEntryModalV2Props) {
  const titleId = useId();
  const [type, setType] = useState<EntryType>("feature");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | null>("medium");
  const [status, setStatus] = useState<EntryStatus>("planned");
  const [tagsInput, setTagsInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);

  const [fileCandidates, setFileCandidates] = useState<string[]>([]);
  const [filesTouched, setFilesTouched] = useState<Set<string>>(new Set());

  // Pre-fill candidates from today's tracked file changes (non-fatal).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const changes = await oculpmApi.getFileChanges(projectId, workday);
        if (cancelled) return;
        setFileCandidates(uniquePaths(changes).slice(0, 30));
      } catch {
        // no candidates — fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, workday]);

  useEffect(() => {
    if (slug === "") {
      setSlugError(null);
    } else if (!SLUG_RE.test(slug)) {
      setSlugError("slug 은 소문자/숫자/하이픈만 (1–60자). 예: changelog-export-fix");
    } else {
      setSlugError(null);
    }
  }, [slug]);

  // Esc closes. Stop propagation so the journal screen's ⌘F/⌘N don't also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const canSubmit =
    !submitting && title.trim().length > 0 && slug.trim().length > 0 && slugError == null;

  const toggleFile = (path: string) =>
    setFilesTouched((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const commitTag = () => {
    const v = tagsInput.trim().replace(/^#/, "");
    if (v.length === 0) return;
    if (!tags.includes(v)) setTags((prev) => [...prev, v]);
    setTagsInput("");
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const draft: ManualEntryDraft = {
      type,
      slug: slug.trim(),
      title: title.trim(),
      difficulty,
      body_markdown: bodyMarkdown,
      session_id: null,
      files_touched: Array.from(filesTouched).map<FileTouched>((path) => ({
        path,
        op: "update",
        bytes_added: null,
        bytes_removed: null,
        rename_from: null,
      })),
      status,
      tags,
    };
    try {
      const entry = await oculpmApi.createManualEntry(projectId, draft);
      onCreated(entry);
      onClose();
    } catch (e) {
      setError(
        e instanceof OculpmApiError
          ? `${e.command} 실패: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="set-modal-backdrop" onMouseDown={() => !submitting && onClose()}>
      <div
        className="set-modal set-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="set-modal-title" id={titleId}>
          <Plus size={16} /> 수동 일지 작성{" "}
          <span className="entry-hint">workday {workday}</span>
        </div>
        <div className="set-modal-desc">
          에이전트가 놓친 작업을 직접 기록합니다. session_id 가 비면 활성 세션 또는
          manual-{workday}-… 이 자동 부여됩니다.
        </div>

        <form
          className="entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/* type */}
          <div className="entry-field">
            <label className="entry-label">트리거</label>
            <div className="entry-chips">
              {ENTRY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={"scope-chip" + (type === t ? " on" : "")}
                  onClick={() => setType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* title */}
          <div className="entry-field">
            <label className="entry-label" htmlFor={`${titleId}-title`}>
              제목<span className="req">*</span>
            </label>
            <input
              id={`${titleId}-title`}
              ref={titleRef}
              className="set-modal-input"
              value={title}
              maxLength={140}
              placeholder="예: Changelog Export 파라미터 불일치"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* slug */}
          <div className="entry-field">
            <label className="entry-label" htmlFor={`${titleId}-slug`}>
              slug<span className="req">*</span>
              <span className="entry-hint">kebab-case · 1–60자 · ASCII</span>
            </label>
            <input
              id={`${titleId}-slug`}
              className="set-modal-input"
              value={slug}
              maxLength={60}
              aria-invalid={slugError != null}
              placeholder="changelog-export-param-mismatch"
              onChange={(e) => setSlug(e.target.value)}
            />
            {slugError ? <div className="entry-err">{slugError}</div> : null}
          </div>

          {/* difficulty + status */}
          <div className="entry-row2">
            <div className="entry-field">
              <label className="entry-label" htmlFor={`${titleId}-diff`}>
                난이도
              </label>
              <select
                id={`${titleId}-diff`}
                className="set-modal-input"
                value={difficulty ?? "_none"}
                onChange={(e) =>
                  setDifficulty(e.target.value === "_none" ? null : (e.target.value as Difficulty))
                }
              >
                <option value="_none">— (없음)</option>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="entry-field">
              <label className="entry-label" htmlFor={`${titleId}-status`}>
                상태
              </label>
              <select
                id={`${titleId}-status`}
                className="set-modal-input"
                value={status}
                onChange={(e) => setStatus(e.target.value as EntryStatus)}
              >
                {ENTRY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* tags */}
          <div className="entry-field">
            <label className="entry-label" htmlFor={`${titleId}-tags`}>
              태그<span className="entry-hint">Enter 또는 , 로 추가</span>
            </label>
            {tags.length > 0 ? (
              <div className="entry-chips">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="entry-tag"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                  >
                    #{t} <X size={11} />
                  </button>
                ))}
              </div>
            ) : null}
            <input
              id={`${titleId}-tags`}
              className="set-modal-input"
              value={tagsInput}
              placeholder="tag-name"
              onChange={(e) => setTagsInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  commitTag();
                }
              }}
            />
          </div>

          {/* files_touched */}
          <div className="entry-field">
            <label className="entry-label">
              변경 파일<span className="entry-hint">오늘 변경된 파일 — 클릭으로 토글</span>
            </label>
            {fileCandidates.length === 0 ? (
              <div className="entry-hint">오늘 추적된 파일 변경이 없어요. 비워둬도 됩니다.</div>
            ) : (
              <div className="entry-files">
                {fileCandidates.map((path) => {
                  const checked = filesTouched.has(path);
                  return (
                    <button
                      key={path}
                      type="button"
                      className={"scope-chip" + (checked ? " on" : "")}
                      style={{ fontFamily: "var(--mono)" }}
                      onClick={() => toggleFile(path)}
                    >
                      {checked ? <CheckMark size={11} strokeWidth={3} /> : null}
                      {path}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* body */}
          <div className="entry-field">
            <label className="entry-label" htmlFor={`${titleId}-body`}>
              본문<span className="entry-hint">markdown · 선택</span>
            </label>
            <textarea
              id={`${titleId}-body`}
              className="entry-textarea"
              value={bodyMarkdown}
              placeholder={"## 발생 원인\n…\n\n## 해결 방법\n…"}
              onChange={(e) => setBodyMarkdown(e.target.value)}
            />
          </div>

          {error ? <div className="entry-err">{error}</div> : null}
        </form>

        <div className="set-modal-actions">
          <button type="button" className="btn sm" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button
            type="button"
            className="btn sm primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {submitting ? "작성 중…" : "작성"}
          </button>
        </div>
      </div>
    </div>
  );
}

function uniquePaths(changes: FileChangeEvent[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of changes) {
    if (!seen.has(c.path)) {
      seen.add(c.path);
      out.push(c.path);
    }
  }
  return out;
}
