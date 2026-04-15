import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { simpleParser } from "mailparser";
import { extractBestDateTime, getDomainReputation } from "../server/mailNer";
import { runRecruitingNlpPipeline } from "../server/mailNlpPipeline";

type JobStatus =
  | "researching"
  | "applied"
  | "briefing"
  | "es_preparing"
  | "es_submitted"
  | "document_screening"
  | "written_test"
  | "interview_1"
  | "interview_2"
  | "interview_3"
  | "interview_4"
  | "interview_final"
  | "offer"
  | "rejected"
  | "withdrawn";

function jobStatusRank(status: JobStatus): number {
  const ranks: Record<JobStatus, number> = {
    researching: 10,
    applied: 20,
    briefing: 30,
    es_preparing: 40,
    es_submitted: 45,
    document_screening: 50,
    written_test: 55,
    interview_1: 60,
    interview_2: 70,
    interview_3: 75,
    interview_4: 80,
    interview_final: 85,
    offer: 90,
    rejected: 90,
    withdrawn: 90,
  };
  return ranks[status] ?? 0;
}

function inferStatus(params: {
  eventType: string;
  hardOutcome?: "offer" | "rejection" | null;
  interviewRound?: string | null;
  subject: string;
  body: string;
}): JobStatus {
  if (params.hardOutcome === "offer") return "offer";
  if (params.hardOutcome === "rejection") return "rejected";
  if (params.eventType === "test") return "written_test";
  if (params.eventType === "deadline") return "es_preparing";
  if (params.eventType === "briefing") return "briefing";
  if (params.eventType === "interview") {
    if (params.interviewRound === "1st") return "interview_1";
    if (params.interviewRound === "2nd") return "interview_2";
    if (params.interviewRound === "3rd") return "interview_3";
    if (params.interviewRound === "4th") return "interview_4";
    if (params.interviewRound === "final") return "interview_final";
    return "interview_1";
  }
  if (params.eventType === "entry") {
    const text = `${params.subject}\n${params.body}`;
    if (
      /(エントリーシート|web\s*es|es)\s*(提出|回答).*(完了|ありがとう|ありがとうございました)/i.test(text) ||
      /(回答が完了しました|提出が完了しました|ご提出ありがとうございました|ご提出ありがとう|提出の御礼)/.test(text)
    ) {
      return "es_submitted";
    }
    return "applied";
  }
  return "researching";
}

function csvEscape(v: string): string {
  return `"${(v ?? "").replace(/"/g, '""')}"`;
}

async function main() {
  const mailDir = path.resolve("testmail");
  const outPath = path.resolve("testmailcsv/job_applications.csv");
  const files = (await readdir(mailDir)).filter((f) => f.toLowerCase().endsWith(".eml")).sort();

  const jobs = new Map<
    string,
    {
      companyName: string;
      status: JobStatus;
      position: string;
      deadline: string;
      contact: string;
      priority: "high" | "medium" | "low";
      mailSubject: string;
      mailFrom: string;
      reason: string;
    }
  >();

  for (const file of files) {
    const raw = await readFile(path.join(mailDir, file));
    const parsed = await simpleParser(raw);
    const subject = (parsed.subject ?? "").trim();
    const from = (parsed.from?.text ?? "").trim();
    const body = ((parsed.text ?? parsed.html ?? "") as string).trim();
    const fallback = extractBestDateTime(`${subject}\n${body}`);
    const headerDate = parsed.date ? parsed.date.toISOString().slice(0, 10) : null;
    const fallbackDate = fallback.date ?? headerDate;
    const fallbackTime = fallback.time ?? null;
    const domainSignal = getDomainReputation(from).score;
    const decision = runRecruitingNlpPipeline({
      subject,
      body,
      from,
      domainSignal,
      fallbackDate,
      fallbackTime,
    });
    const companyName = decision.companyName?.trim() ?? "";
    if (!decision.isJobRelated || !companyName) continue;

    const status = inferStatus({
      eventType: decision.eventType,
      hardOutcome: decision._meta?.hardOutcome ?? null,
      interviewRound: decision._meta?.interviewRound ?? null,
      subject,
      body,
    });
    const key = companyName.toLowerCase();
    const prev = jobs.get(key);
    const reason = `${decision.reason} (eventType=${decision.eventType}, hardOutcome=${decision._meta?.hardOutcome ?? "none"})`;
    const deadline = decision.eventDate ?? "";
    if (!prev) {
      jobs.set(key, {
        companyName,
        status,
        position: "",
        deadline,
        contact: "",
        priority: "medium",
        mailSubject: subject,
        mailFrom: from,
        reason,
      });
      continue;
    }
    if (jobStatusRank(status) > jobStatusRank(prev.status)) {
      prev.status = status;
    }
    if (deadline && !prev.deadline) prev.deadline = deadline;
    prev.mailSubject = subject || prev.mailSubject;
    prev.mailFrom = from || prev.mailFrom;
    prev.reason = reason || prev.reason;
  }

  const header = "\ufeff公司名称,申请状态,职位名称,締切,联系方式,优先级,来源邮件标题,来源邮箱,提取依据\n";
  const rows = Array.from(jobs.values())
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "ja"))
    .map((j) =>
      [
        csvEscape(j.companyName),
        csvEscape(j.status),
        csvEscape(j.position),
        csvEscape(j.deadline),
        csvEscape(j.contact),
        csvEscape(j.priority),
        csvEscape(j.mailSubject),
        csvEscape(j.mailFrom),
        csvEscape(j.reason),
      ].join(",")
    )
    .join("\n");
  await writeFile(outPath, header + rows, "utf8");
  process.stdout.write(`Wrote ${outPath} (${jobs.size} companies)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

