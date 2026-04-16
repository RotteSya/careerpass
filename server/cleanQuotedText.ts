export function cleanQuotedText(body: string): string {
  // Remove email reply quote blocks starting with >, >>, >>> etc.
  const lines = body.split(/\r?\n/);
  const cleanLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    
    // Skip lines starting with >
    if (/^\s*(>+)\s*/.test(line)) {
      continue;
    }
    
    // Stop completely if we hit typical reply dividers
    if (
      /^\s*_{4,}\s*$/.test(line) ||
      /^\s*-{4,}\s*$/.test(line) ||
      /^\s*20\d{2}年\d{1,2}月\d{1,2}日.{0,100}\s+wrote:\s*$/.test(line) ||
      /^\s*On\s+.{0,100},\s+.{0,100}\s+wrote:\s*$/.test(line) ||
      /^\s*※このメールは.{0,100}返信できません/i.test(line)
    ) {
      // It's a bit aggressive to drop the rest, but usually anything after the divider is history
      break;
    }
    
    cleanLines.push(line);
  }
  
  return cleanLines.join("\n").trim();
}
