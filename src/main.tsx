import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/react";
import { Toaster } from "sonner";
import { router } from "./router";
import { publicConfig } from "@/lib/public-config";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publicConfig.clerkPublishableKey}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
    </ClerkProvider>
  </StrictMode>,
);
