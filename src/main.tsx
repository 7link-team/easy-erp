import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components";
import { ConfirmationProvider } from "./ui";
import "./style.css";
import "./responsive.css";
import "./theme.css";
import "./controls.css";
import "./movement.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ConfirmationProvider>
        <App />
      </ConfirmationProvider>
    </ErrorBoundary>
  </StrictMode>,
);
