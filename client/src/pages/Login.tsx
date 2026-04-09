import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrainCircuit } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [, navigate] = useLocation();

  const utils = trpc.useUtils();

  const emailLogin = trpc.auth.emailLogin.useMutation({
    onSuccess: async (data) => {
      await utils.auth.me.invalidate();
      if (data.profileCompleted) {
        navigate("/dashboard");
      } else {
        navigate("/register");
      }
    },
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    emailLogin.mutate({ email, password });
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
          <h1 className="mt-6 text-[26px] leading-tight tracking-[-0.625px] font-bold">ログイン</h1>
          <p className="mt-2 text-[14px] text-[var(--color-warm-gray-500)]">就活パスへようこそ</p>
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
              <Label htmlFor="password" className="text-[12px] text-[var(--color-warm-gray-500)]">パスワード</Label>
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

            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 text-destructive text-[14px]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={emailLogin.isPending}
              className="w-full h-11"
            >
              {emailLogin.isPending ? "ログイン中..." : "ログイン →"}
            </Button>
          </form>
        </div>

        <p className="text-center text-[14px] text-[var(--color-warm-gray-500)]">
          アカウントをお持ちでない方は{" "}
          <Link href="/signup">
            <span className="text-[var(--color-notion-blue)] hover:underline cursor-pointer">無料で始める</span>
          </Link>
        </p>
      </div>
    </div>
  );
}
