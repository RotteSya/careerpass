import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { BrainCircuit, Loader2, Mic, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

type Message = { role: "user" | "assistant"; content: string };

export default function InterviewSimulator() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [companyName, setCompanyName] = useState("");
  const [position, setPosition] = useState("");
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const interviewMutation = trpc.agent.startInterview.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.question }]);
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (!isAuthenticated) navigate("/");
  }, [isAuthenticated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleStart = () => {
    if (!companyName || !position) { toast.error("企業名と職種を入力してください"); return; }
    setStarted(true);
    interviewMutation.mutate({ companyName, position, history: [] });
  };

  const handleAnswer = () => {
    if (!input.trim() || interviewMutation.isPending) return;
    const answer = input.trim();
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: answer }];
    setMessages(newMessages);
    interviewMutation.mutate({
      companyName,
      position,
      history: newMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      userAnswer: answer,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAnswer(); }
  };

  if (!started) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate("/dashboard")} className="text-muted-foreground hover:text-foreground text-sm">
            ← ダッシュボード
          </button>
          <h1 className="font-bold flex items-center gap-2">
            <Mic className="w-4 h-4 text-primary" /> 模擬面接
          </h1>
        </div>
        <div className="p-6 max-w-lg mx-auto">
          <div className="p-6 rounded-2xl border border-border bg-card space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-3">
                <BrainCircuit className="w-7 h-7 text-primary" />
              </div>
              <h2 className="text-xl font-bold">模擬面接を開始</h2>
              <p className="text-sm text-muted-foreground mt-1">
                厳格な日本企業の面接官があなたのESを深掘りします
              </p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
              ⚠️ 面接官は非常に厳格です。曖昧な回答は容赦なく指摘されます。本番のつもりで臨んでください。
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>面接企業名</Label>
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
                  placeholder="例：ITエンジニア"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="bg-input border-border"
                />
              </div>
            </div>
            <Button className="w-full" onClick={handleStart} disabled={interviewMutation.isPending}>
              {interviewMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />準備中...</>
              ) : "面接を開始する"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => { setStarted(false); setMessages([]); }}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← 終了
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
            <BrainCircuit className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-medium">{companyName} 面接官</p>
            <p className="text-xs text-muted-foreground">{position} · 模擬面接中</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          <span className="text-xs text-red-400 font-medium">面接中</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 mt-1">
                <BrainCircuit className="w-4 h-4 text-red-400" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-tr-sm"
                : "bg-card border border-border rounded-tl-sm"
            }`}>
              {msg.role === "assistant" ? (
                <Streamdown className="prose prose-invert prose-sm max-w-none">{msg.content}</Streamdown>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {interviewMutation.isPending && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
              <BrainCircuit className="w-4 h-4 text-red-400" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                <div className="w-2 h-2 rounded-full bg-red-400/60 animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2 h-2 rounded-full bg-red-400/60 animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2 h-2 rounded-full bg-red-400/60 animate-bounce" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border bg-card/50 p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="回答を入力してください... (Shift+Enter で改行)"
            className="flex-1 resize-none bg-input border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px] max-h-32"
            rows={1}
          />
          <Button
            onClick={handleAnswer}
            disabled={!input.trim() || interviewMutation.isPending}
            size="icon"
            className="h-12 w-12 shrink-0 rounded-xl"
          >
            {interviewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
