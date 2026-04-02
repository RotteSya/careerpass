import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  BrainCircuit,
  Calendar,
  FileText,
  MessageSquare,
  Search,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Zap,
  Shield,
  TrendingUp,
} from "lucide-react";

// ── Animation variants ────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08 },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

// ── Data ──────────────────────────────────────────────────────────────────────
const features = [
  {
    icon: MessageSquare,
    title: "AI 就活コーチ",
    sub: "STAR法則で経験を深掘り",
    desc: "あなたの経験をSTAR法則で体系化し、唯一無二の履歴書を自動生成します。",
    accent: "from-blue-500/20 to-blue-600/5",
  },
  {
    icon: Search,
    title: "企業深度偵察",
    sub: "OpenWork・就活会議を分析",
    desc: "匿名口コミ・IR資料・ニュースを横断分析し、企業の本当の姿を暴露します。",
    accent: "from-violet-500/20 to-violet-600/5",
  },
  {
    icon: FileText,
    title: "ES 自動生成",
    sub: "志望動機・自己PRを日本語で",
    desc: "企業の痛点に直撃する志望動機と自己PRを、あなたの経験と紐づけて作成します。",
    accent: "from-emerald-500/20 to-emerald-600/5",
  },
  {
    icon: BrainCircuit,
    title: "模擬面接",
    sub: "厳格な日本企業面接官が深掘り",
    desc: "提出したESを元に、一問一答形式で本番さながらの面接練習ができます。",
    accent: "from-orange-500/20 to-orange-600/5",
  },
  {
    icon: Calendar,
    title: "日程自動管理",
    sub: "面接メールを自動検知",
    desc: "Gmailを監視し、面接・説明会メールを自動でカレンダーに登録。Telegramで通知します。",
    accent: "from-cyan-500/20 to-cyan-600/5",
  },
  {
    icon: Sparkles,
    title: "記憶ライブラリ",
    sub: "全情報をAIが記憶",
    desc: "企業情報・ES・面接ログをすべて記憶し、次の就活でも即座に活用できます。",
    accent: "from-pink-500/20 to-pink-600/5",
  },
];

const steps = [
  { step: "01", title: "アカウント登録", desc: "基本情報を入力して登録", icon: Shield },
  { step: "02", title: "Telegram 連携", desc: "専属ボットと接続", icon: MessageSquare },
  { step: "03", title: "経験を深掘り", desc: "AIがSTAR法則で分析", icon: Zap },
  { step: "04", title: "内定獲得", desc: "ES・面接を完璧に準備", icon: TrendingUp },
];

const telegramBenefits = [
  "ES・履歴書の自動生成",
  "企業情報のリアルタイム分析",
  "面接メールの自動検知と日程登録",
  "模擬面接でのフィードバック",
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const handleStart = () => {
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      window.location.href = getLoginUrl();
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground overflow-x-hidden">

      {/* ── Navigation ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <BrainCircuit className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold tracking-tight">就活パス</span>
            <span className="text-muted-foreground/60 text-xs hidden sm:block">CareerPass</span>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button onClick={() => navigate("/dashboard")} size="sm" className="h-8 text-xs px-4">
                ダッシュボード <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs px-3 text-muted-foreground"
                  onClick={() => (window.location.href = getLoginUrl())}
                >
                  ログイン
                </Button>
                <Button size="sm" className="h-8 text-xs px-4" onClick={handleStart}>
                  無料で始める
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero — asymmetric split layout ── */}
      <section className="pt-28 pb-24 px-4">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_420px] gap-12 items-center">
          {/* Left: copy */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="max-w-2xl"
          >
            <motion.div variants={fadeUp} custom={0}>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/25 bg-primary/8 text-primary text-xs font-medium mb-6">
                <Sparkles className="w-3 h-3" />
                AI × 就職活動の新しいスタンダード
              </span>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              custom={1}
              className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tighter mb-6"
            >
              日本就活を、
              <br />
              <span className="text-primary">AI が</span>
              <br />
              <span className="text-primary">完全サポート</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={2}
              className="text-base text-muted-foreground max-w-[52ch] mb-8 leading-relaxed"
            >
              ES作成から模擬面接まで、あなた専属のAIエージェントが24時間サポート。
              企業の深層情報を分析し、内定率を最大化します。
            </motion.p>

            <motion.div variants={fadeUp} custom={3} className="flex items-center gap-3">
              <Button
                size="lg"
                onClick={handleStart}
                className="px-7 h-12 text-sm font-semibold active:scale-[0.98] transition-transform"
              >
                今すぐ無料で始める
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.div>

            <motion.p
              variants={fadeUp}
              custom={4}
              className="text-xs text-muted-foreground/60 mt-3"
            >
              クレジットカード不要 · 完全無料でスタート
            </motion.p>
          </motion.div>

          {/* Right: stat cards */}
          <motion.div
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="hidden lg:flex flex-col gap-3"
          >
            {[
              { label: "対応企業数", value: "無制限", sub: "日本全国の上場・非上場企業" },
              { label: "ES生成精度", value: "企業特化", sub: "痛点に直撃する志望動機" },
              { label: "面接対策", value: "一問一答", sub: "厳格な日本企業面接官AI" },
            ].map((card, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.1, duration: 0.45 }}
                className="p-5 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm"
              >
                <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
                <p className="text-xl font-bold text-primary tracking-tight">{card.value}</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">{card.sub}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="py-20 px-4 border-t border-border/40">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
              就活の全プロセスをカバー
            </h2>
            <p className="text-sm text-muted-foreground">
              4つのAIエージェントが連携して、あなたの就活を完全サポート
            </p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {features.map((f, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                custom={i}
                className="group relative p-5 rounded-2xl border border-border/50 bg-card overflow-hidden hover:border-primary/30 transition-all duration-300 cursor-default"
              >
                {/* Gradient accent */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${f.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                />
                <div className="relative">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <f.icon className="w-4.5 h-4.5 text-primary" style={{ width: 18, height: 18 }} />
                  </div>
                  <h3 className="font-semibold text-sm mb-0.5">{f.title}</h3>
                  <p className="text-[11px] text-primary/70 mb-2">{f.sub}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-20 px-4 border-t border-border/40 bg-card/20">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">使い方はシンプル</h2>
            <p className="text-sm text-muted-foreground">4ステップで就活準備を完了</p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            className="grid grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {steps.map((s, i) => (
              <motion.div key={i} variants={fadeUp} custom={i} className="relative">
                {/* Connector line */}
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-5 left-[calc(50%+24px)] right-[-50%] h-px bg-border/60" />
                )}
                <div className="flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-3 relative z-10">
                    <s.icon className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-[10px] text-primary/60 font-mono mb-1">{s.step}</span>
                  <h3 className="font-semibold text-sm mb-1">{s.title}</h3>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Telegram CTA ── */}
      <section className="py-20 px-4 border-t border-border/40">
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="relative p-8 rounded-3xl border border-primary/20 bg-primary/5 overflow-hidden"
          >
            {/* Background glow */}
            <div className="absolute -top-16 -right-16 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative text-center">
              <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-xl font-bold tracking-tight mb-2">
                Telegram で就活を始めよう
              </h2>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed max-w-[42ch] mx-auto">
                登録後、専属AIアドバイザー「CareerpassBot」と接続。
                いつでもどこでもTelegramで就活相談ができます。
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left max-w-sm mx-auto mb-6">
                {telegramBenefits.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="text-xs text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>

              <Button
                size="lg"
                onClick={handleStart}
                className="px-8 h-11 text-sm font-semibold active:scale-[0.98] transition-transform"
              >
                無料アカウントを作成
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-6 px-4 border-t border-border/40">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium">就活パス CareerPass</span>
          </div>
          <p className="text-xs text-muted-foreground/60">
            © 2025 CareerPass. 日本就活AIサポートプラットフォーム
          </p>
        </div>
      </footer>
    </div>
  );
}
