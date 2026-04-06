type HybridRoute = "openclaw" | "legacy_direct" | "legacy_fallback";

type HybridStats = {
  total: number;
  byRoute: Record<HybridRoute, number>;
  openclawErrorCount: number;
  totalLatencyMs: number;
  lastError: string | null;
  lastUpdatedAt: string;
};

type ToolEndpoint = "health" | "recon" | "es" | "workflow_start" | "interview_start" | "metrics";

type ToolStatsItem = {
  calls: number;
  success: number;
  failure: number;
  totalLatencyMs: number;
  lastError: string | null;
  lastUpdatedAt: string;
};

type ToolStats = Record<ToolEndpoint, ToolStatsItem>;

const nowIso = () => new Date().toISOString();

const hybridStats: HybridStats = {
  total: 0,
  byRoute: {
    openclaw: 0,
    legacy_direct: 0,
    legacy_fallback: 0,
  },
  openclawErrorCount: 0,
  totalLatencyMs: 0,
  lastError: null,
  lastUpdatedAt: nowIso(),
};

const createToolItem = (): ToolStatsItem => ({
  calls: 0,
  success: 0,
  failure: 0,
  totalLatencyMs: 0,
  lastError: null,
  lastUpdatedAt: nowIso(),
});

const toolStats: ToolStats = {
  health: createToolItem(),
  recon: createToolItem(),
  es: createToolItem(),
  workflow_start: createToolItem(),
  interview_start: createToolItem(),
  metrics: createToolItem(),
};

export function recordHybridRoute(params: {
  route: HybridRoute;
  latencyMs: number;
  error?: unknown;
}) {
  hybridStats.total += 1;
  hybridStats.byRoute[params.route] += 1;
  hybridStats.totalLatencyMs += Math.max(0, Math.round(params.latencyMs));
  hybridStats.lastUpdatedAt = nowIso();

  if (params.route === "legacy_fallback" && params.error) {
    hybridStats.openclawErrorCount += 1;
    hybridStats.lastError =
      params.error instanceof Error ? params.error.message : String(params.error);
  }
}

export function recordToolCall(params: {
  endpoint: ToolEndpoint;
  ok: boolean;
  latencyMs: number;
  error?: unknown;
}) {
  const item = toolStats[params.endpoint];
  item.calls += 1;
  item.totalLatencyMs += Math.max(0, Math.round(params.latencyMs));
  item.lastUpdatedAt = nowIso();
  if (params.ok) {
    item.success += 1;
  } else {
    item.failure += 1;
    if (params.error) {
      item.lastError = params.error instanceof Error ? params.error.message : String(params.error);
    }
  }
}

export function getOpenClawObservabilitySnapshot() {
  const safeAverage = (totalLatencyMs: number, count: number) =>
    count > 0 ? Math.round(totalLatencyMs / count) : 0;

  return {
    generatedAt: nowIso(),
    hybrid: {
      ...hybridStats,
      avgLatencyMs: safeAverage(hybridStats.totalLatencyMs, hybridStats.total),
    },
    tools: Object.fromEntries(
      (Object.keys(toolStats) as ToolEndpoint[]).map(key => {
        const item = toolStats[key];
        return [
          key,
          {
            ...item,
            avgLatencyMs: safeAverage(item.totalLatencyMs, item.calls),
          },
        ];
      })
    ),
  };
}
