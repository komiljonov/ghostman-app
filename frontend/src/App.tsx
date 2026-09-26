import { createSignal, onMount } from "solid-js";
import { History, Send } from "../wailsjs/go/main/App";
import { engine, store } from "../wailsjs/go/models";
import RequestBar from "./components/RequestBar";
import ResponsePane from "./components/ResponsePane";
import HistoryList from "./components/HistoryList";

export default function App() {
  const [method, setMethod] = createSignal("GET");
  const [url, setUrl] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [response, setResponse] = createSignal<engine.Response>();
  const [error, setError] = createSignal<string>();
  const [history, setHistory] = createSignal<store.History[]>([]);

  const refreshHistory = async () => {
    try {
      setHistory(await History());
    } catch (err) {
      console.error("load history:", err);
    }
  };

  const send = async () => {
    if (loading()) return;
    setLoading(true);
    setError(undefined);
    setResponse(undefined);
    try {
      setResponse(
        await Send(engine.RequestSpec.createFrom({ method: method(), url: url(), headers: [], body: "" })),
      );
    } catch (err) {
      // Wails rejects with the Go error message: a string in the webview, an Error in browser dev mode.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      void refreshHistory();
    }
  };

  const selectHistory = (entry: store.History) => {
    setMethod(entry.method);
    setUrl(entry.url);
  };

  onMount(refreshHistory);

  return (
    <main class="app">
      <RequestBar
        method={method()}
        url={url()}
        loading={loading()}
        onMethodChange={setMethod}
        onUrlChange={setUrl}
        onSend={send}
      />
      <ResponsePane response={response()} error={error()} loading={loading()} />
      <HistoryList entries={history()} onSelect={selectHistory} />
    </main>
  );
}
