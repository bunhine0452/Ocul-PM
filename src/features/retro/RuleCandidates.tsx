// PR-CI4 — 회고 화면의 "규칙 후보" 섹션 (실패→규칙 승격 루프의 UI).
//
// 결정적 후보(rule_candidates, LLM 없음)를 그리고, 사용자가 "초안 생성"을
// 누를 때만 과금 LLM 초안(rule_draft_generate)을 만든 뒤, 제안 카드에서
// **명시적 승인**으로만 기존 rules_save(CI3, create=true) 를 호출한다 —
// 이 컴포넌트 어디에도 자동 저장 경로가 없다 (draft=AI, decision=사람).
// 거절/숨기기는 상태만 바꾸고 아무 커맨드도 부르지 않는다.
import { useEffect, useMemo, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { AppDialog } from "@/components/ui/AppDialog";
import { OculSpinner } from "@/components/OculSpinner";
import { ClipboardCheck, SparklesIcon, X } from "@/components/Icons";
import { toast } from "@/lib/toast";
import { resolveLlmTarget } from "@/lib/llmTarget";
import { commands, type RuleCandidate, type RuleDraft } from "@/lib/bindings";
import { isValidRuleName } from "@/features/skills/rulesModel";

const KIND_LABEL: Record<string, string> = { bug: "버그", error: "에러" };

/** "YYYYMMDD" → "M/D". */
function wd(s: string): string {
  if (s.length !== 8) return s;
  return `${Number(s.slice(4, 6))}/${Number(s.slice(6, 8))}`;
}

export function RuleCandidatesPanel({
  projectId,
  since,
  until,
}: {
  projectId: number;
  since: string;
  until: string;
}) {
  const [cands, setCands] = useState<RuleCandidate[]>([]);
  /** 세션-로컬 숨김/저장 키 — 파일에는 아무것도 쓰지 않는다. */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(new Set());
  const [draftingKey, setDraftingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setCands([]);
    setDismissed(new Set());
    setSavedKeys(new Set());
    void commands.ruleCandidates(projectId, since, until).then((res) => {
      if (!alive) return;
      // 후보 조회 실패는 회고 화면을 막을 일이 아니다 — 섹션을 그리지 않는다.
      if (res.status === "ok") setCands(res.data);
    });
    return () => {
      alive = false;
    };
  }, [projectId, since, until]);

  const visible = useMemo(
    () => cands.filter((c) => !dismissed.has(c.key) && !savedKeys.has(c.key)),
    [cands, dismissed, savedKeys],
  );

  const generateDraft = async (c: RuleCandidate) => {
    if (draftingKey) return;
    const target = await resolveLlmTarget();
    if (!target) {
      toast.warning("설정에서 기본 AI 제공자/모델을 먼저 지정하세요.");
      return;
    }
    setDraftingKey(c.key);
    const res = await commands.ruleDraftGenerate(
      projectId,
      since,
      until,
      c.key,
      target.provider,
      target.model,
    );
    setDraftingKey(null);
    if (res.status === "ok") {
      setDraft(res.data);
      setSlug(res.data.slug);
    } else {
      toast.destructive(`규칙 초안 생성 실패: ${res.error}`);
    }
  };

  const slugValid = isValidRuleName(slug.trim());
  const approve = async () => {
    if (!draft || saving || !slugValid) return;
    setSaving(true);
    const relPath = `.claude/rules/${slug.trim()}.md`;
    const res = await commands.rulesSave(projectId, "project", relPath, draft.content, true);
    setSaving(false);
    if (res.status === "ok") {
      if (res.data.mirror?.action === "conflict") {
        toast.destructive(
          `저장됨 — 단, Cursor 미러 충돌: ${res.data.mirror.mirror_rel} 에 ocul-pm 소유가 아닌 파일이 있어 건드리지 않았습니다`,
        );
      } else {
        toast.info(`규칙이 저장되었습니다: ${relPath} — 스킬·규칙 화면에서 관리할 수 있어요`);
      }
      setSavedKeys((prev) => new Set(prev).add(draft.candidate_key));
      setDraft(null);
    } else {
      // 예: 같은 이름의 파일 존재 — 슬러그를 고쳐 다시 시도할 수 있게 모달 유지.
      toast.destructive(res.error);
    }
  };

  if (visible.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground">
          <ClipboardCheck size={15} />
        </span>
        규칙 후보
      </div>
      <p className="mb-2.5 text-xs text-muted-foreground">
        같은 영역에서 에러·버그가 반복됐어요. 재발을 막는 규칙(
        <code className="font-mono text-[11px]">.claude/rules</code>)으로 승격할 수 있습니다 —
        저장은 항상 사람의 승인으로만 이뤄집니다.
      </p>
      <ul className="flex flex-col gap-2">
        {visible.map((c) => (
          <li
            key={c.key}
            className="rounded-md border border-border/60 bg-background/40 px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-xs text-foreground">{c.area}</span>
              <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {c.kinds.map((k) => KIND_LABEL[k] ?? k).join("·")} {c.entry_count}건
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                최근 {wd(c.last_workday)}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                className="btn sm"
                disabled={draftingKey != null}
                onClick={() => void generateDraft(c)}
                title="이 반복 실패의 증거(일지 발췌)를 AI 로 요약해 규칙 초안을 만듭니다 (과금 호출)"
              >
                {draftingKey === c.key ? (
                  <>
                    <OculSpinner size={13} /> 초안 생성 중…
                  </>
                ) : (
                  <>
                    <SparklesIcon size={13} /> 초안 생성
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn ghost sm"
                aria-label={`${c.area} 후보 숨기기`}
                title="이 후보를 이번 세션에서 숨깁니다 (파일 변경 없음)"
                onClick={() => setDismissed((prev) => new Set(prev).add(c.key))}
              >
                <X size={13} />
              </button>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {c.sample_titles.join(" · ")}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {c.suggested_paths.map((p) => (
                <span key={p} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {p}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* 초안 제안 카드 — 닫기(거절)는 아무 파일도 바꾸지 않는다. */}
      <AppDialog
        open={draft != null}
        onClose={() => setDraft(null)}
        label="규칙 초안 제안"
        width={672}
      >
        {draft ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <SparklesIcon size={15} />
              <span className="text-sm font-semibold">{draft.title}</span>
              <span className="text-xs text-muted-foreground">AI 초안 · 승인해야 저장됩니다</span>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto p-4">
              <div>
                <label
                  htmlFor="rp-slug"
                  className="mb-1 block text-xs font-semibold text-muted-foreground"
                >
                  파일 이름 (슬러그)
                </label>
                <input
                  id="rp-slug"
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <div
                  className={
                    "mt-1 text-[11px] " +
                    (slug.trim() && !slugValid ? "text-red-400" : "text-muted-foreground")
                  }
                >
                  {slug.trim() && !slugValid
                    ? "영문 소문자·숫자·하이픈(kebab-case)만 쓸 수 있습니다"
                    : `.claude/rules/${slug.trim() || "…"}.md 로 저장됩니다`}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">paths</div>
                {draft.paths.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    (없음 — 세션 시작 시 항상 로드)
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {draft.paths.map((p) => (
                      <span
                        key={p}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-3">
                <Markdown>{draft.body_markdown}</Markdown>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                className="btn ghost sm"
                disabled={saving}
                onClick={() => setDraft(null)}
              >
                거절
              </button>
              <button
                type="button"
                className="btn primary sm"
                disabled={saving || !slugValid}
                onClick={() => void approve()}
              >
                {saving ? "저장 중…" : "규칙으로 저장"}
              </button>
            </div>
          </>
        ) : null}
      </AppDialog>
    </div>
  );
}
