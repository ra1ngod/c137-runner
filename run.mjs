#!/usr/bin/env node
/**
 * c137-runner — re-run the answer stage of the published LongMemEval-S result
 * over the frozen per-question prompts, against any OpenAI-compatible endpoint.
 *
 * Zero dependencies. Node 20+.
 *
 *   node run.mjs                          # published Gemini config (all 500)
 *   node run.mjs --ids 001be529,0862e8bf  # subset
 *   node run.mjs --scaffold scaffolds/gpt4o.txt   # the GPT-4o config
 *
 * Env (see .env.example): BASE_URL, API_KEY, MODEL, TEMPERATURE, MAX_TOKENS,
 * REASONING_EFFORT, CONC, OUT.
 *
 * Message shape — exactly what the published run sent:
 *   system = prompts/<qid>.txt   (frozen per-question context + answer scaffold)
 *   user   = questions.json[qid].user_message   ("[Today's date: …]\n\n<question>")
 * Params: temperature 0, max_tokens 24000, and for Gemini reasoning_effort
 * "medium" (native thinking on, as the run; the thinking tokens are why the
 * cap is 24000). gpt-4o rejects the reasoning param, so it is omitted for
 * non-Gemini models unless you set REASONING_EFFORT yourself. The GPT-4o run
 * used MAX_TOKENS=4000.
 */
import fs from "node:fs";
import path from "node:path";

// --- tiny .env loader (no deps) ---
const envFile = path.join(import.meta.dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const BASE_URL = process.env.BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
const API_KEY = process.env.API_KEY;
const MODEL = flag("model") || process.env.MODEL || "gemini-3.1-pro-preview";
const TEMPERATURE = Number(process.env.TEMPERATURE ?? 0);
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 24000);
// Sent as-is when non-empty. Default: "medium" for Gemini (native thinking on,
// exactly as the published runs — gemini-3.1-pro only works in thinking mode),
// omitted otherwise (gpt-4o 400s on the param).
const REASONING_EFFORT =
  process.env.REASONING_EFFORT ?? (/gemini/i.test(MODEL) ? "medium" : "");
const CONC = Number(flag("conc") || process.env.CONC || 6);
const OUT = flag("out") || process.env.OUT || "out";
const SCAFFOLD_FILE = flag("scaffold");
const IDS = (flag("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);

if (!API_KEY) {
  console.error("API_KEY missing — copy .env.example to .env and fill it in.");
  process.exit(1);
}

const questions = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "questions.json"), "utf8"));

// Optional scaffold swap — same region replacement the run used for the GPT-4o
// config (port of scripts/_s2iter.ts injectScaffold, c137 commit c442a8d5).
const scaffold = SCAFFOLD_FILE ? fs.readFileSync(SCAFFOLD_FILE, "utf8") : null;
function injectScaffold(prompt) {
  if (!scaffold) return prompt;
  const s = prompt.indexOf("## Specific-recall procedure");
  const e = prompt.indexOf("## Trailing questions");
  if (s < 0 || e < 0 || e < s) return prompt;
  return prompt.slice(0, s) + scaffold.trim() + "\n\n" + prompt.slice(e);
}

async function callModel(system, user) {
  const body = {
    model: MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (REASONING_EFFORT) body.reasoning_effort = REASONING_EFFORT;
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

async function one(qid) {
  const outFile = path.join(OUT, "answers", `${qid}.json`);
  if (fs.existsSync(outFile)) return JSON.parse(fs.readFileSync(outFile, "utf8"));
  const q = questions[qid];
  const system = injectScaffold(
    fs.readFileSync(path.join(import.meta.dirname, "prompts", `${qid}.txt`), "utf8"),
  );
  let hypothesis = "";
  let error = null;
  for (let attempt = 0; attempt < 4 && !hypothesis; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * attempt));
    try {
      hypothesis = await callModel(system, q.user_message);
      error = null;
    } catch (e) {
      error = String(e.message || e);
    }
  }
  if (error) console.error(`  ${qid} FAILED: ${error}`);
  const rec = {
    question_id: qid,
    question_type: q.question_type,
    question: q.question,
    ground_truth: q.answer,
    hypothesis,
    ...(error ? { error } : {}),
  };
  // only persist successes — a re-run then retries exactly the failed qids
  if (!error && hypothesis) fs.writeFileSync(outFile, JSON.stringify(rec, null, 2));
  return rec;
}

async function main() {
  fs.mkdirSync(path.join(OUT, "answers"), { recursive: true });
  let qids = Object.keys(questions).sort();
  if (IDS.length) qids = qids.filter((q) => IDS.includes(q));
  const pending = qids.filter((q) => !fs.existsSync(path.join(OUT, "answers", `${q}.json`)));
  console.log(
    `c137-runner: ${qids.length} questions (${pending.length} to run) | model=${MODEL} temp=${TEMPERATURE} max_tokens=${MAX_TOKENS}` +
      (REASONING_EFFORT ? ` reasoning_effort=${REASONING_EFFORT}` : "") +
      (scaffold ? ` scaffold=${SCAFFOLD_FILE}` : "") +
      ` conc=${CONC} -> ${OUT}/`,
  );
  const results = [];
  for (let i = 0; i < qids.length; i += CONC) {
    results.push(...(await Promise.all(qids.slice(i, i + CONC).map(one))));
    console.log(`  ${Math.min(i + CONC, qids.length)}/${qids.length}`);
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.error || !r.hypothesis).length;
  console.log(
    `done: ${results.length} answers -> ${OUT}/results.json` +
      (failed ? ` (${failed} FAILED — re-run to retry just those)` : ""),
  );
}

main();
