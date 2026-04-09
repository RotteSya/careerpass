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
    <div className="min-h-screen bg-black flex items-center justify-center px-4 text-white">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link href="/">
            <span className="inline-flex items-center gap-2 cursor-pointer justify-center">
              <div className="w-9 h-9 rounded-sm bg-[#faff69] flex items-center justify-center">
                <BrainCircuit className="w-5 h-5 text-black" />
              </div>
              <span className="text-xl font-black">就活パス</span>
            </span>
          </Link>
          <p className="mt-6 text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69]">// SIGN IN</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">ログイン</h1>
          <p className="mt-2 text-[#a0a0a0] text-sm">就活パスへようこそ</p>
        </div>

        <div className="bg-[#0a0a0a] border border-[rgba(65,65,65,0.8)] rounded-sm p-6 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[#a0a0a0] text-xs uppercase tracking-wider font-mono">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-black border-[rgba(65,65,65,0.8)] text-white placeholder:text-[#414141] focus-visible:border-[#faff69] focus-visible:ring-[#faff69]/30 h-11 rounded-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[#a0a0a0] text-xs uppercase tracking-wider font-mono">パスワード</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-black border-[rgba(65,65,65,0.8)] text-white placeholder:text-[#414141] focus-visible:border-[#faff69] focus-visible:ring-[#faff69]/30 h-11 rounded-sm"
              />
            </div>

            {error && (
              <div className="bg-red-950/40 border border-red-700/50 rounded-sm px-4 py-3 text-red-400 text-sm font-mono">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="neon"
              disabled={emailLogin.isPending}
              className="w-full h-11 rounded-sm text-sm"
            >
              {emailLogin.isPending ? "ログイン中..." : "ログイン →"}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-[#a0a0a0]">
          アカウントをお持ちでない方は{" "}
          <Link href="/signup">
            <span className="text-[#faff69] hover:underline cursor-pointer">無料で始める</span>
          </Link>
        </p>
      </div>
    </div>
  );
}
