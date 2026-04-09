import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrainCircuit, Mail } from "lucide-react";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const register = trpc.auth.register.useMutation({
    onSuccess: () => setDone(true),
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("パスワードが一致しません。");
      return;
    }
    if (password.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }
    register.mutate({ email, password });
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[var(--color-warm-white)] flex items-center justify-center px-4 text-foreground">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--color-badge-blue-bg)] border border-black/10 flex items-center justify-center">
            <Mail className="w-7 h-7 text-[var(--color-notion-blue)]" />
          </div>
          <h1 className="text-[26px] leading-tight tracking-[-0.625px] font-bold">確認メールを送信しました</h1>
          <p className="text-[14px] text-[var(--color-warm-gray-500)] leading-relaxed">
            <span className="text-foreground font-semibold">{email}</span> に確認リンクを送りました。<br />
            メールを開いてリンクをクリックしてください。<br />
            <span className="text-[var(--color-warm-gray-300)]">（リンクの有効期限は24時間です）</span>
          </p>
          <p className="text-[12px] text-[var(--color-warm-gray-500)]">
            メールが届かない場合は迷惑メールフォルダをご確認ください。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-warm-white)] flex items-center justify-center px-4 text-foreground">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link href="/">
            <span className="inline-flex items-center gap-3 cursor-pointer justify-center">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                <BrainCircuit className="w-5 h-5 text-primary-foreground" />
              </div>
              <div className="text-left leading-tight">
                <p className="text-[15px] font-semibold">就活パス</p>
                <p className="text-[12px] text-[var(--color-warm-gray-500)]">CareerPass</p>
              </div>
            </span>
          </Link>
          <h1 className="mt-6 text-[26px] leading-tight tracking-[-0.625px] font-bold">無料アカウントを作成</h1>
          <p className="mt-2 text-[14px] text-[var(--color-warm-gray-500)]">AIで日本就活を完全サポート</p>
        </div>

        <div className="bg-white border border-black/10 rounded-2xl p-6 shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px] space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[12px] text-[var(--color-warm-gray-500)]">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[12px] text-[var(--color-warm-gray-500)]">
                パスワード <span className="text-[var(--color-warm-gray-300)]">（8文字以上）</span>
              </Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-[12px] text-[var(--color-warm-gray-500)]">パスワード（確認）</Label>
              <Input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="h-11"
              />
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-destructive text-[14px]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={register.isPending}
              className="w-full h-11"
            >
              {register.isPending ? "送信中..." : "確認メールを送る →"}
            </Button>
          </form>
        </div>

        <p className="text-center text-[14px] text-[var(--color-warm-gray-500)]">
          すでにアカウントをお持ちの方は{" "}
          <Link href="/login">
            <span className="text-[var(--color-notion-blue)] hover:underline cursor-pointer">ログイン</span>
          </Link>
        </p>
      </div>
    </div>
  );
}
