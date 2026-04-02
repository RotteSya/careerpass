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
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4 p-8">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
            <p className="text-lg font-medium">カレンダーと連携中...</p>
            <p className="text-sm text-muted-foreground">しばらくお待ちください</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
            <p className="text-lg font-medium text-green-300">{message}</p>
            <p className="text-sm text-muted-foreground">ダッシュボードに戻ります...</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-destructive mx-auto" />
            <p className="text-lg font-medium text-destructive">連携に失敗しました</p>
            <p className="text-sm text-muted-foreground">{message}</p>
            <p className="text-xs text-muted-foreground">ダッシュボードに戻ります...</p>
          </>
        )}
      </div>
    </div>
  );
}
