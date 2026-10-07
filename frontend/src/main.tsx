import { render } from "solid-js/web";
import App from "./App";
import { initTheme } from "./themeStore";
import { initUIPrefs } from "./uiPrefs";
import { initRedirectDefault } from "./redirectDefault";
import "./tokens.css";
import "./style.css";

void initTheme(); // apply the saved theme before anything is visible for long
void initUIPrefs(); // sidebar width, response wrap
void initRedirectDefault(); // follow-redirects default (Settings)
render(() => <App />, document.getElementById("app")!);
