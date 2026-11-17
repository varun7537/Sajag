# Evaluation

## Data

`eval/dataset.json` — 118 **synthetic** messages written by the project team (62 scam, 56 benign, English/Hindi/Hinglish). Regenerate with `npm run eval:gen`. Not real scam traffic.

- Template slice (100 items): rules were tuned on these, so results are optimistic.
- HARD slice (18 items, categories `hard_*`): hand-written paraphrases not used for tuning.

"Flagged" = medium or high. Precision/recall are for the scam class.

## Arm 1 — rules only (Node: `npm run eval`)

| Slice | n | Precision | Recall | FP | FN |
|---|---|---|---|---|---|
| Template | 100 | 100% | 100% | 0 | 0 |
| HARD | 18 | 50% | 10% | 1 | 9 |

Reading: the rules do not generalise to paraphrases. That is the case for hybrid AI in this app, not a result to hide.

## Leakage test (Node)

472 outgoing prompts built (4 per message). 476 planted identifier checks, **0 leaks**, 0 residual pattern matches. Personal names are not auto-detected: present in 32 of 64 checks without user-supplied hide-words, 0 with them.

## Arms 2 and 3 — on-device and hybrid (browser, not yet measured)

Open `/eval` in desktop Chrome with Firebase configured, download the on-device model, and run. The page reports per-arm precision, recall, F1, FP/FN, median time and how many extractions ran on-device, and lets you download JSON. Paste the numbers here before submission. A raw-text cloud-only baseline is intentionally excluded because it would violate the project's privacy policy.

Cloud arm uses one request per message; use the HARD slice first to stay inside free-tier quotas.
