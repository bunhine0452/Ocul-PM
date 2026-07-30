# ocul-pm 작업 기록 규칙

이 프로젝트는 ocul-pm 으로 추적됩니다. 루트 `AGENTS.md` 의 기록 규칙을 따르세요 (Claude Code 는 AGENTS.md 를 네이티브로 읽습니다 — 이 파일은 임포트하지 않아 이중 주입이 없습니다). `oculpm` MCP 도구(`journal_write` / `plan_status` / `plan_update` / `plan_create`)가 보이면 파일 직접 작성 대신 **도구를 우선**하세요. 일지 직후 대응 플래너 항목도 갱신합니다 (`plan_update`). agent.id 는 `claude-code`.

> 이 파일은 ocul-pm 이 관리하는 블록입니다 (`<!-- oculpm:begin v1 -->` … `<!-- oculpm:end -->`). 블록 밖 사용자 콘텐츠는 보존됩니다. 마스터 편집은 `.oculpm/agents/_template.md` 에서.
