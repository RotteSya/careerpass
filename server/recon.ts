/**
 * recon.ts — careerpassrecon Agent の情報収集エンジン
 *
 * 三段階フォールバック戦略:
 *   1. Firecrawl (深度スクレイピング) → 成功すれば使用
 *   2. web-content-fetcher (軽量スクレイピング) + Tavily (AI検索) → Firecrawl失敗時
 *   3. IR資料のみ (LLM内部知識) → 両方失敗時
 *
 * 収集対象:
 *   - 企業公式サイト / IR資料
 *   - OpenWork / 就活会議 などの匿名口コミ
 *   - 技術ブログ / ニュース記事
 */

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";
const TAVILY_BASE = "https://api.tavily.com";
// web-content-fetcher: https://github.com/shirenchuang/web-content-fetcher
// Deployed as a local/remote service; falls back to direct fetch if unavailable
const WEB_CONTENT_FETCHER_BASE = process.env.WEB_CONTENT_FETCHER_URL ?? "http://localhost:3001";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReconSource {
  url: string;
  title: string;
  content: string;
  source: "firecrawl" | "tavily" | "fallback";
}

export interface ReconResult {
  companyName: string;
  sources: ReconSource[];
  rawText: string; // aggregated text for LLM context
  strategy: "firecrawl" | "tavily" | "llm_only";
}

// ─── Firecrawl ────────────────────────────────────────────────────────────────

async function firecrawlSearch(query: string): Promise<ReconSource[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit: 5, scrapeOptions: { formats: ["markdown"] } }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as {
      success?: boolean;
      data?: Array<{ url: string; title: string; markdown?: string; description?: string }>;
    };

    if (!data?.success || !data?.data) return [];

    return data.data
      .filter((item) => item.markdown || item.description)
      .map((item) => ({
        url: item.url,
        title: item.title ?? item.url,
        content: item.markdown ?? item.description ?? "",
        source: "firecrawl" as const,
      }));
  } catch {
    return [];
  }
}

// ─── web-content-fetcher ──────────────────────────────────────────────────────
// https://github.com/shirenchuang/web-content-fetcher
// Lightweight scraper that bypasses basic anti-bot measures via headless browser.
// Called when Firecrawl fails (rate-limited, blocked, or API key missing).

async function webContentFetch(url: string): Promise<string | null> {
  // Try the web-content-fetcher service first
  try {
    const res = await fetch(`${WEB_CONTENT_FETCHER_BASE}/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, format: "markdown" }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const data = (await res.json()) as { content?: string; markdown?: string };
      const text = data.markdown ?? data.content;
      if (text && text.length > 100) return text;
    }
  } catch {
    // Service not available — fall through to direct fetch
  }

  // Fallback: direct HTTP fetch (plain text, no JS rendering)
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CareerPassBot/1.0; +https://careerpass.manus.space)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Strip HTML tags for basic text extraction
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{3,}/g, "\n")
      .slice(0, 5000);
  } catch {
    return null;
  }
}

// ─── Tavily ───────────────────────────────────────────────────────────────────

async function tavilySearch(query: string, maxResults = 5): Promise<ReconSource[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(`${TAVILY_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_raw_content: false,
        search_depth: "advanced",
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ url: string; title: string; content: string }>;
    };

    return (data.results ?? []).map((item) => ({
      url: item.url,
      title: item.title,
      content: item.content,
      source: "tavily" as const,
    }));
  } catch {
    return [];
  }
}

// ─── Main Recon Orchestrator ──────────────────────────────────────────────────

export async function reconCompany(companyName: string): Promise<ReconResult> {
  const sources: ReconSource[] = [];

  // ── Stage 1: Firecrawl deep search ──────────────────────────────────────────
  const firecrawlQueries = [
    `${companyName} 企業情報 中期経営計画 IR`,
    `${companyName} site:openwork.jp OR site:kaisha-hyouban.com 口コミ 評判`,
    `${companyName} 採用 求める人材 カルチャー`,
  ];

  for (const q of firecrawlQueries) {
    const results = await firecrawlSearch(q);
    sources.push(...results);
    if (sources.length >= 6) break;
  }

  if (sources.length >= 3) {
    const rawText = sources.map((s) => `## ${s.title}\n${s.content}`).join("\n\n---\n\n");
    return { companyName, sources, rawText, strategy: "firecrawl" };
  }

  // ── Stage 2: web-content-fetcher + Tavily ───────────────────────────────────
  // 2a: Try web-content-fetcher on known IR/company pages
  const slug = companyName.toLowerCase().replace(/\s+/g, "");
  const irUrls = [
    `https://www.${slug}.co.jp/ir/`,
    `https://www.${slug}.com/ir/`,
  ];
  for (const url of irUrls) {
    const content = await webContentFetch(url);
    if (content && content.length > 200) {
      sources.push({ url, title: `${companyName} IR資料`, content, source: "fallback" });
      break;
    }
  }

  // 2b: Tavily search as supplement
  const tavilyQueries = [
    `${companyName} 会社概要 事業内容 強み 課題 2024`,
    `${companyName} 就活 評判 社風 働き方`,
    `${companyName} DX デジタル化 技術 採用`,
  ];

  for (const q of tavilyQueries) {
    const results = await tavilySearch(q, 4);
    sources.push(...results);
    if (sources.length >= 6) break;
  }

  if (sources.length >= 1) {
    const rawText = sources.map((s) => `## ${s.title}\n${s.content}`).join("\n\n---\n\n");
    return { companyName, sources, rawText, strategy: "tavily" };
  }

  // ── Stage 3: IR資料のみ (LLM内部知識) ─────────────────────────────────────────
  return {
    companyName,
    sources: [],
    rawText: "",
    strategy: "llm_only",
  };
}

// ─── Memory Search (text-based similarity, pgvector substitute) ───────────────

/**
 * Simple TF-IDF-like relevance scoring for memory search.
 * Used as a substitute for pgvector semantic search since the current
 * database is MySQL (not PostgreSQL with pgvector extension).
 *
 * For production upgrade: replace this with pgvector cosine similarity
 * when migrating to PostgreSQL.
 */
export function scoreMemoryRelevance(content: string, query: string): number {
  const queryTokens = tokenize(query);
  const contentTokens = tokenize(content);
  const contentSet = new Set(contentTokens);

  if (queryTokens.length === 0) return 0;

  // Term frequency: count how many query tokens appear in content
  let matchCount = 0;
  for (const token of queryTokens) {
    if (contentSet.has(token)) matchCount++;
  }

  // Boost for exact phrase match
  const phraseBoost = content.toLowerCase().includes(query.toLowerCase()) ? 0.3 : 0;

  return matchCount / queryTokens.length + phraseBoost;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Search agent memories by relevance to a query.
 * Returns top-k most relevant memories, sorted by score descending.
 */
export function searchMemories<T extends { content: string; title: string }>(
  memories: T[],
  query: string,
  topK = 5
): T[] {
  if (!query.trim()) return memories.slice(0, topK);

  const scored = memories.map((m) => ({
    item: m,
    score: scoreMemoryRelevance(m.content + " " + m.title, query),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.item);
}
