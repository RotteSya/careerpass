import { Button } from "@/components/ui/button";
import { BrainCircuit, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center gap-2 mb-10">
          <div className="w-9 h-9 rounded-sm bg-[#faff69] flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-black" />
          </div>
          <div className="text-left">
            <p className="font-black text-lg leading-tight">就活パス</p>
            <p className="text-[10px] font-mono text-[#a0a0a0]">CareerPass</p>
          </div>
        </div>

        <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#faff69] mb-3">// 404</p>
        <p className="text-[10rem] font-black text-[#faff69] leading-none select-none mb-4 tracking-tighter">
          404
        </p>

        <h1 className="text-2xl font-black tracking-tight mb-3">ページが見つかりません</h1>
        <p className="text-[#a0a0a0] text-sm mb-8 leading-relaxed">
          お探しのページは存在しないか、移動または削除された可能性があります。
        </p>

        <Button onClick={() => navigate("/")} variant="neon" className="gap-2 rounded-sm">
          <Home className="w-4 h-4" />
          トップページへ戻る
        </Button>
      </div>
    </div>
  );
}
