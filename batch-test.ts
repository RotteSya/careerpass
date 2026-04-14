import fs from 'fs';
import path from 'path';
import { simpleParser } from 'mailparser';
import { runRecruitingNlpPipeline } from './server/mailNlpPipeline.ts';

async function processAllEmls() {
  const dir = '/workspace';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.eml'));
  
  if (files.length === 0) {
    console.log("没有在 /workspace 目录下找到 .eml 文件。");
    return;
  }
  
  console.log(`总共找到 ${files.length} 封 .eml 邮件，开始逐封测试并删除...\n`);
  
  let jobRelatedCount = 0;
  let otherCount = 0;
  let noiseCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const content = fs.readFileSync(filePath);
      const parsed = await simpleParser(content);
      
      const subject = parsed.subject || '';
      const from = parsed.from?.text || '';
      const body = parsed.text || '';
      
      // 简单模拟平台域名权重（就活会議、マイナビ等）
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
      
      console.log(`[文件] ${file}`);
      console.log(`[主题] ${subject}`);
      console.log(`[判定] 分类: ${d.eventType} | 公司: ${d.companyName || 'N/A'} | 时间: ${d.eventDate || 'N/A'} ${d.eventTime || ''}`);
      console.log(`[原因] ${d.reason} (置信度: ${d.confidence.toFixed(2)}) | shouldSkipLlm: ${d.shouldSkipLlm}`);
      
      if (d.eventType === 'other' && !d.isJobRelated) noiseCount++;
      else if (d.eventType === 'other' && d.isJobRelated) otherCount++;
      else jobRelatedCount++;

      // 测试完毕后删除文件
      fs.unlinkSync(filePath);
      console.log(`[状态] 已删除文件`);
      console.log("-".repeat(60));
    } catch (err) {
      console.error(`处理文件 ${file} 时出错:`, err);
    }
  }
  
  console.log(`\n测试完毕！`);
  console.log(`统计结果：`);
  console.log(`- 真实求职事件 (面试/拒信等): ${jobRelatedCount} 封`);
  console.log(`- 待办通知 (需要登录平台等): ${otherCount} 封`);
  console.log(`- 噪音/广告 (直接拦截丢弃): ${noiseCount} 封`);
}

processAllEmls().catch(console.error);
