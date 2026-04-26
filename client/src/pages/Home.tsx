import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  BellRing,
  BrainCircuit,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MailSearch,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useLocation } from "wouter";

const assistantActions = [
  {
    time: "08:40",
    title: "Gmailから面接日程を検知",
    body: "株式会社Aの一次面接をカレンダーに仮登録。返信が必要な候補日もまとめました。",
    tone: "blue",
  },
  {
    time: "12:15",
    title: "3日止まっている選考を確認",
    body: "株式会社Bは応募後72時間動きなし。今日送れる確認文を用意しています。",
    tone: "orange",
  },
  {
    time: "20:30",
    title: "明日の準備をリマインド",
    body: "面接前に見るべき企業メモ、想定質問、逆質問をTelegramに届けます。",
    tone: "green",
  },
];

const strengths = [
  {
    icon: MailSearch,
    title: "メールを見逃さない",
    text: "説明会、面接、締切、合否連絡を検知し、次に必要な行動へつなげます。",
  },
  {
    icon: BellRing,
    title: "必要な時に声をかける",
    text: "期限前、面接前、停滞時など、就活の不安が大きくなる瞬間を先回りします。",
  },
  {
    icon: MessageCircle,
    title: "Telegramで伴走する",
    text: "ダッシュボードを開かなくても、日々の確認と相談をいつものチャットで進められます。",
  },
];

const workflow = [
  "Gmailとカレンダーを接続",
  "選考イベントを自動で整理",
  "今日やることを毎日提案",
  "停滞や準備漏れを先回り",
];

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const startPath = isAuthenticated ? "/dashboard" : "/signup";

  return (
    <div className="min-h-[100dvh] bg-[var(--color-warm-white)] text-foreground">
      <header className="border-b border-black/10 bg-white/92">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-3"
            aria-label="CareerPass home"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <BrainCircuit className="h-5 w-5 text-primary-foreground" />
            </span>
            <span className="text-left leading-tight">
              <span className="block text-[15px] font-semibold">就活パス</span>
              <span className="block text-[12px] text-[var(--color-warm-gray-500)]">CareerPass</span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            {!isAuthenticated && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
                ログイン
              </Button>
            )}
            <Button size="sm" onClick={() => navigate(startPath)}>
              {isAuthenticated ? "ダッシュボード" : "無料で始める"}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-black/10 bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-[1fr_460px] lg:items-center lg:py-18">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[var(--color-badge-blue-bg)] px-3 py-1 text-[12px] font-semibold text-[var(--color-focus-blue)]">
                <Sparkles className="h-3.5 w-3.5" />
                主動陪伴型の就活助理
              </div>
              <h1 className="mt-6 max-w-3xl text-[48px] font-black leading-[1.02] sm:text-[64px]">
                就活の不安に、先回りして声をかける。
              </h1>
              <p className="mt-5 max-w-[58ch] text-[17px] leading-8 text-[var(--color-warm-gray-500)]">
                CareerPassは、メール、予定、選考状況を見守りながら、今日やるべきことを提案するAI就活助理です。
                面接前も、返信待ちの時も、ひとりで抱え込ませません。
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={() => navigate(startPath)}>
                  {isAuthenticated ? "今日の進捗を見る" : "無料アカウントを作成"}
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => navigate("/login")}>
                  ログイン
                </Button>
              </div>

              <div className="mt-8 grid max-w-xl grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border border-black/10 bg-[var(--color-warm-white)] p-3">
                  <div className="text-[22px] font-bold">24h</div>
                  <div className="mt-1 text-[12px] text-[var(--color-warm-gray-500)]">常時見守り</div>
                </div>
                <div className="rounded-lg border border-black/10 bg-[var(--color-warm-white)] p-3">
                  <div className="text-[22px] font-bold">Gmail</div>
                  <div className="mt-1 text-[12px] text-[var(--color-warm-gray-500)]">自動検知</div>
                </div>
                <div className="rounded-lg border border-black/10 bg-[var(--color-warm-white)] p-3">
                  <div className="text-[22px] font-bold">Telegram</div>
                  <div className="mt-1 text-[12px] text-[var(--color-warm-gray-500)]">毎日伴走</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-black/10 bg-[var(--color-warm-white)] p-4 shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2px_8px]">
              <div className="rounded-md border border-black/10 bg-white">
                <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
                      <BrainCircuit className="h-4 w-4 text-white" />
                    </span>
                    <div>
                      <p className="text-[13px] font-semibold">今日の助理メモ</p>
                      <p className="text-[12px] text-[var(--color-warm-gray-500)]">4月26日 進捗チェック</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-[#eaf8ee] px-2 py-1 text-[12px] font-semibold text-[#168a30]">
                    稼働中
                  </span>
                </div>

                <div className="space-y-3 p-4">
                  {assistantActions.map((item) => (
                    <div key={item.title} className="rounded-md border border-black/10 bg-white p-3">
                      <div className="flex items-start gap-3">
                        <span
                          className={
                            item.tone === "blue"
                              ? "mt-1 h-2.5 w-2.5 rounded-full bg-[var(--color-notion-blue)]"
                              : item.tone === "orange"
                                ? "mt-1 h-2.5 w-2.5 rounded-full bg-[#dd5b00]"
                                : "mt-1 h-2.5 w-2.5 rounded-full bg-[#1aae39]"
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[14px] font-semibold">{item.title}</p>
                            <span className="shrink-0 text-[12px] text-[var(--color-warm-gray-300)]">{item.time}</span>
                          </div>
                          <p className="mt-1 text-[13px] leading-6 text-[var(--color-warm-gray-500)]">{item.body}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-black/10 bg-[var(--color-badge-blue-bg)] px-4 py-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--color-focus-blue)]">
                    <Clock3 className="h-4 w-4" />
                    次の通知: 明日 09:00 面接準備チェック
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-4 md:grid-cols-3">
            {strengths.map((item) => (
              <div key={item.title} className="rounded-lg border border-black/10 bg-white p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-black/10 bg-[var(--color-badge-blue-bg)]">
                  <item.icon className="h-5 w-5 text-[var(--color-notion-blue)]" />
                </div>
                <h2 className="mt-5 text-[20px] font-bold">{item.title}</h2>
                <p className="mt-3 text-[15px] leading-7 text-[var(--color-warm-gray-500)]">{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-black/10 bg-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-[360px_1fr] lg:items-start">
            <div>
              <h2 className="text-[34px] font-black leading-tight">登録した後、助理が毎日動きます。</h2>
              <p className="mt-4 text-[15px] leading-7 text-[var(--color-warm-gray-500)]">
                自分から管理画面を見に行く前に、CareerPassが変化を拾い、必要なタイミングで知らせます。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {workflow.map((item, index) => (
                <div key={item} className="flex items-center gap-3 rounded-lg border border-black/10 bg-[var(--color-warm-white)] p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-[13px] font-bold text-[var(--color-notion-blue)]">
                    {index + 1}
                  </span>
                  <span className="text-[15px] font-semibold">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="flex flex-col gap-6 rounded-lg border border-black/10 bg-[#20201f] p-6 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#a6ddff]">
                <ShieldCheck className="h-4 w-4" />
                メール本文は必要な範囲だけ扱い、予定には本文を保存しません
              </div>
              <h2 className="mt-3 text-[28px] font-black leading-tight">就活を、ひとりの作業から毎日の伴走へ。</h2>
            </div>
            <Button size="lg" onClick={() => navigate(startPath)}>
              始める
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
