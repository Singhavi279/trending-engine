/**
 * Scoring & Ranking Engine
 * 
 * Scores deduplicated trends based on:
 * - Multi-source presence (Google + Twitter boost)
 * - Article coverage detection
 * - Recency signals
 * 
 * Also detects whether a trend is "covered" by published articles.
 */

import { UniqueTrend } from './dedup';
import { areSimilar } from './dedup';
import { normalizeForComparison, containsHindi, transliterate, findCommonMapping } from './hindi-utils';
import {
  significantTokens,
  strictMultiWordTextMatch,
} from './article-match';

export interface Article {
  url: string;
  title: string;
  keywords: string[];
  publishedAt: string;
}

export interface CoverageResult {
  isCovered: boolean;
  matchedArticles: { title: string; url: string }[];
}

/** Avoid matching `india` inside `indianapolis` or spurious substring hits */
function appearsAsWordOrPhrase(text: string, needle: string): boolean {
  if (!needle || needle.length < 2) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\s,.;:/])${escaped}(?:$|[\\s,.;:/])`);
  return re.test(text);
}

export interface RankedTrend {
  rank: number;
  keyword: string;
  normalizedKeyword: string;
  sources: ('google' | 'twitter')[];
  googleCount: number;
  twitterCount: number;
  score: number;
  isCovered: boolean;
  matchedArticles: { title: string; url: string }[];
  velocity?: number | 'new';
}

/**
 * Detect if a trend is covered by any published article.
 * Uses the same cross-language matching pipeline as dedup.
 */
export function detectCoverage(
  trend: UniqueTrend,
  articles: Article[]
): CoverageResult {
  const matchedArticles: { title: string; url: string }[] = [];
  const trendNorm = trend.normalizedKeyword;
  const trendMapping = findCommonMapping(trend.keyword);

  for (const article of articles) {
    let isMatch = false;

    const titleNorm = normalizeForComparison(article.title);
    const sig = significantTokens(trendNorm);

    // Multi-word: never treat short title as matching full trend (e.g. "mumbai" ⊂ "mumbai indians")
    if (sig.length >= 2) {
      if (strictMultiWordTextMatch(trendNorm, titleNorm)) {
        isMatch = true;
      }
    } else if (titleNorm.includes(trendNorm) || trendNorm.includes(titleNorm)) {
      isMatch = true;
    }

    if (!isMatch) {
      if (containsHindi(article.title) && !containsHindi(trend.keyword)) {
        const transliteratedTitle = transliterate(article.title).toLowerCase().trim();
        if (sig.length >= 2) {
          const tt = transliterate(trend.keyword).toLowerCase().trim();
          if (strictMultiWordTextMatch(tt, transliteratedTitle)) {
            isMatch = true;
          }
        } else if (
          transliteratedTitle.includes(trendNorm) ||
          (trendNorm.length >= 4 &&
            areSimilar(trendNorm, transliteratedTitle, 0.72, 0.52))
        ) {
          isMatch = true;
        }
      }
      if (!isMatch && !containsHindi(article.title) && containsHindi(trend.keyword)) {
        const transliteratedTrend = transliterate(trend.keyword).toLowerCase().trim();
        if (sig.length >= 2) {
          if (strictMultiWordTextMatch(transliteratedTrend, titleNorm)) {
            isMatch = true;
          }
        } else if (
          transliteratedTrend.length >= 4 &&
          (appearsAsWordOrPhrase(titleNorm, transliteratedTrend) ||
            areSimilar(transliteratedTrend, titleNorm, 0.72, 0.52))
        ) {
          isMatch = true;
        }
      }
    }

    // Common mapping: same key only if both sides resolve to it (no broad substring on `india`)
    if (!isMatch && trendMapping) {
      const titleMapping = findCommonMapping(article.title);
      if (titleMapping === trendMapping) {
        isMatch = true;
      }
      if (!isMatch && appearsAsWordOrPhrase(titleNorm, trendMapping)) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      for (const kw of article.keywords) {
        const kwNorm = normalizeForComparison(kw);
        if (sig.length >= 2) {
          if (strictMultiWordTextMatch(trendNorm, kwNorm)) {
            isMatch = true;
            break;
          }
        } else if (
          areSimilar(trendNorm, kwNorm, 0.7, 0.5) ||
          kwNorm.includes(trendNorm) ||
          trendNorm.includes(kwNorm)
        ) {
          isMatch = true;
          break;
        }
      }
    }

    if (!isMatch) {
      const trendWords = trendNorm.split(/\s+/).filter((w) => w.length > 2);
      if (trendWords.length > 1) {
        const allWordsInTitle = trendWords.every((word) =>
          titleNorm.includes(word)
        );
        if (allWordsInTitle) isMatch = true;
      }
    }

    if (isMatch) {
      matchedArticles.push({ title: article.title, url: article.url });
    }
  }

  return {
    isCovered: matchedArticles.length > 0,
    matchedArticles: matchedArticles.slice(0, 5), // Cap at 5 matched articles
  };
}

/**
 * Score a single trend based on source diversity, coverage, and recency
 */
export function scoreTrend(
  trend: UniqueTrend,
  coverage: CoverageResult
): number {
  let score = 1.0;

  // Multi-source boost: appears in both Google AND Twitter
  if (trend.sources.includes('google') && trend.sources.includes('twitter')) {
    score += 0.5;
  }

  // Coverage boost: trend has matching articles (editorially relevant)
  if (coverage.isCovered) {
    score += 0.3;
  }

  // Volume boost: higher total mentions = more signal
  const totalMentions = trend.googleCount + trend.twitterCount;
  if (totalMentions > 2) {
    score += 0.2;
  }

  // Extra boost for coverage depth (multiple articles about same trend)
  if (coverage.matchedArticles.length >= 3) {
    score += 0.15;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Rank all trends: score, sort descending, assign ranks, return top N
 */
export function rankTrends(
  trends: UniqueTrend[],
  articles: Article[],
  topN: number = 10
): RankedTrend[] {
  const scored: RankedTrend[] = trends.map(trend => {
    const coverage = detectCoverage(trend, articles);
    const score = scoreTrend(trend, coverage);

    return {
      rank: 0, // assigned after sorting
      keyword: trend.keyword,
      normalizedKeyword: trend.normalizedKeyword,
      sources: trend.sources,
      googleCount: trend.googleCount,
      twitterCount: trend.twitterCount,
      score,
      isCovered: coverage.isCovered,
      matchedArticles: coverage.matchedArticles,
    };
  });

  // Sort by score descending, then by source diversity, then by total mentions
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    return (b.googleCount + b.twitterCount) - (a.googleCount + a.twitterCount);
  });

  // Assign ranks and return top N
  return scored.slice(0, topN).map((trend, idx) => ({
    ...trend,
    rank: idx + 1,
  }));
}
