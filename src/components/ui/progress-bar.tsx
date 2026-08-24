interface ProgressBarProps {
  value: number;
  label: string;
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className="progress" aria-label={`${label}: ${clamped}%`}>
      <div className="progress__track">
        <span className="progress__value" style={{ width: `${clamped}%` }} />
      </div>
      <span className="progress__label">{clamped}%</span>
    </div>
  );
}
