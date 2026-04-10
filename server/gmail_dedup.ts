export type MailItem<T> = { messageId: string; mailTs: number; value: T };

export function sortMailItemsByTsDesc<T>(items: MailItem<T>[]): MailItem<T>[] {
  const normalized = items.slice();
  normalized.sort((a, b) => {
    const ta = Number.isFinite(a.mailTs) ? a.mailTs : -Infinity;
    const tb = Number.isFinite(b.mailTs) ? b.mailTs : -Infinity;
    if (tb !== ta) return tb - ta;
    if (a.messageId < b.messageId) return -1;
    if (a.messageId > b.messageId) return 1;
    return 0;
  });
  return normalized;
}

export function createCompanyBatchDeduper(): (companyKey: string | null) => boolean {
  const seen = new Set<string>();
  return (companyKey: string | null) => {
    if (!companyKey) return true;
    const key = companyKey.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
