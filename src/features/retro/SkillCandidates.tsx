// 회고 화면의 "스킬 후보" 섹션 — 반복 절차→스킬 승격 루프의 UI (RuleCandidates
// 의 미러).
//
// 결정적 후보(skill_candidates, LLM 없음)를 그리고, 사용자가 "초안 생성"을
// 누를 때만 과금 LLM 초안(skill_draft_generate)을 만든 뒤, 제안 카드에서
// **명시적 승인**으로만 기존 skills_save(scope=project, create=true) 를 호출한다
// — 이 컴포넌트 어디에도 자동 저장 경로가 없다 (draft=AI, decision=사람).
// 거절/숨기기는 상태만 바꾸고 아무 커맨드도 부르지 않는다.
import { useEffect, useMemo, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { AppDialog } from "@/components/ui/AppDialog";
import { OculSpinner } from "@/components/OculSpinner";
import { Puzzle, SparklesIcon, X } from "@/components/Icons";
import { toast } from "@/lib/toast";
import { resolveLlmTarget } from "@/lib/llmTarget";
import { commands, type SkillCandidate, type SkillDraft } from "@/lib/bindings";
import { isValidSkillName } from "@/features/skills/skillsModel";

/** "YYYYMMDD" → "M/D". */
function wd(s: string): string {
  if (s.length !== 8) return s;
  return `${Number(s.slice(4, 6))}/${Number(s.slice(6, 8))}`;
}

export function SkillCandidatesPanel({
  projectId,
  since,
  until,
}: {
  projectId: number;
  since: string;
  until: string;
}) {
  const [cands, setCands] = useState<SkillCandidate[]>([]);
  /** 세션-로컬 숨김/저장 키 — 파일에는 아무것도 쓰지 않는다. */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [savedTags, setSavedTags] = useState<ReadonlySet<string>>(new Set());
  const [draftingTag, setDraftingTag] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setCands([]);
    setDismissed(new Set());
    setSavedTags(new Set());
    void commands.skillCandidates(projectId, since, until).then((res) => {
      if (!alive) return;
      // 후보 조회 실패는 회고 화면을 막을 일이 아니다 — 섹션을 그리지 않는다.
      if (res.status === "ok") setCands(res.data);
    });
    return () => {
      alive = false;
    };
  }, [projectId, since, until]);

  const visible = useMemo(
    () => cands.filter((c) => !dismissed.has(c.tag) && !savedTags.has(c.tag)),
    [cands, dismissed, savedTags],
  );

  const generateDraft = async (c: SkillCandidate) => {
    if (draftingTag) return;
    const target = await resolveLlmTarget();
    if (!target) {
      toast.warning("설정에서 기본 AI 제공자/모델을 먼저 지정하세요.");
      return;
    }
    setDraftingTag(c.tag);
    const res = await commands.skillDraftGenerate(
      projectId,
      since,
      until,
      c.tag,
      target.provider,
      target.model,
    );
    setDraftingTag(null);
    if (res.status === "ok") {
      setDraft(res.data);
      setSlug(res.data.slug);
    } else {
      toast.destructive(`스킬 초안 생성 실패: ${res.error}`);
    }
  };

  const slugValid = isValidSkillName(slug.trim());
  const approve = async () => {
    if (!draft || saving || !slugValid) return;
    setSaving(true);
    const dirName = slug.trim();
    // 슬러그를 바꿨으면 frontmatter name 도 폴더명과 일치시킨다 (content 첫
    // name: 줄은 백엔드가 결정적으로 조립한 값이라 안전하게 치환 가능).
    const content = draft.content.replace(/^name: .*$/m, `name: ${dirName}`);
    const res = await commands.skillsSave(projectId, "project", dirName, content, true);
    setSaving(false);
    if (res.status === "ok") {
      toast.info(
        `스킬이 저장되었습니다: .claude/skills/${dirName}/SKILL.md — 스킬·규칙 화면에서 관리할 수 있어요`,
      );
      setSavedTags((prev) => new Set(prev).add(draft.tag));
      setDraft(null);
    } else {
      // 예: 같은 이름의 스킬 존재 — 슬러그를 고쳐 다시 시도할 수 있게 모달 유지.
      toast.destructive(res.error);
    }
  };

  if (visible.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground">
          <Puzzle size={15} />
        </span>
        스킬 후보
      </div>
      <p className="mb-2.5 text-xs text-muted-foreground">
        같은 태그의 작업이 반복됐어요. 재사용 절차를 Claude Code 스킬(
        <code className="font-mono text-[11px]">.claude/skills</code>)로 승격할 수 있습니다 —
        저장은 항상 사람의 승인으로만 이뤄집니다.
      </p>
      <ul className="flex flex-col gap-2">
        {visible.map((c) => (
          <li
            key={c.tag}
            className="rounded-md border border-border/60 bg-background/40 px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-xs text-foreground">{c.tag}</span>
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                반복 {c.count}회
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                최근 {wd(c.last_workday)}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                className="btn sm"
                disabled={draftingTag != null}
                onClick={() => void generateDraft(c)}
                title="이 반복 절차의 증거(일지 발췌)를 AI 로 요약해 스킬 초안을 만듭니다 (과금 호출)"
              >
                {draftingTag === c.tag ? (
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
                aria-label={`${c.tag} 후보 숨기기`}
                title="이 후보를 이번 세션에서 숨깁니다 (파일 변경 없음)"
                onClick={() => setDismissed((prev) => new Set(prev).add(c.tag))}
              >
                <X size={13} />
              </button>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {c.sample_titles.join(" · ")}
            </div>
          </li>
        ))}
      </ul>

      {/* 초안 제안 카드 — 닫기(거절)는 아무 파일도 바꾸지 않는다. */}
      <AppDialog
        open={draft != null}
        onClose={() => setDraft(null)}
        label="스킬 초안 제안"
        width={672}
      >
        {draft ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <SparklesIcon size={15} />
              <span className="text-sm font-semibold">{draft.slug}</span>
              <span className="text-xs text-muted-foreground">AI 초안 · 승인해야 저장됩니다</span>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto p-4">
              <div>
                <label
                  htmlFor="sp-slug"
                  className="mb-1 block text-xs font-semibold text-muted-foreground"
                >
                  폴더 이름 (슬러그)
                </label>
                <input
                  id="sp-slug"
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
                    : `.claude/skills/${slug.trim() || "…"}/SKILL.md 로 저장됩니다`}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">
                  description (자동 발동 트리거)
                </div>
                <p className="text-xs text-foreground/85">{draft.description}</p>
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
                {saving ? "저장 중…" : "스킬로 저장"}
              </button>
            </div>
          </>
        ) : null}
      </AppDialog>
    </div>
  );
}
