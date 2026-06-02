# AlgoFlow — Chrome Extension (Manifest V3)

A Chrome Extension that scrapes competitive programming problems from **LeetCode** and **Codeforces**, caches them locally, and exports them to the AlgoFlow sandbox for execution.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome Tab (LeetCode / Codeforces)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  content/parsers.js                                  │  │
│  │  ├─ LeetCode.Parser  → DOM scraping + fallbacks      │  │
│  │  └─ Codeforces.Parser → sample-test block extraction │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  content/injector.js                                 │  │
│  │  ├─ ScrapeManager    → URL change detection (4 strats)│ │
│  │  ├─ Export Button     → native UI integration        │  │
│  │  ├─ chrome.storage    → local cache (200 entries)     │  │
│  │  └─ Toast notifications                              │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  styles/algoflow-injected.css                        │  │
│  │  Button, toast, dark-mode support                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          ↕ chrome.runtime.sendMessage
┌─────────────────────────────────────────────────────────────┐
│  background/service-worker.js                               │
│  Badge updates, lifecycle, message bridge                    │
└─────────────────────────────────────────────────────────────┘
          ↕ chrome.storage.local
┌─────────────────────────────────────────────────────────────┐
│  popup/  (Dashboard)                                        │
│  index.html + popup.js + popup.css                          │
│  ├─ Current page detection & one-click scrape               │
│  ├─ Search + filter (platform, difficulty)                  │
│  ├─ Problem detail modal (test cases, tags)                 │
│  └─ Export All JSON / Clear All                             │
└─────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest — `activeTab`, `storage`, `scripting` permissions |
| `content/parsers.js` | Site-specific DOM scraping with fallback selectors |
| `content/injector.js` | ScrapeManager: URL detection, button injection, caching |
| `styles/algoflow-injected.css` | Export button + toast styling (dark-mode aware) |
| `background/service-worker.js` | Badge management, install lifecycle, message bridge |
| `popup/index.html` | Dashboard popup shell |
| `popup/popup.js` | Popup controller — list, search, filter, modal, export |
| `popup/popup.css` | Dark-themed popup styles |

## Installation (Developer Mode)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `algoflow-extension/` folder
5. Navigate to any LeetCode or Codeforces problem page

## How It Works

### Scraping Flow

1. Content script loads on matching URLs (`leetcode.com/problems/*`, `codeforces.com/contest/*/problem/*`)
2. `ScrapeManager.init()` detects the platform and waits for DOM readiness
3. An **"Export to AlgoFlow"** button is injected into the page's native UI
4. On click (or auto-scrape), `Parsers.scrape()` extracts:
   - **Title** — multiple selector fallbacks
   - **Difficulty** — attribute / text / colour parsing
   - **Test Cases** — `<pre>` blocks, `Example N:` sections, Input:/Output: regex
   - **Tags** — topic links
5. Data is cached to `chrome.storage.local` with a dedup key
6. Toast notification confirms success

### URL Change Detection (4 Strategies)

| # | Strategy | Why |
|---|----------|-----|
| 1 | `MutationObserver` on `<title>` | Both platforms change the title on SPA nav |
| 2 | `popstate` event | Browser back/forward |
| 3 | Override `pushState`/`replaceState` | Catches router calls |
| 4 | Polling (250ms) | Last resort safety net |

### Output Format

```json
{
  "title": "Two Sum",
  "platform": "leetcode",
  "difficulty": "Easy",
  "testCases": [
    { "in": "nums = [2,7,11,15], target = 9", "out": "[0,1]" },
    { "in": "nums = [3,2,4], target = 6", "out": "[1,2]" }
  ],
  "tags": ["Array", "Hash Table"],
  "url": "https://leetcode.com/problems/two-sum/description/",
  "scrapedAt": "2025-01-15T10:30:00.000Z"
}
```

### Selector Strategy

Each parser uses **cascading selectors** (primary → fallback → regex):

**LeetCode:**
- Title: `[data-cy="question-title"]` → `div.text-title-large a` → `<title>` tag
- Difficulty: `[diff]` attribute → colour-coded classes → text scan
- Test cases: `data-track-load="description_content"` → `.elfjS` → raw text regex

**Codeforces:**
- Title: `.problem-statement .header .title` → `<title>` tag
- Difficulty: Problem index letter (A=Easy, B=Easy-Med, C=Med, D+=Hard)
- Test cases: `.sample-test .input pre` / `.output pre` → `.test-example-line` divs

## Popup Dashboard

- **Current page** — detects active tab, shows platform, one-click scrape
- **Search** — fuzzy title + tag matching
- **Filter chips** — All / LeetCode / Codeforces / Easy / Med / Hard
- **Detail modal** — view test cases, copy to clipboard, send to sandbox
- **Export All** — downloads all cached problems as JSON
- **Clear All** — wipes `chrome.storage.local` cache
