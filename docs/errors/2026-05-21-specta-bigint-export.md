# Specta BigInt Export Panic — 2026-05-21

## 증상

`pnpm tauri dev` 실행 직후 패닉으로 앱이 죽음:

```
thread 'main' (840371) panicked at src/lib.rs:139:10:
Failed to export typescript bindings: Attempted to export "" but Specta
forbids exporting BigInt-style types (usize, isize, i64, u64, i128, u128)
to avoid precision loss.
```

(`src/lib.rs:139` = `builder.export(Typescript::default(), ...).expect(...)`)

## 원인

Tauri Specta 가 자동으로 TS 바인딩을 만들 때, **command 시그니처나 `specta::Type`
struct 필드에 `i64`/`u64`/`usize`/`isize`/`i128`/`u128` 이 있으면 패닉**.

이유: TypeScript 의 `number` 는 IEEE 754 double 이라 정수 정밀도가 2^53 까지만
보장된다. 64-bit 정수를 그대로 내보내면 큰 unix epoch 등에서 silent precision
loss 가능. Specta 는 명시적 `bigint` 마커가 없으면 차단한다.

에러 메시지의 `""` 는 *익명 inner type* (예: `Option<i64>` 의 `i64`) 가 별도
이름이 없어 빈 문자열로 보고된 것.

## 잡힌 곳

| 위치 | 문제 코드 | 수정 |
|---|---|---|
| `commands/changelog.rs:196` (W2) | `since: Option<i64>` | `Option<i32>` 로 변경, 내부에서 `as i64` 캐스트 |
| `commands/overview.rs:383` (W3) | `pub date_unix: i64` (DailyBrief 필드) | `i32` 로 변경 |
| `commands/overview.rs:405` (W3) | `date_unix: Option<i64>` (daily_brief 인자) | `Option<i32>` 로 변경, 내부에서 `as i64` 캐스트 |

W2 의 `list_changelog` 도 W3 와 함께 처음 export 되며 동시에 터졌다 — 마지막
실제 `tauri dev` 가 W1 시점이었기 때문.

## 왜 i32 인가

코드베이스의 기존 관례 정합성:

- `list_file_changes(since: i32)` 가 **이미 i32** — 같은 의미의 unix 시각 파라미터.
- 저장 필드 (`created_at: u32`) 는 u32 이지만, 음수 가능성(예: epoch 이전)을
  포함한 *상대 시각 표현* 의 입력 파라미터는 i32 가 안전.
- i32 의 양수 상한 ≈ 2,147,483,647 → **2038-01-19 까지 안전**.
- 그 이후가 필요해지면 그때 Specta `BigInt` 마커 도입을 검토.

## 재발 방지 체크리스트

새 Tauri 커맨드를 추가할 때:

- [ ] 시그니처에 `i64`/`u64`/`usize`/`isize` 가 노출됐는가? → `i32`/`u32` 또는
      `String` (ISO 8601) 로 변경
- [ ] `#[derive(specta::Type)]` struct 필드에 같은 타입이 있는가? → 동일
- [ ] DB 메서드는 `i64` 유지 가능 — *Tauri 경계에서만* 변환
- [ ] `cargo check` 는 통과하지만 *런타임 panic* 으로만 잡힌다. 코드 추가 후
      반드시 `pnpm tauri dev` 한 번 실행해 export 검증

## 참고

- https://docs.rs/specta-typescript/latest/specta_typescript/struct.Error.html#bigint-forbidden
- MASTER-GUIDE §9.1 — 신규 커맨드 등록 시 확인 항목으로 추가 검토
