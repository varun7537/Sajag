# Sajag (सजग) — a privacy-first "is this a scam?" checker

Paste a suspicious message or drop a screenshot. Sajag tells you how risky it looks, **why**, and what to do next — in English or Hindi — while keeping the raw message on your device.

Built for the #BuildHybridAI 2026 hackathon on **Firebase AI Logic hybrid inference**.

## The idea in one paragraph

Scam messages contain exactly the data you must not upload: phone numbers, Aadhaar/PAN, UPI ids, OTPs, names. But judging a scam also needs fresh facts ("is this arrest-by-video-call story a known fraud right now?") that a small local model cannot know. Sajag splits the work: the **on-device model** reads the raw message/screenshot, a **deterministic masker** removes identifiers, you **review** the masked facts, and only then does the **cloud model with Google Search grounding** verify them. An **egress gate** re-scans every outgoing prompt and refuses to send if an identifier is still present.

## Features

- Text and screenshot input (screenshots are read on-device only; images never go to the cloud).
- Explainable verdict: every rule that fired is listed with its reason. A cloud "low" never downgrades a rules "high".
- Two-phase flow with a human review gate and an exact preview of the outgoing payload.
- Egress receipt: what was sent, to which route, with identifier counts.
- English / Hindi UI; Hinglish input handled by local rules.
- Works with no AI at all (rules-only fallback) and with no Firebase config (offline mode).
- Remote Config for new advisories and a cloud kill switch.

## Tech stack

Vite + TypeScript (strict), vanilla DOM (no `innerHTML`), Firebase JS SDK 13 (`firebase/ai`, App Check, Remote Config, Hosting), Chrome built-in AI (Prompt API / Gemini Nano), Vitest, tsx. Licence: Apache-2.0.

## Quick start

```bash
npm install
npm test            # 52 unit tests
npm run eval        # rules-only eval + privacy leakage test (Node, no network)
cp .env.example .env.local   # fill in Firebase web config
npm run dev
```

Without `.env.local` the app runs in offline mode (rules only, no AI calls).

### Firebase setup

1. Create a Firebase project and register a **Web app**; copy its config into `.env.local`.
2. Firebase console → **AI Logic** → enable it with the **Gemini Developer API**.
3. **App Check** (required): register a reCAPTCHA Enterprise key for production, or for local/judging set `VITE_APPCHECK_DEBUG=true`, run the app once, and register the debug token printed in the browser console under App Check → Apps → Manage debug tokens.
4. Optional **Remote Config** keys: `advisories_json` (array of advisories) and `cloud_enabled` (boolean kill switch).
5. Copy `.firebaserc.example` to `.firebaserc`, set your project id, then:
   ```bash
   npm run build
   npx firebase-tools deploy --only hosting
   ```

### Chrome setup for on-device AI

- Desktop Chrome 139+ (Windows, macOS, Linux). Needs ~22 GB free disk, >4 GB VRAM or 16 GB RAM.
- For screenshot understanding enable the multimodal Prompt API flag in `chrome://flags` (see `docs/DAY1_TESTS.md`).
- Open the app and press "Download on-device model" once.
- The on-device model supports en/ja/es/de/fr. **Hindi is not available on-device**, so Hindi/Hinglish text goes through local rules, then masked text may go to the cloud after your review.

## Project layout

See `docs/ARCHITECTURE.md` (modules, routing, diagrams) and `docs/FLOW.md` (user and data flow). Evaluation: `docs/EVAL.md`. Things to verify before you submit: `docs/DAY1_TESTS.md`.

## Honest limits

- **Rules-only recall on hard paraphrases is low**: 10% on an 18-message hand-written slice (the 100% on the template slice is optimistic because the rules were tuned on it). The on-device and cloud arms are meant to close this gap but have **not been measured yet**; run `/eval` in Chrome with Firebase configured.
- The dataset is **synthetic** (written by us), not real scam traffic.
- Names and street addresses are not auto-detected by the masker. You can add words to hide, and you review the masked text before sending.
- Sajag never says "safe". "Low" means no known warning signs were found, not that the message is genuine.
- **Gemini API free tier terms**: do not send sensitive/personal data; content may be reviewed by humans. This is why only masked facts are ever sent, and why you should test with fabricated messages.
- Unverified until you test in a real browser: on-device screenshot extraction quality, grounding behaviour through Firebase AI Logic, and the `inferenceSource` value reported by the SDK.

## Hackathon submission checklist

- [ ] Public repo with this code; Apache-2.0 detected in the About section (LICENSE is at the root).
- [ ] Deployed Hosting URL; App Check debug token registered for judges, or reCAPTCHA configured.
- [ ] Run the two tests in `docs/DAY1_TESTS.md` and record results.
- [ ] Run `/eval` in Chrome and paste the numbers into `docs/EVAL.md`.
- [ ] Demo video (<3 min) showing: on-device extraction, review gate, egress receipt, grounded cloud check, rules-only fallback.
- [ ] Text description naming the hybrid routing and the privacy guarantees (and their limits).
- [ ] Submit before 1 Dec 2026, 3:30 AM IST.
