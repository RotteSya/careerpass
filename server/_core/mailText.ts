export const MAX_MAIL_BODY_CHARS = 3000;
export const MAX_MAIL_TEXT_CHARS = 3500;

export function limitText(text: string, maxChars: number): { text: string; truncated: boolean; originalLength: number } {
  const originalLength = text.length;
  if (originalLength <= maxChars) return { text, truncated: false, originalLength };
  return { text: text.slice(0, maxChars), truncated: true, originalLength };
}

// Separator placed between the retained head and tail slices of a long body.
// Kept short so it barely dents the budget and stays recognizable in logs.
const HEAD_TAIL_SEPARATOR = "\n…(略)…\n";

/**
 * Preserve both the opening and the closing of an overly long email body.
 * For recruiting mail, the decisive signal ("内定通知", "お見送り", etc.) is
 * often in the closing paragraph, so pure head-truncation can silently
 * discard the strongest feature.
 *
 * Net output length never exceeds {@link maxChars}; short bodies are
 * returned verbatim.
 */
export function limitMailBodyHeadTail(
  body: string,
  maxChars: number = MAX_MAIL_BODY_CHARS,
  tailRatio: number = 0.3,
): { text: string; truncated: boolean; originalLength: number } {
  const src = body ?? "";
  const originalLength = src.length;
  if (originalLength <= maxChars) {
    return { text: src, truncated: false, originalLength };
  }
  const sep = HEAD_TAIL_SEPARATOR;
  const budget = Math.max(0, maxChars - sep.length);
  const tailLen = Math.max(0, Math.floor(budget * tailRatio));
  const headLen = Math.max(0, budget - tailLen);
  const head = src.slice(0, headLen);
  const tail = tailLen > 0 ? src.slice(originalLength - tailLen) : "";
  return { text: head + sep + tail, truncated: true, originalLength };
}

export function limitMailBody(body: string): { text: string; truncated: boolean; originalLength: number } {
  return limitMailBodyHeadTail(body ?? "", MAX_MAIL_BODY_CHARS, 0.33); // e.g. Keep first 2000, last 1000
}

export function buildLimitedMailText(input: {
  subject: string;
  body: string;
  from: string;
}): {
  subject: string;
  from: string;
  body: string;
  text: string;
  bodyTruncated: boolean;
  originalBodyLength: number;
} {
  const subject = input.subject ?? "";
  const from = input.from ?? "";
  const limitedBody = limitMailBody(input.body ?? "");
  const combined = `${subject}\n${limitedBody.text}\n${from}`;
  const limitedCombined = limitText(combined, MAX_MAIL_TEXT_CHARS);
  return {
    subject,
    from,
    body: limitedBody.text,
    text: limitedCombined.text,
    bodyTruncated: limitedBody.truncated,
    originalBodyLength: limitedBody.originalLength,
  };
}

