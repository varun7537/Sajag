/**
 * Remote Config: update advisories and flip a cloud kill switch without redeploying.
 * Fails open to safe defaults: the app must work if Remote Config is unreachable.
 */
import type { FirebaseApp } from "firebase/app";
import { fetchAndActivate, getRemoteConfig, getString, getBoolean } from "firebase/remote-config";
import type { Advisory } from "../types";

export interface RemoteSettings {
  extraAdvisories: Advisory[];
  cloudEnabled: boolean;
}

const DEFAULTS: RemoteSettings = { extraAdvisories: [], cloudEnabled: true };

export function parseAdvisories(json: string): Advisory[] {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((a): a is Advisory => {
      if (typeof a !== "object" || a === null) return false;
      const o = a as Record<string, unknown>;
      return (
        typeof o["id"] === "string" &&
        typeof o["title"] === "string" &&
        typeof o["text"] === "string" &&
        typeof o["sourceName"] === "string" &&
        typeof o["verifiedOn"] === "string" &&
        typeof o["sourceUrl"] === "string" &&
        /^https:\/\//.test(o["sourceUrl"])
      );
    });
  } catch {
    return [];
  }
}

export async function loadRemoteSettings(app: FirebaseApp): Promise<RemoteSettings> {
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
    rc.defaultConfig = { advisories_json: "[]", cloud_enabled: true };
    await fetchAndActivate(rc);
    return {
      extraAdvisories: parseAdvisories(getString(rc, "advisories_json")),
      cloudEnabled: getBoolean(rc, "cloud_enabled"),
    };
  } catch {
    return DEFAULTS;
  }
}
