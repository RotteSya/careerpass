type VariantGroup = {
  canonical: string;
  aliases: string[];
};

const COMPANY_VARIANT_GROUPS: VariantGroup[] = [
  {
    canonical: "株式会社ミライト・ワン",
    aliases: [
      "株式会社ミライト・ワン",
      "ミライト・ワン",
      "ミライトワン",
      "（株）ミライト・ワン",
      "(株)ミライト・ワン",
      "㈱ミライト・ワン",
    ],
  },
  {
    canonical: "株式会社アイ・エス・ビー",
    aliases: [
      "株式会社アイ・エス・ビー",
      "アイ・エス・ビー",
      "ISB",
      "株式会社ISB",
    ],
  },
  {
    canonical: "イーソル株式会社",
    aliases: [
      "イーソル株式会社",
      "イーソル",
      "eSOL",
    ],
  },
  {
    canonical: "株式会社スクウェア・エニックス",
    aliases: [
      "株式会社スクウェア・エニックス",
      "スクウェア・エニックス",
      "スクエアエニックス",
      "SQUARE ENIX",
      "SQUARE ENIX CO., LTD.",
    ],
  },
  {
    canonical: "株式会社メイテックフィルダーズ",
    aliases: [
      "株式会社メイテックフィルダーズ",
      "メイテックフィルダーズ",
    ],
  },
  {
    canonical: "テクバン株式会社",
    aliases: [
      "テクバン株式会社",
      "テクバン",
      "TECHVAN",
    ],
  },
  {
    canonical: "株式会社ゲームフリーク",
    aliases: [
      "株式会社ゲームフリーク",
      "ゲームフリーク",
      "GAME FREAK",
    ],
  },
  {
    canonical: "株式会社リコー",
    aliases: [
      "株式会社リコー",
      "リコー",
      "RICOH",
    ],
  },
  {
    canonical: "株式会社オロ",
    aliases: [
      "株式会社オロ",
      "オロ",
      "ORO",
    ],
  },
  {
    canonical: "パナソニックグループ",
    aliases: [
      "パナソニックグループ",
      "Panasonic Group",
      "PANASONIC",
      "パナソニック",
    ],
  },
  {
    canonical: "ルートイングループ",
    aliases: [
      "ルートイングループ",
      "ROUTE INN GROUP",
      "ROUTE INN HOTELS",
      "ROUTE-INN GROUP",
    ],
  },
];

const BLOCKED_COMPANY_TOKENS = new Set([
  "info", "noreply", "no-reply", "support", "recruit", "saiyo", "hr", "jobs",
  "syukatsu-kaigi", "syukatsukaigi", "就活会議", "openwork", "vorkers",
  "onecareer", "one-career", "offerbox", "goodfind",
  "mynavi", "マイナビ", "rikunabi", "リクナビ", "doda", "bizreach", "ビズリーチ",
  "wantedly", "green",
]);

const LEGAL_ENTITY_TOKENS =
  /(株式会社|（株）|\(株\)|㈱|合同会社|有限会社|incorporated|inc\.?|co\.?\s*,?\s*ltd\.?|ltd\.?|corp\.?|corporation|company|llc|g\.k\.)/gi;

const RECRUITING_SUFFIXES =
  /(採用担当|採用チーム|人事部|人事課|人事|採用|リクルート|Recruiting|recruit|HR|新卒採用|中途採用|採用事務局|運営事務局|事務局|team|Team|新卒|中途|専用マイページのお知らせ|からのご案内)$/i;

function cleanEdgeSymbols(input: string): string {
  return input
    .replace(/^(【|「|\[|\()(.+?)(】|」|\]|\))$/, "$2")
    .replace(/^[\s"'`\u201c\u201d]+|[\s"'`\u201c\u201d]+$/g, "")
    .trim();
}

export function hasLegalEntityToken(name: string): boolean {
  return /(株式会社|（株）|\(株\)|㈱|合同会社|有限会社|inc\.?|corp\.?|ltd\.?|llc)/i.test(name);
}

export function normalizeCompanyDisplayName(name: string | null | undefined): string | null {
  let raw = (name ?? "").normalize("NFKC").trim();
  if (!raw) return null;

  raw = cleanEdgeSymbols(raw);
  if (!raw) return null;

  raw = raw.replace(/(（株）|\(株\)|㈱)/g, "株式会社");
  raw = raw.replace(/・.*(コース|職|採用|応募|選考)$/, "").trim();
  raw = raw.replace(/への社名(?:改称|変更).*$/, "").trim();
  raw = raw.replace(RECRUITING_SUFFIXES, "").trim();
  raw = raw.replace(/[のよりからへ]$/, "").trim();
  raw = raw.replace(/[\s　]+/g, " ");
  raw = raw.replace(/^(株式会社|合同会社|有限会社|一般社団法人|一般財団法人)\s+/, "$1");

  const lower = raw.toLowerCase();
  if (BLOCKED_COMPANY_TOKENS.has(lower)) return null;
  if (raw.length < 2) return null;
  return raw;
}

export function normalizeCompanyKey(name: string | null | undefined): string | null {
  const display = normalizeCompanyDisplayName(name);
  if (!display) return null;

  const lower = display.toLowerCase();
  let key = lower.replace(LEGAL_ENTITY_TOKENS, "");
  key = key.replace(/[\s　・･\-ー‐‑‒–—―_.·・'"\(\)\[\]{}【】「」\/\\]/g, "");
  key = key.trim();
  if (key.length < 2) return null;
  return key;
}

const COMPANY_VARIANT_CANONICAL_MAP = (() => {
  const map = new Map<string, string>();
  for (const group of COMPANY_VARIANT_GROUPS) {
    const canonicalDisplay = normalizeCompanyDisplayName(group.canonical);
    if (!canonicalDisplay) continue;
    for (const alias of group.aliases) {
      const key = normalizeCompanyKey(alias);
      if (key) map.set(key, canonicalDisplay);
    }
  }
  return map;
})();

export function resolveCanonicalCompanyName(name: string | null | undefined): string | null {
  const display = normalizeCompanyDisplayName(name);
  if (!display) return null;
  const key = normalizeCompanyKey(display);
  if (!key) return null;
  return COMPANY_VARIANT_CANONICAL_MAP.get(key) ?? display;
}

export function preferCompanyDisplayName(current: string, candidate: string): string {
  const currentLegal = hasLegalEntityToken(current);
  const candidateLegal = hasLegalEntityToken(candidate);
  if (candidateLegal && !currentLegal) return candidate;
  if (!candidateLegal && currentLegal) return current;
  return candidate.length > current.length ? candidate : current;
}
