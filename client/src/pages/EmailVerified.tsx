import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
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
      utils.auth.me.setData(undefined, data.user);
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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center space-y-6">
        {status === "verifying" && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto" />
            <h1 className="text-xl font-bold text-white">メールアドレスを確認中...</h1>
            <p className="text-gray-500 text-sm">しばらくお待ちください</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="text-6xl">✅</div>
            <h1 className="text-2xl font-bold text-white">確認完了！</h1>
            <p className="text-gray-400 text-sm">
              メールアドレスの確認が完了しました。<br />
              プロフィール入力ページへ移動します...
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-6xl">❌</div>
            <h1 className="text-2xl font-bold text-white">確認に失敗しました</h1>
            <p className="text-red-400 text-sm">{errorMsg}</p>
            <div className="space-y-3 pt-2">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700"
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
