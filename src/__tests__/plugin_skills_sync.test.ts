// A2 (#a2-skills-activation) — 앱 스킬 갤러리와 플러그인 동봉 스킬의 이중 소스 방지.
// 2026-10-28 덜어내기로 갤러리가 비었다 — 다시 채우면 아래 동기 검사를 되살린다
// (`plugin/oculpm/skills/<id>/SKILL.md` 를 `?raw` 로 읽어 바이트 단위로 같아야 한다).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { GALLERY_SKILLS } from "@/features/skills/skillsGallery";

const pluginSkillsDir = join(process.cwd(), "plugin", "oculpm", "skills");

describe("plugin skills sync (플러그인이 SSOT)", () => {
  test("갤러리는 비어 있다 — 채우면 플러그인 디스크 사본과 같아야 한다", () => {
    expect(GALLERY_SKILLS).toEqual([]);
  });

  test("걷은 넷은 플러그인에도 없다", () => {
    for (const id of ["project-inception", "self-audit", "run-evals", "tdd-workflow"]) {
      expect(existsSync(join(pluginSkillsDir, id)), id).toBe(false);
    }
  });
});
