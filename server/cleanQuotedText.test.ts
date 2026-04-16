import { describe, expect, it } from "vitest";
import { cleanQuotedText } from "./cleanQuotedText";

describe("cleanQuotedText", () => {
  it("removes quoted lines", () => {
    const text = "Hello\n> Previous message\n> Another line\nWorld";
    expect(cleanQuotedText(text)).toBe("Hello\nWorld");
  });

  it("stops at typical dividers", () => {
    const text = "Hi there\n\n________________________________\nFrom: x\nBlah";
    expect(cleanQuotedText(text)).toBe("Hi there");
    
    const text2 = "Hi there\n\nOn 2026/04/15, someone wrote:\n> Blah";
    expect(cleanQuotedText(text2)).toBe("Hi there");
  });
  
  it("stops at no-reply warning", () => {
    const text = "Hi there\n※このメールは送信専用アドレスから配信されています。ご返信できません。";
    expect(cleanQuotedText(text)).toBe("Hi there");
  });
});
