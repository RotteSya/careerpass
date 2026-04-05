import fs from "fs/promises";
import path from "path";

let cachedSoul: string | null = null;
let cachedSoulPath: string | null = null;
let cachedAt = 0;

async function readIfExists(p: string): Promise<string | null> {
  try {
    const s = await fs.readFile(p, "utf8");
    return s.trim() ? s : null;
  } catch {
    return null;
  }
}

export async function loadCareerpassSoul(): Promise<{ content: string; sourcePath: string | null }> {
  const cacheMs = process.env.NODE_ENV === "development" ? 0 : 60_000;
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
