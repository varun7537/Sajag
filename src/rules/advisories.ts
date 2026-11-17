import type { Advisory } from "../types";

/**
 * Official guidance the app can cite WITHOUT a network call.
 *
 * Only add an entry after opening the source page and confirming the wording. Entries here
 * were read by the project team on the date in `verifiedOn`. The grounded cloud step may add
 * more citations at runtime; those are shown separately and labelled as web results.
 *
 * Remote Config key `advisories_json` can extend this list without redeploying (see
 * src/remote/remoteConfig.ts).
 */
export const BUILT_IN_ADVISORIES: Advisory[] = [
  {
    id: "i4c-video-arrest",
    title: "Agencies do not arrest people over video calls",
    text:
      "The Indian Cyber Crime Coordination Centre (I4C) has advised that agencies such as the CBI, " +
      "ED, police, customs and courts do not arrest people or demand money over video calls. " +
      "A call that does is a scam. Do not pay. Report it on the national helpline 1930 or at cybercrime.gov.in.",
    sourceUrl: "https://www.tribuneindia.com/news/india/cbi-ed-dont-nab-via-video-calls-advisory-to-curb-digital-arrest/",
    sourceName: "The Tribune, reporting the I4C advisory",
    verifiedOn: "2026-11-14",
  },
];

export const REPORTING = {
  helpline: "1930",
  portal: "https://cybercrime.gov.in",
} as const;
