# Sajag — project and user flow

## User flow

1. **Input.** The user pastes text and/or drops a screenshot. They may add "words to hide" (names, places) and choose English or Hindi.
2. **Phase 1 — local check (nothing leaves the device).**
   - Mask identifiers deterministically (`privacy/masker.ts`).
   - Extract structured facts (who claims to be sending, what they demand, urgency, links' hostnames):
     - screenshot → on-device model (required; otherwise the app explains it cannot read images without the local model);
     - English text and local model available → on-device model;
     - otherwise → heuristic extractor (rules), flagged with a caveat.
   - Run the explainable rule engine → local risk level + reasons.
3. **Review gate.** The user sees the masked facts and an exact preview of what would be sent to the cloud. They can include/exclude the masked text, edit hide-words, or stop here (a verdict is already available from Phase 1).
4. **Phase 2 — cloud verification (optional, user-triggered).**
   - The egress gate builds the prompt, re-scans it for residual identifiers, and throws if any are found (fail closed).
   - Cloud model with Google Search grounding checks the claims and returns a level line plus citations (official hosts first).
   - The final verdict takes the **stricter** of rules and cloud levels.
5. **Verdict.** Level (high / medium / low / unclear), reasons with their rule names, advisories (built-in + Remote Config), next steps (report at 1930 / cybercrime.gov.in), caveats, citations, a step trace showing which route each step took, and egress receipts.
6. **Explain simply.** Optional plain-words explanation: on-device in English when possible, cloud in Hindi (masked facts only).
7. **History.** Last 10 checks stored locally as masked excerpts only.

## Data flow rules

- Raw text and images are only ever seen by: the masker, the on-device model, and the heuristic extractor. All run in the browser.
- Anything sent to the cloud is built from masked facts (+ optionally masked text) and passes the egress gate.
- Links are reduced to hostnames. OTPs, Aadhaar (checksum-validated), cards (Luhn), phones, PAN, IFSC, UPI and emails are replaced by placeholders such as `[PHONE_1]`.

## Degradation paths

| Situation | Behaviour |
|---|---|
| No Firebase config | Offline mode: masker + heuristics + rules |
| No on-device model (unsupported browser/hardware) | Heuristics + rules; screenshots rejected with explanation |
| Model downloadable | "Download on-device model" button |
| Cloud disabled via Remote Config | Phase 2 hidden/disabled |
| Cloud call fails | Local verdict stays; error shown |
| Egress gate finds an identifier | Send blocked; user told why |
| Hindi/Hinglish text | Local rules; masked text may go to cloud after review |
