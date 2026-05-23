import Button from '../Button';
import styles from './PhotoEditSlider.module.css';

interface PhotoEditSliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
  disabled?: boolean;
  variant?: 'default' | 'compact';
  onChange: (value: number) => void;
}

function formatValue(value: number, unit: string | undefined): string {
  const rounded = Math.round(value * 100) / 100;
  if (unit === '°') {
    const prefix = rounded > 0 ? '+' : '';
    return `${prefix}${rounded}${unit}`;
  }
  if (unit) return `${rounded}${unit}`;
  const prefix = rounded > 0 ? '+' : '';
  return `${prefix}${rounded}`;
}

export default function PhotoEditSlider({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  defaultValue = 0,
  unit,
  disabled = false,
  variant = 'default',
  onChange,
}: PhotoEditSliderProps) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.target.value));
  };

  const canReset = !disabled && value !== defaultValue;
  const isCompact = variant === 'compact';

  return (
    <div
      className={`${styles.root} ${isCompact ? styles.rootCompact : ''}`}
    >
      <div className={styles.header}>
        <div className={styles.copy}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{formatValue(value, unit)}</span>
        </div>

        {!isCompact ? (
          <Button
            color="muted"
            variant="ghost"
            size="sm"
            disabled={!canReset}
            onClick={() => onChange(defaultValue)}
          >
            Сброс
          </Button>
        ) : null}
      </div>

      <input
        type="range"
        className={`${styles.slider} ${isCompact ? styles.sliderCompact : ''}`}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
      />

      {!isCompact ? (
        <div className={styles.scale}>
          <span>{formatValue(min, unit)}</span>
          <span>{formatValue(defaultValue, unit)}</span>
          <span>{formatValue(max, unit)}</span>
        </div>
      ) : null}
    </div>
  );
}
