import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";

export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [error, setError] = useState("");

  const { data: countData } = trpc.waitlist.count.useQuery();
  const joinMutation = trpc.waitlist.join.useMutation({
    onSuccess: (data) => {
      setSubmitted(true);
      setAlreadyJoined(data.alreadyJoined);
    },
    onError: (err) => {
      setError(err.message || "エラーが発生しました。もう一度お試しください。");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) return;
    joinMutation.mutate({ email: email.trim() });
  };

  const count = countData?.count ?? 0;

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Tag */}
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center text-sm font-medium text-gray-500 mb-4 tracking-wide"
        >
          就活 AI アシスタント
        </motion.p>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-8"
        >
          <h1 className="text-5xl font-black leading-tight text-gray-900 mb-1">
            就活を、
          </h1>
          <h1 className="text-5xl font-black leading-tight">
            <span className="text-[#22c55e]">全自動</span>
            <span className="text-gray-900">に。</span>
          </h1>
        </motion.div>

        {/* Sub copy */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mb-10 space-y-1 text-gray-500 text-[15px] leading-relaxed"
        >
          <p>メールを読んで、自動で選考状況を更新。</p>
          <p>企業を調べて、ES を自動で生成。</p>
          <p>面接対策も、AI が一緒に練習。</p>
          <p className="text-gray-800 font-semibold mt-2">
            あなたは、判断するだけ。
          </p>
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <AnimatePresence mode="wait">
            {!submitted ? (
              <motion.form
                key="form"
                onSubmit={handleSubmit}
                className="space-y-3"
                exit={{ opacity: 0, y: -10 }}
              >
                <Input
                  type="email"
                  placeholder="メールアドレスを入力"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-xl border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus:border-[#22c55e] focus:ring-[#22c55e] text-base"
                  required
                  disabled={joinMutation.isPending}
                />
                {error && (
                  <p className="text-red-500 text-sm">{error}</p>
                )}
                <Button
                  type="submit"
                  disabled={joinMutation.isPending}
                  className="w-full h-12 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-bold text-base"
                >
                  {joinMutation.isPending ? "送信中..." : "キャンセル待ちに参加する"}
                </Button>
              </motion.form>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-4"
              >
                <div className="text-4xl mb-3">🎉</div>
                <p className="text-gray-900 font-bold text-lg">
                  {alreadyJoined
                    ? "すでに登録済みです！"
                    : "登録が完了しました！"}
                </p>
                <p className="text-gray-500 text-sm mt-1">
                  サービス開始時にご連絡します。
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Count */}
        {count > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-5 flex items-center gap-2"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-[#22c55e]" />
            <span className="text-sm text-gray-600">
              すでに <span className="font-semibold text-gray-900">{count}</span> 人が参加中
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}
