import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Building2, Loader2, Plus, Send } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, { ja: string; color: string }> = {
  researching: { ja: "企業研究中", color: "status-researching" },
  es_preparing: { ja: "ES作成中", color: "status-es_preparing" },
  es_submitted: { ja: "ES提出済", color: "status-es_submitted" },
  interview_1: { ja: "1次面接", color: "status-interview_1" },
  interview_2: { ja: "2次面接", color: "status-interview_2" },
  interview_final: { ja: "最終面接", color: "status-interview_final" },
  offer: { ja: "内定", color: "status-offer" },
  rejected: { ja: "不採用", color: "status-rejected" },
  withdrawn: { ja: "辞退", color: "status-withdrawn" },
};

export default function JobTracker() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [showAdd, setShowAdd] = useState(false);
  const [newCompany, setNewCompany] = useState({ companyNameJa: "", companyNameEn: "", position: "" });

  const { data: jobs, refetch } = trpc.jobs.list.useQuery(undefined, { enabled: isAuthenticated });

  const createJob = trpc.jobs.create.useMutation({
    onSuccess: () => {
      toast.success("企業を追加しました");
      setShowAdd(false);
      setNewCompany({ companyNameJa: "", companyNameEn: "", position: "" });
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateStatus = trpc.jobs.updateStatus.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="text-muted-foreground hover:text-foreground text-sm">
          ← ダッシュボード
        </button>
        <h1 className="font-bold flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" /> 就活管理
        </h1>
        <Button size="sm" className="ml-auto" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1" /> 企業を追加
        </Button>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-4">
        {/* Add form */}
        {showAdd && (
          <div className="p-5 rounded-xl border border-primary/30 bg-card space-y-3">
            <h3 className="font-medium">新しい企業を追加</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                placeholder="企業名（日本語）*"
                value={newCompany.companyNameJa}
                onChange={(e) => setNewCompany({ ...newCompany, companyNameJa: e.target.value })}
                className="bg-input border-border"
              />
              <Input
                placeholder="Company Name (EN)"
                value={newCompany.companyNameEn}
                onChange={(e) => setNewCompany({ ...newCompany, companyNameEn: e.target.value })}
                className="bg-input border-border"
              />
              <Input
                placeholder="応募職種"
                value={newCompany.position}
                onChange={(e) => setNewCompany({ ...newCompany, position: e.target.value })}
                className="bg-input border-border"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (!newCompany.companyNameJa) { toast.error("企業名を入力してください"); return; }
                  createJob.mutate(newCompany);
                }}
                disabled={createJob.isPending}
              >
                {createJob.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "追加"}
              </Button>
              <Button size="sm" variant="outline" className="bg-transparent" onClick={() => setShowAdd(false)}>
                キャンセル
              </Button>
            </div>
          </div>
        )}

        {/* Job list */}
        {!jobs ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">まだ企業が登録されていません</p>
            <p className="text-sm mt-1">「企業を追加」から就活先を管理しましょう</p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="p-4 rounded-xl border border-border bg-card flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{job.companyNameJa}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.companyNameEn && `${job.companyNameEn} · `}
                    {job.position ?? "職種未設定"}
                  </p>
                </div>
                <Select
                  value={job.status}
                  onValueChange={(v) => updateStatus.mutate({ id: job.id, status: v as any })}
                >
                  <SelectTrigger className={`w-36 text-xs border rounded-lg px-2 py-1 h-auto ${STATUS_LABELS[job.status]?.color ?? ""}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([v, { ja }]) => (
                      <SelectItem key={v} value={v} className="text-xs">{ja}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
