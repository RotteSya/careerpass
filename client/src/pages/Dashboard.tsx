import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  BrainCircuit,
  BriefcaseBusiness,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  LogOut,
  MessageSquare,
  Mic,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";

const navItems = [
  { icon: User, label: "プロフィール", labelZh: "个人资料", path: "/dashboard" },
];

export default function Dashboard() {
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [currentPath, navigate] = useLocation();
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [companyQuery, setCompanyQuery] = useState("");

  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = trpc.user.getProfile.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: calendarStatus, refetch: refetchCalendar } = trpc.calendar.getStatus.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const { data: telegramStatus, refetch: refetchTelegram } = trpc.telegram.getBindingStatus.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const { data: telegramDeepLink } = trpc.telegram.getDeepLink.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: googleAuthUrl } = trpc.calendar.getAuthUrl.useQuery(
    { provider: "google", origin: typeof window !== "undefined" ? window.location.origin : "" },
    { enabled: isAuthenticated }
  );

  const { data: outlookAuthUrl } = trpc.calendar.getAuthUrl.useQuery(
    { provider: "outlook", origin: typeof window !== "undefined" ? window.location.origin : "" },
    { enabled: isAuthenticated }
  );

  const disconnectCalendar = trpc.calendar.disconnect.useMutation({
    onSuccess: () => {
      toast.success("連携を解除しました");
      refetchCalendar();
    },
  });
  const updateJobStatusMutation = trpc.jobs.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("进度已更新");
      refetchJobs();
      refetchStatusEvents();
    },
    onError: (err) => {
      toast.error(`更新失败: ${err.message}`);
    },
  });

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = trpc.jobs.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const {
    data: statusEvents = [],
    refetch: refetchStatusEvents,
  } = trpc.jobs.listStatusEvents.useQuery(
    { id: selectedJobId ?? 0 },
    { enabled: isAuthenticated && !!selectedJobId }
  );
  const { data: reconMemories = [] } = trpc.memory.list.useQuery(
    { type: "company_report" },
    { enabled: isAuthenticated }
  );
  const { data: esMemories = [] } = trpc.memory.list.useQuery(
    { type: "es_draft" },
    { enabled: isAuthenticated }
  );
  const { data: interviewMemories = [] } = trpc.memory.list.useQuery(
    { type: "interview_log" },
    { enabled: isAuthenticated }
  );

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/");
    // Only redirect to /register when profile has fully loaded AND profileCompleted is false
    // profileLoading guard prevents race condition when navigating from /register
    if (!loading && isAuthenticated && !profileLoading && profile && !profile.profileCompleted) navigate("/register");
  }, [loading, isAuthenticated, profile, profileLoading]);

  // Detect ?calendar=success/error from server-side OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendarResult = params.get("calendar");
    if (!calendarResult) return;
    if (calendarResult === "success") {
      toast.success("カレンダー連携が完了しました！");
      refetchCalendar();
    } else if (calendarResult === "error") {
      const reason = params.get("reason") ?? "unknown";
      toast.error(`カレンダー連携に失敗しました: ${reason}`);
    }
    // Remove query params from URL without triggering navigation
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Poll Telegram binding status every 5s after page load
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      refetchTelegram();
    }, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      refetchJobs();
    }, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, refetchJobs]);

  const boardCards = useMemo(() => {
    const normalized = (s?: string | null) => (s ?? "").toLowerCase();
    const q = normalized(companyQuery);
    return jobs
      .map((job) => {
      const companyJa = normalized(job.companyNameJa);
      const companyEn = normalized(job.companyNameEn);
      const companyMatch = (text: string) => {
        const t = normalized(text);
        return (!!companyJa && t.includes(companyJa)) || (!!companyEn && t.includes(companyEn));
      };
      const recon = reconMemories
        .filter(m => companyMatch(`${m.title}\n${m.content}`))
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
      const es = esMemories
        .filter(m => companyMatch(`${m.title}\n${m.content}`))
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
      const interview = interviewMemories
        .filter(m => companyMatch(`${m.title}\n${m.content}`))
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
      return { job, recon, es, interview };
    })
      .filter((card) => {
        if (!q) return true;
        const target = `${normalized(card.job.companyNameJa)} ${normalized((card.job as { companyNameEn?: string | null }).companyNameEn)}`;
        return target.includes(q);
      })
      .sort((a, b) => +new Date(b.job.updatedAt) - +new Date(a.job.updatedAt));
  }, [jobs, reconMemories, esMemories, interviewMemories, companyQuery]);

  const columns = useMemo(() => {
    const inResearch = boardCards.filter(c => ["researching", "applied"].includes(c.job.status));
    const inES = boardCards.filter(c => ["es_preparing", "es_submitted"].includes(c.job.status));
    const inInterview = boardCards.filter(c =>
      ["interview_1", "interview_2", "interview_final"].includes(c.job.status)
    );
    const closed = boardCards.filter(c => ["offer", "rejected", "withdrawn"].includes(c.job.status));
    return { inResearch, inES, inInterview, closed };
  }, [boardCards]);

  const selectedCard = boardCards.find(c => c.job.id === selectedJobId) ?? null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-border bg-card/50 flex flex-col hidden md:flex">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BrainCircuit className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-sm">就活パス</p>
              <p className="text-xs text-muted-foreground">CareerPass</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                currentPath === item.path
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 px-3 py-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
              <User className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name ?? "ユーザー"}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email ?? ""}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={logout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            ログアウト
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card/50">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-6 h-6 text-primary" />
            <span className="font-bold">就活パス</span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 max-w-4xl mx-auto space-y-6">
          {/* Welcome */}
          <div>
            <h1 className="text-2xl font-bold">
              おかえりなさい、{profile?.name ?? user?.name ?? "ユーザー"}さん
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              就活の準備を続けましょう。AIエージェントがサポートします。
            </p>
          </div>

          {/* Module 1: Calendar OAuth */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  カレンダー連携
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  面接・説明会のメールを自動検知してカレンダーに登録します
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Google Calendar */}
              <div className="p-4 rounded-xl border border-border bg-secondary/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                      <svg viewBox="0 0 24 24" className="w-5 h-5">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    </div>
                    <span className="font-medium text-sm">Google Calendar</span>
                  </div>
                  {calendarStatus?.google ? (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 連携済
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <XCircle className="w-3.5 h-3.5" /> 未連携
                    </span>
                  )}
                </div>
                {calendarStatus?.google ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-transparent text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => disconnectCalendar.mutate({ provider: "google" })}
                    disabled={disconnectCalendar.isPending}
                  >
                    連携解除
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => googleAuthUrl && (window.location.href = googleAuthUrl.url)}
                    disabled={!googleAuthUrl}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Google と連携する
                  </Button>
                )}
              </div>

              {/* Outlook Calendar - Coming Soon */}
              <div className="p-4 rounded-xl border border-border bg-secondary/20 opacity-60">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white">
                        <path d="M7 4C5.34 4 4 5.34 4 7v10c0 1.66 1.34 3 3 3h10c1.66 0 3-1.34 3-3V7c0-1.66-1.34-3-3-3H7zm0 2h10c.55 0 1 .45 1 1v1H6V7c0-.55.45-1 1-1zm-1 4h12v7c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-7z"/>
                      </svg>
                    </div>
                    <span className="font-medium text-sm">Outlook Calendar</span>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-amber-400">
                    準備中
                  </span>
                </div>
                <Button size="sm" className="w-full" disabled>
                  近日公開予定
                </Button>
              </div>
            </div>
          </div>

          {/* Module 2: Chat Platform Binding */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-5">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                聊天机器人绑定
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                当前支持 Telegram。后续将陆续支持 LINE / WhatsApp / WeChat 等主流社交平台。
              </p>
            </div>

            <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl border border-border bg-secondary/20">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">Telegram</p>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#2AABEE]/15 text-[#2AABEE] border border-[#2AABEE]/30">
                    可用
                  </span>
                </div>
                <p className="text-xs text-muted-foreground min-h-[32px]">
                  当前主通道，支持扫码绑定和消息通知。
                </p>
                {telegramStatus?.bound ? (
                  <Button size="sm" className="w-full mt-3" variant="outline" disabled>
                    已绑定
                  </Button>
                ) : telegramDeepLink?.deepLink ? (
                  <a
                    href={telegramDeepLink.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 w-full mt-3 h-8 rounded-md bg-[#2AABEE] hover:bg-[#229ED9] text-white text-xs font-medium transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    去绑定
                  </a>
                ) : (
                  <Button size="sm" className="w-full mt-3" disabled>
                    加载中...
                  </Button>
                )}
              </div>

              <div className="p-4 rounded-xl border border-border bg-secondary/20 opacity-80">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">LINE</p>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    准备中
                  </span>
                </div>
                <p className="text-xs text-muted-foreground min-h-[32px]">
                  即将支持通过 LINE 接收提醒与对话。
                </p>
                <Button size="sm" className="w-full mt-3" disabled>
                  即将开放
                </Button>
              </div>

              <div className="p-4 rounded-xl border border-border bg-secondary/20 opacity-80">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">WhatsApp</p>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    准备中
                  </span>
                </div>
                <p className="text-xs text-muted-foreground min-h-[32px]">
                  即将支持通过 WhatsApp 接收提醒与对话。
                </p>
                <Button size="sm" className="w-full mt-3" disabled>
                  即将开放
                </Button>
              </div>

              <div className="p-4 rounded-xl border border-border bg-secondary/20 opacity-80">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">WeChat</p>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    准备中
                  </span>
                </div>
                <p className="text-xs text-muted-foreground min-h-[32px]">
                  即将支持通过 WeChat 接收提醒与对话。
                </p>
                <Button size="sm" className="w-full mt-3" disabled>
                  即将开放
                </Button>
              </div>
            </div>

            <div className="mb-4">
              <p className="text-xs text-muted-foreground">Telegram 绑定详情</p>
            </div>

            {telegramStatus?.bound ? (
              <div className="flex items-center gap-4 p-4 rounded-xl border border-green-500/30 bg-green-500/10">
                <CheckCircle2 className="w-8 h-8 text-green-400 shrink-0" />
                <div>
                  <p className="font-medium text-green-300">Telegram 已绑定</p>
                  <p className="text-sm text-muted-foreground">
                    @{telegramStatus.telegramUsername ?? telegramStatus.telegramId} と接続中
                  </p>
                  {telegramStatus.boundAt && (
                    <p className="text-xs text-muted-foreground">
                      連携日時: {new Date(telegramStatus.boundAt).toLocaleDateString("ja-JP")}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* QR Code */}
                <div className="shrink-0">
                  {telegramDeepLink?.deepLink ? (
                    <div className="p-3 bg-white rounded-xl">
                      <QRCodeSVG
                        value={telegramDeepLink.deepLink}
                        size={140}
                        level="M"
                        includeMargin={false}
                      />
                    </div>
                  ) : (
                    <div className="w-[164px] h-[164px] bg-secondary rounded-xl flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Instructions */}
                <div className="flex-1 space-y-4">
                  <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                    <p className="text-sm font-medium text-primary mb-1">
                      请先通过 Telegram 绑定就活パス专属顾问
                    </p>
                    <p className="text-xs text-muted-foreground">
                      先完成 Telegram 接入，后续平台（LINE / WhatsApp / WeChat）上线后会在这里开放绑定入口。
                    </p>
                  </div>

                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
                      <span>QRコードをスキャン、またはボタンをタップ</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
                      <span>Telegram で「START」をタップ</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">3</span>
                      <span>AIコーチが自動的に挨拶します</span>
                    </div>
                  </div>

                  {telegramDeepLink?.deepLink && (
                    <a
                      href={telegramDeepLink.deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#2AABEE] hover:bg-[#229ED9] text-white text-sm font-medium transition-colors"
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                      </svg>
                      Telegram で開く
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Module 3: Career Dashboard Board */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <BriefcaseBusiness className="w-5 h-5 text-primary" />
                  求職進捗ダッシュボード
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  企業調査・ES・面接準備の進み具合を1画面で確認できます
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                企業数: {jobs.length} / 進行中: {columns.inResearch.length + columns.inES.length + columns.inInterview.length}
              </div>
            </div>
            <div className="mb-4">
              <input
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                placeholder="搜索公司（中文/日文/英文）"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {jobsLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">読み込み中...</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <BoardColumn
                  title="企業情报"
                  subtitle="Research"
                  count={columns.inResearch.length}
                  cards={columns.inResearch}
                  onSelect={setSelectedJobId}
                />
                <BoardColumn
                  title="ES定制"
                  subtitle="Entry Sheet"
                  count={columns.inES.length}
                  cards={columns.inES}
                  onSelect={setSelectedJobId}
                />
                <BoardColumn
                  title="面试战备"
                  subtitle="Interview"
                  count={columns.inInterview.length}
                  cards={columns.inInterview}
                  onSelect={setSelectedJobId}
                />
                <BoardColumn
                  title="结果归档"
                  subtitle="Archive"
                  count={columns.closed.length}
                  cards={columns.closed}
                  onSelect={setSelectedJobId}
                />
              </div>
            )}

            {selectedCard && (
              <div className="mt-5 p-4 rounded-xl border border-border bg-secondary/20">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <p className="font-semibold">{selectedCard.job.companyNameJa}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-primary/15 text-primary">
                      {statusLabel(selectedCard.job.status)}
                    </span>
                    <select
                      value={selectedCard.job.status}
                      onChange={(e) => {
                        const status = e.target.value as JobStatusValue;
                        updateJobStatusMutation.mutate({
                          id: selectedCard.job.id,
                          status,
                        });
                      }}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                    >
                      {JOB_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {telegramDeepLink?.deepLink && (
                      <a
                        href={telegramDeepLink.deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-2 py-1 rounded-md border border-border hover:bg-background"
                      >
                        去 Telegram
                      </a>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> 企业深报
                    </p>
                    <p className="line-clamp-3">{selectedCard.recon?.content?.slice(0, 120) ?? "未生成"}</p>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" /> ES 草稿
                    </p>
                    <p className="line-clamp-3">{selectedCard.es?.content?.slice(0, 120) ?? "未生成"}</p>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Mic className="w-3.5 h-3.5" /> 面试日志
                    </p>
                    <p className="line-clamp-3">{selectedCard.interview?.content?.slice(0, 120) ?? "未生成"}</p>
                  </div>
                </div>
                <div className="mt-3 p-3 rounded-lg border border-border bg-card">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 更新记录
                  </p>
                  {statusEvents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无</p>
                  ) : (
                    <div className="space-y-2">
                      {statusEvents.slice(0, 5).map((e: any) => (
                        <div key={e.id} className="text-xs">
                          <div className="flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
                            <span>{e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}</span>
                            <span>{e.source ?? ""}</span>
                            <span>
                              {(e.prevStatus ?? "-") + " → " + (e.nextStatus ?? "-")}
                            </span>
                          </div>
                          {e.mailSubject ? (
                            <div className="mt-0.5 text-foreground">
                              {String(e.mailSubject).slice(0, 120)}
                            </div>
                          ) : null}
                          {e.mailFrom ? (
                            <div className="text-muted-foreground">
                              {String(e.mailFrom).slice(0, 120)}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile Summary */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              プロフィール
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              {[
                { label: "氏名", value: profile?.name ?? "-" },
                { label: "生年月日", value: profile?.birthDate ?? "-" },
                { label: "最終学歴", value: educationLabel(profile?.education) },
                { label: "大学名", value: profile?.universityName ?? "-" },
                { label: "メールアドレス", value: profile?.email ?? user?.email ?? "-" },
                { label: "言語設定", value: langLabel(profile?.preferredLanguage) },
              ].map((item, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="font-medium truncate">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}

function educationLabel(edu?: string | null) {
  const map: Record<string, string> = {
    high_school: "高校卒",
    associate: "短大・専門卒",
    bachelor: "大学卒",
    master: "大学院（修士）",
    doctor: "大学院（博士）",
    other: "その他",
  };
  return edu ? (map[edu] ?? edu) : "-";
}

function langLabel(lang?: string | null) {
  const map: Record<string, string> = { ja: "日本語", zh: "中文", en: "English" };
  return lang ? (map[lang] ?? lang) : "-";
}

type BoardCard = {
  job: {
    id: number;
    companyNameJa: string;
    companyNameEn?: string | null;
    status: string;
    updatedAt: string | Date;
  };
  recon?: { content: string } | undefined;
  es?: { content: string } | undefined;
  interview?: { content: string } | undefined;
};

const JOB_STATUS_OPTIONS = [
  { value: "researching", label: "调研中" },
  { value: "es_preparing", label: "ES准备中" },
  { value: "es_submitted", label: "ES已提交" },
  { value: "interview_1", label: "一面" },
  { value: "interview_2", label: "二面" },
  { value: "interview_final", label: "终面" },
  { value: "offer", label: "已拿offer" },
  { value: "rejected", label: "未通过" },
  { value: "withdrawn", label: "已撤回" },
] as const;

type JobStatusValue = (typeof JOB_STATUS_OPTIONS)[number]["value"];

function BoardColumn(props: {
  title: string;
  subtitle: string;
  count: number;
  cards: BoardCard[];
  onSelect: (id: number) => void;
}) {
  const { title, subtitle, count, cards, onSelect } = props;
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3 min-h-[220px]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-background border border-border">{count}</span>
      </div>
      <div className="space-y-2">
        {cards.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">暂无</div>
        ) : (
          cards.map((c) => (
            <button
              key={c.job.id}
              onClick={() => onSelect(c.job.id)}
              className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-card/80 transition-colors"
            >
              <p className="text-sm font-medium truncate">{c.job.companyNameJa}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{statusLabel(c.job.status)}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    researching: "调研中",
    applied: "已投递",
    es_preparing: "ES准备中",
    es_submitted: "ES已提交",
    interview_1: "一面",
    interview_2: "二面",
    interview_final: "终面",
    offer: "已拿到offer",
    rejected: "未通过",
    withdrawn: "已撤回",
  };
  return map[status] ?? status;
}
