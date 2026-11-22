interface Props {
  on: boolean;
  disabled?: boolean;
  /** Komut gönderiliyor: anahtar meşgul görünür ve tıklanamaz */
  busy?: boolean;
  label?: string;
  onChange: () => void;
}

export default function Toggle({ on, disabled, busy, label, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-busy={busy || undefined}
      aria-label={label}
      className={`toggle ${on ? "on" : ""} ${busy ? "busy" : ""}`}
      disabled={disabled || busy}
      onClick={(ev) => {
        ev.stopPropagation();
        onChange();
      }}
    >
      <span className="knob" />
    </button>
  );
}
