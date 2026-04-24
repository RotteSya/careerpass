# 邮件识别系统代码审查（2026-04-24）

审查对象：careerpass 项目中与"邮件抓取 → 解析 → 分类识别"相关的核心模块。

覆盖文件：

| 文件 | 行数 | 核心职责 |
| --- | --- | --- |
| `server/mailNlpPipeline.ts` | 642 | 混合规则 + LLM 的邮件分类主流程 |
| `server/mailNer.ts` | 637 | 实体抽取：公司名、日期/时间、地点、面试轮数、域名信誉、负向信号 |
| `server/companyName.ts` | 105 | 公司名 NFKC 归一 / 法人前后缀剥离 / 变体映射 |
| `server/cleanQuotedText.ts` | 30 | 删除 `>` 引用块与 `On ... wrote:` 分隔线 |
| `server/forwardedMail.ts` | 79 | 转发邮件原始头与正文还原 |
| `server/gmail_dedup.ts` | 27 | 按 `messageId` 排序与公司级批量去重 |
| `server/_core/mailText.ts` | 40 | 邮件文本长度限制（默认 20k/22k） |

下文按 **性能 / 可维护性 / 边界情况** 三个维度列出所有问题，末尾给出值得保留的设计与优化优先级。

---

## 一、性能问题

### P1. 重复构造 RegExp（`mailNer.ts:390, 439`）

```ts
const regex = new RegExp(dp.re.source, dp.re.flags);
```

`NER_DATE_PATTERNS` / `NER_RELATIVE_DATE_PATTERNS` 已经是模块级常量，每封邮件都从 `source` 重新编译是热路径浪费。只需要在使用前复位 `lastIndex`。

### P2. 动态拼接法人名正则（`mailNer.ts:117, 121`）

`extractLegal` 内部用 `LEGAL_ENTITY_PREFIX.source` 字符串插值 `new RegExp(...)`。`extractOrgCandidates` 每封邮件会调用它 4 次（sender、subject、from、body），等于 8 个动态正则每次重新编译。

### P3. 冗余的 `toLowerCase()`（`mailNlpPipeline.ts:314`）

```ts
const lowerText = text.toLowerCase();
```

下游使用 `lowerText` 的正则绝大多数都带 `/i` flag（`JOB_PLATFORM_HINTS`、`PROCESS_HINTS`、`PLATFORM_*_HINTS`、`NEGATIVE_SIGNALS`…），多出的字符串复制毫无意义（≤22k 字符两份）。

### P4. 同一段文本被串行扫描 40+ 次

对同一封邮件：

- `runRecruitingNlpPipeline` 先跑 ~15 个 hard-negative 判定正则；
- `evaluateAllRules` 再扫 7 条 `EVENT_RULES`；
- `applyCoOccurrenceBoosts` 对每个命中信号再跑 `CO_OCCURRENCE_RULES.length × 2` 轮 test；
- 第 507 / 512-521 / 547 行又各自做独立的 hardOutcome / isResultNotificationSubject / override:entry_receipt 扫描；
- `calculateNegativeSignalPenalty` 再跑 9 条；

且这些模式**存在大量重叠**（例："見送り/不採用" 至少在 `EVENT_RULES`、`hardOutcome`、`CO_OCCURRENCE_RULES`、`isResultNotificationSubject` 四处出现）。应合并成一次遍历，将所有命中落到一个 `features` 集合里。

### P5. 邮件正文被重复 slice（`mailNer.ts:78, 308`）

`extractBestCompanyName` 里已 `limitMailBody(body)` 一次，调到 `extractOrgCandidates` 又 slice 一次，同一 20k 字符串拷贝两遍。

### P6. `recipientNames` 子串匹配 O(N·L)（`mailNer.ts:87, 290`）

```ts
recipientNames.some(n => c === n || (c.includes(n) && c.length - n.length <= 4))
```

若收件人列表较大或姓名很短（单汉字），会在每个候选上反复扫。应预编译成 alternation 正则，或按长度/精确匹配前缀表。

### P7. `body fallback` 对出现多次的 `株式会社` 重复走重型过滤（`mailNer.ts:200`）

`addCandidate` 内部包含多个正则调用；一封营销邮件里 `株式会社` 出现 10+ 次时，每次都走一整轮。

---

## 二、可维护性问题

### M1. 同义关键词在 4+ 处重复定义

以 **rejection** 为例：

- `EVENT_RULES[0].pattern`（line 115）
- `CO_OCCURRENCE_RULES[7]`（line 196）
- `hardOutcome` 分支（line 512-514）
- `isResultNotificationSubject`（line 507）
- `NEGATIVE_SIGNALS`（部分）

改一处要同步改四处，**必然遗漏**。应由单一关键词表驱动。

### M2. 魔法数字遍地

置信度 `0.97 / 0.92 / 0.90 / 0.86 / 0.82`、规则权重 `0.45 / 0.30`、域名倍率 `0.7 + 0.3·score`、skipLlm 门槛 `0.90 / 0.92`、负信号门槛 `-0.6 / -0.4`……无命名常量、无注释说明分档依据。

### M3. 事件类型决策链写成嵌套 if-else（`mailNlpPipeline.ts:523-551`）

优先级 `hardOutcome > isResultNotificationSubject > llmEventType > rule.eventType > entry_receipt override` 用嵌套 if 表达，下次维护极易破坏优先级。应改为优先级数组 + `find`。

### M4. `mergedCompany` `??` 链表达与注释不符（`mailNlpPipeline.ts:586-589`）

```ts
const mergedCompany =
  (nerCompany.confidence >= 0.70 ? nerCompany.name : null) ??
  llmCompany ??
  (nerCompany.name);
```

当 NER 置信度 <0.70 时：第一项 null → `llmCompany` → 回退到**同一个低置信度 `nerCompany.name`**。既不是注释说的 "NER > LLM > rule"，也没有 "rule-extracted" 第三来源，极具迷惑性。

### M5. `preferTest / preferDeadline` 仅在 `!llmDecision` 分支生效（`mailNlpPipeline.ts:467-491`）

subject 中的测试/截止线索理论上和 LLM 决策无关，不应因"有 LLM 返回"就不做 tiebreak。看起来是历史遗留。

### M6. `_meta: any` 破坏类型安全

`MailDecisionLike._meta?: any`，`RecruitingNlpDecision._meta` 又附加 `[key: string]: any`。既然内部能枚举字段，不该用 `any`。

### M7. 函数内反赋值参数

`mailNer.ts:78`、`extractTimeCandidates:384` 等直接覆盖入参。阅读时后续引用会被误解为调用方原值。

### M8. 域名集合四处重复

- `PLATFORM_DOMAINS`（`mailNer.ts:30`）
- `RECRUITING_PLATFORM_DOMAINS`（`mailNer.ts:575`）—— 与上者高度重叠
- `NOISE_PLATFORM_DOMAINS`（`mailNer.ts:570`）
- `BLOCKED_COMPANY_TOKENS`（`companyName.ts:20`）—— 平台关键词又混进去一份
- `JOB_PLATFORM_HINTS`（`mailNlpPipeline.ts:79`）—— 平台名正则版

添加新平台要改四处。

### M9. `defaultTodo` 中英日文案混杂

日文邮件识别出的 todo 写成中文（"确认面试时间和形式"），未见本地化策略。

### M10. `cleanQuotedText.ts` 明确承认"aggressive"

注释 "It's a bit aggressive to drop the rest" 但未降级 / 未配置化。

### M11. 命名不一致

`MailDecisionLike` vs `RecruitingNlpInput`；`FREE_MAIL_DOMAINS_NER` 带 `_NER` 后缀暗示有非 NER 版，实际没有。

### M12. `gmail.ts` 1818 行

识别逻辑还有一部分在其中（hardOutcome 注释显示 "extracted from gmail.ts"），模块过重、职责混杂。

---

## 三、边界情况问题

### E1. 转发检测仅看 `fwd:` 前缀（`forwardedMail.ts:31`）

漏掉：

- 日文 `転送:`、中文 `转发:`；
- subject 未加前缀但正文为 Gmail 标准 `---------- Forwarded message ----------`；
- 嵌套多层转发（只解析第一个 `From:`）。

### E2. 日期解析依赖 `new Date(raw)`（`forwardedMail.ts:17`）

日文 "2026年4月24日 10:00" → `Invalid Date`。

### E3. 日文 "wrote:" 分隔未覆盖（`cleanQuotedText.ts:18`）

日文客户端写的是 "… が書きました:" 而非 "wrote:"，Outlook/Thunderbird 日文版无效。

### E4. 年份回卷启发式多种错况（`mailNer.ts:402-406`）

```ts
if (candidate < today - 7) year += 1;
```

- 查看 6 个月前的历史邮件，"5月20日" 会被分配到明年；
- 1 月收到写着 "12月15日" 的确认函，被误判为今年 12 月（实际去年 12 月）；
- 完全依赖 `new Date()` 本地时区，**没有 JST**，服务器在 UTC 时 `todayStr` 整日偏移。

### E5. `ORG_TRAILING_PERSON_TOKEN` 会吃掉真名（`mailNer.ts:91-97`）

```ts
const ORG_TRAILING_PERSON_TOKEN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,4}$/u;
```

"株式会社 タナカ" 中 "タナカ" 可能就是公司名，会被当人名剥掉。

### E6. 域名 SLD 提取错误（`mailNer.ts:253`）

`fullDomain.split(".")[0]` 对 `careers.example.com` 返回 "careers"（无意义的子域）。应取 eTLD+1 的最左段。

### E7. `${name}様` 否决全部候选（`mailNer.ts:344-346`）

多源投票后的最佳候选，只要 body 中出现一次 "CompanyName様"（可能是用户名与公司名近似），整个结果被丢弃。过于激进。

### E8. `extractBestDateTime` 无未来时退回 `candidates[0]`

正文里的"上次我们在 3月1日聊过"等引用日期可能被加到日历。结合 E4 的年份回卷，会污染日历。

### E9. `detectInterviewRound` 存在死代码（`mailNer.ts:541-552`）

第 549 行 `最終 && 面接|選考` 在 544 行已先命中 `最終面接|最終選考` 时无法走到。

### E10. `companyName.ts:53` 贪婪 `.*` 吃掉中间点（`/・.*(コース|職|採用|応募|選考)$/`）

"株式会社A・B・C コース" → "株式会社A"，丢失真名中的中间点。

### E11. `gmail_dedup.ts` null key 全部放行

```ts
if (!companyKey) return true;
```

所有抽取失败的邮件都会通过去重，可能批量重复。

### E12. 平台新闻判定可被简单绕过（`mailNlpPipeline.ts:369`）

仅凭 subject 含 `一次面接|最終面接|書類選考|合否` 就被视为"非 newsletter"。营销邮件 "面接突破のコツ" 含 "面接"（但不在排除列表）等仍可能走到分类器。

### E13. `EVENT_DATE_CONTEXT` 时间窗口僵硬（60 字符后文）

邮件用换行排版时可能截断；前面若有无关数字（"p.10:30"），可能抓错。

### E14. 邮件正文截断策略有偏（`_core/mailText.ts`）

`slice(0, 20000)` 从开头截；多重转发+引用的邮件，真正的结论（"書類選考結果" / "内定" 等）常在尾部，截断后丢失强信号。

### E15. `safeParseDate` 本地化陷阱

`new Date()` 对非 ISO 字符串的 locale 行为未定义，结果不稳定。

### E16. `skipLlm` 门槛基于虚高置信度（`mailNlpPipeline.ts:562-568, 605-619`）

`mergedConfidence` 经 `domainMultiplier`（corporate_jp 最高 1.0）放大后，单一 rule 命中就容易越过 0.92，错失 LLM 纠错机会。

### E17. `MAX_MAIL_BODY_CHARS = 20000` 对长转发链不够

多重转发 + 原始引用可能超 20k，且截断发生在开头保留策略，更雪上加霜（见 E14）。

---

## 四、值得表扬

1. **多信号并行评分 + 特异度 tiebreak**（`EVENT_RULES` + `evaluateAllRules` + `pickBestRuleSignal`）——避免了 first-match-wins 的脆弱性。
2. **硬结果优先**：offer / rejection 压过 LLM 与其他规则，业务上最不能被误判的两类被保护。
3. **多源投票 + 来源加成**（`extractBestCompanyName`）——正则抽取公司名天然适合投票。
4. **平台发件人隔离策略**（`mailNer.ts:134, 210, 239`）——recruiting_platform 域名时禁用 body 法人抽取 / display_name / SLD，防止把"被推广的公司"误当作发件方。
5. **maekabu/atokabu 双向抽取**——处理了 "株式会社X" 与 "X株式会社" 两种词序。
6. **域名信誉分层** 清晰可扩展（corporate_jp / corporate / recruiting_platform / noise_platform / free_mail / unknown）。
7. **NFKC 归一 + CJK 标点剥离**（`companyName.ts`）——对 CJK 文本有敏感度。
8. **事件上下文置信度加权**（`extractTimeCandidates` 的 50 字符 context window + `EVENT_DATE_CONTEXT`）——符合 NER 最佳实践。
9. **LLM 跳过逻辑**（虽需收紧，见 E16）——成本意识好。
10. **`_meta` 调试字段保留** ruleSignals / negPenalty / domainReputation / hardOutcome 便于事后复盘。
11. **文本长度常量中央化**（`MAX_MAIL_BODY_CHARS`）。
12. **测试覆盖扎实**：12+ 测试文件，1500+ 行，含平台促销、override、面试轮数等边界。

---

## 五、优化优先级（按性价比）

| # | 任务 | 主要收益 | 对应问题 |
| --- | --- | --- | --- |
| 1 | 统一关键词特征扫描器（单次遍历累积 features） | 性能 + 可维护性 | P3, P4, M1 |
| 2 | 抽出 domain/keyword/threshold 配置模块 | 可维护性 | M2, M8 |
| 3 | 修复 `mergedCompany` `??` 链 | 可维护性 / 正确性 | M4 |
| 4 | `extractBestDateTime` 加 JST 时区 + 日期范围护栏 | 正确性 | E4, E8 |
| 5 | 扩展 `forwardedMail` 检测 | 召回率 | E1, E2 |
| 6 | 正文截断保留头尾 | 召回率 | E14, E17 |

其余问题（E5/E6/E7/E9/E10/E11/E12/E13/E15/E16、M5-M7、M9-M12、P1/P2/P5-P7）留待后续迭代，或在前 6 项实施过程中顺带处理。

---

## 六、实施记录

本次迭代完成以上 1~6 项。详见提交记录。
