import { trpc } from "@/lib/trpc";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function CalendarCallback() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  const handleCallback = trpc.calendar.handleCallback.useMutation({
    onSuccess: (data) => {
      setStatus("success");
      setMessage(
        `${data.provider === "google" ? "Google" : "Outlook"} カレンダーの連携が完了しました！`
      );
      setTimeout(() => navigate("/dashboard"), 2000);
    },
    onError: (err) => {
      setStatus("error");
      setMessage(err.message);
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");

    if (error) {
      setStatus("error");
      setMessage(`認証がキャンセルされました: ${error}`);
      setTimeout(() => navigate("/dashboard"), 3000);
      return;
    }

    if (!code || !state) {
      setStatus("error");
      setMessage("認証コードが見つかりません");
      setTimeout(() => navigate("/dashboard"), 3000);
      return;
    }

    handleCallback.mutate({
      code,
      state,
      redirectUri: `${window.location.origin}/dashboard/calendar/callback`,
    });
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-warm-white)] flex items-center justify-center px-4">
      <div className="text-center space-y-4 p-8 bg-white border border-black/10 rounded-2xl shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px]">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
            <p className="text-[22px] font-bold tracking-[-0.25px]">カレンダーと連携中...</p>
            <p className="text-[14px] text-[var(--color-warm-gray-500)]">しばらくお待ちください</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="w-12 h-12 text-[#1aae39] mx-auto" />
            <p className="text-[22px] font-bold tracking-[-0.25px]">{message}</p>
            <p className="text-[14px] text-[var(--color-warm-gray-500)]">ダッシュボードに戻ります...</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-destructive mx-auto" />
            <p className="text-[22px] font-bold tracking-[-0.25px] text-destructive">連携に失敗しました</p>
            <p className="text-[14px] text-[var(--color-warm-gray-500)]">{message}</p>
            <p className="text-[12px] text-[var(--color-warm-gray-300)]">ダッシュボードに戻ります...</p>
          </>
        )}
      </div>
    </div>
  );
}
