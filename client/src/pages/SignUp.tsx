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
      <div className="min-h-screen bg-black flex items-center justify-center px-4 text-white">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-14 h-14 mx-auto rounded-sm bg-[#faff69] flex items-center justify-center">
            <Mail className="w-7 h-7 text-black" />
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69]">// CHECK YOUR INBOX</p>
          <h1 className="text-2xl font-black tracking-tight">確認メールを送信しました</h1>
          <p className="text-[#a0a0a0] leading-relaxed text-sm">
            <span className="text-[#faff69] font-mono">{email}</span> に確認リンクを送りました。<br />
            メールを開いてリンクをクリックしてください。<br />
            <span className="text-[#a0a0a0]/60">（リンクの有効期限は24時間です）</span>
          </p>
          <p className="text-[#a0a0a0]/60 text-xs">
            メールが届かない場合は迷惑メールフォルダをご確認ください。
          </p>
        </div>
      </div>
    );
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
          <p className="mt-6 text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69]">// CREATE ACCOUNT</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">無料アカウントを作成</h1>
          <p className="mt-2 text-[#a0a0a0] text-sm">AIで日本就活を完全サポート</p>
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
              <Label htmlFor="password" className="text-[#a0a0a0] text-xs uppercase tracking-wider font-mono">
                パスワード <span className="text-[#414141] normal-case">（8文字以上）</span>
              </Label>
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

            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-[#a0a0a0] text-xs uppercase tracking-wider font-mono">パスワード（確認）</Label>
              <Input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
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
              disabled={register.isPending}
              className="w-full h-11 rounded-sm text-sm"
            >
              {register.isPending ? "送信中..." : "確認メールを送る →"}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-[#a0a0a0]">
          すでにアカウントをお持ちの方は{" "}
          <Link href="/login">
            <span className="text-[#faff69] hover:underline cursor-pointer">ログイン</span>
          </Link>
        </p>
      </div>
    </div>
  );
}
