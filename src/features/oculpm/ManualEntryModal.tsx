/**
 * ManualEntryModal — write a new journal entry by hand.
 *
 * Driven by:
 *   - the [수동 entry 작성] button in EmptyTodayV2 / V3 / SessionCard
 *   - the global ⌘+Shift+J shortcut (App.tsx wires it)
 *
 * Fields (PR3's `ManualEntryDraft` shape, all client-validated):
 *   - type (radio chips)
 *   - slug (input, kebab-case regex hint)
 *   - title (input, required)
 *   - difficulty (select, optional)
 *   - status (select, default planned)
 *   - tags (free-form chip input)
 *   - files_touched (chip multi-select pre-filled from today's
 *     `getFileChanges` so the user can confirm with one tap)
 *   - body_markdown (textarea, optional)
 *
 * Backend authoritative — slug regex / session_id resolution / file
 * naming all done by `oculpm_create_manual_entry`. The frontend's
 * client-side slug check exists purely to surface the error inline
 * instead of round-tripping through the backend.
 */

import { useEffect, useRef, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Difficulty,
  EntryStatus,
  EntryType,
  FileChangeEvent,
  FileTouched,
  JournalEntry,
  ManualEntryDraft,
} from "@/lib/bindings";
import {
  Check,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "@/components/Icons";

interface ManualEntryModalProps {
  projectId: number;
  workday: string;
  /** Called after a successful create with the hydrated entry. */
  onCreated: (entry: JournalEntry) => void;
  onClose: () => void;
}

const ENTRY_TYPES: EntryType[] = ["bug", "feature", "error", "refactor", "chore"];
const ENTRY_STATUSES: EntryStatus[] = ["planned", "in_progress", "done", "abandoned"];
const DIFFICULTIES: Difficulty[] = ["verylow", "low", "medium", "high", "superhigh"];

// Mirrors backend `validate_slug` (see oculpm/manager.rs). Reject early.
const SLUG_RE = /^[a-z0-9-]{1,60}$/;

export function ManualEntryModal({
  projectId,
  workday,
  onCreated,
  onClose,
}: ManualEntryModalProps) {
  const [type, setType] = useState<EntryType>("bug");
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

  // ── file_changes auto-fill source ─────────────────────────────────────
  const [fileCandidates, setFileCandidates] = useState<string[]>([]);
  const [filesTouched, setFilesTouched] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const changes = await oculpmApi.getFileChanges(projectId, workday);
        if (cancelled) return;
        const paths = uniquePaths(changes).slice(0, 30);
        setFileCandidates(paths);
      } catch {
        // Non-fatal: just no candidates to pre-fill.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, workday]);

  // Slug validation surfaces inline (no debounce — single regex).
  useEffect(() => {
    if (slug === "") {
      setSlugError(null);
      return;
    }
    if (!SLUG_RE.test(slug)) {
      setSlugError(
        "slug 은 소문자/숫자/하이픈만 (1–60자). 예: changelog-export-fix"
      );
    } else {
      setSlugError(null);
    }
  }, [slug]);

  // Esc handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  // Autofocus title on mount.
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const canSubmit =
    !submitting &&
    title.trim().length > 0 &&
    slug.trim().length > 0 &&
    slugError == null;

  const toggleFile = (path: string) => {
    setFilesTouched((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const commitTag = () => {
    const v = tagsInput.trim().replace(/^#/, "");
    if (v.length === 0) return;
    if (tags.includes(v)) {
      setTagsInput("");
      return;
    }
    setTags((prev) => [...prev, v]);
    setTagsInput("");
  };

  const removeTag = (t: string) => {
    setTags((prev) => prev.filter((x) => x !== t));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
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
      const msg =
        e instanceof OculpmApiError
          ? `${e.command} 실패: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
      >
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Plus className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold">수동 entry 작성</h2>
            <span className="text-xs text-muted-foreground font-medium tabular-nums">
              workday {workday}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="닫기 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin space-y-5">
          {/* Type chips */}
          <div>
            <Label className="text-xs mb-2">type</Label>
            <div className="flex flex-wrap gap-1.5">
              {ENTRY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-2.5 py-1 text-xs rounded-full border font-medium uppercase tracking-wider transition-colors ${
                    type === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <Label htmlFor="manual-title" className="text-xs mb-2">
              title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="manual-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: Changelog Export 파라미터 불일치"
              maxLength={140}
            />
          </div>

          {/* Slug */}
          <div>
            <Label htmlFor="manual-slug" className="text-xs mb-2">
              slug <span className="text-destructive">*</span>
              <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                (kebab-case, 1–60자, ASCII)
              </span>
            </Label>
            <Input
              id="manual-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="changelog-export-param-mismatch"
              aria-invalid={slugError != null}
              maxLength={60}
            />
            {slugError && (
              <p className="mt-1 text-[11px] text-destructive">{slugError}</p>
            )}
          </div>

          {/* Difficulty + status (side by side) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-2">difficulty</Label>
              <Select
                value={difficulty ?? "_none"}
                onValueChange={(v) =>
                  setDifficulty(v === "_none" ? null : (v as Difficulty))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— (없음)</SelectItem>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-2">status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as EntryStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTRY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <Label className="text-xs mb-2">tags</Label>
            <div className="flex flex-wrap items-center gap-1.5 mb-2 min-h-[1.25rem]">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => removeTag(t)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-mono hover:bg-muted/70 transition-colors"
                >
                  #{t}
                  <X className="w-2.5 h-2.5" />
                </button>
              ))}
              {tags.length === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  아래 입력 후 Enter
                </span>
              )}
            </div>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  commitTag();
                }
              }}
              placeholder="tag-name (Enter 또는 , 로 추가)"
            />
          </div>

          {/* files_touched candidates */}
          <div>
            <Label className="text-xs mb-2">
              files_touched
              <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                (오늘 변경된 파일 — 클릭으로 토글)
              </span>
            </Label>
            {fileCandidates.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                오늘 추적된 파일 변경이 없습니다. 필요하면 비워두세요.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto scrollbar-thin rounded-lg border border-border bg-muted/20 p-2">
                {fileCandidates.map((path) => {
                  const checked = filesTouched.has(path);
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => toggleFile(path)}
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-mono transition-colors ${
                        checked
                          ? "bg-primary/15 text-primary border border-primary/40"
                          : "bg-card text-muted-foreground border border-border hover:bg-muted"
                      }`}
                    >
                      {checked && <Check className="w-2.5 h-2.5" />}
                      {path}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* body_markdown */}
          <div>
            <Label htmlFor="manual-body" className="text-xs mb-2">
              본문 (markdown, 선택)
            </Label>
            <textarea
              id="manual-body"
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              placeholder={"## 발생 원인\n…\n\n## 해결 방법\n…"}
              className="w-full h-32 px-3 py-2 border border-border rounded-lg bg-background text-sm resize-y focus:outline-none focus:border-primary transition-colors font-mono"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-border flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-muted-foreground">
            session_id 가 비어있으면 활성 세션 또는{" "}
            <code className="px-1 py-0.5 rounded bg-muted">
              manual-{workday}-…
            </code>{" "}
            sentinel 이 자동 부여됩니다.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={onClose}
              disabled={submitting}
            >
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  작성 중…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  작성
                </>
              )}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

function uniquePaths(changes: FileChangeEvent[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of changes) {
    if (!seen.has(c.path)) {
      seen.add(c.path);
      result.push(c.path);
    }
  }
  return result;
}

