import { isValidExtractedCompany } from './server/mailNer.ts';

const badNames = ['me', '27卒向け', '1次', '外国人留学生必見', 'データ分析やデータ解析の知識を活かせます!', 'mail', '株式会社ソフトウェア・サービス)', '株式会社サイバー・バズ', '株式会社常陽銀行', '株式会社パルコ', '株式会社IDホールディングス', '余令釗'];

for (const name of badNames) {
  console.log(`"${name}" -> ${isValidExtractedCompany(name)}`);
}
