import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { BrainCircuit, Loader2, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Streamdown } from "streamdown";
import { nanoid } from "nanoid";

type Message = { role: "user" | "assistant"; content: string };

const WELCOME_MESSAGES: Record<string, string> = {
  ja: "こんにちは！私は就活パスのAIキャリアアドバイザーです。\n\n日本の就職活動を全力でサポートします。まず、あなたの経験について教えてください。\n\nどんな**インターン・アルバイト・プロジェクト・研究**の経験がありますか？",
  zh: "你好！我是就活パス的AI求职顾问。\n\n我将全力支持你的日本求职活动。首先，请告诉我你的经历。\n\n你有哪些**实习、兼职、项目或研究**经历？",
  en: "Hello! I'm the AI Career Advisor for CareerPass.\n\nI'm here to fully support your Japanese job hunting. First, let me learn about your experiences.\n\nWhat **internship, part-time, project, or research** experiences do you have?",
};

export default function AgentChat() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const { data: profile } = trpc.user.getProfile.useQuery(undefined, { enabled: isAuthenticated });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => nanoid());
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.agent.chat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    },
    onError: (err) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `エラーが発生しました: ${err.message}` },
      ]);
    },
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/");
  }, [loading, isAuthenticated]);

  useEffect(() => {
    if (profile && messages.length === 0) {
      const lang = profile.preferredLanguage ?? "ja";
      setMessages([{ role: "assistant", content: WELCOME_MESSAGES[lang] ?? WELCOME_MESSAGES.ja }]);
    }
  }, [profile]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || chatMutation.isPending) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    chatMutation.mutate({
      message: userMsg,
      sessionId,
      history: messages.slice(-10),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="text-muted-foreground hover:text-foreground transition-colors text-sm">
          ← ダッシュボード
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <BrainCircuit className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">CareerPass AI</p>
            <p className="text-xs text-muted-foreground">就活専属アドバイザー</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-muted-foreground">オンライン</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                <BrainCircuit className="w-4 h-4 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-card border border-border rounded-tl-sm"
              }`}
            >
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
        {chatMutation.isPending && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <BrainCircuit className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card/50 p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力... (Shift+Enter で改行)"
            className="flex-1 resize-none bg-input border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px] max-h-32"
            rows={1}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || chatMutation.isPending}
            size="icon"
            className="h-12 w-12 shrink-0 rounded-xl"
          >
            {chatMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          AIの回答は参考情報です。重要な決定は専門家にご相談ください。
        </p>
      </div>
    </div>
  );
}
