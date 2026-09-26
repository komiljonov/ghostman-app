interface Props {
  status: number;
  text?: string;
}

function statusClass(status: number): string {
  if (status === 0) return "status-none";
  if (status < 300) return "status-ok";
  if (status < 400) return "status-redirect";
  if (status < 500) return "status-client";
  return "status-server";
}

// Status 0 means no HTTP response was received (see the history migration).
export default function StatusBadge(props: Props) {
  return (
    <span class={`status ${statusClass(props.status)}`}>
      {props.status === 0 ? "ERR" : props.status}
      {props.text ? ` ${props.text}` : ""}
    </span>
  );
}
