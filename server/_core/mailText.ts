export const MAX_MAIL_BODY_CHARS = 20_000;
export const MAX_MAIL_TEXT_CHARS = 22_000;

export function limitText(text: string, maxChars: number): { text: string; truncated: boolean; originalLength: number } {
  const originalLength = text.length;
  if (originalLength <= maxChars) return { text, truncated: false, originalLength };
  return { text: text.slice(0, maxChars), truncated: true, originalLength };
}

export function limitMailBody(body: string): { text: string; truncated: boolean; originalLength: number } {
  return limitText(body ?? "", MAX_MAIL_BODY_CHARS);
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

