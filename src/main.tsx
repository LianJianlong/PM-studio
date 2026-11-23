import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import TableFullscreen from "./TableFullscreen";
import "./styles.css";
import "./preferences.css";
import "./compact-workspace.css";
import "./mobile-workspace.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <TableFullscreen />
  </React.StrictMode>,
);
