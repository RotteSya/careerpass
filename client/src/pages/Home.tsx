import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import {
  BrainCircuit,
  Calendar,
  FileText,
  MessageSquare,
  Search,
  Sparkles,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

const features = [
  {
    icon: MessageSquare,
    title: "AI 就活コーチ",
    titleZh: "AI求职教练",
    desc: "STAR法則で経験を深掘り。あなただけの履歴書を自動生成します。",
  },
  {
    icon: Search,
    title: "企業深度偵察",
    titleZh: "企业深度侦察",
    desc: "OpenWork・就活会議の口コミを分析。企業の本当の姿を暴露します。",
  },
  {
    icon: FileText,
    title: "ES 自動生成",
    titleZh: "ES自动生成",
    desc: "企業の痛点に直撃する志望動機・自己PRを日本語で自動作成。",
  },
  {
    icon: BrainCircuit,
    title: "模擬面接",
    titleZh: "模拟面试",
    desc: "厳格な日本企業の面接官が深掘り質問で本番に備えさせます。",
  },
  {
    icon: Calendar,
    title: "日程自動管理",
    titleZh: "日程自动管理",
    desc: "面接メールを自動検知してカレンダーに登録。Telegramで通知します。",
  },
  {
    icon: Sparkles,
    title: "記憶ライブラリ",
    titleZh: "记忆库",
    desc: "全ての企業情報・ES・面接ログをAIが記憶し、次の就活に活かします。",
  },
];

const steps = [
  { step: "01", title: "アカウント登録", desc: "基本情報を入力して登録" },
  { step: "02", title: "Telegram 連携", desc: "専属ボットと接続" },
  { step: "03", title: "経験を深掘り", desc: "AIがSTAR法則で分析" },
  { step: "04", title: "内定獲得", desc: "ES・面接を完璧に準備" },
];

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const handleStart = () => {
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      window.location.href = getLoginUrl();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BrainCircuit className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">就活パス</span>
            <span className="text-muted-foreground text-sm hidden sm:block">CareerPass</span>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Button onClick={() => navigate("/dashboard")} size="sm">
                ダッシュボード <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => (window.location.href = getLoginUrl())}
                >
                  ログイン
                </Button>
                <Button size="sm" onClick={handleStart}>
                  無料で始める
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="container max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI × 就職活動の新しいスタンダード</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight mb-6">
            日本就活を、
            <br />
            <span className="text-primary">AIが完全サポート</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            ES作成から模擬面接まで、あなた専属のAIエージェントが24時間サポート。
            企業の深層情報を分析し、内定率を最大化します。
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" onClick={handleStart} className="w-full sm:w-auto px-8">
              今すぐ無料で始める <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button variant="outline" size="lg" className="w-full sm:w-auto px-8 bg-transparent">
              デモを見る
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            クレジットカード不要 · 完全無料でスタート
          </p>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-4 border-t border-border/50">
        <div className="container max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">
              就活の全プロセスをカバー
            </h2>
            <p className="text-muted-foreground">
              4つのAIエージェントが連携して、あなたの就活を完全サポート
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <div
                key={i}
                className="p-5 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-card/80 transition-all duration-200 group"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center mb-4 group-hover:bg-primary/25 transition-colors">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">{f.title}</h3>
                <p className="text-xs text-muted-foreground mb-2">{f.titleZh}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 border-t border-border/50 bg-card/30">
        <div className="container max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">使い方はシンプル</h2>
            <p className="text-muted-foreground">4ステップで就活準備を完了</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s, i) => (
              <div key={i} className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-3">
                  <span className="text-primary font-bold text-sm">{s.step}</span>
                </div>
                <h3 className="font-semibold text-sm mb-1">{s.title}</h3>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Telegram CTA */}
      <section className="py-20 px-4 border-t border-border/50">
        <div className="container max-w-2xl mx-auto text-center">
          <div className="p-8 rounded-2xl border border-primary/30 bg-primary/5">
            <MessageSquare className="w-12 h-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-3">Telegram で就活を始めよう</h2>
            <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
              登録後、専属AIアドバイザー「CareerpassBot」と接続。
              いつでもどこでもTelegramで就活相談ができます。
            </p>
            <div className="flex flex-col gap-2 text-sm text-left max-w-xs mx-auto mb-6">
              {["ES・履歴書の自動生成", "企業情報のリアルタイム分析", "面接メールの自動検知と日程登録", "模擬面接でのフィードバック"].map(
                (item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </div>
                )
              )}
            </div>
            <Button size="lg" onClick={handleStart} className="px-8">
              無料アカウントを作成 <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border/50">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">就活パス CareerPass</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © 2025 CareerPass. 日本就活AIサポートプラットフォーム
          </p>
        </div>
      </footer>
    </div>
  );
}
