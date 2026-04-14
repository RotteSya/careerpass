import { runRecruitingNlpPipeline } from './server/mailNlpPipeline.ts';

const subject = 'エントリーした企業からメッセージが届きました(株式会社サンマルクカフェ)　2026.04.14';
const from = 'マイナビ2027 <job-s27@mynavi.jp>';
const body = `お名前：ＳＨＥさん
My CareerID：raysya.biz@gmail.com

あなたのマイページに企業からのメッセージが届きました。

▼お返事送信元企業一覧
https://job.mynavi.jp/27/pc/user/displayMessageList/index?boxType=reply

----------------------------------------------------------------------
★★4月20日空席あり★　サンマルクカフェ／対面会社説明会のご案内
＜株式会社サンマルクカフェ＞

----------------------------------------------------------------------

▼お返事送信元企業一覧
https://job.mynavi.jp/27/pc/user/displayMessageList/index?boxType=reply

　※このメールはマイナビより配信されております。
　　本メールに返信していただきましても、企業へのお問い合わせはできません。

　メールの配信停止、登録内容の変更は、下記URLの「登録内容の変更・退会」
　からご自身で行ってください。
　https://job.mynavi.jp/touroku2027/
　※パスワードをお忘れの方も↑こちらからお調べいただけます。

───────────────────────────────────
◆お問い合わせ マイナビ運営事務局 job-s27@mynavi.jp
「マイナビ2027」への会員登録に覚えのない方は、恐れ入りますが、
「登録の覚えがないので退会希望」と明記の上、
当メールの最初の部分に記載されている「お名前」「My CareerID」を含め全文を運営事務局へご返信ください。
調査の上、折り返しお返事を差し上げます。
───────────────────────────────────`;

const d = runRecruitingNlpPipeline({
  subject,
  body,
  from,
  domainSignal: 0.1,
  fallbackDate: null,
  fallbackTime: null,
});

console.log(JSON.stringify({
  isJobRelated: d.isJobRelated,
  eventType: d.eventType,
  companyName: d.companyName,
  eventDate: d.eventDate,
  confidence: d.confidence,
  reason: d.reason,
  shouldSkipLlm: d.shouldSkipLlm,
}, null, 2));
