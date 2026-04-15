type RateLimiter = {
  consume: (key: string) => boolean;
};

export function createRateLimiter(params: {
  windowMs: number;
  max: number;
}): RateLimiter {
  const windowMs = Math.max(1, Math.floor(params.windowMs));
  const max = Math.max(1, Math.floor(params.max));

  const state = new Map<string, { count: number; resetAt: number }>();

  return {
    consume: (key: string) => {
      const now = Date.now();
      const entry = state.get(key);
      if (!entry || now >= entry.resetAt) {
        state.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (entry.count >= max) {
        return false;
      }
      entry.count += 1;
      return true;
    },
  };
}

