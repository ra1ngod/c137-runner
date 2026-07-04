# c137-runner — LongMemEval-S reproducibility package

Open artifacts + runner for the published [c137](https://c137.ai) memory-benchmark result on
[LongMemEval-S](https://github.com/xiaowu0162/LongMemEval) (500 questions):

| run | model | raw score (correct/500) |
|---|---|---|
| **Pro** | `gemini-3.1-pro-preview` | **470/500 = 94.0%** |
| Flash | `gemini-3-flash-preview` | 455/500 = 91.0% |
| GPT-4o | `gpt-4o` | 412/500 = 82.4% |

Per-question answers, judge labels, and the exact prompt behind every question are browsable in the
[bench viewer](https://c137.ai/research/bench-viewer); methodology in the
[write-up](https://c137.ai/research/overhaul).

## What this proves — and what it doesn't

c137 is a three-stage pipeline: ingest conversations into an editable memory store, retrieve per
question, then answer. This package makes the **answer stage fully re-runnable and the whole
context auditable**:

- **Re-runnable:** `prompts/<qid>.txt` is the exact system prompt sent for each of the 500
  questions — the frozen memory context retrieved for that question with the frozen answer
  scaffold inline. You re-run the exact API calls and grade with the **official** LongMemEval
  evaluator (GPT-4o judge). No c137 code involved.
- **Auditable, not re-runnable:** ingestion and retrieval ran inside the c137 pipeline against a
  live database; they are not packaged here. Instead, their entire *output* is visible: the memory
  block inside every prompt is everything the answer model saw. Grep the prompts for leakage —
  if the pipeline had smuggled in gold answers, it would be in these files.

## Quickstart

```bash
cp .env.example .env         # fill in API_KEY (Gemini) + OPENAI_API_KEY (judge)
node run.mjs                 # 500 answer calls -> out/results.json
node grade/to-official.mjs out/results.json   # -> hypotheses.jsonl + references.jsonl
```

then grade with the official evaluator and summarize:

```bash
git clone https://github.com/xiaowu0162/LongMemEval
pip install openai tqdm backoff numpy   # the evaluator's deps
OPENAI_API_KEY=sk-… python3 LongMemEval/src/evaluation/evaluate_qa.py \
  gpt-4o out/hypotheses.jsonl out/references.jsonl
node grade/summarize.mjs out/hypotheses.jsonl.eval-results-gpt-4o
```

**Cost:** the 500 prompts total ~4.6M input tokens (19k–130k chars each, avg ~9k tokens) plus
roughly 0.5–1M output tokens (native thinking bills as output) — check current
`gemini-3.1-pro-preview` pricing. Grading is 500 short
GPT-4o judge calls. `run.mjs` resumes (skips answered qids), so failures are cheap to retry.

**Expected result:** within ~1% of 470/500. A validation rerun of this exact package — fresh
clone, own keys, official grader — scored **469/500 = 93.8%** (19 individual label flips vs the
published run, roughly balanced both ways). Temp-0 Gemini is not bit-deterministic and the
GPT-4o judge has small run-to-run wobble, so individual flips are normal; the aggregate holds.
Diff your labels against `published/pro.grading.json` (`grade/summarize.mjs` does this).

## What ran, exactly

Every published number came from the same call shape this runner makes:

- `POST {BASE_URL}/chat/completions` — Gemini through Google's OpenAI-compat endpoint
  (`https://generativelanguage.googleapis.com/v1beta/openai`), GPT-4o through OpenAI.
- `system` = `prompts/<qid>.txt` · `user` = `questions.json[qid].user_message`
  (the question prefixed with the in-world date, e.g. `[Today's date: 2023/05/30 (Tue) 10:18]`).
- `temperature: 0`, and for Gemini `reasoning_effort: "medium"` (native thinking on —
  `gemini-3.1-pro` only runs in thinking mode) with `max_tokens: 24000` (thinking tokens count
  toward the cap). GPT-4o rejects the reasoning param, so it's omitted there, with
  `max_tokens: 4000`.

The three runs share the same 500 frozen memory contexts (same ingestion — an open-weight
Qwen3-235B extractor — and same retrieval). The Gemini runs used `scaffolds/gemini.txt` as the
answer scaffold; the GPT-4o run used the shorter `scaffolds/gpt4o.txt` (4o followed the long
scaffold poorly). `prompts/` ships the Gemini config; reproduce the 4o config with
`node run.mjs --scaffold scaffolds/gpt4o.txt --model gpt-4o` against OpenAI, which swaps the
scaffold section in place, exactly as the run did.

### Prompt disclosure

These are **bench prompts, not c137 prod prompts**: the recall scaffold (the
`## Specific-recall procedure` section — forced written working-out for count/date/compare
questions) was tuned on this benchmark for the Gemini models, and is disclosed in full in
`scaffolds/`. The memory contents, their format, and the retrieval behind them are the product
pipeline as of the run (June 2026). Details in the [write-up](https://c137.ai/research/overhaul).

## Repo layout

```
prompts/<qid>.txt        500 exact system prompts (frozen context + scaffold inline)
questions.json           qid -> question, question_type, gold answer, exact user message
scaffolds/gemini.txt     answer scaffold used by the Pro + Flash runs
scaffolds/gpt4o.txt      reduced scaffold used by the GPT-4o run
published/               the published runs' raw model answers + official judge labels
  pro.results.json / pro.grading.json   (+ flash.*, gpt4o.*)
run.mjs                  zero-dependency runner (Node 20+), any OpenAI-compatible endpoint
grade/to-official.mjs    reshape output for the official LongMemEval evaluator
grade/summarize.mjs      raw + per-type accuracy, diff vs published labels
```

## License & attribution

Scripts and scaffolds: MIT (see `LICENSE`). The questions, gold answers, and the conversational
content inside the prompts derive from the
[LongMemEval](https://github.com/xiaowu0162/LongMemEval) benchmark (Wu et al., ICLR 2025) —
MIT-licensed code, dataset via the authors' Hugging Face release; that content remains theirs,
redistributed here solely so the published result can be verified. If you use the benchmark,
cite their paper.
