import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./contexts/SettingsContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
