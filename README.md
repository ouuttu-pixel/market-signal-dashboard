# Market Signal Dashboard

Standalone static dashboard for daily DAX, VIX and DAX breadth market signals.

## What it does

- Fetches data from Yahoo Finance with `yfinance`.
- Writes the latest snapshot to `data/market_data.json`.
- Shows a Finnish static dashboard from `index.html`.
- Calculates breadth as the percentage of selected DAX component stocks trading above their 20-day SMA.
- Sends an optional email alert when the signal state changes.

## Signals

`LONG` requires:

- DAX close above its 200-day SMA
- DAX close above previous day close
- VIX close below previous day close
- Breadth at least 55%
- Breadth flat or improving versus previous day

`SHORT_WARNING` requires:

- DAX makes a new 20-day high
- VIX closes above previous day close
- Breadth weakens versus previous day

`WAIT` is used when neither full setup is present.

## Local use

Install dependencies:

```bash
pip install -r requirements.txt
```

Generate data:

```bash
python scripts/update_market_data.py
```

Open `index.html` in a browser, or serve the folder with any static file server.

## Netlify deployment

1. Create a new GitHub repository for this project.
2. Push these files to the repository root.
3. In Netlify, choose **Add new site** and connect the repository.
4. Use these build settings:
   - Build command: leave empty
   - Publish directory: `.`
5. Deploy the site.

The frontend reads `data/market_data.json`, which GitHub Actions updates once per weekday.

## GitHub Actions setup

The workflow in `.github/workflows/update-market-data.yml` runs at `16:30 UTC` on weekdays, which equals `19:30` in Finland during summer time. GitHub Actions cron uses UTC, so adjust the cron time if you want exact winter-time scheduling.

You can also run the workflow manually from the repository's **Actions** tab with `workflow_dispatch`.

The workflow:

1. Installs Python.
2. Installs `requirements.txt`.
3. Runs `scripts/update_market_data.py`.
4. Commits the updated `data/market_data.json` back to the repository.

## Optional email alerts

Add these GitHub repository secrets if you want email alerts:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `ALERT_EMAIL_TO`
- `ALERT_EMAIL_FROM`

No credentials are hardcoded. If any email secret is missing, the script skips email silently and still updates the JSON file.

## Data quality

If individual DAX component tickers fail, they are skipped and listed under `breadth.failedTickers`.

If Yahoo Finance data fails more broadly, the script writes a clear `error` and `dataQualityNotes` entry to `data/market_data.json` instead of crashing the workflow.
