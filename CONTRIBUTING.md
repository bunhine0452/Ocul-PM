# 기여 안내 (Contributing)

Ocul-PM 에 관심 가져주셔서 감사합니다. 이슈·PR 모두 환영합니다.

## 라이선스와 DCO

- 이 저장소의 코드는 전부 [MIT](LICENSE) 이고, **영원히 MIT 로 남습니다** (유료화는 이 저장소 밖의 팀 모듈에만 적용 — [README의 약속](README.md#라이선스와-약속) 참조).
- 기여는 **CLA 없이 [DCO](https://developercertificate.org/)** 로 받습니다. 커밋에 sign-off 한 줄이면 됩니다:

```bash
git commit -s -m "fix: ..."
# 커밋 메시지 끝에 자동으로 붙습니다:
# Signed-off-by: Your Name <you@example.com>
```

sign-off 는 "이 기여를 내가 작성했고 MIT 로 제출할 권리가 있다"는 확인입니다. 저작권은 항상 기여자 본인에게 남습니다.

## 개발 환경

```bash
pnpm install        # Node 18+, pnpm, Rust stable, (macOS) Xcode CLT
pnpm tauri dev      # 앱 실행 (Rust + Vite)
```

커밋 전 게이트 4종이 모두 통과해야 합니다:

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
cd src-tauri && cargo test   # bindings.ts 재생성 포함
```

## 알아두면 좋은 것

- 아키텍처 개요와 규칙은 [CLAUDE.md](CLAUDE.md) 에 있습니다 (AI 에이전트용으로 쓰였지만 사람에게도 가장 빠른 지도입니다).
- `src/lib/bindings.ts` 는 자동 생성 파일입니다 — 직접 수정하지 마세요.
- UI 문자열·커밋 메시지는 한국어를 기본으로 합니다.
- 이 저장소는 Ocul-PM 자기 자신으로 추적됩니다 (`.oculpm/`) — 앱이 관리하는 `.oculpm/index/**` 는 건드리지 마세요.

## 이슈

버그 신고 시 앱 버전(설정 → 업데이트 탭)과 재현 단계를 함께 적어주세요. 기능 제안은 "어떤 문제를 풀고 싶은지"부터 시작해 주시면 논의가 빠릅니다.
