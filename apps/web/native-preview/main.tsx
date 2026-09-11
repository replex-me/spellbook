import { createRoot } from "react-dom/client";
import "../src/app/design-system.css";
import { NativeWorkspace } from "../src/components/native-workspace";
createRoot(document.getElementById("root")!).render(
  <NativeWorkspace launch={(window as any).__presentLaunch} />,
);
