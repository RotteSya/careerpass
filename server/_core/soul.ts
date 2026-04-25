import fs from "fs/promises";
import path from "path";

type LoadedDoc = { content: string; sourcePath: string | null };

const perAgentCache = new Map<string, { content: string; at: number }>();

const CAREERPASS_USER_FACING_SOUL_CONTRACT = `
[面向用户表达优先级]
- 只要是在对用户说话，必须优先遵从 [SOUL] 的人格、语气和边界；基础系统提示只定义职责，[AGENTS] 只定义工具、流程和排版。
- 如果 [SOUL] 的语气与其他指令冲突：安全、事实、工具调用、输出格式优先；其余表达风格以 [SOUL] 为准。
- 每条回复都要像一个真实同事在 Telegram 里说话：自然、有判断、有推进感；不要模板腔、客服腔、过度礼貌或空泛安慰。
- 可以偶尔使用“不让下班”的设定，但必须克制；除非场景合适，不要硬塞这个梗。`;

export function appendUserFacingSoulContract(agentId: string, prompt: string): string {
  return agentId === "careerpass"
    ? `${prompt}\n\n${CAREERPASS_USER_FACING_SOUL_CONTRACT}`
    : prompt;
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    const s = await fs.readFile(p, "utf8");
    return s.trim() ? s : null;
  } catch {
    return null;
  }
}

function getCacheMs() {
  return process.env.NODE_ENV === "development" ? 0 : 600_000;
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

export function composeSystemSections(sections: {
  soul?: string;
  base: string;
  agents?: string;
}): string {
  const parts: string[] = [];
  if (sections.soul) parts.push(`[SOUL]\n${sections.soul}`);
  parts.push(sections.base);
  if (sections.agents) parts.push(`[AGENTS]\n${sections.agents}`);
  return parts.join("\n\n");
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
