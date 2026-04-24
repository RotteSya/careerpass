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

const FORWARD_SUBJECT_PREFIX = /^\s*(?:fwd?|fw|転送|转发)\s*[:：]/i;

// Standard dividers placed by common mail clients when a user forwards or
// replies with history.  After the divider we expect a "From:" header block.
const FORWARD_BODY_DIVIDERS: RegExp[] = [
  /-{3,}\s*Forwarded message\s*-{3,}/i,
  /-{3,}\s*転送されたメッセージ\s*-{3,}/,
  /-{3,}\s*転送メッセージ\s*-{3,}/,
  /-{3,}\s*转发邮件\s*-{3,}/,
  /-{3,}\s*Original Message\s*-{3,}/i,
  /-{3,}\s*元のメッセージ\s*-{3,}/,
];

// Depth guard for nested forwards ("Fwd: Fwd: Fwd:").  Three layers is enough
// in practice and bounds the cost.
const MAX_FORWARD_LAYERS = 3;

function stripPrefix(v: string): string {
  return v.replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

/** Parse JST-aware Japanese dates like "2026年2月17日 20:29" → UTC Date. */
function parseJapaneseDate(raw: string): Date | null {
  const withTime = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})[:時](\d{2})/);
  if (withTime) {
    const [, y, mo, d, h, min] = withTime;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h - 9, +min));
  }
  const dateOnly = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return new Date(Date.UTC(+y, +mo - 1, +d, -9));
  }
  return null;
}

function safeParseDate(raw: string): Date | null {
  const jp = parseJapaneseDate(raw);
  if (jp) return jp;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Find the first `From:` / `差出人:` / `发件人:` header line, optionally
 *  preceded by a known forward divider.  Returns the line index or -1. */
function findForwardHeaderStart(lines: string[]): number {
  let dividerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (dividerIdx === -1) {
      for (const re of FORWARD_BODY_DIVIDERS) {
        if (re.test(line)) {
          dividerIdx = i;
          break;
        }
      }
    }
    if (/^\s*(?:From|差出人|发件人)\s*[:：]/i.test(line)) {
      return i;
    }
  }
  // Divider was seen but no From: line followed — not actionable.
  return -1;
}

function extractOneLayer(
  input: ForwardedMailInput,
  opts: { strict: boolean },
): ForwardedMailOutput | null {
  const subject = input.subject ?? "";
  const from = input.from ?? "";
  const body = input.body ?? "";

  const lines = body.split(/\r?\n/);
  const start = findForwardHeaderStart(lines);
  if (start === -1) return null;

  // Outer call must see a positive signal (subject prefix or body divider).
  // Inner iterations only need a well-formed header block — once the outer
  // envelope has been stripped, a plain "From:/Subject:" pair in the body is
  // considered genuine nested forward content.
  if (opts.strict) {
    const subjectIndicatesForward = FORWARD_SUBJECT_PREFIX.test(subject);
    const bodyHasDivider = lines.some((line) =>
      FORWARD_BODY_DIVIDERS.some((re) => re.test(line)),
    );
    if (!subjectIndicatesForward && !bodyHasDivider) return null;
  }

  // Require a Subject header within a small window after the From line.
  // This avoids treating body prose that happens to contain the word
  // "From:" as a forwarded header block.
  let hasSubjectHeader = false;
  for (let i = start; i < Math.min(lines.length, start + 10); i++) {
    if (/^\s*(?:Subject|件名|主题)\s*[:：]/i.test(lines[i] ?? "")) {
      hasSubjectHeader = true;
      break;
    }
  }
  if (!hasSubjectHeader) return null;

  let endHeader = start;
  let extractedFrom: string | null = null;
  let extractedSubject: string | null = null;
  let extractedDate: Date | null = null;

  for (let i = start; i < Math.min(lines.length, start + 30); i++) {
    const line = lines[i] ?? "";
    // The header block ends at the first blank line after at least the
    // "From" field has been captured.
    if (extractedFrom && /^\s*$/.test(line)) {
      endHeader = i;
      break;
    }
    endHeader = i;

    const mFrom = line.match(/^\s*(?:From|差出人|发件人)\s*[:：]\s*(.+)\s*$/i);
    if (mFrom?.[1]) extractedFrom = stripPrefix(mFrom[1]);

    const mSubject = line.match(/^\s*(?:Subject|件名|主题)\s*[:：]\s*(.+)\s*$/i);
    if (mSubject?.[1]) extractedSubject = stripPrefix(mSubject[1]);

    const mSent = line.match(/^\s*(?:Sent|Date|送信日時|发送时间|日付)\s*[:：]\s*(.+)\s*$/i);
    if (mSent?.[1]) {
      extractedDate = safeParseDate(stripPrefix(mSent[1])) ?? extractedDate;
    }
  }

  const rest = lines.slice(endHeader + 1).join("\n").trim();
  const cleanedSubject = extractedSubject
    ? extractedSubject.replace(/^\s*(?:re|fwd?|fw|転送|转发)\s*[:：]\s*/i, "").trim()
    : subject;

  return {
    subject: cleanedSubject || subject,
    from: extractedFrom || from,
    body: rest || body,
    date: extractedDate ?? input.date ?? null,
    isForwarded: true,
  };
}

/**
 * Unwraps forwarded-email chains up to {@link MAX_FORWARD_LAYERS} layers deep.
 * Returns the innermost original message when the outer envelope is just a
 * forward wrapper; otherwise returns the input unchanged with `isForwarded:
 * false`.
 */
export function extractForwardedOriginal(input: ForwardedMailInput): ForwardedMailOutput {
  let current: ForwardedMailInput = {
    subject: input.subject ?? "",
    from: input.from ?? "",
    body: input.body ?? "",
    date: input.date ?? null,
  };
  let unwrappedAny = false;

  for (let i = 0; i < MAX_FORWARD_LAYERS; i++) {
    const next = extractOneLayer(current, { strict: !unwrappedAny });
    if (!next) break;
    unwrappedAny = true;
    current = { subject: next.subject, from: next.from, body: next.body, date: next.date };
  }

  return { ...current, isForwarded: unwrappedAny };
}
