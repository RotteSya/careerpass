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
    icon: Calendar,
    title: "メール自動検知",
    sub: "面接・説明会メールを即時通知",
    desc: "Gmailを見守り、面接・説明会・筆記試験のメールを自動でカレンダーに登録。Telegramですぐお知らせします。",
  },
  {
    icon: MessageSquare,
    title: "あなた専属の就活秘書",
    sub: "次にやるべきことをリマインド",
    desc: "「この会社3日連絡なし」「明日面接、準備は？」など、あなたのペースに合わせて次のアクションを提案します。",
  },
  {
    icon: Search,
    title: "企業深度偵察",
    sub: "OpenWork・就活会議を分析",
    desc: "匿名口コミ・IR資料・ニュースを横断分析し、企業の本当の姿をレポートにまとめます。",
  },
  {
    icon: TrendingUp,
    title: "進捗ダッシュボード",
    sub: "全社の選考状況を一目で",
    desc: "各社の選考ステータス・直近の予定・次にやるべきことを一覧で把握できます。",
  },
  {
    icon: Zap,
    title: "Google カレンダー連携",
    sub: "面接日程を自動登録",
    desc: "メールから検知した面接・説明会・締切を、あなたのGoogleカレンダーに自動で書き込みます。",
  },
  {
    icon: Shield,
    title: "プライバシー保護",
    sub: "あなたのデータはあなたのもの",
    desc: "メール本文はカレンダーに記載しません。必要な時だけGmailを開いて確認できます。",
  },
];

const steps = [
  { step: "01", title: "アカウント登録", desc: "基本情報を入力して登録", icon: Shield },
  { step: "02", title: "Google 連携", desc: "Gmail・カレンダーを接続", icon: Calendar },
  { step: "03", title: "Telegram 連携", desc: "専属ボットと接続", icon: MessageSquare },
  { step: "04", title: "内定獲得", desc: "秘書があなたの就活を全面的にサポート", icon: TrendingUp },
];

const telegramBenefits = [
  "面接・説明会メールの自動検知と日程登録",
  "企業情報のリアルタイム分析",
  "次にやるべきことのリマインド",
  "求職進捗の一目把握",
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
    <div className="min-h-[100dvh] bg-background text-foreground overflow-x-hidden">
      <nav className="border-b border-border bg-background">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <BrainCircuit className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <p className="text-[15px] font-semibold">就活パス</p>
              <p className="text-[12px] text-muted-foreground">CareerPass</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button onClick={() => navigate("/dashboard")} size="sm">
                ダッシュボード <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
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

      <main>
        <section className="py-20 sm:py-28 px-4">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_420px] gap-12 items-center">
            <motion.div initial="hidden" animate="visible" variants={stagger}>
              <motion.div variants={fadeUp} custom={0}>
                <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-black/10 bg-[var(--color-badge-blue-bg)] text-[var(--color-focus-blue)] text-[12px] font-semibold tracking-[0.125px]">
                  <Sparkles className="w-3 h-3" />
                  AI × 就職活動の新しいスタンダード
                </span>
              </motion.div>

              <motion.h1
                variants={fadeUp}
                custom={1}
                className="mt-6 text-[clamp(2.5rem,5.2vw,4rem)] leading-[1.02] tracking-[-1.5px] font-bold"
              >
                日本就活を、AI が完全サポート。
              </motion.h1>

              <motion.p
                variants={fadeUp}
                custom={2}
                className="mt-5 text-[16px] leading-relaxed text-[var(--color-warm-gray-500)] max-w-[56ch]"
              >
                ES作成から模擬面接まで、あなた専属のAIエージェントが24時間サポート。
                企業の深層情報を分析し、内定率を最大化します。
              </motion.p>

              <motion.div variants={fadeUp} custom={3} className="mt-8 flex flex-wrap items-center gap-2">
                <Button size="lg" onClick={handleStart}>
                  今すぐ無料で始める
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => navigate("/login")}>
                  ログイン
                </Button>
              </motion.div>

              <motion.p variants={fadeUp} custom={4} className="mt-4 text-[14px] text-[var(--color-warm-gray-300)]">
                クレジットカード不要 · 完全無料でスタート
              </motion.p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="hidden lg:flex flex-col gap-3"
            >
              {[
                { label: "対応企業数", value: "無制限", sub: "日本全国の上場・非上場企業" },
                { label: "ES生成精度", value: "企業特化", sub: "痛点に直撃する志望動機" },
                { label: "面接対策", value: "一問一答", sub: "厳格な日本企業面接官AI" },
              ].map((card, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 + i * 0.1, duration: 0.45 }}
                  className="rounded-xl border border-border bg-card shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px] p-5"
                >
                  <p className="text-[12px] text-[var(--color-warm-gray-500)]">{card.label}</p>
                  <p className="mt-2 text-[40px] leading-none tracking-tight font-bold">{card.value}</p>
                  <p className="mt-2 text-[14px] text-[var(--color-warm-gray-500)]">{card.sub}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        <section className="border-y border-black/10 bg-[var(--color-warm-white)]">
          <div className="max-w-6xl mx-auto px-4 py-12 grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { v: "24/7", l: "AI サポート" },
              { v: "4", l: "AI エージェント" },
              { v: "∞", l: "対応企業数" },
              { v: "JP", l: "日本特化" },
            ].map((s, i) => (
              <div key={i} className="rounded-xl border border-black/10 bg-white p-4 text-center">
                <div className="text-[40px] leading-none tracking-tight font-bold">{s.v}</div>
                <div className="mt-2 text-[12px] text-[var(--color-warm-gray-500)]">{s.l}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-20 sm:py-28 px-4">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="mb-12"
            >
              <h2 className="text-[48px] leading-none tracking-[-1.5px] font-bold mb-3">就活の全プロセスをカバー</h2>
              <p className="text-[16px] text-[var(--color-warm-gray-500)]">
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
                  className="rounded-xl border border-border bg-card shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px] p-6"
                >
                  <div className="w-10 h-10 rounded-lg bg-[var(--color-warm-white)] border border-black/10 flex items-center justify-center mb-5">
                    <f.icon className="w-5 h-5 text-[var(--color-notion-blue)]" />
                  </div>
                  <h3 className="text-[22px] leading-tight tracking-[-0.25px] font-bold mb-2">{f.title}</h3>
                  <p className="text-[14px] text-[var(--color-warm-gray-500)] mb-3">{f.sub}</p>
                  <p className="text-[16px] text-[var(--color-warm-gray-500)] leading-relaxed">{f.desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        <section className="py-20 sm:py-28 px-4 bg-[var(--color-warm-white)] border-t border-black/10">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="mb-12"
            >
              <h2 className="text-[48px] leading-none tracking-[-1.5px] font-bold mb-3">使い方はシンプル</h2>
              <p className="text-[16px] text-[var(--color-warm-gray-500)]">4ステップで就活準備を完了</p>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-60px" }}
              variants={stagger}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            >
              {steps.map((s, i) => (
                <motion.div key={i} variants={fadeUp} custom={i} className="rounded-xl border border-border bg-white p-5">
                  <div className="w-10 h-10 rounded-lg bg-[var(--color-warm-white)] border border-black/10 flex items-center justify-center">
                    <s.icon className="w-5 h-5 text-[var(--color-notion-blue)]" />
                  </div>
                  <p className="mt-4 text-[12px] text-[var(--color-warm-gray-500)]">{s.step}</p>
                  <h3 className="mt-2 text-[16px] font-semibold">{s.title}</h3>
                  <p className="mt-2 text-[14px] text-[var(--color-warm-gray-500)]">{s.desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        <section className="py-20 sm:py-28 px-4 border-t border-black/10">
          <div className="max-w-2xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="rounded-2xl border border-black/10 bg-white shadow-[rgba(0,0,0,0.01)_0px_1px_3px,rgba(0,0,0,0.02)_0px_3px_7px,rgba(0,0,0,0.02)_0px_7px_15px,rgba(0,0,0,0.04)_0px_14px_28px,rgba(0,0,0,0.05)_0px_23px_52px] p-10"
            >
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-[var(--color-badge-blue-bg)] border border-black/10 flex items-center justify-center mx-auto mb-5">
                  <MessageSquare className="w-6 h-6 text-[var(--color-notion-blue)]" />
                </div>
                <h2 className="text-[26px] leading-tight tracking-[-0.625px] font-bold mb-3">Telegram で就活を始めよう</h2>
                <p className="text-[16px] text-[var(--color-warm-gray-500)] mb-8 leading-relaxed max-w-[42ch] mx-auto">
                  登録後、専属AIアドバイザー「CareerpassBot」と接続。
                  いつでもどこでもTelegramで就活相談ができます。
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left max-w-sm mx-auto mb-8">
                  {telegramBenefits.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[var(--color-notion-blue)] shrink-0" />
                      <span className="text-[14px] text-[var(--color-warm-gray-500)]">{item}</span>
                    </div>
                  ))}
                </div>

                <Button size="lg" onClick={handleStart} className="px-8">
                  無料アカウントを作成
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      <footer className="py-10 px-4 border-t border-black/10 bg-[var(--color-warm-white)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-[var(--color-notion-blue)]" />
            <span className="text-[14px] font-semibold">就活パス CareerPass</span>
          </div>
          <p className="text-[12px] text-[var(--color-warm-gray-500)]">
            © 2025 CareerPass. 日本就活AIサポートプラットフォーム
          </p>
          <div className="flex items-center gap-4 text-[12px] text-[var(--color-warm-gray-500)]">
            <a href="/privacy" className="hover:text-[var(--color-notion-blue)] transition-colors">
              プライバシーポリシー
            </a>
            <a href="/terms" className="hover:text-[var(--color-notion-blue)] transition-colors">
              利用規約
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
