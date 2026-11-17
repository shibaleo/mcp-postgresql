import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { router } from "./router";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
  </StrictMode>,
);
