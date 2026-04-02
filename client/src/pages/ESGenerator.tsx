import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { nanoid } from "nanoid";

export default function ESGenerator() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [companyName, setCompanyName] = useState("");
  const [position, setPosition] = useState("");
  const [esContent, setEsContent] = useState("");
  const [reconContent, setReconContent] = useState("");
  const [step, setStep] = useState<"input" | "recon" | "es">("input");
  const [sessionId] = useState(() => nanoid());

  const reconMutation = trpc.agent.reconCompany.useMutation({
    onSuccess: (data) => {
      setReconContent(data.report);
      setStep("recon");
      toast.success("企業リサーチが完了しました");
    },
    onError: (err) => toast.error(err.message),
  });

  const esMutation = trpc.agent.generateES.useMutation({
    onSuccess: (data) => {
      setEsContent(data.es);
      setStep("es");
      toast.success("ES生成が完了しました");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRecon = () => {
    if (!companyName) { toast.error("企業名を入力してください"); return; }
    reconMutation.mutate({ companyName });
  };

  const handleGenerateES = () => {
    if (!position) { toast.error("応募職種を入力してください"); return; }
    esMutation.mutate({ companyName, position, sessionId });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="text-muted-foreground hover:text-foreground text-sm">
          ← ダッシュボード
        </button>
        <h1 className="font-bold flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" /> ES自動生成
        </h1>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Step 1: Input */}
        <div className="p-5 rounded-xl border border-border bg-card space-y-4">
          <h2 className="font-semibold">企業情報の入力</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>企業名（日本語）</Label>
              <Input
                placeholder="例：株式会社リクルート"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="bg-input border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label>応募職種</Label>
              <Input
                placeholder="例：ITエンジニア、営業職"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="bg-input border-border"
              />
            </div>
          </div>
          <Button onClick={handleRecon} disabled={reconMutation.isPending || !companyName}>
            {reconMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />企業リサーチ中...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" />企業を深度リサーチ</>
            )}
          </Button>
        </div>

        {/* Step 2: Recon Report */}
        {(step === "recon" || step === "es") && reconContent && (
          <div className="p-5 rounded-xl border border-border bg-card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">📊 企業深度リサーチ結果</h2>
              <Button
                size="sm"
                onClick={handleGenerateES}
                disabled={esMutation.isPending || !position}
              >
                {esMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />ES生成中...</>
                ) : (
                  <><FileText className="w-4 h-4 mr-2" />このリサーチでES生成</>
                )}
              </Button>
            </div>
            <div className="prose prose-invert prose-sm max-w-none max-h-80 overflow-y-auto">
              <Streamdown>{reconContent}</Streamdown>
            </div>
          </div>
        )}

        {/* Step 3: ES Result */}
        {step === "es" && esContent && (
          <div className="p-5 rounded-xl border border-primary/30 bg-primary/5 space-y-4">
            <h2 className="font-semibold text-primary">✨ 生成されたES</h2>
            <div className="prose prose-invert prose-sm max-w-none">
              <Streamdown>{esContent}</Streamdown>
            </div>
            <Button
              variant="outline"
              className="bg-transparent"
              onClick={() => {
                navigator.clipboard.writeText(esContent);
                toast.success("クリップボードにコピーしました");
              }}
            >
              コピー
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
