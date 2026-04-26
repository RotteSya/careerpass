import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EmailVerified() {
  const [, navigate] = useLocation();

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

  const ranRef = useRef(false);
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";

    // Strip the token from the URL before doing anything else so it doesn't
    // linger in browser history, referer headers, or third-party scripts.
    if (params.has("token")) {
      params.delete("token");
      const remaining = params.toString();
      const newUrl =
        window.location.pathname + (remaining ? `?${remaining}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }

    if (!token) {
      setStatus("error");
      setErrorMsg("確認トークンが見つかりません。");
      return;
    }

    verifyEmail.mutate({ token });
    // Intentionally run only once on mount; verifyEmail is captured by closure
    // and the ref guards against React Strict Mode double-invocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-warm-white)] flex items-center justify-center px-4 text-foreground">
      <div className="w-full max-w-md text-center space-y-6">
        {status === "verifying" && (
          <>
            <div className="bg-white border border-black/10 rounded-2xl p-8 shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px]">
              <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
              <h1 className="mt-6 text-[26px] leading-tight tracking-[-0.625px] font-bold">メールアドレスを確認中...</h1>
              <p className="mt-2 text-[14px] text-[var(--color-warm-gray-500)]">しばらくお待ちください</p>
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <div className="bg-white border border-black/10 rounded-2xl p-8 shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px]">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[rgba(26,174,57,0.15)] border border-black/10 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-[#1aae39]" />
              </div>
              <h1 className="mt-6 text-[26px] leading-tight tracking-[-0.625px] font-bold">確認完了！</h1>
              <p className="mt-2 text-[14px] text-[var(--color-warm-gray-500)]">
                メールアドレスの確認が完了しました。<br />
                プロフィール入力ページへ移動します...
              </p>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div className="bg-white border border-black/10 rounded-2xl p-8 shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px]">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
                <XCircle className="w-7 h-7 text-destructive" />
              </div>
              <h1 className="mt-6 text-[26px] leading-tight tracking-[-0.625px] font-bold">確認に失敗しました</h1>
              <p className="mt-2 text-[14px] text-destructive">{errorMsg}</p>
              <div className="space-y-3 pt-6">
                <Button className="w-full h-11" onClick={() => navigate("/signup")}>
                  新規登録に戻る
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
