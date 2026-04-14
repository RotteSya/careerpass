import fs from 'fs';
import path from 'path';
import { simpleParser } from 'mailparser';
import { runRecruitingNlpPipeline, getDomainReputation } from './server/mailNlpPipeline.ts';

async function run() {
  const dir = '/workspace/testmail';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.eml'));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file));
    const parsed = await simpleParser(content);
    
    const subject = parsed.subject || '';
    const from = parsed.from?.text || '';
    const body = parsed.text || '';
    
    const domainSignal = /mynavi|syukatsu-kaigi|rikunabi|offerbox/i.test(from) ? 0.1 : 0.8;
    
    const preflight = runRecruitingNlpPipeline({
      subject,
      from,
      body,
      domainSignal,
      fallbackDate: "2026-04-14",
      fallbackTime: null
    });
    
    const c = preflight.companyName || "";
    const badNames = ['me', '27卒向け', '1次', '外国人留学生必見', 'データ分析やデータ解析の知識を活かせます!', 'mail', '株式会社ソフトウェア・サービス)', '株式会社サイバー・バズ', '株式会社常陽銀行', '株式会社パルコ', '株式会社IDホールディングス'];
    const bad = badNames.some(b => c.includes(b)) || c.endsWith(')') || c.length <= 2;
    
    if (bad || !preflight.shouldSkipLlm && preflight.isJobRelated) {
       if (bad) {
           console.log(`[BAD] File: ${file}`);
           console.log(`Subject: ${subject}`);
           console.log(`Extracted: ${c} (conf: ${preflight.confidence}, skipLLM: ${preflight.shouldSkipLlm})`);
           console.log("---");
       }
    }
  }
}
run().catch(console.error);
