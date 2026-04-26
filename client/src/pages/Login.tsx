import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrainCircuit, BriefcaseBusiness, CalendarCheck2, CheckCircle2, Mail } from "lucide-react";

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
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-warm-white)] flex items-center justify-center px-4 text-foreground">
      <div className="login-value-visual pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-x-0 top-[9%] mx-auto h-px w-[min(760px,82vw)] bg-[linear-gradient(90deg,transparent,rgba(0,117,222,0.2),rgba(26,174,57,0.18),transparent)]" />
        <div className="login-orbit login-orbit-one left-[8%] top-[16%] hidden sm:flex">
          <Mail className="h-4 w-4 text-[var(--color-notion-blue)]" />
          <span>説明会</span>
        </div>
        <div className="login-orbit login-orbit-two right-[9%] top-[23%] hidden md:flex">
          <CalendarCheck2 className="h-4 w-4 text-[#dd5b00]" />
          <span>面接日程</span>
        </div>
        <div className="login-orbit login-orbit-three bottom-[18%] left-[11%] hidden md:flex">
          <BriefcaseBusiness className="h-4 w-4 text-[var(--color-warm-gray-500)]" />
          <span>選考管理</span>
        </div>
        <div className="login-orbit login-orbit-four bottom-[14%] right-[12%] hidden sm:flex">
          <CheckCircle2 className="h-4 w-4 text-[#1aae39]" />
          <span>内定</span>
        </div>
        <div className="login-flow login-flow-one" />
        <div className="login-flow login-flow-two" />
        <div className="login-flow login-flow-three" />
        <div className="login-pipeline left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="bg-[var(--color-notion-blue)]" />
          <span className="bg-[#dd5b00]" />
          <span className="bg-[#1aae39]" />
        </div>
      </div>

      <div className="relative z-10 w-full max-w-md space-y-8">
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
