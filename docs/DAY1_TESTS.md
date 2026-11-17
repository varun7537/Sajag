# Day-1 verification tests (do these before polishing)

Two assumptions could not be checked from the build environment. Run both in desktop Chrome 139+ with a configured Firebase project.

## Test 1 — on-device screenshot extraction

1. Enable the Prompt API multimodal flag in `chrome://flags`, restart, press "Download on-device model" in the app.
2. Run 10 fabricated scam screenshots (English) through the app.
3. Record: does extraction return valid JSON facts? How many match what you can read? Latency?
4. **Decision rule:** if ≥ 7/10 are mostly correct, keep screenshots as a headline feature. If not, keep text-only extraction on-device and tell the user screenshots need pasted text; remove screenshot claims from the demo.

## Test 2 — grounded cloud verification via Firebase AI Logic

1. Run the HARD slice with the hybrid arm in `/eval`.
2. Check that responses include grounding citations (`groundingChunks`) and a `LEVEL:` line, and that official hosts are ranked first.
3. Check that `inferenceSource` reports the route you expect.
4. **Decision rule:** if grounding metadata is missing, drop the "grounded with citations" claim, keep the cloud step as plain verification, and say so in the description.

Also confirm that `ONLY_ON_DEVICE` works directly from state `downloadable` (otherwise the download button must be pressed first, as the UI already requires).
