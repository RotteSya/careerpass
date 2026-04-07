import { getOauthToken } from "./db";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

type NotionProperty = {
  type: string;
};

type SyncNotionJobInput = {
  userId: number;
  companyName: string;
  status?: string | null;
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

function mapStatusName(status?: string | null): string | null {
  const m: Record<string, string> = {
    researching: "Researching",
    es_preparing: "ES Preparing",
    es_submitted: "ES Submitted",
    interview_1: "Interview 1",
    interview_2: "Interview 2",
    interview_final: "Final Interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
  };
  if (!status) return null;
  return m[status] ?? status;
}

async function notionFetchJson<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      ...notionHeaders(accessToken),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error ${res.status}: ${err}`);
  }
  return (await res.json()) as T;
}

export async function syncJobToNotionBoard(input: SyncNotionJobInput): Promise<void> {
  const dbId = (process.env.NOTION_JOB_BOARD_DATABASE_ID ?? "").trim();
  if (!dbId) return;

  const token = await getOauthToken(input.userId, "notion");
  if (!token?.accessToken) return;

  const database = await notionFetchJson<{
    properties: Record<string, NotionProperty>;
  }>(`/databases/${dbId}`, token.accessToken, { method: "GET" });

  const propsMeta = database.properties ?? {};
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
    ["Status", "状态", "進捗", "ステータス"],
    ["status", "select"]
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
  const statusName = mapStatusName(input.status);
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
