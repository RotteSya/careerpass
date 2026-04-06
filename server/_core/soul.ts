import fs from "fs/promises";
import path from "path";

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
  return loaded;
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
  return loaded;
}
