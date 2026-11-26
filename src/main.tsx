import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { SpaceGame } from "./components/space-game";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SpaceGame />
  </StrictMode>
);
