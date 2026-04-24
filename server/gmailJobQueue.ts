type GmailJob<T> = {
  name: string;
  userId: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

const MAX_CONCURRENT_GMAIL_JOBS = 2;

let activeJobs = 0;
const pendingJobs: Array<GmailJob<unknown>> = [];
const dedupedJobs = new Map<string, Promise<unknown>>();

function drainGmailJobQueue(): void {
  while (activeJobs < MAX_CONCURRENT_GMAIL_JOBS && pendingJobs.length > 0) {
    const job = pendingJobs.shift()!;
    activeJobs++;

    void job.run()
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        activeJobs--;
        drainGmailJobQueue();
      });
  }
}

export function enqueueGmailJob<T>(
  params: {
    name: string;
    userId: number;
    dedupeKey?: string;
  },
  run: () => Promise<T>
): Promise<T> {
  if (params.dedupeKey) {
    const existing = dedupedJobs.get(params.dedupeKey);
    if (existing) return existing as Promise<T>;
  }

  const promise = new Promise<T>((resolve, reject) => {
    pendingJobs.push({
      name: params.name,
      userId: params.userId,
      run,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    drainGmailJobQueue();
  });

  if (params.dedupeKey) {
    dedupedJobs.set(params.dedupeKey, promise);
    promise.then(() => {
      if (dedupedJobs.get(params.dedupeKey!) === promise) {
        dedupedJobs.delete(params.dedupeKey!);
      }
    }, () => {
      if (dedupedJobs.get(params.dedupeKey!) === promise) {
        dedupedJobs.delete(params.dedupeKey!);
      }
    });
  }

  return promise;
}

export function getGmailJobQueueStats() {
  return {
    active: activeJobs,
    pending: pendingJobs.length,
    deduped: dedupedJobs.size,
  };
}
