from __future__ import annotations

import json
import math
import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "market_data.json"

DAX_TICKER = "^GDAXI"
VIX_TICKER = "^VIX"

DAX_COMPONENTS = [
    "ADS.DE",
    "AIR.DE",
    "ALV.DE",
    "BAS.DE",
    "BAYN.DE",
    "BEI.DE",
    "BMW.DE",
    "BNR.DE",
    "CBK.DE",
    "CON.DE",
    "1COV.DE",
    "DTG.DE",
    "DBK.DE",
    "DB1.DE",
    "DHL.DE",
    "DTE.DE",
    "EOAN.DE",
    "FRE.DE",
    "HNR1.DE",
    "HEI.DE",
    "HEN3.DE",
    "IFX.DE",
    "MBG.DE",
    "MRK.DE",
    "MTX.DE",
    "MUV2.DE",
    "P911.DE",
    "PAH3.DE",
    "QIA.DE",
    "RHM.DE",
    "RWE.DE",
    "SAP.DE",
    "SRT3.DE",
    "SIE.DE",
    "ENR.DE",
    "SHL.DE",
    "SY1.DE",
    "VOW3.DE",
    "VNA.DE",
    "ZAL.DE",
]


def load_previous_data() -> dict[str, Any]:
    if not DATA_PATH.exists():
        return {}
    try:
        return json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_data(data: dict[str, Any]) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def clean_number(value: Any, digits: int = 2) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return round(number, digits)


def fetch_close_series(ticker: str, period: str = "1y") -> pd.Series:
    data = yf.download(ticker, period=period, auto_adjust=False, progress=False, threads=False)
    if data.empty or "Close" not in data:
        raise ValueError(f"No close data returned for {ticker}")
    close = data["Close"].dropna()
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    if len(close) < 2:
        raise ValueError(f"Not enough close data returned for {ticker}")
    return close


def pct_change(latest: float, previous: float) -> float:
    return ((latest - previous) / previous) * 100


def direction(latest: float | None, previous: float | None) -> str:
    if latest is None or previous is None:
        return "unknown"
    if latest > previous:
        return "up"
    if latest < previous:
        return "down"
    return "flat"


def calculate_breadth() -> dict[str, Any]:
    above_today = 0
    above_previous = 0
    successful = 0
    failed: list[str] = []

    for ticker in DAX_COMPONENTS:
        try:
            close = fetch_close_series(ticker, period="3mo")
            if len(close) < 21:
                raise ValueError("Need at least 21 trading days for breadth calculation")

            sma20 = close.rolling(20).mean()
            latest_close = float(close.iloc[-1])
            previous_close = float(close.iloc[-2])
            latest_sma = float(sma20.iloc[-1])
            previous_sma = float(sma20.iloc[-2])

            above_today += int(latest_close > latest_sma)
            above_previous += int(previous_close > previous_sma)
            successful += 1
        except Exception:
            failed.append(ticker)

    if successful == 0:
        raise ValueError("No DAX component breadth data could be calculated")

    value = (above_today / successful) * 100
    previous_value = (above_previous / successful) * 100

    return {
        "value": clean_number(value),
        "previousValue": clean_number(previous_value),
        "direction": direction(value, previous_value),
        "successfulTickers": successful,
        "failedTickers": failed,
    }


def vix_higher_low(close: pd.Series, lookback: int = 5) -> bool:
    recent = close.tail(lookback + 1)
    if len(recent) < lookback + 1:
        return False
    lows = recent.rolling(2).min().dropna()
    if len(lows) < 2:
        return False
    return float(lows.iloc[-1]) > float(lows.iloc[-2])


SIGNAL_METADATA = {
    "STRONG_LONG": {
        "label": "Erittäin vahva risk-on",
        "meaning": "Nousu saa erittäin vahvaa tukea",
    },
    "LONG": {
        "label": "Risk-on / long bias",
        "meaning": "Nousu saa vahvaa tukea",
    },
    "WAIT": {
        "label": "Odota / neutraali",
        "meaning": "Ei selvää etua",
    },
    "CAUTION": {
        "label": "Ensimmäiset varoitusmerkit",
        "meaning": "Nousun laatu alkaa heiketä",
    },
    "SHORT_WARNING": {
        "label": "Korjausriski koholla",
        "meaning": "Korjausliikkeen riski on koholla",
    },
}


def metadata_for_state(state: str) -> dict[str, str]:
    return SIGNAL_METADATA[state]


def calculate_signal(dax: dict[str, Any], vix: dict[str, Any], breadth: dict[str, Any], stronger_warning: bool) -> dict[str, Any]:
    dax_above_sma200 = bool(dax["aboveSma200"])
    dax_up = dax["direction"] == "up"
    dax_down = dax["direction"] == "down"
    vix_up = vix["direction"] == "up"
    vix_down = vix["direction"] == "down"
    breadth_up = breadth["direction"] == "up"
    breadth_down = breadth["direction"] == "down"
    breadth_value = breadth["value"]
    breadth_strong = breadth_value is not None and breadth_value >= 60
    breadth_healthy = breadth_value is not None and breadth_value >= 55
    dax_new_20_day_high = bool(dax["new20DayHigh"])

    if vix_up and breadth_down and (dax_new_20_day_high or (dax_above_sma200 and dax_up)):
        state = "SHORT_WARNING"
        reasons = [
            "VIX nousee",
            "Markkinaleveys heikkenee",
            "DAX on edelleen korkealla / nousutrendissä",
        ]
        if dax_new_20_day_high:
            reasons.append("DAX tekee uuden 20 päivän huipun")
        if stronger_warning:
            reasons.append("VIX on tehnyt korkeamman pohjan viimeisen 5 kaupankäyntipäivän aikana")
    elif dax_up and vix_up:
        state = "CAUTION"
        reasons = ["DAX nousee, mutta VIX nousee mukana"]
    elif dax_up and breadth_down:
        state = "CAUTION"
        reasons = ["DAX nousee, mutta markkinaleveys heikkenee"]
    elif dax_above_sma200 and vix_up and not breadth_up:
        state = "CAUTION"
        reasons = ["Nousu jatkuu, mutta riskimittarit eivät enää tue sitä yhtä vahvasti"]
    elif dax_above_sma200 and dax_up and vix_down and breadth_up and breadth_strong:
        state = "STRONG_LONG"
        reasons = [
            "DAX on 200 päivän SMA:n yläpuolella",
            "DAX sulkeutui edellistä päivää ylemmäs",
            "VIX laskee",
            "Markkinaleveys paranee",
            "Markkinaleveys on vahva, vähintään 60 %",
        ]
    elif dax_above_sma200 and dax_up and vix_down and breadth_healthy and not breadth_down:
        state = "LONG"
        reasons = [
            "DAX on 200 päivän SMA:n yläpuolella",
            "DAX sulkeutui edellistä päivää ylemmäs",
            "VIX laskee",
            "Markkinaleveys on vähintään 55 %",
            "Markkinaleveys ei heikkene",
        ]
    else:
        state = "WAIT"
        reasons = [
            "Signaalit ovat ristiriitaisia tai neutraaleja",
            "Selvää etua long- tai short-puolelle ei ole",
        ]

    metadata = metadata_for_state(state)
    return {
        "state": state,
        "label": metadata["label"],
        "meaning": metadata["meaning"],
        "reasons": reasons,
    }


def build_error_data(message: str, previous: dict[str, Any]) -> dict[str, Any]:
    return {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "error": message,
        "dax": previous.get("dax", {}),
        "vix": previous.get("vix", {}),
        "breadth": previous.get("breadth", {}),
        "signal": previous.get(
            "signal",
            {
                "state": "WAIT",
                "label": metadata_for_state("WAIT")["label"],
                "meaning": metadata_for_state("WAIT")["meaning"],
                "reasons": ["Datan haku epäonnistui."],
            },
        ),
        "dataQualityNotes": [message],
    }


def build_market_data() -> dict[str, Any]:
    dax_close = fetch_close_series(DAX_TICKER, period="1y")
    vix_close = fetch_close_series(VIX_TICKER, period="3mo")

    if len(dax_close) < 200:
        raise ValueError("DAX data does not include enough history for 200-day SMA")

    dax_latest = float(dax_close.iloc[-1])
    dax_previous = float(dax_close.iloc[-2])
    dax_sma200 = float(dax_close.rolling(200).mean().iloc[-1])
    dax_high20 = float(dax_close.tail(20).max())

    vix_latest = float(vix_close.iloc[-1])
    vix_previous = float(vix_close.iloc[-2])

    dax = {
        "close": clean_number(dax_latest),
        "changePct": clean_number(pct_change(dax_latest, dax_previous)),
        "sma200": clean_number(dax_sma200),
        "high20": clean_number(dax_high20),
        "aboveSma200": dax_latest > dax_sma200,
        "new20DayHigh": dax_latest >= dax_high20,
        "direction": direction(dax_latest, dax_previous),
    }

    vix = {
        "close": clean_number(vix_latest),
        "changePct": clean_number(pct_change(vix_latest, vix_previous)),
        "direction": direction(vix_latest, vix_previous),
    }

    breadth = calculate_breadth()
    signal = calculate_signal(dax, vix, breadth, vix_higher_low(vix_close))

    notes = []
    if breadth["failedTickers"]:
        notes.append(f"{len(breadth['failedTickers'])} DAX-komponentin data epäonnistui.")

    return {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "dax": dax,
        "vix": vix,
        "breadth": breadth,
        "signal": signal,
        "dataQualityNotes": notes,
    }


def send_email_if_changed(previous: dict[str, Any], current: dict[str, Any]) -> None:
    previous_state = previous.get("signal", {}).get("state")
    current_state = current.get("signal", {}).get("state")
    if not previous_state or previous_state == current_state:
        return

    required = [
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASSWORD",
        "ALERT_EMAIL_TO",
        "ALERT_EMAIL_FROM",
    ]
    config = {key: os.getenv(key) for key in required}
    if any(not value for value in config.values()):
        return

    message = EmailMessage()
    message["Subject"] = f"Market signal changed: {current_state}"
    message["From"] = config["ALERT_EMAIL_FROM"]
    message["To"] = config["ALERT_EMAIL_TO"]
    message.set_content(
        "\n".join(
            [
                f"Signal: {current_state}",
                f"Label: {current['signal']['label']}",
                f"Meaning: {current['signal'].get('meaning', '')}",
                "",
                f"DAX close: {current['dax']['close']} ({current['dax']['changePct']}%)",
                f"VIX close: {current['vix']['close']} ({current['vix']['changePct']}%)",
                f"Breadth: {current['breadth']['value']}%",
                "",
                "Reasons:",
                *[f"- {reason}" for reason in current["signal"]["reasons"]],
            ]
        )
    )

    port = int(config["SMTP_PORT"])
    with smtplib.SMTP(config["SMTP_HOST"], port, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(config["SMTP_USER"], config["SMTP_PASSWORD"])
        smtp.send_message(message)


def main() -> None:
    previous = load_previous_data()
    try:
        current = build_market_data()
    except Exception as exc:
        current = build_error_data(f"Yahoo Finance data update failed: {exc}", previous)

    write_data(current)

    try:
        send_email_if_changed(previous, current)
    except Exception as exc:
        current.setdefault("dataQualityNotes", []).append(f"Email alert failed: {exc}")
        write_data(current)


if __name__ == "__main__":
    main()
