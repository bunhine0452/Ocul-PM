import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { commands, type Goal, type Project } from "@/lib/bindings";
import { GoalCard } from "./GoalCard";
import { GoalForm } from "./GoalForm";
import { Dashboard } from "./Dashboard";
import { CalendarView } from "./CalendarView";
import { useGoals } from "./hooks";
import { Clipboard, Target } from "@/components/Icons";

const STATUS_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "open", label: "열림" },
  { value: "in_progress", label: "진행 중" },
  { value: "done", label: "완료" },
  { value: "cancelled", label: "취소" },
];

interface PlannerPanelProps {
  activeProjectId?: number | null;
}

export function PlannerPanel({ activeProjectId = null }: PlannerPanelProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);

  const projectId =
    activeProjectId !== null
      ? activeProjectId
      : (filterProject === "all" ? null : Number(filterProject));
      
  const statusFilter =
    filterStatus === "all" ? null : filterStatus;

  const { goals, loading, refresh } = useGoals(projectId, statusFilter);

  useEffect(() => {
    (async () => {
      const res = await commands.listProjects();
      if (res.status === "ok") setProjects(res.data);
    })();
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      refresh();
    };
    window.addEventListener("refresh-planner", handleRefresh);
    return () => {
      window.removeEventListener("refresh-planner", handleRefresh);
    };
  }, [refresh]);

  function handleEdit(goal: Goal) {
    setEditGoal(goal);
    setFormOpen(true);
  }

  function handleNew() {
    setEditGoal(null);
    setFormOpen(true);
  }

  return (
    <section className="w-full h-full flex flex-col min-h-0 space-y-6 p-6">
      <div className="flex items-center justify-between border-b border-border/50 pb-4 shrink-0">
        <h2 className="text-xl font-heading font-semibold flex items-center gap-2">
          <Clipboard className="w-5 h-5 text-primary" strokeWidth={2.2} />
          <span>목표 관리</span>
        </h2>
        <Button size="sm" onClick={handleNew} className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md">
          + 새 목표
        </Button>
      </div>

      <Tabs defaultValue="goals" className="w-full flex-1 flex flex-col min-h-0">
        <TabsList className="w-full grid grid-cols-3 shrink-0">
          <TabsTrigger value="goals">목표 목록</TabsTrigger>
          <TabsTrigger value="dashboard">대시보드</TabsTrigger>
          <TabsTrigger value="calendar">캘린더</TabsTrigger>
        </TabsList>

        {/* ===== Goals list tab ===== */}
        <TabsContent value="goals" className="flex-1 flex flex-col min-h-0 mt-4 space-y-4 overflow-hidden">
          {/* Filters */}
          <div className="flex gap-2 shrink-0">
            <Select
              value={filterStatus}
              onValueChange={setFilterStatus}
            >
              <SelectTrigger aria-label="상태 필터" className="w-[120px] h-8 text-xs">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {activeProjectId === null && (
              <Select
                value={filterProject}
                onValueChange={setFilterProject}
              >
                <SelectTrigger aria-label="프로젝트 필터" className="w-[140px] h-8 text-xs">
                  <SelectValue placeholder="프로젝트" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 프로젝트</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Goal cards */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              로딩 중…
            </div>
          ) : goals.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
              <Target className="w-10 h-10 text-muted-foreground/45" strokeWidth={1.5} />
              <span>목표가 없습니다. 새 목표를 추가해 보세요!</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin space-y-3 min-h-0">
              {goals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  projects={projects}
                  onEdit={handleEdit}
                  onRefresh={refresh}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ===== Dashboard tab ===== */}
        <TabsContent value="dashboard" className="flex-1 overflow-y-auto pr-1 scrollbar-thin mt-4 min-h-0">
          <Dashboard projectId={projectId} />
        </TabsContent>

        {/* ===== Calendar tab ===== */}
        <TabsContent value="calendar" className="flex-1 overflow-y-auto pr-1 scrollbar-thin mt-4 min-h-0">
          <CalendarView projectId={projectId} />
        </TabsContent>
      </Tabs>


      {/* Goal form dialog */}
      <GoalForm
        open={formOpen}
        onOpenChange={setFormOpen}
        projects={projects}
        editGoal={editGoal}
        onSaved={refresh}
      />
    </section>
  );
}
