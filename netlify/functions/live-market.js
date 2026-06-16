const INDICES = {
  dax: "^GDAXI",
  vix: "^VIX"
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function cleanNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(2));
}

async function fetchYahooIndex(symbol) {
  const encodedSymbol = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1m&range=1d`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "market-signal-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status} for ${symbol}`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;

  if (!meta || typeof meta.regularMarketPrice !== "number") {
    throw new Error(`Yahoo Finance response did not include price for ${symbol}`);
  }

  const price = meta.regularMarketPrice;
  const previousClose = meta.previousClose;
  const change =
    typeof previousClose === "number" && previousClose !== 0 ? price - previousClose : null;
  const changePct = change === null ? null : (change / previousClose) * 100;

  return {
    symbol,
    price: cleanNumber(price),
    previousClose: cleanNumber(previousClose),
    change: cleanNumber(change),
    changePct: cleanNumber(changePct),
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
  };
}

exports.handler = async function handler() {
  const entries = await Promise.allSettled(
    Object.entries(INDICES).map(async ([key, symbol]) => [key, await fetchYahooIndex(symbol)])
  );

  const payload = {
    lastUpdated: new Date().toISOString(),
    dax: null,
    vix: null,
    errors: []
  };

  entries.forEach((entry) => {
    if (entry.status === "fulfilled") {
      const [key, value] = entry.value;
      payload[key] = value;
    } else {
      payload.errors.push(entry.reason?.message || "Unknown live market data error");
    }
  });

  if (!payload.dax && !payload.vix) {
    return jsonResponse(502, {
      ...payload,
      error: "Live market data unavailable"
    });
  }

  return jsonResponse(200, payload);
};
