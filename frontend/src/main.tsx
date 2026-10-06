import { render } from "solid-js/web";
import App from "./App";
import { initTheme } from "./themeStore";
import "./tokens.css";
import "./style.css";

void initTheme(); // apply the saved theme before anything is visible for long
render(() => <App />, document.getElementById("app")!);
