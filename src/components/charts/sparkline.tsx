import { useId } from "react";

const WIDTH = 120;
const HEIGHT = 36;
const PAD = 3;

/** Мини-график тренда для KPI-карточки. Без осей и подписей: значение рядом. */
export function Sparkline({ data, color, className }: { data: number[]; color: string; className?: string }) {
  const id = useId();
  if (data.length < 2) return <div className={className} style={{ height: HEIGHT }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = WIDTH / (data.length - 1);
  const points = data.map((v, i) => [i * step, HEIGHT - PAD - ((v - min) / span) * (HEIGHT - PAD * 2)] as const);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className={className} style={{ height: HEIGHT }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.18" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Сглаживание скользящим средним: дневные продажи слишком «рваные» для спарклайна. */
export function smooth(data: number[], window = 3): number[] {
  return data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}
