# Trending Engine 🚀

A high-performance, real-time trending topics and article aggregation dashboard designed for editorial teams. It aggregates trends from Google Search and X (formerly Twitter), then semantically matches them against latest news stories using optional LLM intent verification.

## ✨ Key Features

- **🌐 Multi-Source Aggegation**: Real-time trending data from Google Trends (RSS) and Twitter (scraped via Trends24).
- **📝 High-Volume Article Fetching**: Pulls and crawls thousands of articles from regional/national sitemaps.
- **🧠 Semantic Filtering**: Uses keyword-based logic (Recall) followed by optional LLM-based re-ranking (Precision) to match articles to trends.
- **⚡ Performance First**: Local caching and optimized aggregation logic for near-instant dashboard loads.
- **📊 Trend History**: Supports persistent history and velocity tracking via Upstash Redis.
- **🎨 Premium UI**: Modern, glassmorphism-inspired dark mode interface built with Next.js and Tailwind CSS.

## 🛠 Tech Stack

- **Framework**: [Next.js 15 (App Router)](https://nextjs.org/)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Database (Optional)**: [Upstash Redis](https://upstash.com/)
- **LLM Integration**: [Ollama](https://ollama.com/) or any OpenAI-compatible API (e.g., NVIDIA NIM)
- **Scraping**: Cheerio

## 🚀 Getting Started

### 1. Prerequisites

- [Node.js 20+](https://nodejs.org/)
- npm / pnpm / yarn
- (Optional) Upstash Redis account for history tracking.
- (Optional) Ollama running locally for LLM-based article matching.

### 2. Installation

```bash
git clone https://github.com/your-username/trending-engine.git
cd trending-engine
npm install
```

### 3. Environment Setup

Copy the example environment file and fill in your values:

```bash
cp .env.example .env.local
```

### 4. Development

Run the development server:

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the dashboard.

## ⚙️ Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_RERANK_ENABLED` | Enable LLM verification for article-trend matching | `false` |
| `LLM_BASE_URL` | Base URL for the LLM API (Ollama/NVIDIA) | `http://localhost:11434/v1` |
| `GOOGLE_TRENDS_MAX` | Max number of trends to pull from Google | `20` |
| `TWITTER_TRENDS_MAX` | Max number of trends to pull from Twitter | `20` |
| `TOP_N` | Number of trends shown in the final merged list | `10` |

## 🏗 Project Structure

- `/src/app`: Next.js pages and API routes.
- `/src/lib`: Core logic including trend fetchers, scorers, and LLM utilities.
- `/data`: Local scratch storage for transient historical data.

## 📜 License

[MIT](LICENSE)
