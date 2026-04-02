import { Button } from "@/components/ui/button";
import { BrainCircuit, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <BrainCircuit className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="text-left">
            <p className="font-bold text-lg leading-tight">就活パス</p>
            <p className="text-xs text-muted-foreground">CareerPass</p>
          </div>
        </div>

        {/* 404 */}
        <div className="mb-6">
          <p className="text-8xl font-black text-primary/20 select-none leading-none">404</p>
        </div>

        <h1 className="text-2xl font-bold mb-3">ページが見つかりません</h1>
        <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
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
