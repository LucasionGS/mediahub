import { createRoot } from "react-dom/client";
import "./companion/companion.scss";
import CompanionApp from "./companion/CompanionApp";

createRoot(document.getElementById("root")!).render(<CompanionApp />);
