import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
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
  },
  {
    icon: Search,
    title: "企業深度偵察",
    sub: "OpenWork・就活会議を分析",
    desc: "匿名口コミ・IR資料・ニュースを横断分析し、企業の本当の姿を暴露します。",
  },
  {
    icon: FileText,
    title: "ES 自動生成",
    sub: "志望動機・自己PRを日本語で",
    desc: "企業の痛点に直撃する志望動機と自己PRを、あなたの経験と紐づけて作成します。",
  },
  {
    icon: BrainCircuit,
    title: "模擬面接",
    sub: "厳格な日本企業面接官が深掘り",
    desc: "提出したESを元に、一問一答形式で本番さながらの面接練習ができます。",
  },
  {
    icon: Calendar,
    title: "日程自動管理",
    sub: "面接メールを自動検知",
    desc: "Gmailを監視し、面接・説明会メールを自動でカレンダーに登録。Telegramで通知します。",
  },
  {
    icon: Sparkles,
    title: "記憶ライブラリ",
    sub: "全情報をAIが記憶",
    desc: "企業情報・ES・面接ログをすべて記憶し、次の就活でも即座に活用できます。",
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
      navigate("/signup");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-black text-white overflow-x-hidden">

      {/* ── Navigation ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[rgba(65,65,65,0.8)] bg-black/85 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-sm bg-[#faff69] flex items-center justify-center">
              <BrainCircuit className="w-4 h-4 text-black" />
            </div>
            <span className="font-black tracking-tight">就活パス</span>
            <span className="text-[#a0a0a0] text-xs font-mono hidden sm:block">CareerPass</span>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button onClick={() => navigate("/dashboard")} variant="neon" size="sm" className="h-8 text-xs px-4 rounded-sm">
                ダッシュボード <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs px-3 text-[#a0a0a0] hover:text-[#faff69] hover:bg-transparent"
                  onClick={() => navigate("/login")}
                >
                  ログイン
                </Button>
                <Button variant="neon" size="sm" className="h-8 text-xs px-4 rounded-sm" onClick={handleStart}>
                  無料で始める
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-36 pb-28 px-4 relative">
        {/* subtle neon grid background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#faff69 1px, transparent 1px), linear-gradient(90deg, #faff69 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_380px] gap-16 items-center relative">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.div variants={fadeUp} custom={0}>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-sm border border-[#faff69]/40 bg-[#faff69]/5 text-[#faff69] text-xs font-mono mb-8">
                <Sparkles className="w-3 h-3" />
                AI × 就職活動の新しいスタンダード
              </span>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              custom={1}
              className="hero-headline mb-8"
            >
              日本就活を、
              <br />
              <span className="text-[#faff69]">AI が完全</span>
              <br />
              <span className="text-[#faff69]">サポート。</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={2}
              className="text-base text-[#a0a0a0] max-w-[52ch] mb-10 leading-relaxed"
            >
              ES作成から模擬面接まで、あなた専属のAIエージェントが24時間サポート。
              企業の深層情報を分析し、内定率を最大化します。
            </motion.p>

            <motion.div variants={fadeUp} custom={3} className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                variant="neon"
                onClick={handleStart}
                className="px-7 h-12 text-sm rounded-sm"
              >
                今すぐ無料で始める
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="ghost-olive"
                onClick={() => navigate("/login")}
                className="px-7 h-12 text-sm rounded-sm"
              >
                ログイン
              </Button>
            </motion.div>

            <motion.p
              variants={fadeUp}
              custom={4}
              className="text-xs font-mono text-[#a0a0a0]/70 mt-4"
            >
              // クレジットカード不要 · 完全無料でスタート
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
                className="p-5 rounded-sm border border-[rgba(65,65,65,0.8)] bg-[#0a0a0a] hover:border-[#faff69]/40 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-widest font-mono text-[#a0a0a0] mb-2">{card.label}</p>
                <p className="text-2xl font-black text-[#faff69] tracking-tight">{card.value}</p>
                <p className="text-xs text-[#a0a0a0]/70 mt-1">{card.sub}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="border-y border-[rgba(65,65,65,0.8)] bg-[#0a0a0a]">
        <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { v: "24/7", l: "AI サポート" },
            { v: "4", l: "AI エージェント" },
            { v: "∞", l: "対応企業数" },
            { v: "JP", l: "日本特化" },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-3xl font-black text-[#faff69]">{s.v}</div>
              <div className="text-[10px] uppercase tracking-widest font-mono text-[#a0a0a0] mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-14"
          >
            <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69] mb-3">// FEATURES</p>
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight mb-3">
              就活の全プロセスをカバー
            </h2>
            <p className="text-sm text-[#a0a0a0]">
              4つのAIエージェントが連携して、あなたの就活を完全サポート
            </p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[rgba(65,65,65,0.8)] border border-[rgba(65,65,65,0.8)]"
          >
            {features.map((f, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                custom={i}
                className="group relative p-6 bg-black hover:bg-[#0a0a0a] transition-colors cursor-default"
              >
                <div className="w-10 h-10 rounded-sm bg-[#faff69]/10 border border-[#faff69]/30 flex items-center justify-center mb-5 group-hover:bg-[#faff69] group-hover:border-[#faff69] transition-colors">
                  <f.icon className="w-5 h-5 text-[#faff69] group-hover:text-black transition-colors" />
                </div>
                <h3 className="font-black text-base mb-1 tracking-tight">{f.title}</h3>
                <p className="text-[11px] text-[#faff69] font-mono mb-3">{f.sub}</p>
                <p className="text-xs text-[#a0a0a0] leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-24 px-4 border-t border-[rgba(65,65,65,0.8)] bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-14"
          >
            <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69] mb-3">// WORKFLOW</p>
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight mb-3">使い方はシンプル</h2>
            <p className="text-sm text-[#a0a0a0]">4ステップで就活準備を完了</p>
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
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-6 left-[calc(50%+28px)] right-[-50%] h-px bg-[rgba(65,65,65,0.8)]" />
                )}
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-sm bg-black border border-[#faff69]/40 flex items-center justify-center mb-4 relative z-10">
                    <s.icon className="w-5 h-5 text-[#faff69]" />
                  </div>
                  <span className="text-[10px] text-[#faff69] font-mono mb-2">{s.step}</span>
                  <h3 className="font-black text-sm mb-1">{s.title}</h3>
                  <p className="text-xs text-[#a0a0a0]">{s.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Telegram CTA ── */}
      <section className="py-24 px-4 border-t border-[rgba(65,65,65,0.8)]">
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="relative p-10 rounded-sm border border-[#faff69]/40 bg-[#0a0a0a] overflow-hidden"
          >
            <div className="absolute -top-16 -right-16 w-48 h-48 bg-[#faff69]/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative text-center">
              <div className="w-12 h-12 rounded-sm bg-[#faff69] flex items-center justify-center mx-auto mb-5">
                <MessageSquare className="w-6 h-6 text-black" />
              </div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69] mb-2">// GET STARTED</p>
              <h2 className="text-3xl font-black tracking-tight mb-3">
                Telegram で就活を始めよう
              </h2>
              <p className="text-sm text-[#a0a0a0] mb-8 leading-relaxed max-w-[42ch] mx-auto">
                登録後、専属AIアドバイザー「CareerpassBot」と接続。
                いつでもどこでもTelegramで就活相談ができます。
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left max-w-sm mx-auto mb-8">
                {telegramBenefits.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#faff69] shrink-0" />
                    <span className="text-xs text-[#a0a0a0]">{item}</span>
                  </div>
                ))}
              </div>

              <Button
                size="lg"
                variant="neon"
                onClick={handleStart}
                className="px-8 h-12 text-sm rounded-sm"
              >
                無料アカウントを作成
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-8 px-4 border-t border-[rgba(65,65,65,0.8)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-3.5 h-3.5 text-[#faff69]" />
            <span className="text-xs font-black">就活パス CareerPass</span>
          </div>
          <p className="text-xs font-mono text-[#a0a0a0]/70">
            © 2025 CareerPass. 日本就活AIサポートプラットフォーム
          </p>
          <div className="flex items-center gap-4 text-xs text-[#a0a0a0]/70">
            <a href="/privacy" className="hover:text-[#faff69] transition-colors">プライバシーポリシー</a>
            <a href="/terms" className="hover:text-[#faff69] transition-colors">利用規約</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
