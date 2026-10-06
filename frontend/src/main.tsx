import { render } from "solid-js/web";
import App from "./App";
import { initTheme } from "./themeStore";
import { initUIPrefs } from "./uiPrefs";
import "./tokens.css";
import "./style.css";

void initTheme(); // apply the saved theme before anything is visible for long
void initUIPrefs(); // sidebar width, response wrap
render(() => <App />, document.getElementById("app")!);
