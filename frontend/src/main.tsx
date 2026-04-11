import React from "react";
import ReactDOM from "react-dom/client";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import { registerSW } from "virtual:pwa-register";
import App from "./App";

ModuleRegistry.registerModules([AllCommunityModule]);

// Register the service worker. `autoUpdate` means new builds install in
// the background and activate on the next full navigation.
if (typeof window !== "undefined") {
  registerSW({ immediate: true });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><App /></React.StrictMode>
);
