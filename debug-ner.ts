import fs from 'fs';
import path from 'path';
import { simpleParser } from 'mailparser';
import { runRecruitingNlpPipeline } from './server/mailNlpPipeline.ts';

async function debugNer() {
  const dir = '/workspace/testmail';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.eml'));
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file));
      const parsed = await simpleParser(content);
      
      const subject = parsed.subject || '';
      const from = parsed.from?.text || '';
      const body = parsed.text || '';
      
      const isPlatform = /mynavi|syukatsu-kaigi|rikunabi|offerbox/i.test(from);
      const domainSignal = isPlatform ? 0.1 : 0.8;
      
      const d = runRecruitingNlpPipeline({
        subject,
        from,
        body,
        domainSignal,
        fallbackDate: "2026-04-14",
        fallbackTime: null
      });
      
      const c = d.companyName || "";
      const badNames = ['me', '27卒向け', '1次', '外国人留学生必見', 'データ分析やデータ解析の知識を活かせます!', 'mail', '株式会社ソフトウェア・サービス)'];
      const bad = badNames.includes(c) || c.endsWith(')') || c.length <= 2;
      
      if (bad) {
        console.log(`[FILE] ${file}`);
        console.log(`[SUBJECT] ${subject}`);
        console.log(`[FROM] ${from}`);
        console.log(`[EXTRACTED] ${c} (conf: ${d.confidence}) | SkipLLM: ${d.shouldSkipLlm}`);
        console.log("-".repeat(50));
      }
    } catch (err) {
      console.error(`Error parsing ${file}:`, err);
    }
  }
}

debugNer().catch(console.error);
