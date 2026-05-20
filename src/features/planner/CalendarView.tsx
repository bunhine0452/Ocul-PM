import { useState, useEffect, useMemo, useCallback } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
} from "date-fns";
import { ko } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { commands, type Goal } from "@/lib/bindings";
import { ChevronLeft, ChevronRight } from "@/components/Icons";

interface CalendarViewProps {
  projectId: number | null;
}

const STATUS_DOT: Record<string, string> = {
  open: "bg-muted-foreground",
  in_progress: "bg-blue-500",
  done: "bg-emerald-500",
  cancelled: "bg-destructive",
};

export function CalendarView({ projectId }: CalendarViewProps) {
  const [current, setCurrent] = useState(new Date());
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const fetchGoals = useCallback(async () => {
    const res = await commands.goalList(projectId ?? null, null);
    if (res.status === "ok") setGoals(res.data);
  }, [projectId]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  useEffect(() => {
    window.addEventListener("refresh-planner", fetchGoals);
    return () => {
      window.removeEventListener("refresh-planner", fetchGoals);
    };
  }, [fetchGoals]);

  const monthStart = startOfMonth(current);
  const monthEnd = endOfMonth(current);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  // Build array of days
  const days: Date[] = [];
  let d = calStart;
  while (d <= calEnd) {
    days.push(d);
    d = addDays(d, 1);
  }

  // Map goals by date
  const goalsByDate = useMemo(() => {
    const map = new Map<string, Goal[]>();
    for (const g of goals) {
      if (!g.due_date) continue;
      const key = format(new Date(g.due_date * 1000), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(g);
      map.set(key, list);
    }
    return map;
  }, [goals]);

  const selectedGoals = selectedDate
    ? goalsByDate.get(format(selectedDate, "yyyy-MM-dd")) ?? []
    : [];

  const weekDays = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrent(subMonths(current, 1))}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <h3 className="text-sm font-semibold">
          {format(current, "yyyy년 M월", { locale: ko })}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrent(addMonths(current, 1))}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-px">
        {weekDays.map((wd) => (
          <div
            key={wd}
            className="text-center text-[11px] text-muted-foreground font-medium py-1"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px rounded-lg border overflow-hidden bg-border">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayGoals = goalsByDate.get(key) ?? [];
          const inMonth = isSameMonth(day, current);
          const today = isToday(day);
          const selected = selectedDate && isSameDay(day, selectedDate);

          return (
            <button
              key={key}
              onClick={() =>
                setSelectedDate(
                  selected ? null : day,
                )
              }
              className={`relative flex flex-col items-center py-2 min-h-[3.2rem] transition-colors
                ${inMonth ? "bg-card" : "bg-muted/30"}
                ${today ? "ring-1 ring-primary ring-inset" : ""}
                ${selected ? "bg-primary/10" : "hover:bg-muted/50"}
              `}
            >
              <span
                className={`text-xs tabular-nums ${
                  !inMonth ? "text-muted-foreground/40" : ""
                } ${today ? "font-bold text-primary" : ""}`}
              >
                {format(day, "d")}
              </span>

              {/* Goal dots */}
              {dayGoals.length > 0 && (
                <div className="flex gap-0.5 mt-1">
                  {dayGoals.slice(0, 3).map((g) => (
                    <span
                      key={g.id}
                      className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[g.status] ?? STATUS_DOT.open}`}
                    />
                  ))}
                  {dayGoals.length > 3 && (
                    <span className="text-[9px] text-muted-foreground leading-none">
                      +{dayGoals.length - 3}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected date detail */}
      {selectedDate && (
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {format(selectedDate, "M월 d일 (EEEE)", { locale: ko })}
          </h4>
          {selectedGoals.length === 0 ? (
            <p className="text-xs text-muted-foreground">마감 목표 없음</p>
          ) : (
            <ul className="space-y-1.5">
              {selectedGoals.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[g.status]}`}
                  />
                  <span
                    className={
                      g.status === "done"
                        ? "line-through text-muted-foreground"
                        : ""
                    }
                  >
                    {g.title}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 ml-auto"
                  >
                    {g.status === "open"
                      ? "열림"
                      : g.status === "in_progress"
                        ? "진행 중"
                        : g.status === "done"
                          ? "완료"
                          : "취소"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
