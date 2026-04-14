import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [count, setCount] = useState(28);

  const { data: countData } = trpc.waitlist.getCount.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (countData && countData.count > 0) {
      // If we have some actual count, start from the higher of 28 or real count
      setCount(Math.max(28, countData.count));
    }
  }, [countData]);

  const joinMutation = trpc.waitlist.join.useMutation({
    onSuccess: (data) => {
      toast.success("先行リストに参加しました！");
      setCount(Math.max(28, data.count));
      setEmail("");
    },
    onError: (error) => {
      toast.error(error.message || "エラーが発生しました。");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    joinMutation.mutate({ email });
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-10">
        {/* Header section */}
        <div className="space-y-3">
          <p className="text-[#0075DE] font-bold tracking-widest text-sm mb-4">
            就活自动化
          </p>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tighter text-[#111] mb-1">
            日本就活。
          </h1>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tighter text-[#0075DE]">
            任せろ。
          </h1>
        </div>

        {/* Sub-headline section */}
        <div className="space-y-3 text-2xl sm:text-3xl font-medium pt-8 pb-4">
          <p className="text-gray-400">不用你去盯邮箱。</p>
          <p className="text-gray-400">不用你去排日程。</p>
          <p className="text-gray-400">不用你去写ES。</p>
          <p className="text-[#111] font-bold pt-2">内定，一定会来。</p>
          <p className="text-gray-500 text-lg font-normal pt-4">就活のすべてを、AIがサポートする。</p>
        </div>

        {/* Form section */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <Input
            type="email"
            placeholder="メールアドレスを入力"
            className="w-full h-16 text-lg rounded-2xl border-gray-200 px-6 focus-visible:ring-[#0075DE] shadow-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button
            type="submit"
            disabled={joinMutation.isPending}
            className="w-full h-16 text-lg font-bold rounded-2xl bg-[#1a1a1a] hover:bg-black text-white disabled:opacity-50"
          >
            {joinMutation.isPending ? "送信中..." : "先行リストに参加する"}
          </Button>
        </form>

        {/* Status section */}
        <div className="flex items-center justify-start text-[#0075DE] font-medium pt-2">
          <span className="relative flex h-3 w-3 mr-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0075DE] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#0075DE]"></span>
          </span>
          <span className="text-base font-semibold">すでに {count} 人が参加しています</span>
        </div>
      </div>
    </div>
  );
}
