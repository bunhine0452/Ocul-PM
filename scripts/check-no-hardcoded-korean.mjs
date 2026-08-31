#!/usr/bin/env node
/**
 * Lint rule: 사용자에게 보이는 한글은 소스에 직접 쓰지 않고 `src/i18n` 사전을
 * 거친다 (docs/20260811_three-features/03-i18n.md §5).
 *
 * `check-no-localstorage.mjs` 와 같은 구조 — zero-dep Node 워커 + allowlist.
 *
 * ## allowlist 를 역방향으로 쓴다
 *
 * Phase 0 에서 **현재 한글이 있는 파일을 전부 ALLOWLIST 에 넣고 통과**시킨다.
 * Phase 2 에서 파일을 하나 번역할 때마다 여기서 한 줄씩 뺀다. 그래서:
 *
 *  - Phase 0 직후부터 **신규 파일은 한글 하드코딩이 불가능**하다
 *    (allowlist 에 없으므로 즉시 걸린다)
 *  - Phase 2 진척도가 PENDING 길이로 정확히 측정된다 (Phase 0 시딩 시점 130 → 0)
 *  - 이미 끝낸 파일의 회귀가 즉시 잡힌다
 *
 * Phase 2 완료 기준 = **PENDING 이 빈 상태** (2026-08-12 달성). 남은 세 집합은
 * 전부 번역 대상이 아닌 파일이다 — PERMANENT(i18n 기계 자신) · DISK_CONTENT
 * (디스크 산출물의 내용) · TESTS(한글이 검사 재료인 테스트).
 *
 * 이제 이 게이트의 역할은 "진척 측정" 에서 **"회귀 방지"** 로 바뀐다 — 새
 * 파일이나 되살아난 한글은 세 집합 어디에도 없으므로 즉시 걸린다.
 *
 * ## 탐지 방식
 *
 * 라인 단위 정규식이 아니라 **문자 단위 상태 기계**로 훑는다. `"https://…"`
 * 안의 `//` 를 주석 시작으로 오독해 그 뒤 한글을 놓치는(= 게이트가 조용히
 * 뚫리는) 실패를 막기 위해서다. 주석 안 한글은 번역 대상이 아니므로 건너뛴다
 * — 이 코드베이스의 서술 언어는 한국어다.
 *
 * ## 예외 주석
 *
 *   // i18n-ignore -- 사유          (같은 줄)
 *   // i18n-ignore-next-line -- 사유 (다음 줄)
 *
 * 정규식 문자 클래스(`[가-힣]`)나 검색 별칭처럼 **표시 문자열이 아닌** 한글에
 * 쓴다. 사유를 반드시 적는다.
 *
 * Exit 0 on clean, non-zero with a report on violations.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;

/**
 * 설계상 한글이 있어야 하는 파일 — Phase 2 가 끝나도 남는다.
 */
const PERMANENT = new Set([
  "i18n/ko.ts", // 한국어 사전 정본.
  "i18n/en.ts", // 언어 이름("한국어")은 자기 언어 표기로 두는 게 관례.
  // i18n 자체를 검증하는 테스트 3종 — 여기서 한글은 번역할 UI 카피가 아니라
  // **검사 대상 소재**다. 스캐너 픽스처("URL 안의 // 를 오독하지 않는가")와
  // 한국어 렌더 단언(`getByText("작업 일지")`)은 한글이어야만 의미가 있다.
  "__tests__/i18n.test.ts",
  "__tests__/i18n_lint_scanner.test.ts",
  "__tests__/i18n_switch.test.tsx",
  "__tests__/i18n_settings_wiring.test.tsx",
  // tError 계약 — 백엔드 영어 원문이 한국어로 되돌아오는지가 검사 대상이라
  // 양쪽 언어 문자열이 단언에 그대로 있어야 한다.
  "__tests__/i18n_errors.test.ts",
  // 영어 모드 렌더 계약 — 한글 **검출** 정규식과 한국어 테스트 설명이 검사
  // 대상 소재다 (여기서 한글이 사라지면 검사기가 아무것도 못 잡는다).
  "__tests__/i18n_english_render.test.tsx",
]);

/**
 * 한글이 **UI 카피가 아니라 디스크 산출물의 내용**인 파일.
 *
 * Phase 2(화면 영어화)의 대상이 아니라서 PENDING 에 두면 카운터가 영영 0 이
 * 안 된다. 그렇다고 `i18n-ignore` 로도 못 적는다 — 이 한글은 **여러 줄
 * 템플릿 리터럴 안**에 있고, 거기에 `//` 를 넣으면 주석이 아니라 사용자
 * 저장소에 기록되는 파일 내용의 일부가 된다.
 *
 * 나중에 "AI 작성 언어"(`settings.contentLanguage`) 축이 배선되면 그때 이
 * 목록을 다시 본다 — UI 언어로 뒤집는 건 잘못된 축이다.
 */
const DISK_CONTENT = new Set([
  // 사용자 저장소에 기록되는 시드 파일 본문 (.claude/rules/*.md · CLAUDE.md).
  "features/skills/rulesModel.ts",
  // 같음 (.claude/skills/<name>/SKILL.md).
  "features/skills/skillsModel.ts",
  // 문제 해결 문서의 시작 템플릿 본문 + 파서가 인식하는 `## ` 섹션 제목.
  // `.oculpm/discussion/<slug>/discussion.md` 에 그대로 기록되는 내용이고,
  // 축도 UI 언어가 아니라 작성 언어(`getContentLang()`)라 ko/en 두 벌을 이
  // 파일이 직접 들고 있다.
  "features/discussion/discussionTemplates.ts",
  // 플러그인 실표면(plugin/oculpm/**)의 **거울**. `plugin_docs_sync.test.ts` 가
  // `description` 을 커맨드 .md 의 frontmatter 와 글자 단위로 일치시킨다 —
  // 여기만 번역하면 그 게이트가 깨지고, 앱이 플러그인의 실제 문구를 잘못
  // 인용하게 된다. 플러그인 .md 자체가 번역될 때 함께 간다.
  "features/skills/pluginDocs.ts",
]);

/**
 * Phase 2 에서 하나씩 제거할 미번역 파일. **추가 금지** — 새 파일은 처음부터
 * `t()` 로 쓴다. 줄이는 방향으로만 편집한다.
 */
const PENDING = new Set([
  // @PENDING_START (scripts/gen-i18n-allowlist.mjs 가 생성)
  // @PENDING_END
]);

/**
 * 테스트 파일 — 한글이 **번역 대상 UI 가 아니라 검사 재료**다.
 *
 * Phase 0 시딩은 "한글이 있는 파일" 을 전부 PENDING 에 넣었는데, 그건
 * "미번역 UI" 와 "한국어 UI 를 검사하는 테스트" 를 구분하지 못한 것이다.
 * 실측하면 이 44파일의 한글 1,062줄은:
 *
 *   399줄  `it(...)` / `describe(...)` 설명 — 이 코드베이스의 서술 언어
 *   343줄  DOM 조회 — 대부분 **픽스처 데이터**("첫 대화" 같은 목 제목)
 *   220줄  픽스처·샘플 문서 본문 (플랜 제목·AGENTS.md 예시)
 *   100줄  순수 함수 값 단언
 *
 * 전부 한국어여야 의미가 있다. `setup.ts` 가 언어를 `ko` 로 고정하므로 이
 * 단언들은 **한국어 렌더를 검사하는 유효한 테스트**다.
 *
 * 영어 경로 커버리지는 번역이 아니라 별도 스위트가 맡는다 —
 * `__tests__/i18n_english_render.test.tsx` 가 실제로 영어로 그려서 한글이
 * 남는지 본다. 이쪽을 넓히는 게 맞고, 이 파일들을 번역하는 건 틀렸다.
 */
const TESTS = new Set([
  // 양 언어 a11y — ko 마커("설정")와 한국어 테스트 이름이 검사 재료다.
  "__tests__/a11y_screens.test.tsx",
  "__tests__/agent_context_model.test.ts",
  "__tests__/agent_context_proposals.test.tsx",
  "__tests__/agent_detect.test.ts",
  "__tests__/acp_conversation_seams.test.tsx",
  "__tests__/acp_parallel_sessions.test.tsx",
  "__tests__/acp_session_tabs.test.tsx",
  "__tests__/acp_title.test.ts",
  "__tests__/acp_usage_detail.test.ts",
  "__tests__/acp_usage_meter.test.tsx",
  "__tests__/acp_working_indicator.test.tsx",
  "__tests__/ai_context_parts.test.ts",
  "__tests__/ai_history.test.tsx",
  "__tests__/app_dialog.test.tsx",
  "__tests__/automation_tab.test.tsx",
  "__tests__/claude_hooks_settings.test.tsx",
  "__tests__/close_intent.test.ts",
  "__tests__/console_bridge_format.test.ts",
  "__tests__/core_model_slot.test.tsx",
  "__tests__/defer_ledger_v2.test.tsx",
  "__tests__/diff_v2.test.tsx",
  "__tests__/discussion_v2.test.tsx",
  "__tests__/discussion_edit.test.ts",
  "__tests__/discussion_editor.test.tsx",
  "__tests__/dispatch_handoff.test.ts",
  "__tests__/docs_resolve.test.ts",
  "__tests__/drag_motion.test.ts",
  "__tests__/edd_lite_v2.test.tsx",
  "__tests__/error_boundary.test.tsx",
  "__tests__/external_links.test.ts",
  "__tests__/trace_preview.test.ts",
  "__tests__/file_links.test.ts",
  "__tests__/firing_ledger_v2.test.ts",
  "__tests__/home_match.test.ts",
  "__tests__/home_model.test.ts",
  "__tests__/ime_bridge.test.ts",
  "__tests__/ime_trace.test.ts",
  // 한국어 제목의 인라인 마크다운 파싱 — 한글 줄바꿈 성질이 검사 재료다.
  "__tests__/inline_markdown.test.tsx",
  "__tests__/journal_v2.test.tsx",
  "__tests__/mcp_settings.test.tsx",
  "__tests__/multi_window.test.tsx",
  "__tests__/nav_registry.test.ts",
  "__tests__/notion_export_v2.test.tsx",
  "__tests__/code_dir_map.test.ts",
  "__tests__/code_file_icons.test.ts",
  "__tests__/code_patch_reverse.test.ts",
  "__tests__/code_file_ops.test.ts",
  "__tests__/code_gutter_outline.test.ts",
  "__tests__/code_debug.test.ts",
  "__tests__/code_screen_tabs.test.tsx",
  "__tests__/code_tabs.test.ts",
  "__tests__/code_tree_lazy.test.tsx",
  "__tests__/code_tree_watch.test.tsx",
  "__tests__/lsp_bridge.test.ts",
  "__tests__/oculpm_live.test.tsx",
  "__tests__/oculpm_settings_subtabs.test.tsx",
  "__tests__/osc_shell.test.ts",
  "__tests__/plan_list.test.ts",
  "__tests__/plugin_docs_sync.test.ts",
  "__tests__/plugin_skills_sync.test.ts",
  "__tests__/project_appearance.test.ts",
  "__tests__/project_manager.test.tsx",
  "__tests__/recent_changes_store.test.tsx",
  "__tests__/rule_promotion_v2.test.tsx",
  "__tests__/rules_hub_v2.test.tsx",
  "__tests__/sidebar_a11y.test.tsx",
  "__tests__/skill_promotion_v2.test.tsx",
  "__tests__/skill_shop.test.tsx",
  "__tests__/skills_catalog.test.ts",
  "__tests__/skills_gallery_v2.test.tsx",
  "__tests__/skills_v2.test.tsx",
  "__tests__/start_screen.test.tsx",
  "__tests__/tab_strip.test.tsx",
  "__tests__/term_pane_drop.test.ts",
  "__tests__/term_panes.test.ts",
  "__tests__/terminal_dock.test.tsx",
  "__tests__/terminal_agent_mode.test.ts",
  "__tests__/terminal_command_blocks.test.ts",
  "__tests__/terminal_quality_round.test.ts",
  "__tests__/terminal_rail.test.ts",
  "__tests__/terminal_viewport_resync.test.ts",
  "__tests__/today_journal_missing.test.tsx",
  "__tests__/today_v2.test.tsx",
  "__tests__/polish_phase2.test.tsx",
  "__tests__/design_tokens.test.ts",
  "__tests__/token_estimate.test.ts",
  "__tests__/tools_v2.test.tsx",
  "__tests__/tray_popover.test.tsx",
  "__tests__/update_banner.test.tsx",
  "__tests__/workday_rollover.test.tsx",
]);

const ALLOWLIST = new Set([...PERMANENT, ...DISK_CONTENT, ...TESTS, ...PENDING]);

const EXT = new Set([".ts", ".tsx"]);
const HANGUL = /[가-힣]/;

/**
 * 정규식 리터럴이 시작될 수 있는 위치인지 — 직전 유효 문자로 판정한다.
 *
 * `/` 는 나눗셈이기도 해서 문맥 없이는 구분이 안 된다. 피연산자가 올 자리
 * (`(`, `=`, `,`, `return` 뒤 …)의 `/` 는 정규식이고, 값이 끝난 자리
 * (식별자·숫자·`)`·`]` 뒤)의 `/` 는 나눗셈이다.
 *
 * `<` `>` `}` 는 **일부러 뺐다.** JSX 가 이 셋 뒤에 `/` 를 흔히 놓는다 —
 * `</div>`, `<A/></>`, `{dir}/{file}`. 정규식으로 오인하면 닫는 `/` 를 찾아
 * 헤매다 그 뒤 코드를 통째로 삼킨다. 반대 방향(이 셋 뒤의 진짜 정규식)은
 * 실제 코드에 사실상 없어서 이 교환은 한쪽으로만 안전하다.
 */
const REGEX_PREV = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", ";", "+", "-", "*", "%", "~", "^", "{"]);
const REGEX_KEYWORD = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|case|do|else|yield|await|new|delete|void|throw)$/;

function startsRegex(emitted) {
  const trimmed = emitted.replace(/\s+$/, "");
  if (trimmed === "") return true;
  const last = trimmed[trimmed.length - 1];
  if (REGEX_PREV.has(last)) return true;
  return REGEX_KEYWORD.test(trimmed);
}

/**
 * 소스에서 **주석을 제외한** 영역만 남긴다. 주석 문자는 공백으로 치환해
 * 줄/열 번호가 보존된다.
 *
 * 상태: code / line-comment / block-comment / '…' / "…" / `…` / /…/
 * 문자열 안에 남은 한글은 표시 문자열이거나 JSX 텍스트다 — 둘 다 번역 대상.
 *
 * ## 정규식 리터럴을 왜 따로 다루나
 *
 * 정규식 안의 따옴표(`/[\s'"(\[<]/`)를 문자열 시작으로 오독하면 그 뒤 파일
 * 전체가 "문자열 안"이 된다. 그러면 주석 속 한글이 위반으로 보고되고(거짓
 * 양성 — `features/terminal/fileLinks.ts` 가 실제로 그랬다), 반대로 정규식
 * 안의 `//` 를 줄 주석으로 오독하면 진짜 한글을 놓친다(거짓 음성 — 게이트가
 * 조용히 뚫린다). 정규식 **내용은 그대로 남긴다** — 문자 클래스의 한글은
 * 여전히 보고돼야 하고, 면제는 `i18n-ignore` 주석으로 명시한다.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  // 0=code 1=line 2=block 3=single 4=double 5=template 6=regex 7=regex char class
  let state = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 0) {
      // 주석 판정이 정규식 판정보다 **앞선다**. 정규식 리터럴은 `/` 나 `*` 로
      // 시작할 수 없어서(`//` 는 주석, `/*` 는 수량자 오류) 순서가 안전하다.
      if (c === "/" && c2 === "/") {
        state = 1;
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        state = 2;
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && startsRegex(out)) state = 6;
      else if (c === "'") state = 3;
      else if (c === '"') state = 4;
      else if (c === "`") state = 5;
      out += c;
      i += 1;
      continue;
    }
    if (state === 1) {
      if (c === "\n") {
        state = 0;
        out += c;
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (state === 2) {
      if (c === "*" && c2 === "/") {
        state = 0;
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? c : " ";
      i += 1;
      continue;
    }
    // 문자열 3종 + 정규식 — 이스케이프를 건너뛰고 닫는 구분자에서 code 로 복귀.
    if (c === "\\") {
      out += c + (c2 ?? "");
      i += 2;
      continue;
    }
    // 정규식 리터럴은 줄을 넘지 못한다. 줄바꿈을 만났다면 `/` 를 정규식으로
    // 오인한 것이므로 code 로 되돌려 피해를 그 줄에 가둔다.
    if ((state === 6 || state === 7) && c === "\n") {
      state = 0;
      out += c;
      i += 1;
      continue;
    }
    if (state === 6) {
      // 문자 클래스 안의 `/` 는 구분자가 아니다 — `/[a-z/]/` 를 여기서 끊으면
      // 남은 패턴이 코드로 새어 나온다.
      if (c === "[") state = 7;
      else if (c === "/") state = 0;
    } else if (state === 7) {
      if (c === "]") state = 6;
    } else if (
      (state === 3 && c === "'") ||
      (state === 4 && c === '"') ||
      (state === 5 && c === "`")
    ) {
      state = 0;
    }
    out += c;
    i += 1;
  }
  return out;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // src/legacy 는 빌드·tsconfig·vitest 에서 제외된 보존 사문 —
      // check-no-localstorage.mjs 와 동일하게 건너뛴다.
      if (entry.name === "legacy") continue;
      yield* walk(full);
    } else if (EXT.has(entry.name.slice(entry.name.lastIndexOf(".")))) yield full;
  }
}

/** 파일 하나를 검사해 위반 줄 목록을 돌려준다. */
export function scanSource(src) {
  const rawLines = src.split("\n");
  const codeLines = stripComments(src).split("\n");
  const hits = [];
  for (let idx = 0; idx < codeLines.length; idx++) {
    if (!HANGUL.test(codeLines[idx])) continue;
    const raw = rawLines[idx] ?? "";
    const prev = rawLines[idx - 1] ?? "";
    if (raw.includes("i18n-ignore") || prev.includes("i18n-ignore-next-line")) continue;
    hits.push({ num: idx + 1, line: raw.trim() });
  }
  return hits;
}

async function main() {
  const offenders = [];
  const cleanedAllowlisted = [];
  for await (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).split("\\").join("/");
    const src = await readFile(file, "utf8");
    const hits = scanSource(src);
    if (ALLOWLIST.has(rel)) {
      // allowlist 에 있는데 이미 깨끗하다 → 번역이 끝났다는 뜻. 목록에서 빼도록
      // 알려 준다 (역방향 게이트가 실제로 줄어들게 만드는 장치).
      if (hits.length === 0 && !PERMANENT.has(rel) && !DISK_CONTENT.has(rel) && !TESTS.has(rel))
        cleanedAllowlisted.push(rel);
      continue;
    }
    if (hits.length > 0) offenders.push({ rel, hits });
  }

  if (cleanedAllowlisted.length > 0) {
    console.log(
      `ℹ 번역이 끝나 allowlist 에서 뺄 수 있는 파일 ${cleanedAllowlisted.length}개:`,
    );
    for (const rel of cleanedAllowlisted) console.log(`    ${rel}`);
    console.log("");
  }

  if (offenders.length === 0) {
    console.log(
      `✓ no hardcoded Korean outside the allowlist (남은 미번역 ${PENDING.size}개)`,
    );
    process.exit(0);
  }

  console.error("✗ 하드코딩된 한글 — src/i18n 사전을 거치세요:");
  for (const { rel, hits } of offenders) {
    console.error(`  ${rel}`);
    for (const { num, line } of hits) console.error(`    ${num}: ${line}`);
  }
  console.error(
    [
      "",
      "고치는 법:",
      "  1. src/i18n/ko.ts 에 키를 추가하고 en.ts 에 영어를 넣는다",
      "     (en.ts 는 ko.ts 의 키 집합으로 타입 제약 — 빠뜨리면 typecheck 가 잡는다)",
      "  2. 컴포넌트는 useT() 의 t(), 순수 모듈은 t() 를 직접 쓴다",
      "  3. 표시 문자열이 아니면 (정규식·검색 별칭 등)",
      "     `// i18n-ignore -- 사유` 를 같은 줄이나 앞줄에 단다",
    ].join("\n"),
  );
  process.exit(1);
}

// 테스트에서 import 할 때는 실행하지 않는다.
if (process.argv[1] && process.argv[1].endsWith("check-no-hardcoded-korean.mjs")) {
  await main();
}
