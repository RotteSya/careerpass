import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { BrainCircuit, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const educationOptions = [
  { value: "high_school", label: "高校卒 / 高中毕业" },
  { value: "associate", label: "短大・専門卒 / 专科毕业" },
  { value: "bachelor", label: "大学卒 / 本科毕业" },
  { value: "master", label: "大学院（修士）/ 硕士" },
  { value: "doctor", label: "大学院（博士）/ 博士" },
  { value: "other", label: "その他 / 其他" },
];

const languageOptions = [
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

export default function Register() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const [form, setForm] = useState({
    name: "",
    birthDate: "",
    education: "",
    universityName: "",
    preferredLanguage: "ja",
  });
  const [step, setStep] = useState(1);

  const utils = trpc.useUtils();

  const completeRegistration = trpc.user.completeRegistration.useMutation({
    onSuccess: async () => {
      toast.success("登録が完了しました！ / 注册成功！");
      // Invalidate profile cache BEFORE navigating so Dashboard reads updated profileCompleted=true
      await utils.user.getProfile.invalidate();
      navigate("/dashboard");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
    }
    if (!loading && isAuthenticated && user) {
      // Pre-fill name from OAuth
      setForm((f) => ({ ...f, name: user.name ?? "" }));
    }
  }, [loading, isAuthenticated, user]);

  const handleSubmit = () => {
    if (!form.name || !form.birthDate || !form.education || !form.universityName) {
      toast.error("全ての項目を入力してください / 请填写所有必填项");
      return;
    }
    completeRegistration.mutate({
      name: form.name,
      birthDate: form.birthDate,
      education: form.education as any,
      universityName: form.universityName,
      preferredLanguage: form.preferredLanguage as any,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-warm-white)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const inputCls =
    "h-11 rounded-[4px]";

  return (
    <div className="min-h-screen bg-[var(--color-warm-white)] text-foreground flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <p className="font-semibold text-[15px] leading-tight">就活パス</p>
            <p className="text-[12px] text-[var(--color-warm-gray-500)]">CareerPass</p>
          </div>
        </div>

        <p className="text-[12px] text-[var(--color-warm-gray-500)] text-center mb-4">
          STEP {step} / 2
        </p>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-semibold transition-colors ${
                  step > s
                    ? "bg-[rgba(26,174,57,0.15)] text-[#1aae39] border border-black/10"
                    : step === s
                    ? "bg-[var(--color-badge-blue-bg)] text-[var(--color-notion-blue)] border border-black/10"
                    : "bg-white text-[var(--color-warm-gray-300)] border border-black/10"
                }`}
              >
                {step > s ? <CheckCircle2 className="w-4 h-4" /> : s}
              </div>
              {s < 2 && (
                <div
                  className={`flex-1 h-px ${step > s ? "bg-[#1aae39]/40" : "bg-black/10"}`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white border border-black/10 rounded-2xl p-6 shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px]">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-[22px] font-bold tracking-[-0.25px]">基本情報の入力</h2>
                <p className="text-[14px] text-[var(--color-warm-gray-500)] mt-1">
                  就活サポートに必要な基本情報を入力してください
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[12px] text-[var(--color-warm-gray-500)]">
                    氏名 / 姓名 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="例：山田 太郎 / 张三"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="birthDate" className="text-[12px] text-[var(--color-warm-gray-500)]">
                    生年月日 / 出生日期 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="birthDate"
                    type="date"
                    value={form.birthDate}
                    onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[12px] text-[var(--color-warm-gray-500)]">
                    最終学歴 / 最高学历 <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.education}
                    onValueChange={(v) => setForm({ ...form, education: v })}
                  >
                    <SelectTrigger className={inputCls}>
                      <SelectValue placeholder="学歴を選択 / 选择学历" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-black/10 rounded-xl shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px]">
                      {educationOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="university" className="text-[12px] text-[var(--color-warm-gray-500)]">
                    大学名 / 大学名称 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="university"
                    placeholder="例：立命館大学 / 贵州大学"
                    value={form.universityName}
                    onChange={(e) => setForm({ ...form, universityName: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>

              <Button
                className="w-full h-11"
                onClick={() => {
                  if (!form.name || !form.birthDate || !form.education || !form.universityName) {
                    toast.error("全ての項目を入力してください");
                    return;
                  }
                  setStep(2);
                }}
              >
                次へ <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-[22px] font-bold tracking-[-0.25px]">言語設定</h2>
                <p className="text-[14px] text-[var(--color-warm-gray-500)] mt-1">
                  AIコーチとの会話言語を選択してください
                </p>
              </div>

              <div className="space-y-3">
                {languageOptions.map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => setForm({ ...form, preferredLanguage: lang.value })}
                    className={`w-full p-4 rounded-xl border text-left transition-all ${
                      form.preferredLanguage === lang.value
                        ? "border-[#097fe8] bg-[var(--color-badge-blue-bg)]"
                        : "border-black/10 bg-white hover:bg-[var(--color-warm-white)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{lang.label}</span>
                      {form.preferredLanguage === lang.value && (
                        <CheckCircle2 className="w-5 h-5 text-[#097fe8]" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setStep(1)}>
                  戻る
                </Button>
                <Button
                  className="flex-1 h-11"
                  onClick={handleSubmit}
                  disabled={completeRegistration.isPending}
                >
                  {completeRegistration.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "登録完了"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[12px] text-[var(--color-warm-gray-500)] mt-5">
          登録することで、利用規約とプライバシーポリシーに同意したものとみなします
        </p>
      </div>
    </div>
  );
}
