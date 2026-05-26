import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./contexts/SettingsContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { Toaster } from "./components/ui/Toaster";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <WorkspaceProvider>
        <App />
        <Toaster />
      </WorkspaceProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
