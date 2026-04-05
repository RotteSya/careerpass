import fs from "fs/promises";
import path from "path";

let cachedSoul: string | null = null;
let cachedSoulPath: string | null = null;
let cachedAt = 0;

let cachedAgents: string | null = null;
let cachedAgentsPath: string | null = null;
let cachedAgentsAt = 0;

type LoadedDoc = { content: string; sourcePath: string | null };

const perAgentCache = new Map<string, { content: string; at: number }>();

async function readIfExists(p: string): Promise<string | null> {
  try {
    const s = await fs.readFile(p, "utf8");
    return s.trim() ? s : null;
  } catch {
    return null;
  }
}

function getCacheMs() {
  return process.env.NODE_ENV === "development" ? 0 : 60_000;
}

async function loadDocByCandidates(cacheKey: string, candidates: string[]): Promise<LoadedDoc> {
  const ttl = getCacheMs();
  const fresh = ttl > 0 && perAgentCache.has(cacheKey) && Date.now() - (perAgentCache.get(cacheKey)!.at) < ttl;
  if (fresh) {
    return { content: perAgentCache.get(cacheKey)!.content, sourcePath: null };
  }

  for (const p of candidates.filter(Boolean)) {
    const content = await readIfExists(p);
    if (content) {
      perAgentCache.set(cacheKey, { content, at: Date.now() });
      return { content, sourcePath: p };
    }
  }

  perAgentCache.set(cacheKey, { content: "", at: Date.now() });
  return { content: "", sourcePath: null };
}

export async function loadCareerpassSoul(): Promise<{ content: string; sourcePath: string | null }> {
  const cacheMs = getCacheMs();
  const configured = (process.env.CAREERPASS_SOUL_PATH ?? "").trim();
  const candidatePaths = [
    configured,
    path.join(process.cwd(), "SOUL.careerpass.md"),
    path.join(process.cwd(), "SOUL.md"),
    path.join(process.cwd(), "server", "SOUL.careerpass.md"),
    path.join(process.cwd(), "server", "SOUL.md"),
  ].filter(Boolean);

  const joined = candidatePaths.join("|");
  const fresh = cacheMs > 0 && Date.now() - cachedAt < cacheMs;
  if (cachedSoul !== null && cachedSoulPath === joined && fresh) {
    return { content: cachedSoul, sourcePath: null };
  }

  for (const p of candidatePaths) {
    const content = await readIfExists(p);
    if (content) {
      cachedSoul = content;
      cachedSoulPath = joined;
      cachedAt = Date.now();
      return { content, sourcePath: p };
    }
  }

  cachedSoul = "";
  cachedSoulPath = joined;
  cachedAt = Date.now();
  return { content: "", sourcePath: null };
}

export async function loadCareerpassAgents(): Promise<{ content: string; sourcePath: string | null }> {
  const cacheMs = getCacheMs();
  const configured = (process.env.CAREERPASS_AGENTS_PATH ?? "").trim();
  const candidatePaths = [
    configured,
    path.join(process.cwd(), "AGENTS.careerpass.md"),
    path.join(process.cwd(), "AGENTS.md"),
    path.join(process.cwd(), "server", "AGENTS.careerpass.md"),
    path.join(process.cwd(), "server", "AGENTS.md"),
  ].filter(Boolean);

  const joined = candidatePaths.join("|");
  const fresh = cacheMs > 0 && Date.now() - cachedAgentsAt < cacheMs;
  if (cachedAgents !== null && cachedAgentsPath === joined && fresh) {
    return { content: cachedAgents, sourcePath: null };
  }

  for (const p of candidatePaths) {
    const content = await readIfExists(p);
    if (content) {
      cachedAgents = content;
      cachedAgentsPath = joined;
      cachedAgentsAt = Date.now();
      return { content, sourcePath: p };
    }
  }

  cachedAgents = "";
  cachedAgentsPath = joined;
  cachedAgentsAt = Date.now();
  return { content: "", sourcePath: null };
}

export async function loadAgentSoul(agentId: string): Promise<LoadedDoc> {
  const dir = (process.env.CAREERPASS_AGENT_DOCS_DIR ?? "").trim();
  const baseDir = dir || path.join(process.cwd(), "agents");
  const candidates = [
    path.join(baseDir, agentId, "SOUL.md"),
    path.join(baseDir, agentId, "soul.md"),
    path.join(baseDir, agentId, "SOUL.careerpass.md"),
    path.join(baseDir, agentId, "SOUL.md.txt"),
  ];
  const loaded = await loadDocByCandidates(`soul:${baseDir}:${agentId}`, candidates);
  if (loaded.content) return loaded;
  return loadCareerpassSoul();
}

export async function loadAgentAgents(agentId: string): Promise<LoadedDoc> {
  const dir = (process.env.CAREERPASS_AGENT_DOCS_DIR ?? "").trim();
  const baseDir = dir || path.join(process.cwd(), "agents");
  const candidates = [
    path.join(baseDir, agentId, "AGENTS.md"),
    path.join(baseDir, agentId, "agents.md"),
    path.join(baseDir, agentId, "AGENTS.careerpass.md"),
    path.join(baseDir, agentId, "AGENTS.md.txt"),
  ];
  const loaded = await loadDocByCandidates(`agents:${baseDir}:${agentId}`, candidates);
  if (loaded.content) return loaded;
  return loadCareerpassAgents();
}
