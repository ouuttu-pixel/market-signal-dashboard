const DATA_URL = "data/market_data.json";

const stateLabels = {
  STRONG_LONG: "Erittäin vahva risk-on",
  LONG: "Risk-on / long bias",
  WAIT: "Odota / neutraali",
  CAUTION: "Ensimmäiset varoitusmerkit",
  SHORT_WARNING: "Korjausriski koholla"
};

const stateMeanings = {
  STRONG_LONG: "Nousu saa erittäin vahvaa tukea",
  LONG: "Nousu saa vahvaa tukea",
  WAIT: "Ei selvää etua",
  CAUTION: "Nousun laatu alkaa heiketä",
  SHORT_WARNING: "Korjausliikkeen riski on koholla"
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

function directionFromChange(changePct) {
  if (typeof changePct !== "number" || Number.isNaN(changePct)) return "unknown";
  if (changePct > 0) return "up";
  if (changePct < 0) return "down";
  return "flat";
}

function directionFromValues(latest, previous) {
  if (typeof latest !== "number" || typeof previous !== "number") return "unknown";
  if (latest > previous) return "up";
  if (latest < previous) return "down";
  return "flat";
}

function metricDirection(metric, previousKey = null) {
  if (metric?.direction) return metric.direction;
  if (typeof metric?.changePct === "number") return directionFromChange(metric.changePct);
  if (previousKey && typeof metric?.value === "number" && typeof metric?.[previousKey] === "number") {
    return directionFromValues(metric.value, metric[previousKey]);
  }
  return "unknown";
}

function daxDirection(dax) {
  const explicitDirection = dax?.direction;
  const changeDirection = directionFromChange(dax?.changePct);
  if (explicitDirection === "up" || changeDirection === "up") return "up";
  if (explicitDirection === "down" || changeDirection === "down") return "down";
  if (explicitDirection === "flat" || changeDirection === "flat") return "flat";
  return "unknown";
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
  banner.className = `signal signal-${signalState.toLowerCase().replaceAll("_", "-")}`;

  setText("signal-state", signalState);
  setText("signal-label", data.signal?.label || stateLabels[signalState] || "-");
  setText("signal-meaning", data.signal?.meaning || stateMeanings[signalState] || "");
  setText("last-updated", formatTimestamp(data.lastUpdated));

  setText("dax-close", formatNumber(data.dax?.close));
  setText("dax-change", formatPercent(data.dax?.changePct));
  setText("dax-sma200", formatNumber(data.dax?.sma200));
  setText("dax-high20", formatNumber(data.dax?.high20));
  setPill("dax-trend", daxDirection(data.dax));

  setText("vix-close", formatNumber(data.vix?.close));
  setText("vix-change", formatPercent(data.vix?.changePct));
  const vixDirection = metricDirection(data.vix);
  setText("vix-direction-text", directionLabels[vixDirection] || "-");
  setPill("vix-direction", vixDirection);

  setText("breadth-value", `${formatNumber(data.breadth?.value)} %`);
  setText("breadth-previous", `${formatNumber(data.breadth?.previousValue)} %`);
  setText("breadth-success", String(data.breadth?.successfulTickers ?? "-"));
  setPill("breadth-direction", metricDirection(data.breadth, "previousValue"));

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
