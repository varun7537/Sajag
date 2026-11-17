/** Prompt text. Kept in one file so the exact wording is auditable. */

export const EXTRACT_PROMPT = `You help a person in India check a message that may be a scam.
Read the message (text and/or screenshot) and fill the JSON fields.

Rules:
- Output JSON only, matching the schema.
- NEVER copy personal names, phone numbers, account numbers, ID numbers, UPI ids or OTP digits into any field. Write [REDACTED] instead.
- senderClaim: who the sender claims to be.
- demands: only what the message actually asks the reader to do.
- urgencyCues: up to 5 short quoted phrases that create pressure (no numbers or names).
- promisedReturns: true only if profit, returns or income are promised.
- domains: hostnames only, for example example.com. No paths or parameters.
- summary: one neutral English sentence describing what the message asks.
- transcript: the visible text of the message, in its original language.`;

export const VERIFY_INSTRUCTIONS = `You are helping a person in India decide whether a message may be a scam.
You receive ONLY masked, structured facts about the message. Identifiers were removed on the person's device.

Task:
1. Use Google Search to check whether the claimed sender type and demands match how real Indian authorities, banks and regulators behave. Prefer official sources: cybercrime.gov.in, pib.gov.in, rbi.org.in, sebi.gov.in, trai.gov.in, mha.gov.in, indiacode.nic.in.
2. Mention the scam pattern by name if one fits (for example digital arrest, task scam, fake trading app).
3. Do not invent links, quotes, laws or statistics. If you find no evidence, say so plainly.
4. Never tell the person a message is "safe". The most reassuring honest answer is "no strong scam signs found; still verify through an official channel you look up yourself".
5. Write at most 110 words in plain, calm language. Do not ask the person for more personal details.
6. The last line must be exactly one of: LEVEL: high | LEVEL: medium | LEVEL: low | LEVEL: unclear`;

export const EXPLAIN_INSTRUCTIONS = `Explain in simple, calm words why a message may be a scam, using ONLY the masked facts and rule ids below.
At most 90 words. Finish with two short, practical next steps. Do not ask for personal details. Never say a message is safe.`;

export function languageLine(lang: "en" | "hi"): string {
  return lang === "hi"
    ? "Write the answer in simple Hindi (Devanagari), keeping the final LEVEL line in English exactly as specified."
    : "Write the answer in simple English.";
}
