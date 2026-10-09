import { createRoot } from "react-dom/client";
import "./app/styles/global.scss";
import App from "./app/App";

createRoot(document.getElementById("root")!).render(<App />);
