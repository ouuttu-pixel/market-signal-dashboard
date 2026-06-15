const DATA_URL = "data/market_data.json";

const stateLabels = {
  LONG: "Risk-on / long bias",
  WAIT: "Odotustila / neutraali",
  SHORT_WARNING: "Varoitus / risk-off"
};

const directionLabels = {
  up: "ylös",
  down: "alas",
  flat: "ennallaan",
  unknown: "ei tiedossa"
};

function formatNumber(value, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("fi-FI", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)} %`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setPill(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = directionLabels[value] || value || "-";
  element.classList.remove("up", "down");
  if (value === "up") element.classList.add("up");
  if (value === "down") element.classList.add("down");
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fi-FI", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function renderReasons(reasons = []) {
  const list = document.getElementById("reasons-list");
  list.innerHTML = "";

  if (!reasons.length) {
    const item = document.createElement("li");
    item.textContent = "Ei perusteluita saatavilla.";
    list.appendChild(item);
    return;
  }

  reasons.forEach((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    list.appendChild(item);
  });
}

function renderQuality(data) {
  const panel = document.getElementById("quality-notes");
  panel.innerHTML = "";

  const notes = [...(data.dataQualityNotes || [])];
  const failed = data.breadth?.failedTickers || [];

  if (failed.length) {
    notes.push(`Epäonnistuneet tickerit: ${failed.join(", ")}`);
  }

  if (!notes.length) {
    panel.innerHTML = "<p>Ei huomioita.</p>";
    return;
  }

  const list = document.createElement("ul");
  notes.forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    list.appendChild(item);
  });
  panel.appendChild(list);
}

function renderError(message) {
  const panel = document.getElementById("error-panel");
  panel.textContent = message;
  panel.classList.remove("hidden");
}

function renderDashboard(data) {
  if (data.error) {
    renderError(data.error);
  }

  const signalState = data.signal?.state || "WAIT";
  const banner = document.getElementById("status-banner");
  banner.className = `signal signal-${signalState.toLowerCase().replace("_", "-")}`;

  setText("signal-state", signalState);
  setText("signal-label", data.signal?.label || stateLabels[signalState] || "-");
  setText("last-updated", formatTimestamp(data.lastUpdated));

  setText("dax-close", formatNumber(data.dax?.close));
  setText("dax-change", formatPercent(data.dax?.changePct));
  setText("dax-sma200", formatNumber(data.dax?.sma200));
  setText("dax-high20", formatNumber(data.dax?.high20));
  setPill("dax-trend", data.dax?.new20DayHigh ? "up" : "flat");

  setText("vix-close", formatNumber(data.vix?.close));
  setText("vix-change", formatPercent(data.vix?.changePct));
  setText("vix-direction-text", directionLabels[data.vix?.direction] || "-");
  setPill("vix-direction", data.vix?.direction);

  setText("breadth-value", `${formatNumber(data.breadth?.value)} %`);
  setText("breadth-previous", `${formatNumber(data.breadth?.previousValue)} %`);
  setText("breadth-success", String(data.breadth?.successfulTickers ?? "-"));
  setPill("breadth-direction", data.breadth?.direction);

  renderReasons(data.signal?.reasons);
  renderQuality(data);
}

fetch(DATA_URL, { cache: "no-store" })
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Dataa ei voitu ladata (${response.status}).`);
    }
    return response.json();
  })
  .then(renderDashboard)
  .catch((error) => {
    renderError(error.message || "Dataa ei voitu ladata.");
  });
