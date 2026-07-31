#!/usr/bin/env node
// score.mjs — B2 에이전틱 A/B 벤치마크 집계기 (의존성 없음)
//
// 입력: results/raw/<runid>/*.json + *.meta.json (+ B 팔 *.oculpm/journal 사본)
// 출력: results/<YYYY-MM-DD>-agentic.md 리포트 + stdout 요약
//
// 정직성 규범: 측정하지 않은 수치를 쓰지 않는다 — 원본에 없는 필드는 "—" 로 표기.
//
// 사용: node score.mjs [runid]   (생략 시 results/raw 의 최신 runid)

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
const RAW_ROOT = join(BENCH_DIR, "results", "raw");

// ─── runid 선택 ──────────────────────────────────────────────────────────────
function pickRunid() {
  const arg = process.argv[2];
  if (arg) return arg;
  const dirs = readdirSync(RAW_ROOT).filter((d) => {
    try { return statSync(join(RAW_ROOT, d)).isDirectory(); } catch { return false; }
  }).sort();
  if (dirs.length === 0) throw new Error(`results/raw 에 runid 가 없습니다: ${RAW_ROOT}`);
  return dirs[dirs.length - 1];
}

// ─── 원본 로드 ───────────────────────────────────────────────────────────────
function loadRuns(rawDir) {
  const metas = readdirSync(rawDir).filter((f) => f.endsWith(".meta.json")).sort();
  return metas.map((metaFile) => {
    const name = metaFile.replace(/\.meta\.json$/, "");
    const meta = JSON.parse(readFileSync(join(rawDir, metaFile), "utf8"));
    let claude = null;
    let rawText = "";
    const rawPath = join(rawDir, `${name}.json`);
    if (existsSync(rawPath)) {
      rawText = readFileSync(rawPath, "utf8");
      try { claude = JSON.parse(rawText); } catch { claude = null; }
    }
    return { name, meta, claude, rawText, rawDir };
  });
}

// ─── §2 frontmatter 검증 (AGENTS.md v8 규격) ────────────────────────────────
const TYPE_ENUM = ["bug", "feature", "error", "refactor", "chore"];
const STATUS_ENUM = ["planned", "in_progress", "done", "abandoned"];
const OP_ENUM = ["create", "update", "delete", "rename", "correct"];

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return m ? m[1] : null;
}

/** 최소 YAML 서브셋: 톱레벨 key, agent 중첩 매핑, files_touched 시퀀스. */
function extractField(fm, key) {
  const re = new RegExp(`^${key}:[ \\t]*(.*)$`, "m");
  const m = fm.match(re);
  return m ? m[1].trim() : null;
}

function extractBlock(fm, key) {
  // key: 로 시작해 다음 톱레벨 키(들여쓰기 0) 전까지의 들여쓰긴 줄들
  const lines = fm.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return null;
  const inline = lines[start].slice(key.length + 1).trim();
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return { inline, block };
}

function unquote(v) {
  if (v == null) return v;
  return v.replace(/^["']|["']$/g, "");
}

function validateJournal(text) {
  const failures = [];
  const ok = (cond, label) => { if (!cond) failures.push(label); };

  const fm = parseFrontmatter(text);
  if (fm == null) return { passed: false, failures: ["frontmatter 블록 없음"] };

  ok(/^schema_version:\s*1\s*$/m.test(fm), "schema_version=1");

  const type = unquote(extractField(fm, "type"));
  ok(type != null && TYPE_ENUM.includes(type), "type enum");

  const slug = unquote(extractField(fm, "slug"));
  ok(slug != null && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 40, "slug ASCII kebab ≤40");

  const status = unquote(extractField(fm, "status"));
  ok(status != null && STATUS_ENUM.includes(status), "status enum");

  const createdAt = unquote(extractField(fm, "created_at"));
  ok(
    createdAt != null &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/.test(createdAt),
    "created_at +HH:MM offset (Z/+0900 금지)"
  );

  const sessionId = unquote(extractField(fm, "session_id"));
  ok(sessionId != null && sessionId.length > 0, "session_id 존재");

  // agent — id/version 매핑이어야 함 (문자열 금지)
  const agent = extractBlock(fm, "agent");
  if (agent == null) {
    failures.push("agent 매핑");
  } else if (agent.inline && !agent.inline.startsWith("{")) {
    failures.push("agent 가 문자열 (매핑이어야)");
  } else {
    const body = agent.inline.startsWith("{") ? agent.inline : agent.block.join("\n");
    ok(/(^|\s|\{)id:\s*\S/.test(body), "agent.id");
    ok(/(^|\s|,\s*)version:\s*\S/.test(body), "agent.version");
  }

  const language = unquote(extractField(fm, "language"));
  ok(language === "ko" || language === "en", "language ko|en");

  const verified = extractField(fm, "verified_by_user");
  ok(verified === "true" || verified === "false", "verified_by_user bool");

  // files_touched — [{path, op}] 시퀀스
  const ft = extractBlock(fm, "files_touched");
  const ftPaths = [];
  if (ft == null) {
    failures.push("files_touched 존재");
  } else if (ft.inline === "[]") {
    // 빈 배열은 형식상 유효 (겹침 채점에서 0 으로 드러남)
  } else {
    const body = ft.block.join("\n") + (ft.inline.startsWith("[") ? ft.inline : "");
    const items = body.split(/^\s*-\s+/m).filter((s) => s.trim().length > 0);
    if (items.length === 0 && !ft.inline.startsWith("[")) failures.push("files_touched 항목 파싱 불가");
    let allValid = items.length > 0 || ft.inline.startsWith("[");
    for (const item of items) {
      const p = item.match(/path:\s*(.+)/);
      const o = item.match(/op:\s*(\S+)/);
      if (!p || !o || !OP_ENUM.includes(unquote(o[1]))) allValid = false;
      if (p) ftPaths.push(unquote(p[1].trim()));
    }
    // 인라인 [{path: x, op: y}] 형태
    if (ft.inline.startsWith("[") && ft.inline !== "[]") {
      const inlineItems = [...ft.inline.matchAll(/path:\s*([^,}]+)\s*,?\s*op:\s*([^,}\]]+)/g)];
      if (inlineItems.length === 0) allValid = false;
      for (const mi of inlineItems) {
        if (!OP_ENUM.includes(unquote(mi[2].trim()))) allValid = false;
        ftPaths.push(unquote(mi[1].trim()));
      }
    }
    ok(allValid, "files_touched [{path,op}] 형식");
  }

  return { passed: failures.length === 0, failures, ftPaths, type, slug };
}

// ─── 정직성 프록시: files_touched ↔ git diff 겹침 ───────────────────────────
function overlapScore(ftPaths, changedFiles) {
  const norm = (p) => p.replace(/^\.\//, "");
  const changed = changedFiles.map(norm).filter((p) => !p.startsWith(".oculpm/") && p !== "AGENTS.md");
  const listed = ftPaths.map(norm);
  const hit = listed.filter((p) => changed.includes(p));
  return {
    changedCode: changed.length,
    listed: listed.length,
    hits: hit.length,
    coverage: changed.length > 0 ? hit.length / changed.length : null,
    precision: listed.length > 0 ? hit.length / listed.length : null,
  };
}

// ─── 포맷 도우미 ─────────────────────────────────────────────────────────────
const dash = "—";
const num = (v, d = 0) => (v == null || Number.isNaN(v) ? dash : Number(v).toFixed(d));
const pct = (v) => (v == null ? dash : `${(v * 100).toFixed(0)}%`);

function usageOf(claude) {
  const u = claude?.usage ?? {};
  return {
    turns: claude?.num_turns ?? null,
    durMs: claude?.duration_ms ?? null,
    apiMs: claude?.duration_api_ms ?? null,
    cost: claude?.total_cost_usd ?? null,
    inTok: u.input_tokens ?? null,
    outTok: u.output_tokens ?? null,
    cacheRead: u.cache_read_input_tokens ?? null,
    cacheWrite: u.cache_creation_input_tokens ?? null,
    isError: claude?.is_error ?? null,
    subtype: claude?.subtype ?? null,
  };
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
const runid = pickRunid();
const rawDir = join(RAW_ROOT, runid);
const runs = loadRuns(rawDir);
if (runs.length === 0) throw new Error(`meta 파일이 없습니다: ${rawDir}`);

const rows = runs.map((r) => {
  const u = usageOf(r.claude);
  const oculpmMentions = (r.rawText.match(/oculpm/gi) ?? []).length;

  // B 팔 일지 준수 채점 (사본 기준 — 실행 workdir 은 재현 대상이 아님)
  let compliance = null;
  if (r.meta.arm === "B") {
    const journals = (r.meta.journal_files ?? []).map((f) => {
      const capPath = join(rawDir, `${r.name}.oculpm`, f.replace(/^\.oculpm\//, ""));
      let v = { passed: false, failures: ["사본 없음"], ftPaths: [] };
      if (existsSync(capPath)) v = validateJournal(readFileSync(capPath, "utf8"));
      return { file: f, ...v, overlap: overlapScore(v.ftPaths ?? [], r.meta.changed_files ?? []) };
    });
    compliance = { journalCount: journals.length, journals };
  }
  return { ...r, u, oculpmMentions, compliance };
});

// 팔·티켓별 집계
function aggregate(list) {
  const n = list.length;
  const succ = list.filter((r) => r.meta.success).length;
  const avg = (sel, d = 0) => {
    const vals = list.map(sel).filter((v) => v != null);
    return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  return {
    n, succ,
    turns: avg((r) => r.u.turns),
    wall: avg((r) => r.meta.wall_secs),
    apiMs: avg((r) => r.u.apiMs),
    cost: avg((r) => r.u.cost),
    inTok: avg((r) => r.u.inTok),
    outTok: avg((r) => r.u.outTok),
    cacheRead: avg((r) => r.u.cacheRead),
    cacheWrite: avg((r) => r.u.cacheWrite),
  };
}

const tickets = [...new Set(rows.map((r) => r.meta.ticket))].sort();
const byArmTicket = {};
for (const arm of ["A", "B"]) {
  for (const t of tickets) {
    byArmTicket[`${arm}:${t}`] = aggregate(rows.filter((r) => r.meta.arm === arm && r.meta.ticket === t));
  }
}
const armTotals = { A: aggregate(rows.filter((r) => r.meta.arm === "A")), B: aggregate(rows.filter((r) => r.meta.arm === "B")) };

// ─── 리포트 생성 ─────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push(`# 에이전틱 A/B 벤치마크 — runid ${runid}`);
lines.push("");
lines.push(`> A 팔 = 순정 claude 헤드리스 / B 팔 = .oculpm 스캐폴드(AGENTS.md v8) + oculpm 플러그인.`);
lines.push(`> 원본: \`benchmarks/agentic/results/raw/${runid}/\`. 측정하지 않은 수치는 "${dash}" 로 표기한다.`);
lines.push("");
lines.push("## 실행별 원자료");
lines.push("");
lines.push("| run | 성공 | 턴 | wall(s) | api(s) | in tok | out tok | cache read | cache write | cost($) | subtype |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  lines.push(
    `| ${r.name} | ${r.meta.success ? "✅" : "❌"} | ${num(r.u.turns)} | ${num(r.meta.wall_secs)} | ${num(r.u.apiMs != null ? r.u.apiMs / 1000 : null, 1)} | ${num(r.u.inTok)} | ${num(r.u.outTok)} | ${num(r.u.cacheRead)} | ${num(r.u.cacheWrite)} | ${num(r.u.cost, 4)} | ${r.u.subtype ?? dash} |`
  );
}
lines.push("");
lines.push("## 팔 비교 (티켓별 평균)");
lines.push("");
lines.push("| 티켓 | 팔 | n | 성공률 | 턴 | wall(s) | in tok | out tok | cache read | cost($) |");
lines.push("|---|---|---|---|---|---|---|---|---|---|");
for (const t of tickets) {
  for (const arm of ["A", "B"]) {
    const a = byArmTicket[`${arm}:${t}`];
    if (a.n === 0) continue;
    lines.push(
      `| ${t} | ${arm} | ${a.n} | ${pct(a.succ / a.n)} | ${num(a.turns, 1)} | ${num(a.wall)} | ${num(a.inTok)} | ${num(a.outTok)} | ${num(a.cacheRead)} | ${num(a.cost, 4)} |`
    );
  }
}
lines.push("");
lines.push("## 팔 합계 (전 티켓 평균)");
lines.push("");
lines.push("| 팔 | n | 성공률 | 턴 | wall(s) | in tok | out tok | cache read | cache write | cost($) |");
lines.push("|---|---|---|---|---|---|---|---|---|---|");
for (const arm of ["A", "B"]) {
  const a = armTotals[arm];
  if (a.n === 0) continue;
  lines.push(
    `| ${arm} | ${a.n} | ${pct(a.succ / a.n)} | ${num(a.turns, 1)} | ${num(a.wall)} | ${num(a.inTok)} | ${num(a.outTok)} | ${num(a.cacheRead)} | ${num(a.cacheWrite)} | ${num(a.cost, 4)} |`
  );
}
lines.push("");
lines.push("## B 팔 기록 준수");
lines.push("");
lines.push("| run | 일지 수 | frontmatter | 실패 항목 | files_touched 겹침 (hit/변경, 커버리지) |");
lines.push("|---|---|---|---|---|");
for (const r of rows.filter((r) => r.meta.arm === "B")) {
  const c = r.compliance;
  if (c.journalCount === 0) {
    lines.push(`| ${r.name} | 0 | ${dash} | 일지 없음 | ${dash} |`);
    continue;
  }
  for (const j of c.journals) {
    const o = j.overlap;
    lines.push(
      `| ${r.name} | ${c.journalCount} | ${j.passed ? "✅ 통과" : "❌"} | ${j.failures.join("; ") || dash} | ${o.hits}/${o.changedCode}, ${pct(o.coverage)} |`
    );
  }
}
lines.push("");
lines.push("## 격리 신호");
lines.push("");
lines.push(`> A 팔 raw JSON 에 "oculpm" 문자열이 있으면 격리 실패 의심 (B 팔은 있는 것이 정상).`);
lines.push("");
lines.push("| run | raw 내 oculpm 언급 | .oculpm 디렉터리 |");
lines.push("|---|---|---|");
for (const r of rows) {
  lines.push(`| ${r.name} | ${r.oculpmMentions} | ${r.meta.oculpm_dir_exists ? "있음" : "없음"} |`);
}
lines.push("");
lines.push("## 방법론·한계");
lines.push("");
lines.push("(자리 — 방법론 요약은 `benchmarks/agentic/README.md` 참조. 이 섹션은 본실행 후 해석·한계를 채운다.");
lines.push("측정하지 않은 수치를 쓰지 않는다.)");
lines.push("");

const reportPath = join(BENCH_DIR, "results", `${today}-agentic.md`);
writeFileSync(reportPath, lines.join("\n"));
console.log(lines.join("\n"));
console.error(`\n리포트 저장: ${reportPath}`);
