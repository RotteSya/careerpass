import { Button } from "@/components/ui/button";
import { BrainCircuit, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-[var(--color-warm-white)] text-foreground flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center gap-2 mb-10">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-[15px] leading-tight">就活パス</p>
            <p className="text-[12px] text-[var(--color-warm-gray-500)]">CareerPass</p>
          </div>
        </div>

        <p className="text-[64px] font-bold leading-none select-none mb-4 tracking-[-2.125px]">
          404
        </p>

        <h1 className="text-[26px] leading-tight tracking-[-0.625px] font-bold mb-3">ページが見つかりません</h1>
        <p className="text-[14px] text-[var(--color-warm-gray-500)] mb-8 leading-relaxed">
          お探しのページは存在しないか、移動または削除された可能性があります。
        </p>

        <Button onClick={() => navigate("/")} className="gap-2">
          <Home className="w-4 h-4" />
          トップページへ戻る
        </Button>
      </div>
    </div>
  );
}
