# 03. ClarifyDialog 컴포넌트

> **작업 ID**: W5 / UI-5
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.8 ("Quick Edit 안의 Clarify Dialog")

---

## 변경 요약

`clarify_edit_intent` 가 모호하다고 판단해 질문을 반환한 경우 사용자에게
1~3 개의 질문을 받는 모달.

## 신규 파일

### `src/features/code/ClarifyDialog.tsx`

Props:
```ts
interface ClarifyDialogProps {
  open: boolean;
  ambiguityScore: number;        // 헤더 우측에 0.00–1.00 표시
  questions: ClarifyQuestion[];
  busy?: boolean;                 // 답변 제출 후 LLM 생성 중일 때 true
  onSubmit: (answers: ClarifyAnswer[]) => void;
  onCancel: () => void;
}
```

지원 동작:
- **`kind: "choice"`** → option chip 들 중 하나 선택
- **`kind: "text"`** → 자유 입력 Input
- **건너뛰기** → `onSubmit([])` (답변 없이 진행)
- **답변하고 진행** → 빈 답변이 있으면 disabled, 전부 채우면 활성
- **Esc / backdrop click / X 버튼** → `onCancel`

상태:
- `draftAnswers: Record<string, string>` — 사용자가 채우는 임시 답변
- `open` 변경 또는 `questions` 변경 시 자동 reset (이전 쿼리 답이 새는 걸 방지)

스타일:
- 모달 z-index 95 (Settings 90 보다 위, DiffModal 과 동급)
- 카드 max-w-lg, 작은 모달
- backdrop blur + fade in animation (다른 오버레이와 일관)

## 설계 결정

- **답변 강제 vs 선택**: 마스터 가이드 §5.8 의 "질문 건너뛰기" 옵션 채택.
  사용자가 질문이 무가치하다고 판단하면 즉시 우회 가능.
- **답변 유효성**: 빈 문자열만 막음. 옵션 정합성 검증은 LLM 이 무관한 텍스트
  답변을 받아도 합리적으로 처리하므로 클라이언트 단에서 깐깐히 안 따짐.
- **단일 패널 디자인**: 질문 1~3 개 모두 한 화면에 노출 → step-wise 가 아닌
  flat list. 1~3 개라는 작은 수에서는 스텝 인터랙션이 오히려 거추장.

## 검증

`tsc --noEmit` 통과. 동작 확인은 AiWorkbench Quick Edit 모드 + dev 런에서.
