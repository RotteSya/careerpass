import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EmailVerified() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? "";

  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMsg, setErrorMsg] = useState("");

  const utils = trpc.useUtils();

  const verifyEmail = trpc.auth.verifyEmail.useMutation({
    onSuccess: async (data) => {
      await utils.auth.me.invalidate();
      setStatus("success");
      setTimeout(() => {
        if (data.profileCompleted) {
          navigate("/dashboard");
        } else {
          navigate("/register");
        }
      }, 1500);
    },
    onError: (err) => {
      setStatus("error");
      setErrorMsg(err.message);
    },
  });

  useEffect(() => {
    if (token) {
      verifyEmail.mutate({ token });
    } else {
      setStatus("error");
      setErrorMsg("確認トークンが見つかりません。");
    }
  }, [token]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 text-white">
      <div className="w-full max-w-md text-center space-y-6">
        {status === "verifying" && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-[#faff69] mx-auto" />
            <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69]">// VERIFYING</p>
            <h1 className="text-2xl font-black tracking-tight">メールアドレスを確認中...</h1>
            <p className="text-[#a0a0a0] text-sm">しばらくお待ちください</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-14 h-14 mx-auto rounded-sm bg-[#faff69] flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-black" />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69]">// VERIFIED</p>
            <h1 className="text-2xl font-black tracking-tight">確認完了！</h1>
            <p className="text-[#a0a0a0] text-sm">
              メールアドレスの確認が完了しました。<br />
              プロフィール入力ページへ移動します...
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-14 h-14 mx-auto rounded-sm bg-red-950 border border-red-700 flex items-center justify-center">
              <XCircle className="w-7 h-7 text-red-400" />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-red-400">// ERROR</p>
            <h1 className="text-2xl font-black tracking-tight">確認に失敗しました</h1>
            <p className="text-red-400 text-sm font-mono">{errorMsg}</p>
            <div className="space-y-3 pt-2">
              <Button
                variant="neon"
                className="w-full rounded-sm"
                onClick={() => navigate("/signup")}
              >
                新規登録に戻る
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
