import { useState, useEffect, useCallback } from "react";
import { commands, type DashboardStats } from "@/lib/bindings";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  open: "hsl(220, 9%, 60%)",
  in_progress: "hsl(220, 70%, 55%)",
  done: "hsl(142, 60%, 45%)",
  cancelled: "hsl(0, 60%, 55%)",
};

const STATUS_LABELS: Record<string, string> = {
  open: "열림",
  in_progress: "진행 중",
  done: "완료",
  cancelled: "취소",
};

interface DashboardProps {
  projectId: number | null;
}

export function Dashboard({ projectId }: DashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const fetchStats = useCallback(async () => {
    const res = await commands.dashboardStats(projectId ?? null);
    if (res.status === "ok") setStats(res.data);
  }, [projectId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    window.addEventListener("refresh-planner", fetchStats);
    return () => {
      window.removeEventListener("refresh-planner", fetchStats);
    };
  }, [fetchStats]);

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        로딩 중…
      </div>
    );
  }

  if (stats.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-sm text-muted-foreground gap-2">
        <span className="text-3xl">📋</span>
        <span>아직 목표가 없습니다. 새 목표를 추가해 보세요!</span>
      </div>
    );
  }

  const pieData = [
    { name: "open", value: stats.open, label: STATUS_LABELS.open },
    {
      name: "in_progress",
      value: stats.in_progress,
      label: STATUS_LABELS.in_progress,
    },
    { name: "done", value: stats.done, label: STATUS_LABELS.done },
    {
      name: "cancelled",
      value: stats.cancelled,
      label: STATUS_LABELS.cancelled,
    },
  ].filter((d) => d.value > 0);

  const barData = [
    { name: "전체", value: stats.total },
    { name: "진행 중", value: stats.in_progress },
    { name: "완료", value: stats.done },
    { name: "기한 초과", value: stats.overdue },
  ];

  const completionRate =
    stats.total > 0 ? ((stats.done / stats.total) * 100).toFixed(0) : "0";

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="오늘 마감"
          value={stats.due_today}
          accent={stats.due_today > 0}
        />
        <StatCard
          label="기한 초과"
          value={stats.overdue}
          accent={stats.overdue > 0}
          danger
        />
        <StatCard label="진행 중" value={stats.in_progress} />
        <StatCard label="달성률" value={`${completionRate}%`} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        {/* Pie chart */}
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            상태 분포
          </h4>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={36}
                outerRadius={60}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
              >
                {pieData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={STATUS_COLORS[entry.name]}
                  />
                ))}
              </Pie>
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, _: any, props: any) =>
                  [`${value}개`, props.payload.label]
                }
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-3 mt-1">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center gap-1 text-[11px]">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[d.name] }}
                />
                {d.label}
              </div>
            ))}
          </div>
        </div>

        {/* Bar chart */}
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            목표 요약
          </h4>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={barData} barSize={24}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={24}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {barData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={
                      i === 3
                        ? STATUS_COLORS.cancelled
                        : `hsl(220, ${30 + i * 20}%, ${55 - i * 5}%)`
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Average progress */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            활성 목표 평균 진행률
          </h4>
          <span className="text-sm font-semibold tabular-nums">
            {((stats.avg_progress ?? 0) * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${(stats.avg_progress ?? 0) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-center transition-colors ${
        accent && danger
          ? "border-destructive/40 bg-destructive/5"
          : accent
            ? "border-primary/40 bg-primary/5"
            : "bg-card"
      }`}
    >
      <div
        className={`text-2xl font-bold tabular-nums ${
          accent && danger ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
