import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrainCircuit } from "lucide-react";

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
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="text-6xl">📬</div>
          <h1 className="text-2xl font-bold text-white">確認メールを送信しました</h1>
          <p className="text-gray-400 leading-relaxed text-sm">
            <span className="text-blue-400 font-medium">{email}</span> に確認リンクを送りました。<br />
            メールを開いてリンクをクリックしてください。<br />
            <span className="text-gray-500">（リンクの有効期限は24時間です）</span>
          </p>
          <p className="text-gray-600 text-xs">
            メールが届かない場合は迷惑メールフォルダをご確認ください。
          </p>
        </div>
      </div>
    );
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
          <h1 className="mt-6 text-2xl font-bold text-white">無料アカウントを作成</h1>
          <p className="mt-2 text-gray-500 text-sm">AIで日本就活を完全サポート</p>
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
              <Label htmlFor="password" className="text-gray-300 text-sm">
                パスワード <span className="text-gray-600 text-xs">（8文字以上）</span>
              </Label>
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

            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-gray-300 text-sm">パスワード（確認）</Label>
              <Input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
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
              disabled={register.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 rounded-lg text-sm"
            >
              {register.isPending ? "送信中..." : "確認メールを送る →"}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-600">
          すでにアカウントをお持ちの方は{" "}
          <Link href="/login">
            <span className="text-blue-400 hover:text-blue-300 cursor-pointer">ログイン</span>
          </Link>
        </p>
      </div>
    </div>
  );
}
