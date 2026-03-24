# KTDoc — Trending Engine: External Data Sources & Access Methods

---

## 1. Google Trends India (RSS Feed)

| Field | Value |
|-------|-------|
| **URL** | `https://trends.google.com/trending/rss?geo=IN` |
| **Protocol** | HTTP GET (RSS/XML) |
| **Auth** | ❌ None required (Public RSS feed) |
| **Format** | XML RSS — keywords extracted from `<item><title>` elements |
| **Rate Limit** | ~20 keywords per fetch (configurable via `GOOGLE_TRENDS_MAX`) |
| **Geo** | India (`geo=IN`) |
| **Language** | Hindi-India (`hi-IN`) — returns Devanagari + English mixed |
---

## 2. Ollama (Local LLM) — Semantic Verification

| Field | Value |
|-------|-------|
| **API Key** | `ollama` (placeholder — no real key needed for local inference) |
| **Model** | `llama3.2` (3.2B parameters, optimized for Apple Silicon) |
| **Base URL** | `http://localhost:11434/v1` |
| **Protocol** | OpenAI-compatible Chat Completions API (`/v1/chat/completions`) |
| **Access Method** | Local HTTP via `httpx.AsyncClient` — POST request with JSON body |
| **Hardware** | Runs on Apple Silicon GPU (Metal) — zero cloud cost |
| **Config Key** | `NVIDIA_API_KEY` in `.env` (legacy name, value is `ollama`) |
| **Enable Flag** | `LLM_RERANK_ENABLED=true` in `.env` (required for intent verification) |
| **Intent floor** | `LLM_INTENT_MIN_SCORE` (optional, default `0.5`) — minimum `relevance_score` to keep an article after LLM gate |

**How it works (Article Explorer / `POST /api/llm/filter`):**

1. **Recall** — loose keyword overlap over the article pool to pick up to ~40 candidates (fast, high recall).
2. **Intent verification** — each candidate is sent to the LLM with a prompt that rejects same-city / partial-word false positives (e.g. “Mumbai Indians” IPL team vs generic Mumbai news). The model must return JSON only:
```
{"same_intent": true|false, "relevance_score": 0.0–1.0, "reason": "..."}
```
Rows with `same_intent: false` or `relevance_score` below `LLM_INTENT_MIN_SCORE` are dropped. There is **no** fallback to loose keyword when the LLM returns no passing rows (empty list is valid).

3. **If `LLM_RERANK_ENABLED` is not `true`** — the API uses **strict multi-word keyword matching** only (full phrase or all significant tokens in title/keywords), not the old partial-word scorer.

**Example request shape:**
```
POST http://localhost:11434/v1/chat/completions
{
  "model": "llama3.2",
  "messages": [
    {"role": "system", "content": "<intent verification prompt>"},
    {"role": "user",   "content": "Trending query: …\nHeadline: …\nArticle keywords: …"}
  ],
  "temperature": 0.1,
  "max_tokens": 200
}
```

---

## 3. Trends24.in (Twitter/X Trends — India)

| Field | Value |
|-------|-------|
| **URL** | `https://trends24.in/india/` |
| **Auth** | ❌ None required (Public web scraping) |
| **Access Method** | HTML scraping via `httpx` + `BeautifulSoup` (lxml parser) |
| **Selectors** | `.trend-card__list li` elements — text content extracted |
| **Rate Limit** | ~20 keywords per fetch (configurable via `TWITTER_TRENDS_MAX`) |
| **Fallback** | `https://getdaytrends.com/india/` (auto-switches on failure) |
| **Polite Delay** | Random 1–3 second sleep before each request |

---

## 4. News Sitemap (RSS Feed — Article Source)

| Field | Value |
|-------|-------|
| **URL** | `https://navbharattimes.indiatimes.com/staticsitemap/nbt/news/sitemap-48hours.xml` |
| **Protocol** | HTTP GET (XML Sitemap) |
| **Auth** | ❌ None required (Public sitemap) |
| **Format** | Standard News Sitemap XML — `<url><loc>`, `<news:title>`, `<news:keywords>` |
| **Window** | Last 48 hours (`ARTICLE_WINDOW_HOURS=48`) |
| **Config Key** | `SITEMAP_URL` in `.env` |

---

## Quick Reference: Environment Variables

```env
# News Source
SITEMAP_URL=https://navbharattimes.indiatimes.com/staticsitemap/nbt/news/sitemap-48hours.xml

# Local LLM (set LLM_RERANK_ENABLED=true for Llama intent verification on Explore)
NVIDIA_API_KEY=ollama
LLM_RERANK_ENABLED=true
LLM_INTENT_MIN_SCORE=0.5

# Scoring
TOP_N=10
```
