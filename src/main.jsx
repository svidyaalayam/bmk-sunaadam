import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import CarnaticPage from "./CarnaticPage";
import ShruthiPage from "./ShruthiPage";
import { AuthProvider } from "./auth";
import "./index.css";

const Page =
  window.location.pathname === "/shruthi"
    ? ShruthiPage
    : window.location.pathname === "/midi"
      ? App
      : CarnaticPage;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <Page />
    </AuthProvider>
  </StrictMode>,
);
