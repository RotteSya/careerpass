import { getOauthToken } from "./db";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

type NotionProperty = {
  type: string;
  status?: { options?: Array<{ name: string }> };
  select?: { options?: Array<{ name: string }> };
};

export type SyncNotionJobInput = {
  userId: number;
  companyName: string;
  position?: string | null;
  status?: string | null;
  nextActionAt?: string | Date | null;
  eventType?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  location?: string | null;
  mailSubject?: string | null;
  source?: "gmail" | "manual" | "agent";
};

function notionHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

function findFirstPropertyName(
  properties: Record<string, NotionProperty>,
  names: string[],
  allowedTypes: string[]
): string | null {
  for (const key of Object.keys(properties)) {
    const p = properties[key];
    if (!p) continue;
    if (names.includes(key) && allowedTypes.includes(p.type)) return key;
  }
  return null;
}

function findTitlePropertyName(properties: Record<string, NotionProperty>): string | null {
  for (const key of Object.keys(properties)) {
    if (properties[key]?.type === "title") return key;
  }
  return null;
}

function mapStatusNameEnglish(status?: string | null): string | null {
  const m: Record<string, string> = {
    researching: "Researching",
    applied: "Entry Submitted",
    briefing: "Briefing",
    es_preparing: "ES Preparing",
    es_submitted: "ES Submitted",
    document_screening: "Document Screening",
    written_test: "Written Test",
    interview_1: "Interview 1",
    interview_2: "Interview 2",
    interview_3: "Interview 3",
    interview_4: "Interview 4",
    interview_final: "Final Interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
  };
  if (!status) return null;
  return m[status] ?? status;
}

function getStatusOrSelectOptionNames(p?: NotionProperty | null): string[] {
  if (!p) return [];
  if (p.type === "status") return (p.status?.options ?? []).map(o => o.name).filter(Boolean);
  if (p.type === "select") return (p.select?.options ?? []).map(o => o.name).filter(Boolean);
  return [];
}

function pickBestStatusName(status: string | null | undefined, p?: NotionProperty | null): string | null {
  if (!status) return null;
  const options = getStatusOrSelectOptionNames(p);

  const english = mapStatusNameEnglish(status);
  if (options.length === 0) return english ?? status;
  if (english && options.includes(english)) return english;

  const candidates: Record<string, string[]> = {
    researching: ["未投递", "调研中", "Researching"],
    applied: ["エントリー済み", "已投递", "Applied", "Entry Submitted"],
    briefing: ["说明会", "説明会", "Briefing"],
    es_preparing: ["简历筛选中", "ES准备中", "ES Preparing"],
    es_submitted: ["简历筛选中", "ES已提交", "ES Submitted"],
    document_screening: ["書類選考中", "简历筛选中", "Document Screening"],
    written_test: ["筆記試験", "笔试", "Written Test"],
    interview_1: ["一面", "Interview 1"],
    interview_2: ["二面", "Interview 2"],
    interview_3: ["三次面接", "三面", "Interview 3"],
    interview_4: ["四次面接", "Interview 4"],
    interview_final: ["终面", "最終面接", "Final Interview", "Interview Final"],
    offer: ["内定", "offer获得", "已拿offer", "Offer"],
    rejected: ["已拒绝", "未通过", "Rejected"],
    withdrawn: ["辞退", "已放弃", "已撤回", "Withdrawn"],
  };

  const list = candidates[status] ?? [status];
  for (const name of list) {
    if (options.includes(name)) return name;
  }
  if (options.includes(status)) return status;
  return english ?? status;
}

async function notionFetchJson<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${NOTION_API_BASE}${path}`, {
      ...init,
      headers: {
        ...notionHeaders(accessToken),
        ...(init?.headers ?? {}),
      },
    });
    const rawText = await res.text();

    // Notion may respond with 429 and plain text body: "Rate exceeded."
    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfterSec = Number(res.headers.get("retry-after") ?? "0");
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : attempt * 800;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Notion API error ${res.status}: ${rawText.slice(0, 300)}`);
    }

    try {
      return JSON.parse(rawText) as T;
    } catch {
      throw new Error(`Notion API returned non-JSON payload: ${rawText.slice(0, 300)}`);
    }
  }
  throw new Error("Notion API failed after retries");
}

export async function createNotionJobBoardFromTemplate(userId: number): Promise<{ databaseId: string; url: string }> {
  const token = await getOauthToken(userId, "notion");
  if (!token?.accessToken) throw new Error("Notion 未连接");

  const searchRes = await notionFetchJson<{
    results: Array<{ object: string; id: string }>;
  }>(`/search`, token.accessToken, {
    method: "POST",
    body: JSON.stringify({
      page_size: 10,
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
    }),
  });

  const parentPageId = searchRes.results?.find(r => r.object === "page")?.id;
  if (!parentPageId) {
    throw new Error("未找到可用于创建 Database 的 Notion 页面：请先在 Notion 里创建任意页面并分享给该集成");
  }

  const created = await notionFetchJson<{
    id: string;
    url: string;
  }>(`/databases`, token.accessToken, {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: "日本求职进度追踪" } }],
      properties: {
        公司名称: { title: {} },
        申请状态: {
          status: {
            options: [
              { name: "未投递", color: "gray" },
              { name: "エントリー済み", color: "blue" },
              { name: "说明会", color: "blue" },
              { name: "简历筛选中", color: "blue" },
              { name: "書類選考中", color: "blue" },
              { name: "笔试", color: "yellow" },
              { name: "筆記試験", color: "yellow" },
              { name: "一面", color: "orange" },
              { name: "二面", color: "orange" },
              { name: "三面", color: "orange" },
              { name: "三次面接", color: "orange" },
              { name: "四次面接", color: "orange" },
              { name: "终面", color: "purple" },
              { name: "内定", color: "green" },
              { name: "offer获得", color: "green" },
              { name: "已拒绝", color: "red" },
              { name: "辞退", color: "brown" },
              { name: "已放弃", color: "brown" },
            ],
          },
        },
        职位名称: { rich_text: {} },
        投递日期: { date: {} },
        下次跟进日期: { date: {} },
        优先级: {
          select: {
            options: [
              { name: "高", color: "red" },
              { name: "中", color: "yellow" },
              { name: "低", color: "gray" },
            ],
          },
        },
        联系方式: { email: {} },
        ExternalKey: { rich_text: {} },
        UserId: { number: { format: "number" } },
        EventType: {
          select: {
            options: [
              { name: "applied", color: "blue" },
              { name: "screening", color: "blue" },
              { name: "assessment", color: "yellow" },
              { name: "interview", color: "orange" },
              { name: "offer", color: "green" },
              { name: "rejection", color: "red" },
            ],
          },
        },
        EventAt: { date: {} },
        LastMailSubject: { rich_text: {} },
        Source: {
          select: {
            options: [
              { name: "gmail", color: "blue" },
              { name: "manual", color: "gray" },
              { name: "agent", color: "purple" },
            ],
          },
        },
      },
    }),
  });

  const database = await notionFetchJson<{
    properties: Record<string, any>;
  }>(`/databases/${created.id}`, token.accessToken, { method: "GET" });

  const statusProp = database.properties?.["申请状态"];
  const options: Array<{ id: string; name: string; color?: string }> = statusProp?.status?.options ?? [];
  const idByName = new Map(options.map(o => [o.name, o.id]));
  const groups = [
    { name: "To-do", color: "default", option_ids: ["未投递"].map(n => idByName.get(n)).filter(Boolean) },
    {
      name: "In progress",
      color: "default",
      option_ids: ["已投递", "简历筛选中", "笔试", "一面", "二面", "三面", "终面"]
        .map(n => idByName.get(n))
        .filter(Boolean),
    },
    { name: "Complete", color: "default", option_ids: ["offer获得", "已拒绝", "已放弃"].map(n => idByName.get(n)).filter(Boolean) },
  ];

  if (options.length > 0 && groups.every(g => g.option_ids.length > 0)) {
    await notionFetchJson(`/databases/${created.id}`, token.accessToken, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          申请状态: {
            status: {
              options,
              groups,
            },
          },
        },
      }),
    });
  }

  return { databaseId: created.id.replace(/-/g, ""), url: created.url };
}

const databaseSchemaCache = new Map<string, {
  propsMeta: Record<string, NotionProperty>;
  expiresAt: number;
}>();

async function getNotionDatabaseSchema(dbId: string, accessToken: string) {
  const now = Date.now();
  const cached = databaseSchemaCache.get(dbId);
  if (cached && cached.expiresAt > now) {
    return cached.propsMeta;
  }
  const database = await notionFetchJson<{
    properties: Record<string, NotionProperty>;
  }>(`/databases/${dbId}`, accessToken, { method: "GET" });
  
  const propsMeta = database.properties ?? {};
  databaseSchemaCache.set(dbId, {
    propsMeta,
    expiresAt: now + 5 * 60 * 1000, // Cache for 5 minutes
  });
  return propsMeta;
}

export async function syncJobToNotionBoard(input: SyncNotionJobInput): Promise<void> {
  const token = await getOauthToken(input.userId, "notion");
  if (!token?.accessToken) return;

  const scopeMeta: Record<string, unknown> =
    token.scope
      ? (() => {
          try {
            const parsed = JSON.parse(token.scope) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
            return {};
          } catch {
            return {};
          }
        })()
      : {};

  const perUserDbId = typeof scopeMeta.notionDatabaseId === "string" ? scopeMeta.notionDatabaseId.trim() : "";
  const fallbackDbId = (process.env.NOTION_JOB_BOARD_DATABASE_ID ?? "").trim();
  const dbId = perUserDbId || fallbackDbId;
  if (!dbId) return;

  const propsMeta = await getNotionDatabaseSchema(dbId, token.accessToken);

  const titleProp = findTitlePropertyName(propsMeta);
  if (!titleProp) throw new Error("Notion database missing title property");

  const externalKeyProp = findFirstPropertyName(
    propsMeta,
    ["ExternalKey", "外部键", "外部キー"],
    ["rich_text"]
  );
  const userIdProp = findFirstPropertyName(
    propsMeta,
    ["UserId", "用户ID", "ユーザーID"],
    ["number"]
  );
  const statusProp = findFirstPropertyName(
    propsMeta,
    ["Status", "状态", "進捗", "ステータス", "申请状态"],
    ["status", "select"]
  );
  const positionProp = findFirstPropertyName(
    propsMeta,
    ["Position", "职位名称", "ポジション"],
    ["rich_text"]
  );
  const nextActionProp = findFirstPropertyName(
    propsMeta,
    ["NextActionAt", "下次跟进日期", "次のフォロー日"],
    ["date"]
  );
  const eventProp = findFirstPropertyName(
    propsMeta,
    ["EventType", "事件类型", "イベント種別"],
    ["select", "rich_text"]
  );
  const scheduleProp = findFirstPropertyName(
    propsMeta,
    ["EventAt", "事件时间", "日程日時"],
    ["date", "rich_text"]
  );
  const subjectProp = findFirstPropertyName(
    propsMeta,
    ["LastMailSubject", "邮件主题", "メール件名"],
    ["rich_text"]
  );
  const sourceProp = findFirstPropertyName(
    propsMeta,
    ["Source", "来源", "ソース"],
    ["select", "rich_text"]
  );

  const externalKey = `careerpass:${input.userId}:${input.companyName}`;
  const titleValue = input.companyName;
  const statusName = pickBestStatusName(input.status ?? null, statusProp ? propsMeta[statusProp] : null);
  const nextActionDate = input.nextActionAt ? new Date(input.nextActionAt) : null;
  const eventAtText = input.eventDate
    ? `${input.eventDate}${input.eventTime ? ` ${input.eventTime}` : ""} JST`
    : null;

  const properties: Record<string, any> = {
    [titleProp]: {
      title: [{ text: { content: titleValue.slice(0, 180) } }],
    },
  };
  if (externalKeyProp) {
    properties[externalKeyProp] = {
      rich_text: [{ text: { content: externalKey } }],
    };
  }
  if (userIdProp) properties[userIdProp] = { number: input.userId };
  if (statusProp && statusName) {
    const t = propsMeta[statusProp]?.type;
    properties[statusProp] = t === "status" ? { status: { name: statusName } } : { select: { name: statusName } };
  }
  if (positionProp && input.position) {
    properties[positionProp] = { rich_text: [{ text: { content: input.position.slice(0, 180) } }] };
  }
  if (nextActionProp && nextActionDate && !Number.isNaN(+nextActionDate)) {
    properties[nextActionProp] = { date: { start: nextActionDate.toISOString() } };
  }
  if (eventProp && input.eventType) {
    const t = propsMeta[eventProp]?.type;
    properties[eventProp] = t === "select" ? { select: { name: input.eventType } } : { rich_text: [{ text: { content: input.eventType } }] };
  }
  if (scheduleProp && eventAtText) {
    const t = propsMeta[scheduleProp]?.type;
    properties[scheduleProp] = t === "date" ? { date: { start: `${input.eventDate}T${input.eventTime ?? "09:00"}:00+09:00` } } : { rich_text: [{ text: { content: eventAtText } }] };
  }
  if (subjectProp && input.mailSubject) {
    properties[subjectProp] = {
      rich_text: [{ text: { content: input.mailSubject.slice(0, 180) } }],
    };
  }
  if (sourceProp && input.source) {
    const t = propsMeta[sourceProp]?.type;
    properties[sourceProp] = t === "select" ? { select: { name: input.source } } : { rich_text: [{ text: { content: input.source } }] };
  }

  const filter = externalKeyProp
    ? { property: externalKeyProp, rich_text: { equals: externalKey } }
    : { property: titleProp, title: { equals: titleValue } };

  const queryRes = await notionFetchJson<{ results: Array<{ id: string }> }>(
    `/databases/${dbId}/query`,
    token.accessToken,
    { method: "POST", body: JSON.stringify({ page_size: 1, filter }) }
  );
  const existingId = queryRes.results?.[0]?.id;

  const writeWithRetry = async (body: Record<string, any>, pageId?: string) => {
    try {
      if (pageId) {
        await notionFetchJson(`/pages/${pageId}`, token.accessToken, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await notionFetchJson(`/pages`, token.accessToken, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
    } catch (e) {
      // Fallback: retry with only required minimal fields to avoid property-schema mismatch.
      const minimalProps: Record<string, any> = {
        [titleProp]: properties[titleProp],
      };
      if (externalKeyProp) minimalProps[externalKeyProp] = properties[externalKeyProp];
      if (userIdProp) minimalProps[userIdProp] = properties[userIdProp];
      if (pageId) {
        await notionFetchJson(`/pages/${pageId}`, token.accessToken, {
          method: "PATCH",
          body: JSON.stringify({ properties: minimalProps }),
        });
      } else {
        await notionFetchJson(`/pages`, token.accessToken, {
          method: "POST",
          body: JSON.stringify({
            parent: { database_id: dbId },
            properties: minimalProps,
          }),
        });
      }
      console.warn("[Notion] Fallback write used:", (e as Error).message);
    }
  };

  if (existingId) {
    await writeWithRetry({ properties }, existingId);
  } else {
    await writeWithRetry({
      parent: { database_id: dbId },
      properties,
    });
  }
}
