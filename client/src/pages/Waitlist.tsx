import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function Waitlist() {
  const [email, setEmail] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    // Simulate joining waitlist
    toast.success("您已成功加入候补名单，敬请期待！");
    setEmail("");
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-10">
        {/* Header section */}
        <div className="space-y-3">
          <p className="text-[#00A86B] font-bold tracking-widest text-sm mb-4">
            增长自动化
          </p>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tighter text-[#111] mb-1">
            持续获客。
          </h1>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tighter text-[#00A86B]">
            全自动。
          </h1>
        </div>

        {/* Sub-headline section */}
        <div className="space-y-3 text-2xl sm:text-3xl font-medium pt-8 pb-4">
          <p className="text-gray-400">不用你去做 SEO。</p>
          <p className="text-gray-400">不用你去写内容。</p>
          <p className="text-gray-400">不用你去管分发。</p>
          <p className="text-[#111] font-bold pt-2">用户，自己会来。</p>
        </div>

        {/* Form section */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <Input
            type="email"
            placeholder="输入你的邮箱"
            className="w-full h-16 text-lg rounded-2xl border-gray-200 px-6 focus-visible:ring-[#00A86B] shadow-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button
            type="submit"
            className="w-full h-16 text-lg font-bold rounded-2xl bg-[#1a1a1a] hover:bg-black text-white"
          >
            加入候补名单
          </Button>
        </form>

        {/* Status section */}
        <div className="flex items-center justify-start text-[#00A86B] font-medium pt-2">
          <span className="relative flex h-3 w-3 mr-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00A86B] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#00A86B]"></span>
          </span>
          <span className="text-base font-semibold">已有 28 人加入候补名单</span>
        </div>
      </div>
    </div>
  );
}
