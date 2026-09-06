/**
 * 설정 색인 — "그 스위치가 어느 탭에 있더라" 를 끝낸다 (3.0 {#settings-search}).
 *
 * 왜 필요한가: 설정은 12탭 + `.oculpm` 안의 하위 5탭에 걸쳐 7,900줄이고 항목이
 * 100개가 넘는데 검색이 없었다. ⌘K 팔레트도 **화면**만 색인하지 개별 설정은
 * 모른다 — "자동 저장" 을 찾으려면 탭 열둘을 눈으로 훑는 수밖에 없었다.
 *
 * 왜 손으로 적힌 표인가: 항목은 각 탭이 렌더할 때만 존재한다(마운트 안 된 탭의
 * `<Field label=…>` 는 어디에도 없다). 런타임 등록으로는 안 연 탭을 못 찾으므로
 * 목록이 **정적**이어야 한다. 낡는 것이 유일한 위험이라, 짝이 되는 테스트
 * (`settings_search.test.ts`)가 설정 파일들을 다시 훑어 새로 생긴 라벨이 여기
 * 없으면 실패한다 — 표가 유물이 되지 않게 하는 것은 그 테스트다.
 *
 * 새 설정을 추가했다면: 아래 목록에 한 줄 넣으면 된다. 테스트가 어느 키가
 * 빠졌는지 이름으로 말해 준다.
 */
import { t, tAll, type I18nKey } from "@/i18n";

/** 설정 패널의 탭 — `SettingsPanel.TABS` 와 같은 집합 (lib/settingsNav 의
 *  `SettingsTabId` 에는 `context` 가 빠져 있어 그쪽을 쓰지 않는다). */
export type SettingsTab =
  | "appearance"
  | "llm"
  | "code"
  | "indexing"
  | "graph"
  | "data"
  | "oculpm"
  | "context"
  | "automation"
  | "mobile"
  | "diagnostics"
  | "update";

export interface SettingsEntry {
  tab: SettingsTab;
  /** 항목 이름(사전 키). 그대로 화면에 뜬다. */
  key: I18nKey;
  /** 같은 탭 안에서 이 항목을 품은 섹션 제목 — 결과 줄의 "어디" 다. */
  section?: I18nKey;
}

/**
 * 설명문(`*.desc`)·aria 라벨·중복 라벨은 일부러 뺐다. 설명은 문장이라 결과 줄로
 * 읽히지 않고, aria 는 사람이 찾는 이름이 아니다. 테스트가 같은 규칙으로 거른다.
 */
export const SETTINGS_INDEX: readonly SettingsEntry[] = [
  // ── oculpm 하위 5탭 — 항목이 아니라 **자리**다. 자동 추출은 이걸 못 본다
  //    (Section 제목이 영어 리터럴이고 하위 탭 라벨만 사전에 있다).
  { tab: "oculpm", key: "op.tab.record" },
  { tab: "oculpm", key: "op.tab.agents" },
  { tab: "oculpm", key: "op.tab.automation" },
  { tab: "oculpm", key: "op.tab.integration" },
  { tab: "oculpm", key: "op.tab.logs" },

  // ── appearance
  { tab: "appearance", key: "settings.language.uiTitle" },
  { tab: "appearance", key: "settings.language.contentTitle" },
  { tab: "appearance", key: "settings.editor.title" },
  { tab: "appearance", key: "settings.editor.field", section: "settings.editor.title" },
  { tab: "appearance", key: "settings.theme.title" },
  { tab: "appearance", key: "settings.scale.title" },
  { tab: "appearance", key: "settings.scale.field", section: "settings.scale.title" },
  { tab: "appearance", key: "settings.termFont.title" },
  { tab: "appearance", key: "settings.termFont.field", section: "settings.termFont.title" },
  { tab: "appearance", key: "settings.tray.title" },

  // ── llm
  { tab: "llm", key: "settings.keys.title" },
  { tab: "llm", key: "settings.keys.verifyTitle" },
  { tab: "llm", key: "settings.provider.title" },
  { tab: "llm", key: "settings.models.title" },
  { tab: "llm", key: "settings.models.fallbackDefault", section: "settings.models.title" },
  { tab: "llm", key: "settings.coreModel.title" },
  { tab: "llm", key: "settings.coreModel.provider", section: "settings.coreModel.title" },
  { tab: "llm", key: "settings.coreModel.model", section: "settings.coreModel.title" },
  { tab: "llm", key: "settings.fallback.title" },
  { tab: "llm", key: "settings.fallback.field", section: "settings.fallback.title" },
  { tab: "llm", key: "settings.gen.title" },
  { tab: "llm", key: "settings.gen.temperature", section: "settings.gen.title" },
  { tab: "llm", key: "settings.gen.maxTokens", section: "settings.gen.title" },
  { tab: "llm", key: "settings.gen.systemPrompt", section: "settings.gen.title" },

  // ── code
  { tab: "code", key: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.formatOnSave", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.tabSize", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.insertSpaces", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.trimTrailingWhitespace", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.insertFinalNewline", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.trimFinalNewlines", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.previewTabs", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.stickyScroll", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.stickyMaxLines", section: "settings.code.editorTitle" },
  { tab: "code", key: "settings.code.autoSaveTitle" },
  { tab: "code", key: "settings.code.autoSave", section: "settings.code.autoSaveTitle" },
  { tab: "code", key: "settings.code.autoSaveDelay", section: "settings.code.autoSaveTitle" },
  { tab: "code", key: "settings.code.historyTitle" },
  { tab: "code", key: "settings.code.localHistory", section: "settings.code.historyTitle" },
  { tab: "code", key: "settings.code.localHistoryMax", section: "settings.code.historyTitle" },
  { tab: "code", key: "settings.code.lspTitle" },

  // ── indexing
  { tab: "indexing", key: "settings.index.title" },
  { tab: "indexing", key: "settings.index.auto", section: "settings.index.title" },
  { tab: "indexing", key: "settings.chunk.title" },
  { tab: "indexing", key: "settings.chunk.size", section: "settings.chunk.title" },
  { tab: "indexing", key: "settings.chunk.overlap", section: "settings.chunk.title" },
  { tab: "indexing", key: "settings.retrieval.title" },
  { tab: "indexing", key: "settings.retrieval.topK", section: "settings.retrieval.title" },
  { tab: "indexing", key: "settings.aiContext.title" },
  { tab: "indexing", key: "settings.aiContext.inject", section: "settings.aiContext.title" },
  { tab: "indexing", key: "settings.aiContext.entries", section: "settings.aiContext.title" },
  { tab: "indexing", key: "settings.scan.title" },
  { tab: "indexing", key: "settings.scan.maxSize", section: "settings.scan.title" },
  { tab: "indexing", key: "settings.scan.exclude", section: "settings.scan.title" },

  // ── graph
  { tab: "graph", key: "settings.graph.title" },
  { tab: "graph", key: "settings.graph.showIsolated", section: "settings.graph.title" },
  { tab: "graph", key: "settings.graph.threshold", section: "settings.graph.title" },

  // ── data
  { tab: "data", key: "settings.notion.title" },
  { tab: "data", key: "settings.storage.title" },
  { tab: "data", key: "settings.diag.title" },
  { tab: "data", key: "settings.reset.title" },
  { tab: "data", key: "settings.danger.title" },
  { tab: "data", key: "settings.declarative.title" },
  { tab: "data", key: "settings.import.title" },

  // ── oculpm
  { tab: "oculpm", key: "op.session.inactivity" },
  { tab: "oculpm", key: "op.session.resumeGrace" },
  { tab: "oculpm", key: "op.watcher.ignore" },
  { tab: "oculpm", key: "op.watcher.gitignore" },
  { tab: "oculpm", key: "op.auto.title" },
  { tab: "oculpm", key: "op.auto.reconcile", section: "op.auto.title" },
  { tab: "oculpm", key: "op.auto.draft", section: "op.auto.title" },
  { tab: "oculpm", key: "op.scope.projectTitle" },
  { tab: "oculpm", key: "op.scope.machineTitle" },
  { tab: "oculpm", key: "op.scope.projectKey", section: "op.scope.machineTitle" },
  { tab: "oculpm", key: "op.logs.title" },
  { tab: "oculpm", key: "op.acp.node", section: "op.logs.title" },
  { tab: "oculpm", key: "op.acp.claude", section: "op.logs.title" },
  { tab: "oculpm", key: "op.acp.adapter", section: "op.logs.title" },
  { tab: "oculpm", key: "op.acp.codexAdapter", section: "op.logs.title" },
  { tab: "oculpm", key: "op.acp.codexAuth", section: "op.logs.title" },
  { tab: "oculpm", key: "plugins.title" },

  // ── context
  { tab: "context", key: "ctx.always.title" },
  { tab: "context", key: "ctx.always.global", section: "ctx.always.title" },
  { tab: "context", key: "ctx.always.project", section: "ctx.always.title" },
  { tab: "context", key: "ctx.manifest.title" },
  { tab: "context", key: "ctxTab.budget.title" },
  { tab: "context", key: "ctx.recall.title" },
  { tab: "context", key: "ctx.recall.forget", section: "ctx.recall.title" },
  { tab: "context", key: "ctx.danger.title" },

  // ── automation
  { tab: "automation", key: "automation.switches.title" },
  { tab: "automation", key: "automation.switches.schedules", section: "automation.switches.title" },
  { tab: "automation", key: "automation.switches.watchers", section: "automation.switches.title" },
  { tab: "automation", key: "automation.list.title" },
  { tab: "automation", key: "automation.trouble.title" },
  { tab: "automation", key: "automation.history.title" },
  { tab: "automation", key: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.id", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.kind", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.watch", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.recursive", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.responsiveness", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.frequency", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.every", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.at", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.weekday", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.dayOfMonth", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.month", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.day", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.cron", section: "automation.editor.title" },
  { tab: "automation", key: "automation.editor.output", section: "automation.editor.title" },
  { tab: "automation", key: "automation.cond.title" },
  { tab: "automation", key: "automation.cond.journal_count_gte", section: "automation.cond.title" },
  { tab: "automation", key: "automation.editor.instructions", section: "automation.cond.title" },

  // ── mobile
  { tab: "mobile", key: "settings.mobile.serverTitle" },
  { tab: "mobile", key: "settings.mobile.pairTitle" },
  { tab: "mobile", key: "settings.mobile.devicesTitle" },

  // ── diagnostics
  { tab: "diagnostics", key: "settings.db.title" },
  { tab: "diagnostics", key: "settings.db.schema", section: "settings.db.title" },
  { tab: "diagnostics", key: "settings.db.size", section: "settings.db.title" },
  { tab: "diagnostics", key: "settings.db.wal", section: "settings.db.title" },
  { tab: "diagnostics", key: "settings.db.free", section: "settings.db.title" },
  { tab: "diagnostics", key: "automation.trouble.title" },
  { tab: "diagnostics", key: "settings.feedback.title" },
  { tab: "diagnostics", key: "settings.doctor.title" },
  { tab: "diagnostics", key: "settings.firing.title" },

  // ── update
  { tab: "update", key: "settings.update.title" },
  { tab: "update", key: "settings.changelog.title" },
];

/**
 * 표시 이름 — 자리표시자를 지운다.
 *
 * 슬라이더 라벨 몇 개는 `"온도 {v}"` 처럼 값을 품는다. 목록에는 값이 없으므로
 * `t()` 가 자리표시자를 그대로 남기고(i18n/index.ts 규약), 그게 결과 줄에
 * `{v}` 로 새어 나온다. 이름만 남긴다.
 */
export function entryLabel(key: I18nKey): string {
  return t(key).replace(/\s*\{[^}]*\}/g, "").trim();
}

/** 한 항목의 검색 건초더미 — 두 언어의 이름 + 섹션 + 키 자체. */
function haystack(entry: SettingsEntry): string[] {
  const parts = [...tAll(entry.key), entry.key];
  if (entry.section) parts.push(...tAll(entry.section));
  return parts.map((s) => s.toLowerCase());
}

/**
 * 질의에 맞는 항목 — 이름이 질의로 **시작**하는 것이 먼저다.
 *
 * `tAll` 을 쓰는 이유는 ⌘K 팔레트와 같다: 한국어 UI 로 쓰면서 `autoSave` 라고
 * 치는 사람이 있고, 그 반대도 있다. 사전이 한 언어만 로드돼 있으면 `tAll` 이
 * 그 한 언어만 돌려주므로 조용히 좁아질 뿐 깨지지 않는다.
 */
export function searchSettings(query: string, limit = 24): SettingsEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ entry: SettingsEntry; rank: number }> = [];
  for (const entry of SETTINGS_INDEX) {
    const parts = haystack(entry);
    // 이름(사전값)은 앞의 두 칸, 그 뒤가 키·섹션이다 — 앞칸의 시작 일치가 가장 강하다.
    const rank = parts.some((p) => p.startsWith(q)) ? 0 : parts.some((p) => p.includes(q)) ? 1 : -1;
    if (rank >= 0) scored.push({ entry, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.entry);
}
