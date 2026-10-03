import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tailwind.css";
import "./styles/app.css";
import "./styles/demo.css";
import App from "./App";
import { ensureDb } from "./mocks/seed";
import { installNetworkSimulation } from "./demo/settings";
import { DemoLayer } from "./demo/DemoLayer";

// La demo arranca con su "base de datos" en el navegador (datos semilla o los
// cambios guardados) antes de mostrar la app.
const boot = ensureDb();
installNetworkSimulation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <DemoLayer boot={boot} />
  </StrictMode>,
);
