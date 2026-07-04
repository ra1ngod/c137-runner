#!/usr/bin/env node
/**
 * Reshape a runner output (out/results.json) into the two files the OFFICIAL
 * LongMemEval evaluator consumes, then print the command to run it.
 *
 *   node grade/to-official.mjs out/results.json
 *     -> out/hypotheses.jsonl   ({question_id, hypothesis} per line)
 *     -> out/references.jsonl   ({question_id, question, answer, question_type})
 *
 * Grading MUST use the official script (GPT-4o judge, per-type prompts):
 *   git clone https://github.com/xiaowu0162/LongMemEval
 *   cd LongMemEval/src/evaluation
 *   OPENAI_API_KEY=sk-… python3 evaluate_qa.py gpt-4o <hypotheses.jsonl> <references.jsonl>
 * It writes <hypotheses.jsonl>.eval-results-gpt-4o with an autoeval_label per
 * question. Summarize with grade/summarize.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const resultsFile = process.argv[2] || "out/results.json";
const results = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
const dir = path.dirname(resultsFile);

const hyp = results.map((r) => JSON.stringify({ question_id: r.question_id, hypothesis: r.hypothesis }));
const ref = results.map((r) =>
  JSON.stringify({
    question_id: r.question_id,
    question: r.question,
    answer: r.ground_truth,
    question_type: r.question_type,
  }),
);
fs.writeFileSync(path.join(dir, "hypotheses.jsonl"), hyp.join("\n") + "\n");
fs.writeFileSync(path.join(dir, "references.jsonl"), ref.join("\n") + "\n");
console.log(`wrote ${dir}/hypotheses.jsonl + ${dir}/references.jsonl (${results.length} entries)`);
console.log(`\nnow grade with the official evaluator:`);
console.log(`  git clone https://github.com/xiaowu0162/LongMemEval`);
console.log(`  OPENAI_API_KEY=sk-… python3 LongMemEval/src/evaluation/evaluate_qa.py gpt-4o ${dir}/hypotheses.jsonl ${dir}/references.jsonl`);
console.log(`  node grade/summarize.mjs ${dir}/hypotheses.jsonl.eval-results-gpt-4o`);
