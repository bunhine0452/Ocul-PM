import { useState } from "react";
import { Button } from "@/components/ui/button";
import { commands, type DbHealth } from "@/lib/bindings";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import "./App.css";

function App() {
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  async function checkDb() {
    const result = await commands.dbHealth();
    if (result.status === "ok") {
      setHealth(result.data);
      setHealthError(null);
    } else {
      setHealthError(result.error);
      setHealth(null);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center gap-8 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">AI-PM</h1>
        <p className="text-muted-foreground text-sm">M1 — Foundation</p>
      </div>

      <SettingsPanel />

      <section className="w-full max-w-md rounded-lg border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Diagnostics</h2>

        <Button variant="outline" onClick={checkDb} className="w-full">
          Check DB Health
        </Button>

        {health && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs font-mono space-y-1">
            <div>
              <span className="text-muted-foreground">sqlite: </span>
              {health.sqlite_version}
            </div>
            <div>
              <span className="text-muted-foreground">vec: </span>
              {health.vec_version}
            </div>
            <div>
              <span className="text-muted-foreground">schema: </span>v
              {health.schema_version}
            </div>
            <div className="break-all">
              <span className="text-muted-foreground">path: </span>
              {health.path}
            </div>
          </div>
        )}

        {healthError && (
          <p className="text-sm text-destructive">Error: {healthError}</p>
        )}
      </section>
    </main>
  );
}

export default App;
