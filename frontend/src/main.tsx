import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .register(import.meta.env.DEV ? "/dev-sw.js?dev-sw" : "/sw.js", { type: "module" })
    .catch(() => {
      // Reading remains online-only if this browser disallows workers.
    });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
