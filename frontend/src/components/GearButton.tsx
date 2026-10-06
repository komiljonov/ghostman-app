import Icon from "./Icon";

interface Props {
  onClick: () => void;
}

export default function GearButton(props: Props) {
  return (
    <button type="button" class="icon-button" title="Settings" aria-label="Settings" onClick={() => props.onClick()}>
      <Icon name="settings" size={18} />
    </button>
  );
}
