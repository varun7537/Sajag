import type { EgressReceipt, RiskLevel, Route, StepTrace, Verdict } from "../types";
import { h } from "./dom";
import type { Strings } from "./i18n";

export function levelLabel(level: RiskLevel, t: Strings): string {
  return { high: t.levelHigh, medium: t.levelMedium, low: t.levelLow, unclear: t.levelUnclear }[level];
}

export function routeLabel(route: Route, t: Strings): string {
  return { on_device: t.routeOnDevice, cloud: t.routeCloud, rules_only: t.routeRules }[route];
}

const LEVEL_GLYPH: Record<RiskLevel, string> = { high: "!", medium: "?", low: "i", unclear: "–" };

export function routeBadge(route: Route, t: Strings): HTMLElement {
  return h("span", { class: `route route-${route}` }, routeLabel(route, t));
}

function traceList(traces: StepTrace[], t: Strings): HTMLElement {
  const names: Record<StepTrace["step"], string> = {
    extract: "Read message",
    mask: "Hide identifiers",
    rules: "Rule check",
    verify: "Verify claims",
    explain: "Explain",
  };
  return h(
    "ol",
    { class: "trace" },
    ...traces.map((tr) =>
      h(
        "li",
        {},
        h("span", { class: "trace-step" }, names[tr.step]),
        routeBadge(tr.route, t),
        h("span", { class: "muted" }, `${tr.ms} ms${tr.note ? ` · ${tr.note}` : ""}`),
      ),
    ),
  );
}

function receiptView(r: EgressReceipt): HTMLElement {
  const counts = Object.entries(r.maskedCounts)
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");
  return h(
    "details",
    { class: "receipt" },
    h("summary", {}, `${new Date(r.at).toLocaleTimeString()} · ${r.destination} · ${r.bytes} bytes`),
    h("p", { class: "muted" }, `Hidden before sending: ${counts || "nothing needed hiding"}. Screenshot sent: no.`),
    h("pre", { class: "payload", tabindex: 0 }, r.payload),
  );
}

export interface VerdictHandlers {
  onExplain: (lang: "en" | "hi") => void;
  explainBusy: boolean;
  explainText: string | null;
  canExplainEn: boolean;
  canExplainHi: boolean;
}

export function renderVerdict(v: Verdict, t: Strings, hd: VerdictHandlers): HTMLElement {
  const root = h("section", { class: `card verdict level-${v.level}`, "aria-live": "polite" });

  root.append(
    h(
      "div",
      { class: "verdict-head" },
      h("span", { class: "glyph", "aria-hidden": "true" }, LEVEL_GLYPH[v.level]),
      h("div", {}, h("h2", {}, levelLabel(v.level, t)), v.level === "low" ? h("p", { class: "muted" }, t.levelLowNote) : null),
    ),
  );

  if (v.reasons.length > 0) {
    root.append(
      h("h3", {}, t.why),
      h("ul", { class: "reasons" }, ...v.reasons.map((r) => h("li", {}, h("strong", {}, r.label), h("span", {}, ` ${r.why}`)))),
    );
  }

  root.append(h("p", { class: "explanation" }, v.explanation));

  if (hd.explainText) root.append(h("blockquote", { class: "simple" }, hd.explainText));

  const explainRow = h("div", { class: "row" });
  if (hd.canExplainEn) explainRow.append(h("button", { class: "btn ghost", type: "button", disabled: hd.explainBusy, onClick: () => hd.onExplain("en") }, t.explainEn));
  if (hd.canExplainHi) explainRow.append(h("button", { class: "btn ghost", type: "button", disabled: hd.explainBusy, onClick: () => hd.onExplain("hi") }, t.explainHi));
  if (explainRow.childElementCount > 0) root.append(explainRow);

  if (v.advisories.length > 0) {
    root.append(
      h("h3", {}, t.officialGuidance),
      ...v.advisories.map((a) =>
        h(
          "div",
          { class: "advisory" },
          h("strong", {}, a.title),
          h("p", {}, a.text),
          h("a", { href: a.sourceUrl, target: "_blank", rel: "noopener noreferrer" }, a.sourceName),
          h("span", { class: "muted" }, ` · read ${a.verifiedOn}`),
        ),
      ),
    );
  }

  if (v.citations.length > 0) {
    root.append(
      h("h3", {}, t.webSources),
      h(
        "ul",
        { class: "citations" },
        ...v.citations.map((c) =>
          h(
            "li",
            {},
            h("a", { href: c.uri, target: "_blank", rel: "noopener noreferrer" }, c.title),
            c.official ? h("span", { class: "chip official" }, t.official) : null,
          ),
        ),
      ),
    );
  }

  root.append(h("h3", {}, t.whatToDo), h("ul", { class: "steps" }, ...v.nextSteps.map((s) => h("li", {}, s))));

  root.append(h("h3", {}, t.howChecked), traceList(v.traces, t));

  root.append(
    h("h3", {}, t.receipts),
    v.receipts.length === 0 ? h("p", { class: "muted" }, t.noReceipts) : h("div", {}, ...v.receipts.map(receiptView)),
  );

  if (v.caveats.length > 0) {
    root.append(h("h3", {}, t.caveats), h("ul", { class: "caveats" }, ...v.caveats.map((c) => h("li", {}, c))));
  }
  return root;
}

export { receiptView };
