import { useState } from "react";
import { Button } from "@/components/ui/button";
import { commands, type DbHealth } from "@/lib/bindings";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  async function greet() {
    setGreetMsg(await commands.greet(name));
  }

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
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">AI-PM</h1>
        <p className="text-muted-foreground text-sm">
          M1 — DB layer smoke test
        </p>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="이름을 입력하세요"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit">Greet</Button>
      </form>

      {greetMsg && <p className="text-sm text-muted-foreground">{greetMsg}</p>}

      <div className="flex flex-col items-center gap-3">
        <Button variant="outline" onClick={checkDb}>
          Check DB Health
        </Button>

        {health && (
          <div className="rounded-md border bg-muted/40 p-4 text-xs font-mono w-[28rem] max-w-full space-y-1">
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
      </div>
    </main>
  );
}

export default App;
