import "./styles.css";
import type { AiServices, OnDeviceState } from "./ai/contracts";
import { createFirebaseServices } from "./ai/firebaseServices";
import {
  analyzeLocal,
  buildVerdict,
  EgressBlockedError,
  explainSimply,
  LocalModelRequiredError,
  previewCloud,
  remask,
  verifyInCloud,
  type CloudPreview,
  type LocalAnalysis,
} from "./ai/pipeline";
import { isFirebaseConfigured } from "./config";
import { initFirebase } from "./firebase";
import { loadRemoteSettings, type RemoteSettings } from "./remote/remoteConfig";
import { BUILT_IN_ADVISORIES } from "./rules/advisories";
import { addHistory, clearHistory, loadHistory } from "./storage/history";
import type { Verdict } from "./types";
import { $, clear, h } from "./ui/dom";
import { STRINGS, type UiLang } from "./ui/i18n";
import { ImageRejectedError, prepareImage, type PreparedImage } from "./ui/image";
import { levelLabel, renderVerdict } from "./ui/views";

/** Used when Firebase is not configured: built-in rules only, nothing leaves the device. */
const offlineServices: AiServices = {
  onDeviceState: async () => "no_api",
  prepareOnDevice: async () => {},
  extractLocal: async () => {
    throw new Error("On-device model unavailable without Firebase config.");
  },
  verifyCloud: async () => {
    throw new Error("Cloud check unavailable without Firebase config.");
  },
  explain: async () => {
    throw new Error("Cloud unavailable without Firebase config.");
  },
};

interface State {
  lang: UiLang;
  svc: AiServices;
  firebaseOn: boolean;
  remote: RemoteSettings;
  onDevice: OnDeviceState;
  image: PreparedImage | null;
  analysis: LocalAnalysis | null;
  verdict: Verdict | null;
  preview: CloudPreview | null;
  includeText: boolean;
  explainText: string | null;
  busy: boolean;
}

const state: State = {
  lang: "en",
  svc: offlineServices,
  firebaseOn: false,
  remote: { extraAdvisories: [], cloudEnabled: true },
  onDevice: "no_api",
  image: null,
  analysis: null,
  verdict: null,
  preview: null,
  includeText: true,
  explainText: null,
  busy: false,
};

const t = () => STRINGS[state.lang];

// ---------- static texts ----------
function applyStaticText(): void {
  const s = t();
  document.documentElement.lang = state.lang;
  $("#tagline").textContent = s.tagline;
  $("#input-title").textContent = s.inputTitle;
  ($("#msg") as HTMLTextAreaElement).placeholder = s.inputPlaceholder;
  $("#drop-hint").textContent = s.dropHint;
  $("#thumb-remove").textContent = s.removeImage;
  $("#hide-label").textContent = s.hideWords;
  $("#allow-cloud-label").textContent = s.allowCloud;
  $("#check-btn").textContent = state.busy ? s.checking : s.check;
  ($("#check-btn") as HTMLButtonElement).disabled = state.busy;
  $("#history-title").textContent = s.history;
  $("#history-clear").textContent = s.clearHistory;
  $("#footer").textContent = s.footer;
  $("#lang-btn").textContent = s.language;
  if (!state.firebaseOn) $("#notice").textContent = s.firebaseOff;
  renderModelStatus();
}

function renderModelStatus(): void {
  const s = t();
  const label = {
    available: s.modelReady,
    downloadable: s.modelDownloadable,
    downloading: s.modelDownloading,
    unavailable: s.modelUnavailable,
    no_api: s.modelNoApi,
  }[state.onDevice];
  const el = $("#model-status");
  el.textContent = label;
  el.className = `status status-${state.onDevice}`;
  const btn = $("#model-btn") as HTMLButtonElement;
  btn.hidden = !(state.onDevice === "downloadable" && state.firebaseOn);
  btn.textContent = s.enableModel;
}

async function refreshModelState(): Promise<void> {
  state.onDevice = await state.svc.onDeviceState();
  renderModelStatus();
}

function showError(msg: string | null): void {
  const el = $("#error");
  el.hidden = !msg;
  el.textContent = msg ?? "";
}

// ---------- rendering ----------
function currentVerdict(): Verdict | null {
  return state.verdict;
}

function renderAll(): void {
  renderReview();
  renderVerdictArea();
  renderHistory();
}

function renderVerdictArea(): void {
  const host = $("#verdict");
  clear(host);
  const v = currentVerdict();
  if (!v) return;
  const canEn = state.onDevice === "available" || state.remote.cloudEnabled;
  host.append(
    renderVerdict(v, t(), {
      onExplain: (lang) => void onExplain(lang),
      explainBusy: state.busy,
      explainText: state.explainText,
      canExplainEn: canEn,
      canExplainHi: state.remote.cloudEnabled && state.firebaseOn,
    }),
  );
}

function renderReview(): void {
  const host = $("#review");
  clear(host);
  const a = state.analysis;
  host.hidden = !a;
  if (!a) return;
  const s = t();
  const cloudAllowed = ($("#allow-cloud") as HTMLInputElement).checked;

  const textarea = h("textarea", { id: "masked", rows: 6, spellcheck: false, "aria-label": s.maskedText });
  textarea.value = a.maskedText;

  host.append(
    h("h2", {}, s.reviewTitle),
    h("p", { class: "muted" }, s.reviewHelp),
    h("label", { class: "field" }, h("span", {}, s.maskedText), textarea),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          class: "btn ghost",
          type: "button",
          onClick: () => {
            if (!state.analysis) return;
            const extra = parseExtra();
            state.analysis = remask(state.analysis, textarea.value, extra);
            state.verdict = buildVerdict(state.analysis, null, allAdvisories());
            state.preview = null;
            state.explainText = null;
            renderAll();
          },
        },
        s.recheck,
      ),
    ),
  );

  if (state.firebaseOn && state.remote.cloudEnabled && cloudAllowed) {
    const forced = a.needsMaskedTextForCloud;
    if (forced) state.includeText = true;
    const includeBox = h("input", {
      type: "checkbox",
      id: "include-text",
      checked: state.includeText,
      disabled: forced,
      onChange: (e: Event) => {
        state.includeText = (e.target as HTMLInputElement).checked;
        state.preview = null;
        renderReview();
      },
    });
    host.append(h("label", { class: "check" }, includeBox, h("span", {}, s.includeText)));

    host.append(
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onClick: () => {
              if (!state.analysis) return;
              state.analysis = remask(state.analysis, textarea.value, parseExtra());
              try {
                state.preview = previewCloud(state.analysis, { includeMaskedText: state.includeText, language: state.lang });
                showError(null);
              } catch (e) {
                state.preview = null;
                showError(e instanceof EgressBlockedError ? `${s.blocked}: ${e.message}` : String(e));
              }
              state.verdict = buildVerdict(state.analysis, null, allAdvisories());
              renderAll();
            },
          },
          s.previewCloud,
        ),
      ),
    );

    if (state.preview) {
      const pv = state.preview;
      host.append(
        h("p", { class: "muted" }, s.willSend),
        h("pre", { class: "payload", tabindex: 0 }, pv.prompt),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn primary", type: "button", disabled: state.busy, onClick: () => void onSend(pv) }, state.busy ? s.verifying : s.sendCloud),
          h("button", { class: "btn ghost", type: "button", onClick: () => { state.preview = null; renderReview(); } }, s.cancel),
        ),
      );
    }
  } else if (!state.remote.cloudEnabled) {
    host.append(h("p", { class: "muted" }, s.cloudOff));
  } else if (state.firebaseOn && !cloudAllowed) {
    host.append(h("p", { class: "muted" }, s.cloudNeedsConsent));
  }
}

function renderHistory(): void {
  const host = $("#history");
  clear(host);
  const items = loadHistory();
  if (items.length === 0) {
    host.append(h("li", { class: "muted" }, t().noHistory));
    return;
  }
  for (const e of items) {
    host.append(
      h(
        "li",
        {},
        h("span", { class: `dot level-${e.level}`, "aria-hidden": "true" }),
        h("strong", {}, levelLabel(e.level, t())),
        h("span", { class: "muted" }, ` · ${new Date(e.at).toLocaleString()}${e.cloudUsed ? " · cloud, masked" : ""}`),
        h("div", { class: "excerpt" }, e.excerpt),
      ),
    );
  }
}

// ---------- actions ----------
const allAdvisories = () => [...BUILT_IN_ADVISORIES, ...state.remote.extraAdvisories];

function parseExtra(): string[] {
  return ($("#hide") as HTMLInputElement).value
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

function setBusy(b: boolean): void {
  state.busy = b;
  applyStaticText();
}

async function onCheck(): Promise<void> {
  const s = t();
  showError(null);
  const text = ($("#msg") as HTMLTextAreaElement).value;
  if (!text.trim() && !state.image) return;
  setBusy(true);
  state.verdict = null;
  state.preview = null;
  state.explainText = null;
  try {
    await refreshModelState();
    const a = await analyzeLocal(
      {
        text,
        extraMaskTerms: parseExtra(),
        allowCloud: ($("#allow-cloud") as HTMLInputElement).checked,
        ...(state.image ? { image: { mimeType: state.image.mimeType, base64: state.image.base64 } } : {}),
      },
      state.svc,
    );
    state.analysis = a;
    state.verdict = buildVerdict(a, null, allAdvisories());
    addHistory({ at: new Date().toISOString(), level: state.verdict.level, excerpt: a.maskedText.slice(0, 140), cloudUsed: false });
  } catch (e) {
    state.analysis = null;
    showError(e instanceof LocalModelRequiredError ? s.needModel : `${s.errorGeneric}: ${(e as Error).message}`);
  } finally {
    setBusy(false);
    renderAll();
  }
}

async function onSend(pv: CloudPreview): Promise<void> {
  if (!state.analysis) return;
  setBusy(true);
  showError(null);
  renderReview();
  try {
    const out = await verifyInCloud(pv, state.svc);
    state.verdict = buildVerdict(state.analysis, out, allAdvisories());
    state.preview = null;
    addHistory({ at: new Date().toISOString(), level: state.verdict.level, excerpt: state.analysis.maskedText.slice(0, 140), cloudUsed: true });
  } catch (e) {
    showError(`${t().errorGeneric}: ${(e as Error).message}`);
  } finally {
    setBusy(false);
    renderAll();
  }
}

async function onExplain(lang: "en" | "hi"): Promise<void> {
  if (!state.analysis || !state.verdict) return;
  setBusy(true);
  showError(null);
  try {
    const out = await explainSimply(state.analysis, lang, ($("#allow-cloud") as HTMLInputElement).checked, state.svc);
    if (!out) {
      showError(t().cloudNeedsConsent);
    } else {
      state.explainText = out.text;
      state.verdict = {
        ...state.verdict,
        traces: [...state.verdict.traces, out.trace],
        receipts: out.receipt ? [...state.verdict.receipts, out.receipt] : state.verdict.receipts,
      };
    }
  } catch (e) {
    showError(e instanceof EgressBlockedError ? `${t().blocked}: ${e.message}` : `${t().errorGeneric}: ${(e as Error).message}`);
  } finally {
    setBusy(false);
    renderAll();
  }
}

async function onEnableModel(): Promise<void> {
  const btn = $("#model-btn") as HTMLButtonElement;
  btn.disabled = true;
  state.onDevice = "downloading";
  renderModelStatus();
  try {
    await state.svc.prepareOnDevice((f) => {
      $("#model-status").textContent = `${t().modelDownloading} ${Math.round(f * 100)}%`;
    });
  } catch (e) {
    showError(`${t().errorGeneric}: ${(e as Error).message}`);
  } finally {
    btn.disabled = false;
    await refreshModelState();
  }
}

async function onFile(file: File | undefined): Promise<void> {
  if (!file) return;
  try {
    state.image = await prepareImage(file);
    ($("#thumb-img") as HTMLImageElement).src = state.image.previewUrl;
    $("#thumb").hidden = false;
    showError(null);
  } catch (e) {
    state.image = null;
    $("#thumb").hidden = true;
    showError(e instanceof ImageRejectedError ? t().imageBad : `${t().errorGeneric}: ${(e as Error).message}`);
  }
}

function wireEvents(): void {
  $("#check-btn").addEventListener("click", () => void onCheck());
  $("#model-btn").addEventListener("click", () => void onEnableModel());
  $("#lang-btn").addEventListener("click", () => {
    state.lang = state.lang === "en" ? "hi" : "en";
    applyStaticText();
    renderAll();
  });
  $("#history-clear").addEventListener("click", () => {
    clearHistory();
    renderHistory();
  });
  $("#allow-cloud").addEventListener("change", () => renderReview());

  const drop = $("#drop");
  const fileInput = $("#file") as HTMLInputElement;
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => void onFile(fileInput.files?.[0]));
  for (const ev of ["dragenter", "dragover"]) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
  }
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    void onFile((e as DragEvent).dataTransfer?.files?.[0]);
  });
  document.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) void onFile(f);
  });
  $("#thumb-remove").addEventListener("click", () => {
    state.image = null;
    $("#thumb").hidden = true;
    fileInput.value = "";
  });
}

async function boot(): Promise<void> {
  wireEvents();
  if (isFirebaseConfigured()) {
    try {
      const { app, ai } = initFirebase();
      state.svc = createFirebaseServices(ai);
      state.firebaseOn = true;
      void loadRemoteSettings(app).then((r) => {
        state.remote = r;
        renderAll();
      });
    } catch (e) {
      console.error("Firebase init failed", e);
    }
  }
  if (!state.firebaseOn) {
    const n = $("#notice");
    n.hidden = false;
    n.textContent = t().firebaseOff;
  }
  await refreshModelState();
  applyStaticText();
  renderAll();
}

void boot();
