import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  BrainCircuit,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  LogOut,
  Mail,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  Send,
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";

const navItems = [
  { icon: User, label: "プロフィール", labelZh: "个人资料", path: "/dashboard" },
  { icon: MessageSquare, label: "AIチャット", labelZh: "AI对话", path: "/dashboard/chat" },
  { icon: FileText, label: "ES生成", labelZh: "ES生成", path: "/dashboard/es" },
  { icon: Mic, label: "模擬面接", labelZh: "模拟面试", path: "/dashboard/interview" },
  { icon: Send, label: "就活管理", labelZh: "求职管理", path: "/dashboard/jobs" },
];

export default function Dashboard() {
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [, navigate] = useLocation();

  const { data: profile, refetch: refetchProfile } = trpc.user.getProfile.useQuery(undefined, {
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

  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryQueryInput, setMemoryQueryInput] = useState("");

  const monitorEmails = trpc.agent.monitorEmails.useMutation({
    onSuccess: (result) => {
      if (result.detected === 0) {
        toast.info(`${result.scanned}件のメールをスキャン。就活関連メールは見つかりませんでした。`);
      } else {
        toast.success(
          `${result.detected}件の就活メールを検出！カレンダーに${result.calendarEvents}件登録しました。`
        );
      }
    },
    onError: () => toast.error("メール監視に失敗しました。Googleカレンダーと連携してください。"),
  });

  const { data: memoryResults, refetch: searchMemory, isFetching: isSearching } =
    trpc.agent.searchMemory.useQuery(
      { query: memoryQuery, topK: 5 },
      { enabled: isAuthenticated && memoryQuery.length > 0 }
    );

  const disconnectCalendar = trpc.calendar.disconnect.useMutation({
    onSuccess: () => {
      toast.success("連携を解除しました");
      refetchCalendar();
    },
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/");
    if (!loading && isAuthenticated && profile && !profile.profileCompleted) navigate("/register");
  }, [loading, isAuthenticated, profile]);

  // Poll Telegram binding status every 5s after page load
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      refetchTelegram();
    }, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

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
                location.pathname === item.path
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

          {/* Quick Actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {navItems.slice(1).map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-card/80 transition-all text-left group"
              >
                <item.icon className="w-5 h-5 text-primary mb-2 group-hover:scale-110 transition-transform" />
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.labelZh}</p>
              </button>
            ))}
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

              {/* Outlook Calendar */}
              <div className="p-4 rounded-xl border border-border bg-secondary/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white">
                        <path d="M7 4C5.34 4 4 5.34 4 7v10c0 1.66 1.34 3 3 3h10c1.66 0 3-1.34 3-3V7c0-1.66-1.34-3-3-3H7zm0 2h10c.55 0 1 .45 1 1v1H6V7c0-.55.45-1 1-1zm-1 4h12v7c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-7z"/>
                      </svg>
                    </div>
                    <span className="font-medium text-sm">Outlook Calendar</span>
                  </div>
                  {calendarStatus?.outlook ? (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 連携済
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <XCircle className="w-3.5 h-3.5" /> 未連携
                    </span>
                  )}
                </div>
                {calendarStatus?.outlook ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-transparent text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => disconnectCalendar.mutate({ provider: "outlook" })}
                    disabled={disconnectCalendar.isPending}
                  >
                    連携解除
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => outlookAuthUrl && (window.location.href = outlookAuthUrl.url)}
                    disabled={!outlookAuthUrl}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Outlook と連携する
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Module 2: Telegram Binding */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-5">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                Telegram 専属顧問との連携
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                就活パス専属顧問と接続して、AI就活サポートを開始しましょう
              </p>
            </div>

            {telegramStatus?.bound ? (
              <div className="flex items-center gap-4 p-4 rounded-xl border border-green-500/30 bg-green-500/10">
                <CheckCircle2 className="w-8 h-8 text-green-400 shrink-0" />
                <div>
                  <p className="font-medium text-green-300">Telegram 連携済み</p>
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
                      就活パス専属顧問を追加する
                    </p>
                    <p className="text-xs text-muted-foreground">
                      QRコードをスキャンするか、下のボタンをタップして
                      CareerpassBot を追加してください
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

          {/* Module 3: Email Monitor */}
          {calendarStatus?.google && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <Mail className="w-5 h-5 text-primary" />
                    メール自動監視
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Gmailをスキャンして面接・説明会メールをカレンダーに自動登録します
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => monitorEmails.mutate()}
                  disabled={monitorEmails.isPending}
                  className="gap-2"
                >
                  {monitorEmails.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {monitorEmails.isPending ? "スキャン中..." : "今すぐスキャン"}
                </Button>
                {monitorEmails.data && (
                  <p className="text-sm text-muted-foreground">
                    最終スキャン: {monitorEmails.data.scanned}件確認 /{" "}
                    {monitorEmails.data.detected}件検出 /{" "}
                    {monitorEmails.data.calendarEvents}件登録
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Module 4: Memory Search */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-primary" />
                記憶ライブラリ検索
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                AIが蓄積した履歴書・企業レポート・ESを検索できます
              </p>
            </div>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={memoryQueryInput}
                onChange={(e) => setMemoryQueryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && memoryQueryInput.trim()) {
                    setMemoryQuery(memoryQueryInput.trim());
                  }
                }}
                placeholder="例: トヨタ 企業レポート / 自己PR / 面接"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-secondary/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                size="sm"
                onClick={() => memoryQueryInput.trim() && setMemoryQuery(memoryQueryInput.trim())}
                disabled={isSearching}
                className="gap-1.5"
              >
                {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                検索
              </Button>
            </div>
            {memoryResults && memoryQuery && (
              <div className="space-y-2">
                {memoryResults.results.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">該当する記憶が見つかりませんでした</p>
                ) : (
                  memoryResults.results.map((item, i) => (
                    <div key={i} className="p-3 rounded-lg border border-border bg-secondary/20 hover:border-primary/30 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2 px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          {memoryTypeLabel(item.memoryType)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{item.content.slice(0, 120)}...</p>
                    </div>
                  ))
                )}
                <p className="text-xs text-muted-foreground text-right">
                  記憶ライブラリ合計: {memoryResults.total}件
                </p>
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

function memoryTypeLabel(type?: string | null) {
  const map: Record<string, string> = {
    resume: "履歴書",
    company_report: "企業レポート",
    conversation: "会話",
    es_draft: "ES下書き",
    interview_log: "面接ログ",
  };
  return type ? (map[type] ?? type) : "";
}
