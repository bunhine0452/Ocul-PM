// ⌘K 편집의 **귀속** — 순수 초안 조립 (Phase 5 `{#agent-attribution}`).
//
// 이 앱의 존재 이유가 기록이라 편집기가 기록을 빠뜨리면 안 된다. 그런데
// ⌘K 로 들어간 편집에는 **일지를 쓸 에이전트가 없다** — 사용자가 이 앱 안에서
// 모델을 부른 것이라 MCP `journal_write` 를 탈 주체가 없다. 그래서 화면이
// 대신 초안을 만든다.
//
// `verified_by_user: false` 로 낸다. 그 필드의 뜻이 바로 이것이다("자동 초안은
// Some(false) — 사용자가 UI 에서 검토 후 토글한다"). 앱이 관측한 사실을 남기되
// 사람의 확인을 사칭하지 않는다.
//
// ⚠️ 이것은 귀속의 **절반**이다. 나머지 절반인 로컬 히스토리의
// `HistorySource` 는 지금 이 편집을 `user` 로 적는다 — 앱의 `code_write` 가
// 스스로 남긴 쪽지를 워처가 읽기 때문이다. 그쪽을 고치려면 백엔드 커맨드에
// 인자가 하나 늘어야 한다. → 플랜 `{#agent-attribution}` 의 메모.

import { getContentLang, type Lang } from "@/i18n";
import type { ManualEntryDraft } from "@/lib/bindings";

/** 이 파일에서 받은 ⌘K 편집 하나. */
export interface AiEdit {
  added: number;
  removed: number;
}

/** 한 파일의 누적. 화면의 칩과 초안이 같은 값을 읽는다. */
export interface AiEditTally {
  edits: number;
  added: number;
  removed: number;
  /** 마지막으로 답한 프로바이더·모델 — 귀속의 알맹이다. */
  provider: string;
  model: string;
}

export function addEdit(
  prev: AiEditTally | undefined,
  edit: AiEdit,
  provider: string,
  model: string,
): AiEditTally {
  return {
    edits: (prev?.edits ?? 0) + 1,
    added: (prev?.added ?? 0) + edit.added,
    removed: (prev?.removed ?? 0) + edit.removed,
    provider,
    model,
  };
}

/** 파일명만 (제목용). */
function baseName(path: string): string {
  return path.split("/").pop() || path;
}

/**
 * 슬러그 — ASCII kebab, 40자 이내 (일지 규격).
 *
 * 경로에서 만들되 한글·공백·점을 전부 하이픈으로 눕히고, 앞에 `ai-edit-` 를
 * 붙여 **무엇으로 만들어진 기록인지**가 파일명에서 보이게 한다.
 */
export function draftSlug(path: string, now: Date): string {
  const stem = baseName(path)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hhmm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `ai-edit-${stem || "file"}-${hhmm}`.slice(0, 40).replace(/-+$/, "");
}

/**
 * 일지에 **기록되는** 문구 — UI 카피가 아니다.
 *
 * 그래서 축이 UI 언어가 아니라 **작성 언어**(`settings.contentLanguage`)다.
 * `discussionTemplates.ts` 와 같은 부류라 사전이 아니라 여기서 두 벌을 든다
 * (한글 게이트의 `DISK_CONTENT`).
 */
const TEXT: Record<Lang, { title: string; summary: string; verify: string; ask: string }> = {
  ko: {
    title: "편집기에서 AI 로 고친 자리",
    summary: "## 변경 요약",
    verify: "## 검증",
    ask: "(무엇을 왜 고쳤는지, 어떻게 확인했는지를 적어 주세요.)",
  },
  en: {
    title: "Edits made with AI in the editor",
    summary: "## Summary",
    verify: "## Verification",
    ask: "(Write what changed, why, and how you checked it.)",
  },
};

function bodyLine(lang: Lang, path: string, tally: AiEditTally): string {
  const stat = `+${tally.added} −${tally.removed}`;
  return lang === "ko"
    ? `\`${path}\` 의 ${tally.edits}곳을 편집기 안에서 ⌘K 로 고쳤습니다 (${stat}).`
    : `Rewrote ${tally.edits} place(s) in \`${path}\` with ⌘K in the editor (${stat}).`;
}

/**
 * 초안 하나.
 *
 * `type: "refactor"` 인 이유: ⌘K 는 **있는 코드를 고쳐 쓰는** 자리다. 기능
 * 추가일 수도 있지만 그건 사용자가 나중에 바꿀 수 있고, 기본값은 가장 흔한
 * 쪽이어야 한다.
 *
 * 본문은 짧게 둔다 — 무엇을 왜 고쳤는지는 사람만 안다. 앱이 아는 것(몇 곳,
 * 몇 줄, 어느 모델)만 적고 나머지는 빈칸으로 남겨 사람이 채우게 한다. 여기서
 * 그럴싸한 문장을 지어내면 그 기록은 거짓이 된다.
 */
export function buildDraft(
  path: string,
  tally: AiEditTally,
  now = new Date(),
  lang: Lang = getContentLang(),
): ManualEntryDraft {
  const text = TEXT[lang] ?? TEXT.ko;
  return {
    type: "refactor",
    slug: draftSlug(path, now),
    title: `${text.title} — ${baseName(path)}`,
    difficulty: null,
    body_markdown: [
      text.summary,
      "",
      bodyLine(lang, path, tally),
      "",
      text.verify,
      "",
      text.ask,
    ].join("\n"),
    session_id: null,
    files_touched: [
      {
        path,
        op: "update",
        bytes_added: null,
        bytes_removed: null,
        rename_from: null,
      },
    ],
    status: "done",
    tags: ["ai-edit"],
    // 귀속의 알맹이 — **어느 모델이 썼는가**.
    agent: { id: tally.provider, version: tally.model, session: null },
    // 앱이 관측한 사실이지 사람의 확인이 아니다.
    verified_by_user: false,
  };
}
