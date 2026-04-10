import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  KeyRound,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";

const navItems = [
  { icon: User, label: "个人中心", path: "/dashboard/profile" },
  { icon: Calendar, label: "カレンダー連携", path: "/dashboard/calendar" },
];

export default function Dashboard() {
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [currentPath, navigate] = useLocation();
  const pathOnly = currentPath.split("?")[0] ?? currentPath;
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [companyQuery, setCompanyQuery] = useState("");
  const [notionGuideOpen, setNotionGuideOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [notionDatabaseIdOrUrl, setNotionDatabaseIdOrUrl] = useState("");
  const [showManualNotionBind, setShowManualNotionBind] = useState(false);
  const utils = trpc.useUtils();

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
  const { data: notionStatus, refetch: refetchNotionStatus } = trpc.notion.getStatus.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: notionAuthUrl } = trpc.notion.getAuthUrl.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const disconnectNotion = trpc.notion.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Notion 連携を解除しました");
      refetchNotionStatus();
    },
  });
  const setNotionBoardDatabase = trpc.notion.setBoardDatabase.useMutation({
    onSuccess: () => {
      toast.success("Notion 看板已绑定");
      setNotionDatabaseIdOrUrl("");
      refetchNotionStatus();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });
  const createNotionBoardFromTemplate = trpc.notion.createBoardFromTemplate.useMutation({
    onSuccess: (res: any) => {
      toast.success("Notion 看板已创建并绑定");
      setShowManualNotionBind(false);
      refetchNotionStatus();
      if (res?.url) window.open(res.url, "_blank", "noopener,noreferrer");
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

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
    onError: (err: any) => {
      toast.error(`更新失败: ${err.message}`);
    },
  });
  const changePasswordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密码已修改");
      setPasswordDialogOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });
  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation({
    onSuccess: async () => {
      toast.success("账号已删除");
      await utils.auth.me.invalidate();
      navigate("/login");
    },
    onError: (err: any) => {
      toast.error(err.message);
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
    if (!loading && isAuthenticated && pathOnly === "/dashboard") {
      navigate("/dashboard/profile");
    }
  }, [loading, isAuthenticated, pathOnly]);

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
    const notionResult = params.get("notion");
    if (!calendarResult && !notionResult) return;
    if (calendarResult) {
      if (calendarResult === "success") {
        toast.success("カレンダー連携が完了しました！");
        refetchCalendar();
      } else if (calendarResult === "error") {
        const reason = params.get("reason") ?? "unknown";
        toast.error(`カレンダー連携に失敗しました: ${reason}`);
      }
    }
    if (notionResult) {
      if (notionResult === "success") {
        toast.success("Notion 連携が完了しました！");
        refetchNotionStatus();
      } else if (notionResult === "error") {
        const reason = params.get("reason") ?? "unknown";
        toast.error(`Notion 連携に失敗しました: ${reason}`);
      }
    }
    // Remove query params from URL without triggering navigation
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    // When Notion OAuth URL fetch fails, show a direct configuration hint.
    if (notionAuthUrl === undefined) return;
  }, [isAuthenticated, notionAuthUrl]);

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
      .map((job: any) => {
      const companyJa = normalized(job.companyNameJa);
      const companyEn = normalized(job.companyNameEn);
      const companyMatch = (text: string) => {
        const t = normalized(text);
        return (!!companyJa && t.includes(companyJa)) || (!!companyEn && t.includes(companyEn));
      };
      const recon = reconMemories
        .filter((m: any) => companyMatch(`${m.title}\n${m.content}`))
        .sort((a: any, b: any) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
      const es = esMemories
        .filter((m: any) => companyMatch(`${m.title}\n${m.content}`))
        .sort((a: any, b: any) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
      const interview = interviewMemories
        .filter((m: any) => companyMatch(`${m.title}\n${m.content}`))
        .sort((a: any, b: any) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
      return { job, recon, es, interview };
    })
      .filter((card: any) => {
        if (!q) return true;
        const target = `${normalized(card.job.companyNameJa)} ${normalized((card.job as { companyNameEn?: string | null }).companyNameEn)}`;
        return target.includes(q);
      })
      .sort((a: any, b: any) => +new Date(b.job.updatedAt) - +new Date(a.job.updatedAt));
  }, [jobs, reconMemories, esMemories, interviewMemories, companyQuery]);

  const columns = useMemo(() => {
    const todo = boardCards.filter((c: any) => ["researching"].includes(c.job.status));
    const inProgress = boardCards.filter((c: any) =>
      ["applied", "es_preparing", "es_submitted", "interview_1", "interview_2", "interview_final"].includes(
        c.job.status
      )
    );
    const complete = boardCards.filter((c: any) => ["offer", "rejected", "withdrawn"].includes(c.job.status));
    return { todo, inProgress, complete };
  }, [boardCards]);

  const selectedCard = boardCards.find((c: any) => c.job.id === selectedJobId) ?? null;
  const isCalendarPage = pathOnly === "/dashboard/calendar";

  useEffect(() => {
    if (!isAuthenticated) return;
    if (selectedJobId != null) return;
    if (boardCards.length === 0) return;
    setSelectedJobId(boardCards[0].job.id);
  }, [isAuthenticated, selectedJobId, boardCards]);

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
                pathOnly === item.path
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-secondary transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="w-8 h-8 border border-border">
                  <AvatarFallback className="text-xs font-medium bg-primary/15 text-primary">
                    {(user?.name?.trim()?.[0] ?? "U").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.name ?? "ユーザー"}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email ?? ""}</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-72">
              <DropdownMenuLabel className="pb-1">账号信息</DropdownMenuLabel>
              <div className="px-2 pb-2 space-y-1 text-xs text-muted-foreground">
                <p className="truncate">姓名：{profile?.name ?? user?.name ?? "-"}</p>
                <p className="truncate">邮箱：{profile?.email ?? user?.email ?? "-"}</p>
                <p className="truncate">学历：{educationLabel(profile?.education)}</p>
                <p className="truncate">语言：{langLabel(profile?.preferredLanguage)}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPasswordDialogOpen(true)} className="cursor-pointer">
                <KeyRound className="w-4 h-4" />
                修改密码
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} variant="destructive" className="cursor-pointer">
                <Trash2 className="w-4 h-4" />
                删除账号
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="cursor-pointer">
                <LogOut className="w-4 h-4" />
                ログアウト
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="w-8 h-8 border border-border">
                  <AvatarFallback className="text-xs font-medium bg-primary/15 text-primary">
                    {(user?.name?.trim()?.[0] ?? "U").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-72">
              <DropdownMenuLabel className="pb-1">账号信息</DropdownMenuLabel>
              <div className="px-2 pb-2 space-y-1 text-xs text-muted-foreground">
                <p className="truncate">姓名：{profile?.name ?? user?.name ?? "-"}</p>
                <p className="truncate">邮箱：{profile?.email ?? user?.email ?? "-"}</p>
                <p className="truncate">学历：{educationLabel(profile?.education)}</p>
                <p className="truncate">语言：{langLabel(profile?.preferredLanguage)}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPasswordDialogOpen(true)} className="cursor-pointer">
                <KeyRound className="w-4 h-4" />
                修改密码
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} variant="destructive" className="cursor-pointer">
                <Trash2 className="w-4 h-4" />
                删除账号
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="cursor-pointer">
                <LogOut className="w-4 h-4" />
                ログアウト
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

          {isCalendarPage && (
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
          )}

          {!isCalendarPage && (
            <>
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
                  {telegramStatus?.bound ? (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 連携済
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#2AABEE]/15 text-[#2AABEE] border border-[#2AABEE]/30">
                      可用
                    </span>
                  )}
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
                  日本求职进度追踪
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  与 Notion 模板保持一致的动态看板（状态/字段按模板同步）
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                企業数: {jobs.length} / 進行中: {columns.todo.length + columns.inProgress.length}
              </div>
            </div>

            <div className="mb-4 p-4 rounded-xl border border-border bg-secondary/20">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Notion 动态看板同步</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    将邮件识别和状态更新自动同步到 Notion Database
                    {notionStatus?.workspaceName ? `（${notionStatus.workspaceName}）` : ""}
                  </p>
                  {!notionStatus?.databaseConfigured && (
                    <p className="text-xs text-amber-400 mt-1">
                      尚未创建/绑定你的 Notion 看板：点击“一键创建”将按模板自动创建并绑定。
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-transparent"
                    onClick={() => setNotionGuideOpen(true)}
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" />
                    使用指南
                  </Button>
                  {notionStatus?.connected ? (
                    <>
                      <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                        已连接
                      </span>
                      {!notionStatus?.databaseConfigured ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-transparent"
                          onClick={() => {
                            if (notionStatus?.databaseUrl) window.open(notionStatus.databaseUrl, "_blank", "noopener,noreferrer");
                          }}
                          disabled={!notionStatus?.databaseUrl}
                        >
                          打开看板
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-transparent text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => disconnectNotion.mutate()}
                        disabled={disconnectNotion.isPending}
                      >
                        断开
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        if (notionAuthUrl?.url) {
                          window.location.href = notionAuthUrl.url;
                          return;
                        }
                        toast.error("Notion OAuth 未正确配置，请检查 NOTION_CLIENT_ID");
                      }}
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      连接 Notion
                    </Button>
                  )}
                </div>
              </div>
              {notionStatus?.connected && !notionStatus?.databaseConfigured ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      size="sm"
                      onClick={() => createNotionBoardFromTemplate.mutate()}
                      disabled={createNotionBoardFromTemplate.isPending}
                      className="bg-[var(--color-notion-blue)] hover:bg-[var(--color-notion-blue-active)] text-white"
                    >
                      {createNotionBoardFromTemplate.isPending ? "创建中..." : "一键创建 Notion 看板"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-transparent"
                      onClick={() => setShowManualNotionBind((v) => !v)}
                    >
                      {showManualNotionBind ? "收起手动绑定" : "已有看板？手动绑定"}
                    </Button>
                  </div>
                  {showManualNotionBind ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={notionDatabaseIdOrUrl}
                        onChange={(e) => setNotionDatabaseIdOrUrl(e.target.value)}
                        placeholder="粘贴 Notion Database 链接或 database_id"
                        className="bg-background"
                      />
                      <Button
                        size="sm"
                        onClick={() => setNotionBoardDatabase.mutate({ databaseIdOrUrl: notionDatabaseIdOrUrl })}
                        disabled={setNotionBoardDatabase.isPending || !notionDatabaseIdOrUrl.trim()}
                      >
                        {setNotionBoardDatabase.isPending ? "绑定中..." : "绑定"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : notionStatus?.connected && notionStatus?.databaseId ? (
                <div className="mt-3 text-xs text-muted-foreground">已绑定 Database: {notionStatus.databaseId}</div>
              ) : null}
            </div>

            <Dialog open={notionGuideOpen} onOpenChange={setNotionGuideOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Notion 看板使用指南</DialogTitle>
                  <DialogDescription>按模板一键创建/绑定，看板与系统状态自动同步</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 text-sm text-muted-foreground">
                  <div className="space-y-2">
                    <p className="font-medium text-foreground">快速开始</p>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">
                          1
                        </span>
                        <span>先点击「连接 Notion」完成授权（只需要一次）。</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">
                          2
                        </span>
                        <span>点击「一键创建 Notion 看板」，系统会按模板创建「日本求职进度追踪」并自动绑定到你的账号。</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">
                          3
                        </span>
                        <span>之后邮件识别、网页改状态、Agent 更新都会同步到该 Notion Database。</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="font-medium text-foreground">常见问题</p>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-secondary text-muted-foreground text-xs flex items-center justify-center shrink-0 mt-0.5">
                          Q
                        </span>
                        <span>
                          如果提示“未找到可用于创建 Database 的 Notion 页面”，请在 Notion 新建任意页面并分享给本集成（Share → Invite →
                          选择该 Integration），然后再点一次「一键创建」。
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-secondary text-muted-foreground text-xs flex items-center justify-center shrink-0 mt-0.5">
                          Q
                        </span>
                        <span>如果你已经有自己的看板，用「已有看板？手动绑定」粘贴 Database 链接或 database_id 绑定即可。</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="font-medium text-foreground">同步内容</p>
                    <div className="text-xs leading-relaxed">
                      公司名称、申请状态（To-do / In progress / Complete）、职位名称、下次跟进日期，以及邮件识别的事件类型/时间/来源等会写入到你的
                      Notion Database（字段名按模板匹配）。你可以在 Notion 里自由补充信息，不影响同步。
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setNotionGuideOpen(false)}>
                    关闭
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded-full border border-border bg-secondary/20 text-muted-foreground">
                  To-do {columns.todo.length}
                </span>
                <span className="px-2 py-1 rounded-full border border-border bg-secondary/20 text-muted-foreground">
                  In progress {columns.inProgress.length}
                </span>
                <span className="px-2 py-1 rounded-full border border-border bg-secondary/20 text-muted-foreground">
                  Complete {columns.complete.length}
                </span>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-black/10 bg-white text-[rgba(0,0,0,0.95)] shadow-[0_1px_3px_rgba(0,0,0,0.01),0_3px_7px_rgba(0,0,0,0.02),0_7px_15px_rgba(0,0,0,0.02),0_14px_28px_rgba(0,0,0,0.04),0_23px_52px_rgba(0,0,0,0.05)]">
              <div className="px-6 pt-6 pb-4 border-b border-black/10">
                <div className="flex flex-col gap-1">
                  <p className="text-[22px] font-bold tracking-[-0.25px]">日本求职进度追踪（动态看板）</p>
                  <p className="text-[14px] text-[var(--color-warm-gray-500)]">
                    视图与 Notion 模板一致，按 To-do / In progress / Complete 分组展示
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                    <span className="px-2 py-1 rounded-full border border-black/10 bg-[var(--color-warm-white)] text-[var(--color-warm-gray-500)]">
                      企業数 {jobs.length}
                    </span>
                    <span className="px-2 py-1 rounded-full border border-black/10 bg-[var(--color-warm-white)] text-[var(--color-warm-gray-500)]">
                      進行中 {columns.todo.length + columns.inProgress.length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <input
                    value={companyQuery}
                    onChange={(e) => setCompanyQuery(e.target.value)}
                    placeholder="搜索公司（中文/日文/英文）"
                    className="w-full sm:max-w-md h-10 rounded-[4px] border border-black/10 bg-white px-3 text-[14px] text-[rgba(0,0,0,0.95)] outline-none focus:ring-2 focus:ring-[#097fe8]/30"
                  />
                  {telegramDeepLink?.deepLink ? (
                    <a
                      href={telegramDeepLink.deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center h-10 px-4 rounded-[4px] bg-[var(--color-notion-blue)] hover:bg-[var(--color-notion-blue-active)] text-white text-[15px] font-semibold"
                    >
                      Telegram へ
                    </a>
                  ) : null}
                </div>

                <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
                  <div className="min-w-0">
                    {jobsLoading ? (
                      <div className="py-10 text-center text-[14px] text-[var(--color-warm-gray-500)]">読み込み中...</div>
                    ) : (
                      <div className="flex gap-3 overflow-x-auto pb-2">
                        <BoardColumn
                          title="待办"
                          subtitle="To-do"
                          count={columns.todo.length}
                          cards={columns.todo}
                          selectedJobId={selectedJobId}
                          onSelect={setSelectedJobId}
                        />
                        <BoardColumn
                          title="进行中"
                          subtitle="In progress"
                          count={columns.inProgress.length}
                          cards={columns.inProgress}
                          selectedJobId={selectedJobId}
                          onSelect={setSelectedJobId}
                        />
                        <BoardColumn
                          title="已完成"
                          subtitle="Complete"
                          count={columns.complete.length}
                          cards={columns.complete}
                          selectedJobId={selectedJobId}
                          onSelect={setSelectedJobId}
                        />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    {selectedCard ? (
                      <div className="rounded-xl border border-black/10 bg-white shadow-[0_4px_18px_rgba(0,0,0,0.04),0_2.025px_7.84688px_rgba(0,0,0,0.027),0_0.8px_2.925px_rgba(0,0,0,0.02),0_0.175px_1.04062px_rgba(0,0,0,0.01)] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[16px] font-semibold truncate">{selectedCard.job.companyNameJa}</p>
                            {selectedCard.job.companyNameEn ? (
                              <p className="text-[12px] text-[var(--color-warm-gray-500)] truncate">{selectedCard.job.companyNameEn}</p>
                            ) : null}
                          </div>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-1 text-[12px] font-semibold tracking-[0.125px] status-${selectedCard.job.status}`}
                          >
                            {statusLabel(selectedCard.job.status)}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <select
                            value={selectedCard.job.status}
                            onChange={(e) => {
                              const status = e.target.value as JobStatusValue;
                              updateJobStatusMutation.mutate({
                                id: selectedCard.job.id,
                                status,
                              });
                            }}
                            className="h-9 w-full rounded-[4px] border border-black/10 bg-white px-2 text-[14px] outline-none focus:ring-2 focus:ring-[#097fe8]/30"
                          >
                            {JOB_STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="mt-4 rounded-lg border border-black/10 bg-[var(--color-warm-white)] p-3 text-[14px]">
                          <div className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2">
                            <div className="text-[12px] text-[var(--color-warm-gray-500)]">公司名称</div>
                            <div className="min-w-0">
                              <div className="truncate">{selectedCard.job.companyNameJa}</div>
                              {selectedCard.job.companyNameEn ? (
                                <div className="text-[12px] text-[var(--color-warm-gray-500)] truncate">
                                  {selectedCard.job.companyNameEn}
                                </div>
                              ) : null}
                            </div>

                            <div className="text-[12px] text-[var(--color-warm-gray-500)]">申请状态</div>
                            <div className="truncate">{statusLabel(selectedCard.job.status)}</div>

                            <div className="text-[12px] text-[var(--color-warm-gray-500)]">职位名称</div>
                            <div className="truncate">{selectedCard.job.position ?? "—"}</div>

                            <div className="text-[12px] text-[var(--color-warm-gray-500)]">締切</div>
                            <div className="truncate">
                              {selectedCard.job.nextActionAt ? new Date(selectedCard.job.nextActionAt).toLocaleDateString() : "—"}
                            </div>

                            <div className="text-[12px] text-[var(--color-warm-gray-500)]">联系方式</div>
                            <div className="truncate">—</div>

                            <div className="text-[12px] text-[var(--color-warm-gray-500)]">优先级</div>
                            <div className="truncate">—</div>
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-black/10 bg-white p-3">
                          <p className="text-[12px] text-[var(--color-warm-gray-500)] mb-2 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> 更新记录
                          </p>
                          {statusEvents.length === 0 ? (
                            <p className="text-[12px] text-[var(--color-warm-gray-300)]">暂无</p>
                          ) : (
                            <div className="space-y-2">
                              {statusEvents.slice(0, 8).map((e: any) => (
                                <div key={e.id} className="text-[12px]">
                                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-[var(--color-warm-gray-300)]">
                                    <span>{e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}</span>
                                    <span>{e.source ?? ""}</span>
                                    <span>{(e.prevStatus ?? "-") + " → " + (e.nextStatus ?? "-")}</span>
                                  </div>
                                  {e.mailSubject ? (
                                    <div className="mt-0.5 text-[rgba(0,0,0,0.95)]">
                                      {String(e.mailSubject).slice(0, 120)}
                                    </div>
                                  ) : null}
                                  {e.mailFrom ? (
                                    <div className="text-[var(--color-warm-gray-500)]">{String(e.mailFrom).slice(0, 120)}</div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
            </>
          )}

        </div>
      </main>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>请输入当前密码和新密码（至少8位）。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="当前密码"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <Input
              type="password"
              placeholder="新密码"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Input
              type="password"
              placeholder="确认新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (!currentPassword || !newPassword || !confirmPassword) {
                  toast.error("请填写完整");
                  return;
                }
                if (newPassword.length < 8) {
                  toast.error("新密码至少8位");
                  return;
                }
                if (newPassword !== confirmPassword) {
                  toast.error("两次输入的新密码不一致");
                  return;
                }
                changePasswordMutation.mutate({
                  currentPassword,
                  newPassword,
                });
              }}
              disabled={changePasswordMutation.isPending}
            >
              {changePasswordMutation.isPending ? "提交中..." : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除账号</DialogTitle>
            <DialogDescription>
              此操作不可恢复，将删除你的账号及相关数据。请输入密码确认。
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="请输入当前密码"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deletePassword) {
                  toast.error("请输入密码");
                  return;
                }
                deleteAccountMutation.mutate({ password: deletePassword });
              }}
              disabled={deleteAccountMutation.isPending}
            >
              {deleteAccountMutation.isPending ? "删除中..." : "确认删除账号"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    position?: string | null;
    status: string;
    nextActionAt?: string | Date | null;
    updatedAt: string | Date;
  };
  recon?: { content: string } | undefined;
  es?: { content: string } | undefined;
  interview?: { content: string } | undefined;
};

const JOB_STATUS_OPTIONS = [
  { value: "researching", label: "调研中" },
  { value: "applied", label: "已投递" },
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
  selectedJobId: number | null;
  onSelect: (id: number) => void;
}) {
  const { title, subtitle, count, cards, selectedJobId, onSelect } = props;
  return (
    <div className="min-w-[260px] w-[260px] rounded-xl border border-black/10 bg-[var(--color-warm-white)] p-3">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold truncate">{title}</p>
          <p className="text-[12px] text-[var(--color-warm-gray-500)]">{subtitle}</p>
        </div>
        <span className="text-[12px] px-2 py-0.5 rounded-full bg-white border border-black/10 text-[var(--color-warm-gray-500)]">
          {count}
        </span>
      </div>
      <div className="space-y-2">
        {cards.length === 0 ? (
          <div className="text-[12px] text-[var(--color-warm-gray-300)] py-6 text-center">暂无</div>
        ) : (
          cards.map((c) => {
            const selected = c.job.id === selectedJobId;
            return (
              <button
                key={c.job.id}
                onClick={() => onSelect(c.job.id)}
                className={`w-full text-left p-3 rounded-xl border bg-white transition-shadow ${
                  selected
                    ? "border-[#097fe8] shadow-[0_0_0_2px_rgba(9,127,232,0.15)]"
                    : "border-black/10 shadow-[0_4px_18px_rgba(0,0,0,0.04),0_2.025px_7.84688px_rgba(0,0,0,0.027),0_0.8px_2.925px_rgba(0,0,0,0.02),0_0.175px_1.04062px_rgba(0,0,0,0.01)] hover:shadow-[0_6px_22px_rgba(0,0,0,0.045),0_2.5px_9px_rgba(0,0,0,0.03),0_1px_3.5px_rgba(0,0,0,0.02)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold truncate">{c.job.companyNameJa}</p>
                    <p className="text-[12px] text-[var(--color-warm-gray-500)] mt-0.5">
                      {[
                        c.job.position,
                        c.job.updatedAt ? new Date(c.job.updatedAt).toLocaleDateString() : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-1 text-[12px] font-semibold tracking-[0.125px] status-${c.job.status}`}>
                    {statusLabel(c.job.status)}
                  </span>
                </div>
              </button>
            );
          })
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
