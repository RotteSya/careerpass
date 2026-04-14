import { runRecruitingNlpPipeline } from './server/mailNlpPipeline.ts';

const testBody = `
田中 太郎 様

株式会社サイバー・バズの採用担当です。
面接のご案内を申し上げます。
`;

const res = runRecruitingNlpPipeline({
  subject: "面接のご案内",
  from: "recruit@cyberbuzz.co.jp",
  body: testBody,
  domainSignal: 0.8,
  fallbackDate: "2026-04-14",
  fallbackTime: null
});

console.log("Extracted:", res.companyName);

const testBody2 = `
佘令釗様

こんにちは。パルコ採用担当です。
`;

const res2 = runRecruitingNlpPipeline({
  subject: "面接",
  from: "hr@parco.co.jp",
  body: testBody2,
  domainSignal: 0.8,
  fallbackDate: "2026-04-14",
  fallbackTime: null
});

console.log("Extracted 2:", res2.companyName);

