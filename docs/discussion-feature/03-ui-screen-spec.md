# 03. DiscussionScreenV2 — 문제 해결 화면

> 위상: [`00`](./00-master-plan.md) 의 정체성을 화면으로. ui_v2 의 **10번째 화면**.
> 시각 토큰: ui_v2 토큰 시스템 준수([[ui-v2-architecture-decisions]] — `--accent` 녹색, `[data-theme]`/`[data-preset]`, 자체 SVG 0, lucide re-export). 레거시 무변경.
> 선례: [`../planner-upgrade/03-ui-screen-spec.md`](../planner-upgrade/03-ui-screen-spec.md), 신규 화면 추가 절차는 docs(문서) 뷰어와 동형.

---

## 1. 화면 추가 체크리스트 (신규 ui_v2 화면)

docs 뷰어가 9번째 화면을 추가한 경로 그대로:

| # | 변경 | 파일 |
|---|---|---|
| 1 | `UiV2View` union 에 `"discussion"` 추가 | [`src/contexts/WorkspaceContext.tsx`](../../src/contexts/WorkspaceContext.tsx) |
| 2 | `WorkspaceState` 에 `discussionActiveId: string \| null` 추가 + initialState 기본값 | 〃 |
| 3 | 라우터 분기 `view === "discussion"` | [`src/features/shell/ShellV2.tsx`](../../src/features/shell/ShellV2.tsx) |
| 4 | 사이드바 nav 항목(`MAIN_NAV`, **플래너 바로 앞** — 퍼널 순서) | [`src/components/Sidebar.tsx`](../../src/components/Sidebar.tsx) |
| 5 | 화면 컴포넌트 | `src/features/discussion/DiscussionScreenV2.tsx` (신규) |

- 라벨 "문제 해결", 아이콘 = lucide `MessagesSquare` 또는 `Lightbulb`(자체 SVG 0).
- 사이드바 배치: `today → 문제 해결 → planner → journal → diff → retro …`(funnel 순). ⌘ 단축키 1칸 시프트.
- 화면은 React.lazy 불필요(무거운 의존성 없음 — 마크다운 렌더는 docs 뷰어와 공유).

---

## 2. 레이아웃 (목업 톤 — 2-pane)

```
┌ Toolbar  "문제 해결"   [+ 새 문제]   [open 12 · resolved 8 ▾]               ┐
├───────────────┬────────────────────────────────────────────────────────────┤
│ 목록(좌, 280)  │  문서(우)                                                   │
│               │  ┌ 헤더 ───────────────────────────────────────────────┐    │
│ ● onnx 캐시…   │  │ onnx 모델 캐시 전략 결정      [open]  ⬡user · 6/29   │    │
│   open ·2안    │  │ [편집] [첨부 추가] [플래너로 승격]  [resolved 로 닫기] │    │
│ ○ 다중플랜화해 │  └──────────────────────────────────────────────────────┘    │
│   resolved →📋 │                                                              │
│ ○ …           │   ## 문제 정의                                               │
│               │   패키징 .app 의 CWD 가 / 라서 …                            │
│ [_archive ▾]  │                                                              │
│               │   ## 후보 해결 방안                                          │
│               │   ▸ A — app_data_dir 절대경로   장점…/단점…                  │
│               │   ▸ B — 모델 번들 동봉          장점…/단점…                   │
│               │                                                              │
│               │   ## 배경 / 조사 자료                                        │
│               │    📎 bench-screenshot.png   📄 vendor-notes.md   🔗 링크    │
│               │    ↪ src/embedding.rs:42   📓 0902_bug_onnx-cache            │
│               │                                                              │
│               │   ## 토의 / 메모                                             │
│               │    ⬡user 14:03  A 로 가되 진행 UI 는 분리                    │
│               │    [+ 메모 추가]                                             │
│               │                                                              │
│               │   ## 결론 / ## 다음 단계  (resolved 시)                      │
│               │    - [ ] embedding.rs 절대경로  - [ ] 다운로드 UI            │
└───────────────┴────────────────────────────────────────────────────────────┘
```

편집 모드: 우측 문서 영역이 **마크다운 textarea + 라이브 렌더 프리뷰**(v1, WYSIWYG 아님). 저장 = `discussion_write(body_md)`.

---

## 3. 컴포넌트 (신규, ui_v2 토큰)

| 컴포넌트 | 책임 |
|---|---|
| `DiscussionScreenV2` | 목록 로드(`discussion_list`) + 선택(`discussionActiveId`) + 상세 로드(`discussion_get`) + 라우팅 |
| `DiscussionList` | 좌측 목록 — 상태 dot(open●/resolved○) · 제목 · "N안/→📋승격" 배지 · `_archive` 접이식 |
| `DiscussionHeader` | 제목 · status pill · owner 칩(`agentColor.ts`) · 액션 버튼(편집/첨부/승격/닫기) |
| `DiscussionBody` | 섹션 렌더(문제정의/옵션/배경/결론/다음단계) — docs 뷰어 마크다운 렌더 재사용 |
| `DiscussionEditor` | 편집 모드 textarea + 프리뷰 → `discussion_write`. 빈 문서 골격 템플릿 |
| `OptionCard` | `### 옵션 {#id}` 카드(장/단/비용 파싱 렌더) |
| `AttachmentRail` | 첨부 목록(`discussion_attachment_list`) + 이미지 썸네일(`discussion_asset` base64) + 드롭/추가(`discussion_attach`) |
| `DiscussionLog` | 토의 로그 타임라인(작성자 칩 + 시각 + 내용) + "메모 추가"(append 1행) |
| `PromoteToPlanDialog` | `## 다음 단계` 미리보기 → 확인 → `discussion_promote_to_plan` → 생성된 plan 으로 이동 |

마크다운 렌더·`agentColor.ts`·`Icons.tsx` 는 전부 **재사용**(신규 시각 자산 0).

---

## 4. 상호작용

| 동작 | 결과 |
|---|---|
| [+ 새 문제] | 제목 입력 → `discussion_create` → 골격 문서 + 편집 모드 진입 |
| [편집] → 저장 | `discussion_write(body_md)`(redact + atomic) → optimistic + watcher 재투영 |
| [첨부 추가] / 드롭 | 파일 선택 → `discussion_attach` → `attachments/` 복사 + 본문에 참조 라인 삽입 |
| 첨부 클릭(이미지) | `discussion_asset` base64 인라인 렌더(docs_asset 패턴). 문서는 oculpmApi.openEntryInEditor 로 열기([[opener-scope-recurring]] 준수) |
| `src/foo.rs:42` 참조 클릭 | 코드 화면/에디터로 이동(기존 핸드오프 재사용) |
| `📓 일지` 참조 클릭 | 해당 일지 focus(ShellV2 `onOpenJournal` 재사용) |
| [메모 추가] | 1행 입력 → 토의 로그 managed block append(`author=user`) |
| [플래너로 승격] | `PromoteToPlanDialog` → `discussion_promote_to_plan` → plan 생성 + `resolution_ref` + status=resolved → 플래너 화면으로 이동 |
| [resolved 로 닫기] / 보관 | `discussion_set_status` → 잠금(편집 가드). archived → `_archive/` 이동 |

승격·닫기 후 문서는 **읽기 전용**(불변식 §2-2,3: 진척은 plan 단독). resolved 헤더에 "→ 📋 fastembed-stabilize" 링크 노출.

---

## 5. Today 노출
- `discussion_list` 에서 `status: open` 카운트 → Today 위젯 "🟢 결정 대기 N건" + 클릭 시 문제 해결 화면 진입.
- 최근 토의 활동(로그 최신 ts)으로 정렬한 상위 3건 미리보기(선택).

## 6. 라이브성
watcher 가 `.oculpm/discussion/**` 변경 emit → 프론트 구독(기존 oculpm watcher 채널 재사용) → 현재 문서면 `discussion_get` 재조회. 외부 에이전트가 토의 로그에 한 줄 append 하면 앱에서 실시간 반영(Today/플래너 라이브와 동형).

## 7. 테스트 (DoD)
- `discussion_v2.test.tsx`: 목록 렌더, 섹션 렌더(문제정의 필수 빈 상태), 옵션 카드, 토의 로그 작성자 칩, 첨부 레일, 승격 다이얼로그, axe 0 violations(light+dark).
- 파서·승격 단위테스트는 Rust 측([`01`](./01-data-model-and-markdown-spec.md) §3.1, PR-DISC 0/4).
- watcher 라이브·첨부 파일 IO 는 dogfood 런타임 검증(jsdom 한계).

## 8. 레거시/플래그
- 레거시 디렉터리 0 diff. ui_v2 만 신 화면.
- `discussionActiveId` 는 `WorkspaceContext`(단일 localStorage 키) 경유만 — 직접 localStorage 금지([[ui-v2-architecture-decisions]], `pnpm lint` 가드).
