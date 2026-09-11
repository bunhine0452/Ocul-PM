# EVALS — 완료 정의

플랜 `vscode-extension-round` 의 "완성"을 재현 가능한 시나리오로 옮긴 것. 실행·채점은 `/run-evals`, 결과는 맨 아래 표에만 적는다 (표 형식은 회고 화면이 파싱하므로 바꾸지 말 것).

## 스위트 `vscode-ext` — VS Code 확장

전제: 설치본 Ocul-PM(`/Applications/Ocul-PM.app`) + 마켓(또는 `.vsix`)에서 설치한 `oculpm.ocul-pm` + 이 저장소를 VS Code 로 연 상태.

1. **첫 데모 — 일지가 사이드바에 즉시 뜬다.** 내장 터미널에서 Claude Code 로 `journal_write` 1건 → 1초 안에 '오늘 일지' 트리에 새 항목이 추가되고, 클릭하면 마크다운 미리보기가 열린다. `.oculpm/index/**` 변경은 트리를 흔들지 않는다(재구축 중에도 깜빡임 없음).
2. **플랜 토글 왕복.** '활성 플랜' 트리에서 `[ ]` 항목 체크 → `.oculpm/planner/<id>.md` 의 글리프가 `[x]` 로 바뀌고 plan-log 에 `vscode-ext` 행이 붙으며, 앱 플래너 화면이 리로드 없이 같이 바뀐다. 반대로 앱에서 체크하면 VS Code 트리도 바뀐다.
3. **잠긴 플랜 보호.** `status: done` 플랜의 항목엔 체크박스가 없고 툴팁이 '잠긴 플랜' 이다.
4. **읽기 전용 강등.** 설정 `oculpm.mcpBinaryPath` 를 없는 경로로 두고 앱을 지운 상태를 흉내내면(또는 `/Applications` 에 앱이 없는 머신): 트리·미리보기는 동작하고, 체크박스는 비활성 + 이유 툴팁, 상태바에 '읽기 전용 — Ocul-PM 설치' 가 뜬다. 활성화 오류 토스트 0.
5. **Copilot 에 도구가 보인다.** `MCP: List Servers` 에 `oculpm (ai-pm)` 이 있고, Copilot 에이전트 모드 도구 목록에 `journal_write`·`plan_status`·`plan_update` 가 나열된다. 에이전트에게 "일지 써" 라고 하면 서버 규격 경로에 파일이 생긴다.
6. **딥링크 왕복.** 트리 컨텍스트 'Ocul-PM 에서 열기' → 실행 중인 앱이 해당 일지를 연다. 앱의 일지 모달 'VS Code 로 열기' → VS Code 에서 그 파일이 열리고 트리에서 선택된다.
7. **비추적 폴더.** `.oculpm` 없는 폴더를 열면 Welcome 뷰('추적 안 됨') 만 보이고 워처·MCP 정의는 0개다.
8. **Cursor 경로.** Cursor 에서 같은 확장(Open VSX)을 설치하면 `vscode.lm` 부재를 감지해 트리는 그대로 동작하고, '.cursor/mcp.json 에 등록' 커맨드가 우리 키만 머지한다(다른 서버 정의 보존).
9. **아웃바운드 0.** 확장 활성화~시나리오 1~8 동안 네트워크 요청이 없다(마켓 링크는 사용자 클릭만). `src-tauri/tests/egress_inventory.rs` 가 초록.
10. **게이트.** 루트 `pnpm typecheck && pnpm test && pnpm lint && pnpm build` 와 `cd extension && pnpm compile && pnpm test` 가 모두 exit 0.

## 기록

| 날짜 | 스위트 | 통과 | 메모 |
|---|---|---|---|
