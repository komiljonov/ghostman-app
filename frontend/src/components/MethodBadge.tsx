interface Props {
  method: string;
}

// Short, color-coded HTTP method label (colors in style.css: .method-GET etc.).
export default function MethodBadge(props: Props) {
  const label = () => (props.method === "DELETE" ? "DEL" : props.method === "OPTIONS" ? "OPT" : props.method);
  return <span class={`method-badge method-${props.method}`}>{label()}</span>;
}
