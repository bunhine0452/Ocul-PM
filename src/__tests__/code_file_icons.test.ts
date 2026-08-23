// 파일 아이콘 매핑 — 순수 함수 계약.
//
// 렌더(SVG)는 눈으로 볼 것이고, 여기서 지키는 것은 **판정 규칙**이다:
// 정확한 파일명이 확장자보다 먼저고, 모르는 것은 조용히 문서 아이콘이 된다.
import { describe, expect, it } from "vitest";
import { iconSpecFor } from "@/features/code/FileIcon";

describe("iconSpecFor — 판정 규칙", () => {
  it("도형 로고가 있는 언어는 로고다 — 색상자 모노그램이 아니라", () => {
    expect(iconSpecFor("main.rs")).toEqual({ kind: "logo", logo: "rust" });
    expect(iconSpecFor("script.py")).toEqual({ kind: "logo", logo: "python" });
    expect(iconSpecFor("README.md")).toEqual({ kind: "logo", logo: "markdown" });
    expect(iconSpecFor("App.vue")).toEqual({ kind: "logo", logo: "vue" });
  });

  it("TS/JS 는 공식 로고 그대로 — 모서리 글자 사각형", () => {
    expect(iconSpecFor("app.ts")).toMatchObject({ kind: "corner", label: "TS", bg: "#3178C6" });
    expect(iconSpecFor("app.js")).toMatchObject({ kind: "corner", label: "JS", bg: "#F7DF1E" });
  });

  it("jsx/tsx 는 리액트 원자다 (ts 와 갈려야 컴포넌트 파일이 한눈에 띈다)", () => {
    expect(iconSpecFor("App.tsx")).toEqual({ kind: "logo", logo: "react" });
    expect(iconSpecFor("index.jsx")).toEqual({ kind: "logo", logo: "react" });
    expect(iconSpecFor("util.ts").kind).toBe("corner");
  });

  it("로고가 없는 언어는 상자 없는 색 글자다", () => {
    expect(iconSpecFor("main.go")).toMatchObject({ kind: "letter", label: "Go" });
    expect(iconSpecFor("data.json")).toMatchObject({ kind: "letter", label: "{}" });
    expect(iconSpecFor("style.css")).toMatchObject({ kind: "letter", label: "#" });
  });

  it("정확한 파일명이 확장자보다 먼저다", () => {
    // pnpm-lock.yaml 이 yaml(설정)로 판정되면 잠금 파일임이 안 보인다.
    expect(iconSpecFor("pnpm-lock.yaml")).toEqual({ kind: "glyph", glyph: "lock" });
    expect(iconSpecFor("package-lock.json")).toEqual({ kind: "glyph", glyph: "lock" });
    expect(iconSpecFor("Cargo.lock")).toEqual({ kind: "glyph", glyph: "lock" });
    // 대소문자 무시.
    expect(iconSpecFor("MAKEFILE")).toEqual({ kind: "glyph", glyph: "shell" });
  });

  it("성질이 있는 파일은 성질 아이콘이다", () => {
    expect(iconSpecFor(".gitignore")).toEqual({ kind: "glyph", glyph: "git" });
    expect(iconSpecFor("photo.png")).toEqual({ kind: "glyph", glyph: "image" });
    expect(iconSpecFor("schema.sql")).toEqual({ kind: "glyph", glyph: "db" });
    expect(iconSpecFor("config.toml")).toEqual({ kind: "glyph", glyph: "gear" });
    expect(iconSpecFor("run.sh")).toEqual({ kind: "glyph", glyph: "shell" });
  });

  it(".env 계열은 열쇠 — 비밀이 든 파일임을 밝힌다", () => {
    expect(iconSpecFor(".env")).toEqual({ kind: "glyph", glyph: "key" });
    expect(iconSpecFor(".env.local")).toEqual({ kind: "glyph", glyph: "key" });
    // .environment 같은 우연한 접두사는 아니다.
    expect(iconSpecFor(".environment")).toEqual({ kind: "glyph", glyph: "gear" });
  });

  it("모르는 점 파일은 도구 설정, 그 밖은 문서로 접는다", () => {
    expect(iconSpecFor(".prettierrc")).toEqual({ kind: "glyph", glyph: "gear" });
    expect(iconSpecFor("LICENSE")).toEqual({ kind: "glyph", glyph: "doc" });
    expect(iconSpecFor("notes.txt")).toEqual({ kind: "glyph", glyph: "doc" });
    expect(iconSpecFor("no-extension")).toEqual({ kind: "glyph", glyph: "doc" });
  });
});
