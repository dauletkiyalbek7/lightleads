import confetti from "canvas-confetti";

const ACCENTS = ["#FF5C7A", "#FFB020", "#12B76A"];
const BRAND_VARS = ["--brand", "--brand-2"];

/** Фирменные цвета берём из текущей темы, чтобы конфетти совпадало с интерфейсом. */
function brandColors(): string[] {
  const styles = getComputedStyle(document.documentElement);
  return BRAND_VARS.map((name) => styles.getPropertyValue(name).trim()).filter(Boolean);
}

/** Короткая конфетти-микроанимация. Отключается при prefers-reduced-motion. */
export function celebrate(origin: { x: number; y: number } = { x: 0.5, y: 0.7 }) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  confetti({
    particleCount: 70,
    spread: 70,
    startVelocity: 38,
    scalar: 0.9,
    ticks: 140,
    origin,
    colors: [...brandColors(), ...ACCENTS],
    disableForReducedMotion: true,
  });
}
