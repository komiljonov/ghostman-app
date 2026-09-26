interface Props {
  hasProject: boolean;
}

// Left sidebar: reserved for the current project's folders/requests tree.
export default function ProjectSidebar(props: Props) {
  return (
    <nav class="sidebar" aria-label="Project tree">
      <p class="placeholder small">
        {props.hasProject ? "Folders & requests coming next" : "Select or create a project"}
      </p>
    </nav>
  );
}
