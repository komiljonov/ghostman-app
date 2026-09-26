// Left sidebar when no project is selected (ProjectTree takes over once one is).
export default function ProjectSidebar() {
  return (
    <nav class="sidebar" aria-label="Project tree">
      <p class="placeholder small">Select or create a project</p>
    </nav>
  );
}
