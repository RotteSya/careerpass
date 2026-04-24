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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import {
  BrainCircuit,
  BriefcaseBusiness,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogOut,
  MessageSquare,
  KeyRound,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import confetti from "canvas-confetti";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type JobApplication = RouterOutputs["jobs"]["list"][number];
type JobStatusEvent = RouterOutputs["jobs"]["listStatusEvents"][number];
type RecentCalendarEvent = RouterOutputs["calendar"]["listRecentAutoEvents"]["events"][number];

const navItems = [
  { icon: User, label: "个人中心", path: "/dashboard/profile" },
  { icon: Calendar, label: "カレンダー連携", path: "/dashboard/calendar" },
];

export default function Dashboard() {
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [currentPath, navigate] = useLocation();
  const pathOnly = currentPath.split("?")[0] ?? currentPath;
  const isCalendarPage = pathOnly === "/dashboard/calendar";
  const pageVisible = usePageVisible();
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [companyQuery, setCompanyQuery] = useState("");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const utils = trpc.useUtils();

  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = trpc.user.getProfile.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: calendarStatus, refetch: refetchCalendar } = trpc.calendar.getStatus.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );
  const {
    data: recentCalendarEvents,
    isLoading: recentCalendarEventsLoading,
    refetch: refetchRecentCalendarEvents,
  } = trpc.calendar.listRecentAutoEvents.useQuery(undefined, {
    enabled: isAuthenticated && isCalendarPage && !!calendarStatus?.google,
    retry: false,
  });

  const { data: telegramStatus } = trpc.telegram.getBindingStatus.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
      refetchInterval: (query) => {
        const bound = query.state.data?.bound;
        return isAuthenticated && pageVisible && !bound ? 5000 : false;
      },
    }
  );

  const { data: telegramDeepLink } = trpc.telegram.getDeepLink.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: googleAuthUrl } = trpc.calendar.getAuthUrl.useQuery(undefined, {
    enabled: isAuthenticated,
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
    onError: (err: unknown) => {
      toast.error(`更新失败: ${getErrorMessage(err)}`);
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
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });
  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation({
    onSuccess: async () => {
      toast.success("账号已删除");
      await utils.auth.me.invalidate();
      navigate("/login");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = trpc.jobs.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated && pageVisible && !isCalendarPage ? 10000 : false,
  });
  const {
    data: statusEvents = [],
    refetch: refetchStatusEvents,
  } = trpc.jobs.listStatusEvents.useQuery(
    { id: expandedJobId ?? 0 },
    { enabled: isAuthenticated && !!expandedJobId }
  );
  const updateProfileMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("提醒偏好已保存");
      refetchProfile();
    },
    onError: (err: unknown) => {
      toast.error(`保存失败: ${getErrorMessage(err)}`);
    },
  });

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
    if (!calendarResult) return;
    if (calendarResult === "success") {
      toast.success("カレンダー連携が完了しました！");
      refetchCalendar();
    } else if (calendarResult === "error") {
      const reason = params.get("reason") ?? "unknown";
      toast.error(`カレンダー連携に失敗しました: ${reason}`);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // One-time celebration when Telegram binding succeeds
  const prevBound = useRef(telegramStatus?.bound);
  useEffect(() => {
    if (prevBound.current === false && telegramStatus?.bound === true) {
      const end = Date.now() + 1500;
      const frame = () => {
        confetti({ particleCount: 40, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
        confetti({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
      toast.success("🎉 Telegram 绑定成功！");
    }
    prevBound.current = telegramStatus?.bound;
  }, [telegramStatus?.bound]);

  const filteredJobs = useMemo(() => {
    const normalized = (s?: string | null) => (s ?? "").toLowerCase();
    const q = normalized(companyQuery);
    return jobs
      .filter((job: JobApplication) => {
        if (!q) return true;
        const target = `${normalized(job.companyNameJa)} ${normalized(job.companyNameEn)}`;
        return target.includes(q);
      })
      .sort((a: JobApplication, b: JobApplication) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }, [jobs, companyQuery]);

  const activeJobCount = useMemo(() => {
    return jobs.filter((job: JobApplication) => !["offer", "rejected", "withdrawn"].includes(job.status)).length;
  }, [jobs]);

  const nudgeCategories = normalizeNudgeCategories(profile?.nudgeCategoriesEnabled);
  const notificationSchedule = profile?.notificationSchedule ?? "09:00-21:00";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const copyText = async (text: string) => {
    const t = (text ?? "").trim();
    if (!t) {
      toast.error("没有可复制的内容");
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
      toast.success("已复制");
    } catch {
      try {
        const el = document.createElement("textarea");
        el.value = t;
        el.style.position = "fixed";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        toast.success("已复制");
      } catch {
        toast.error("复制失败");
      }
    }
  };

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
          <AccountMenu
            user={user}
            profile={profile}
            onChangePassword={() => setPasswordDialogOpen(true)}
            onDeleteAccount={() => setDeleteDialogOpen(true)}
            onLogout={logout}
          />
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
          <AccountMenu
            user={user}
            profile={profile}
            onChangePassword={() => setPasswordDialogOpen(true)}
            onDeleteAccount={() => setDeleteDialogOpen(true)}
            onLogout={logout}
            compact
          />
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
                      onClick={() => disconnectCalendar.mutate()}
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

              {calendarStatus?.google ? (
                <div className="mt-6 rounded-xl border border-border bg-secondary/10 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <p className="text-sm font-semibold">最近自动写入的日程</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        点击“一键复制备注”可直接复制优化后的日程备注内容用于分享（不包含邮件正文）
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-transparent"
                      onClick={() => refetchRecentCalendarEvents()}
                      disabled={recentCalendarEventsLoading}
                    >
                      {recentCalendarEventsLoading ? "刷新中..." : "刷新"}
                    </Button>
                  </div>

                  {recentCalendarEventsLoading ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">读取中...</div>
                  ) : (recentCalendarEvents?.events?.length ?? 0) === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      暂无可复制的自动日程。后续有新邮件触发写入后，这里会显示最近的事件。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recentCalendarEvents!.events.slice(0, 10).map((e: RecentCalendarEvent) => (
                        <div
                          key={e.id}
                          className="rounded-lg border border-border bg-background/60 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{e.summary || "（无标题）"}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {e.start ? new Date(e.start).toLocaleString() : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-transparent"
                              onClick={() => copyText(e.description)}
                              disabled={!e.description}
                            >
                              一键复制备注
                            </Button>
                            {e.htmlLink ? (
                              <a
                                href={e.htmlLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center h-8 px-3 rounded-md border border-border bg-transparent text-xs font-medium hover:bg-secondary"
                              >
                                打开
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
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
                      <CheckCircle2 className="w-3.5 h-3.5" /> 已绑定
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

            {!telegramStatus?.bound && (
              <>
            <div className="mb-4">
              <p className="text-xs text-muted-foreground">Telegram 绑定详情</p>
            </div>

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
              </>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <BriefcaseBusiness className="w-5 h-5 text-primary" />
                  求职进度列表
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  帮你留意每家公司的选考进度，点击公司可查看状态历史。
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                企業数: {jobs.length} / 進行中: {activeJobCount}
              </div>
            </div>

            <Input
              value={companyQuery}
              onChange={(e) => setCompanyQuery(e.target.value)}
              placeholder="搜索公司（中文/日文/英文）"
              className="w-full sm:max-w-md"
            />

            <div className="mt-4 divide-y divide-border rounded-xl border border-border overflow-hidden">
              {jobsLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">読み込み中...</div>
              ) : filteredJobs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  暂无求职记录。绑定邮箱后，新的求职邮件会自动整理到这里。
                </div>
              ) : (
                filteredJobs.map((job: JobApplication) => {
                  const expanded = expandedJobId === job.id;
                  return (
                    <div key={job.id} className="bg-background/50">
                      <button
                        type="button"
                        onClick={() => setExpandedJobId(expanded ? null : job.id)}
                        className="w-full px-4 py-3 text-left hover:bg-secondary/50 transition-colors"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">{job.companyNameJa}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {[job.companyNameEn, job.position].filter(Boolean).join(" · ") || "职位未填写"}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold status-${job.status}`}>
                              {statusLabel(job.status)}
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDateTime(job.updatedAt)}
                            </span>
                          </div>
                        </div>
                      </button>

                      {expanded ? (
                        <div className="px-4 pb-4">
                          <div className="rounded-lg border border-border bg-card p-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                              <p className="text-sm font-medium">状态历史</p>
                              <select
                                value={job.status}
                                onChange={(e) => {
                                  const status = e.target.value as JobStatusValue;
                                  updateJobStatusMutation.mutate({ id: job.id, status });
                                }}
                                className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                              >
                                {JOB_STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {statusEvents.length === 0 ? (
                              <p className="py-3 text-sm text-muted-foreground">还没有状态变更记录。</p>
                            ) : (
                              <div className="space-y-2">
                                {statusEvents.map((event: JobStatusEvent) => (
                                  <div key={event.id} className="flex items-start justify-between gap-3 text-sm">
                                    <div className="min-w-0">
                                      <p className="font-medium">
                                        {event.prevStatus ? `${statusLabel(event.prevStatus)} → ` : ""}
                                        {statusLabel(event.nextStatus)}
                                      </p>
                                      {event.reason || event.mailSubject ? (
                                        <p className="text-xs text-muted-foreground truncate">
                                          {event.reason ?? event.mailSubject}
                                        </p>
                                      ) : null}
                                    </div>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                      {formatDateTime(event.createdAt)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-5">
              <h2 className="text-lg font-bold">通知偏好</h2>
              <p className="text-sm text-muted-foreground mt-1">
                设置贴身求职秘书通过 Telegram 主动提醒你的时间和类别。
              </p>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label>安静时段</Label>
                <Select
                  value={notificationSchedule}
                  onValueChange={(value) => {
                    updateProfileMutation.mutate({ notificationSchedule: value });
                  }}
                  disabled={updateProfileMutation.isPending}
                >
                  <SelectTrigger className="w-full sm:max-w-xs">
                    <SelectValue placeholder="选择提醒时间" />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTIFICATION_SCHEDULE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label>提醒类别</Label>
                {NUDGE_CATEGORY_OPTIONS.map((category) => (
                  <div
                    key={category.value}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{category.label}</p>
                      <p className="text-xs text-muted-foreground">{category.description}</p>
                    </div>
                    <Switch
                      checked={nudgeCategories[category.value]}
                      disabled={updateProfileMutation.isPending}
                      onCheckedChange={(checked) => {
                        updateProfileMutation.mutate({
                          nudgeCategoriesEnabled: {
                            ...nudgeCategories,
                            [category.value]: checked,
                          },
                        });
                      }}
                    />
                  </div>
                ))}
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

function AccountMenu({
  user,
  profile,
  onChangePassword,
  onDeleteAccount,
  onLogout,
  compact = false,
}: {
  user: RouterOutputs["auth"]["me"];
  profile?: RouterOutputs["user"]["getProfile"];
  onChangePassword: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
  compact?: boolean;
}) {
  const avatar = (
    <Avatar className="w-8 h-8 border border-border">
      <AvatarFallback className="text-xs font-medium bg-primary/15 text-primary">
        {(user?.name?.trim()?.[0] ?? "U").toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {avatar}
          </button>
        ) : (
          <button className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-secondary transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {avatar}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name ?? "ユーザー"}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email ?? ""}</p>
            </div>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} side={compact ? undefined : "top"} sideOffset={compact ? 8 : undefined} className="w-72">
        <DropdownMenuLabel className="pb-1">账号信息</DropdownMenuLabel>
        <div className="px-2 pb-2 space-y-1 text-xs text-muted-foreground">
          <p className="truncate">姓名：{profile?.name ?? user?.name ?? "-"}</p>
          <p className="truncate">邮箱：{profile?.email ?? user?.email ?? "-"}</p>
          <p className="truncate">学历：{educationLabel(profile?.education)}</p>
          <p className="truncate">语言：{langLabel(profile?.preferredLanguage)}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onChangePassword} className="cursor-pointer">
          <KeyRound className="w-4 h-4" />
          修改密码
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDeleteAccount} variant="destructive" className="cursor-pointer">
          <Trash2 className="w-4 h-4" />
          删除账号
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onLogout} className="cursor-pointer">
          <LogOut className="w-4 h-4" />
          ログアウト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function langLabel(lang?: string | null) {
  const map: Record<string, string> = { ja: "日本語", zh: "中文", en: "English" };
  return lang ? (map[lang] ?? lang) : "-";
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "未知错误";
}

function usePageVisible() {
  const [visible, setVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });

  useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return visible;
}

const JOB_STATUS_OPTIONS = [
  { value: "researching", label: "调研中" },
  { value: "applied", label: "エントリー済み" },
  { value: "briefing", label: "说明会" },
  { value: "es_preparing", label: "ES准备中" },
  { value: "es_submitted", label: "ES已提交" },
  { value: "document_screening", label: "書類選考中" },
  { value: "written_test", label: "筆記試験" },
  { value: "interview_1", label: "一面" },
  { value: "interview_2", label: "二面" },
  { value: "interview_3", label: "三次面接" },
  { value: "interview_4", label: "四次面接" },
  { value: "interview_final", label: "终面" },
  { value: "offer", label: "内定" },
  { value: "rejected", label: "未通过" },
  { value: "withdrawn", label: "辞退" },
] as const;

type JobStatusValue = (typeof JOB_STATUS_OPTIONS)[number]["value"];

const NOTIFICATION_SCHEDULE_OPTIONS = [
  { value: "09:00-21:00", label: "09:00-21:00" },
  { value: "08:00-20:00", label: "08:00-20:00" },
  { value: "10:00-22:00", label: "10:00-22:00" },
  { value: "07:00-23:00", label: "07:00-23:00" },
] as const;

const NUDGE_CATEGORY_OPTIONS = [
  { value: "status_suggestion", label: "状态建议", description: "发现邮件里可能有新的选考进度时提醒你确认。" },
  { value: "time_nudge", label: "时间提醒", description: "临近需要行动的时间点时轻轻提醒。" },
  { value: "inactivity", label: "停滞提醒", description: "某家公司太久没有进展时帮你留意。" },
  { value: "deadline_warning", label: "截止提醒", description: "ES、说明会或面试截止前提醒你。" },
  { value: "follow_up", label: "跟进提醒", description: "面试或关键沟通后提醒你补充跟进。" },
] as const;

type NudgeCategoryValue = (typeof NUDGE_CATEGORY_OPTIONS)[number]["value"];

function normalizeNudgeCategories(value: unknown): Record<NudgeCategoryValue, boolean> {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return NUDGE_CATEGORY_OPTIONS.reduce((acc, category) => {
    acc[category.value] = raw[category.value] !== false;
    return acc;
  }, {} as Record<NudgeCategoryValue, boolean>);
}

function formatDateTime(value?: string | Date | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status?: string | null): string {
  if (!status) return "-";
  const map: Record<string, string> = {
    researching: "调研中",
    applied: "エントリー済み",
    briefing: "说明会",
    es_preparing: "ES准备中",
    es_submitted: "ES已提交",
    document_screening: "書類選考中",
    written_test: "筆記試験",
    interview_1: "一面",
    interview_2: "二面",
    interview_3: "三次面接",
    interview_4: "四次面接",
    interview_final: "终面",
    offer: "内定",
    rejected: "未通过",
    withdrawn: "辞退",
  };
  return map[status] ?? status;
}
