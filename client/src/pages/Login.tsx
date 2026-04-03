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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <Link href="/">
            <span className="inline-flex items-center gap-2 cursor-pointer justify-center">
              <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
                <BrainCircuit className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white">就活パス</span>
            </span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-white">ログイン</h1>
          <p className="mt-2 text-gray-500 text-sm">就活パスへようこそ</p>
        </div>

        {/* Form */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-6 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-gray-300 text-sm">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-[#0a0a0a] border-[#333] text-white placeholder:text-gray-700 focus:border-blue-500 h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-gray-300 text-sm">パスワード</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-[#0a0a0a] border-[#333] text-white placeholder:text-gray-700 focus:border-blue-500 h-11"
              />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={emailLogin.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 rounded-lg text-sm"
            >
              {emailLogin.isPending ? "ログイン中..." : "ログイン →"}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-600">
          アカウントをお持ちでない方は{" "}
          <Link href="/signup">
            <span className="text-blue-400 hover:text-blue-300 cursor-pointer">無料で始める</span>
          </Link>
        </p>
      </div>
    </div>
  );
}
