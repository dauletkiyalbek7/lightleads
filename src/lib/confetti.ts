import confetti from "canvas-confetti";

const COLORS = ["#6D5BFF", "#3D8BFF", "#FF5C7A", "#FFB020", "#12B76A"];

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
    colors: COLORS,
    disableForReducedMotion: true,
  });
}
