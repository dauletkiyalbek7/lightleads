import type { ReactNode } from "react";
import { FadeIn } from "@/components/kit/motion";

/** template пересоздаётся при каждой навигации — получаем плавный переход между страницами. */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <FadeIn>{children}</FadeIn>;
}
