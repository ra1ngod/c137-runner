#!/usr/bin/env node
/**
 * Summarize an official-evaluator output file (…eval-results-gpt-4o):
 * raw + per-type accuracy, and a diff against the published run.
 *
 *   node grade/summarize.mjs out/hypotheses.jsonl.eval-results-gpt-4o [published/pro.grading.json]
 */
import fs from "node:fs";
import path from "node:path";

const evalFile = process.argv[2];
const publishedFile = process.argv[3] || path.join(import.meta.dirname, "..", "published", "pro.grading.json");
if (!evalFile) {
  console.error("usage: node grade/summarize.mjs <eval-results file> [published grading.json]");
  process.exit(1);
}

const lines = fs
  .readFileSync(evalFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const questions = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "questions.json"), "utf8"));

const byType = {};
let correct = 0;
const labels = {};
for (const r of lines) {
  const label = r.autoeval_label === true || r.autoeval_label?.label === true;
  const type = questions[r.question_id]?.question_type || "unknown";
  byType[type] ??= { correct: 0, total: 0 };
  byType[type].total++;
  if (label) {
    byType[type].correct++;
    correct++;
  }
  labels[r.question_id] = label;
}
console.log(`raw score: ${correct}/${lines.length} = ${((100 * correct) / lines.length).toFixed(1)}%`);
for (const [t, s] of Object.entries(byType).sort())
  console.log(`  ${t}: ${s.correct}/${s.total} = ${((100 * s.correct) / s.total).toFixed(1)}%`);

if (fs.existsSync(publishedFile)) {
  const pub = JSON.parse(fs.readFileSync(publishedFile, "utf8"));
  const pubCorrect = Object.values(pub).filter((v) => v.label).length;
  const flips = Object.keys(labels).filter((q) => pub[q] && pub[q].label !== labels[q]);
  console.log(`\nvs published (${path.basename(publishedFile)}: ${pubCorrect}/${Object.keys(pub).length}):`);
  console.log(`  delta ${correct - pubCorrect >= 0 ? "+" : ""}${correct - pubCorrect}, ${flips.length} label flips`);
  if (flips.length && flips.length <= 40) console.log(`  flipped qids: ${flips.join(", ")}`);
}
