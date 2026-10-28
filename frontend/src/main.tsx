import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@xyflow/react/dist/style.css";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("ROOT_MISSING");
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
