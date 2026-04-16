export type ForwardedMailInput = {
  subject: string;
  from: string;
  body: string;
  date: Date | null;
};

export type ForwardedMailOutput = {
  subject: string;
  from: string;
  body: string;
  date: Date | null;
  isForwarded: boolean;
};

function safeParseDate(raw: string): Date | null {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function stripPrefix(v: string): string {
  return v.replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

export function extractForwardedOriginal(input: ForwardedMailInput): ForwardedMailOutput {
  const subject = input.subject ?? "";
  const from = input.from ?? "";
  const body = input.body ?? "";

  const looksForwarded = /^\s*(?:fwd?|fw)\s*:/i.test(subject);
  if (!looksForwarded) {
    return { subject, from, body, date: input.date ?? null, isForwarded: false };
  }

  const lines = body.split(/\r?\n/);
  const indexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(From|差出人)\s*:/i.test(lines[i] ?? "")) indexes.push(i);
  }
  if (indexes.length === 0) {
    return { subject, from, body, date: input.date ?? null, isForwarded: false };
  }

  const start = indexes[0];
  let endHeader = start;
  let extractedFrom: string | null = null;
  let extractedSubject: string | null = null;
  let extractedDate: Date | null = null;

  for (let i = start; i < Math.min(lines.length, start + 30); i++) {
    const line = lines[i] ?? "";
    endHeader = i;
    const mFrom = line.match(/^\s*(?:From|差出人)\s*:\s*(.+)\s*$/i);
    if (mFrom?.[1]) extractedFrom = stripPrefix(mFrom[1]);

    const mSubject = line.match(/^\s*(?:Subject|件名)\s*:\s*(.+)\s*$/i);
    if (mSubject?.[1]) extractedSubject = stripPrefix(mSubject[1]);

    const mSent = line.match(/^\s*(?:Sent|Date|送信日時)\s*:\s*(.+)\s*$/i);
    if (mSent?.[1]) {
      extractedDate = safeParseDate(stripPrefix(mSent[1])) ?? extractedDate;
    }

    if (extractedFrom && extractedSubject) break;
  }

  const rest = lines.slice(endHeader + 1).join("\n").trim();
  const cleanedSubject = extractedSubject ? extractedSubject.replace(/^\s*(?:re|fwd?|fw)\s*:\s*/i, "").trim() : subject;

  return {
    subject: cleanedSubject || subject,
    from: extractedFrom || from,
    body: rest || body,
    date: extractedDate ?? input.date ?? null,
    isForwarded: true,
  };
}

