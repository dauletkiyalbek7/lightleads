import { Image as ImageIcon, Layers, Play } from "lucide-react";
import type { Creative, Platform } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "./brand";

const HUE_SHIFT = 48;
const SECONDS_IN_MINUTE = 60;

const formatDuration = (sec: number) =>
  `${Math.floor(sec / SECONDS_IN_MINUTE)}:${String(sec % SECONDS_IN_MINUTE).padStart(2, "0")}`;

interface CreativeThumbProps {
  creative: Creative;
  platform?: Platform;
  /** mini — квадрат 48px для списков; card — обложка 4:5 с «проигрыванием» при наведении. */
  variant?: "mini" | "card";
  className?: string;
}

/**
 * Превью креатива. В демо реальных файлов нет, поэтому обложка генерируется из оттенка креатива.
 * Видео «проигрывается» при наведении на родителя с классом `group`: наезд камеры и полоса прогресса.
 * В Фазе 2 сюда придут превью, скачанные в Supabase Storage.
 */
export function CreativeThumb({ creative, platform, variant = "card", className }: CreativeThumbProps) {
  const { hue, type } = creative;
  const background = `linear-gradient(150deg, hsl(${hue} 88% 70%) 0%, hsl(${(hue + HUE_SHIFT) % 360} 86% 58%) 100%)`;
  const TypeIcon = type === "video" ? Play : type === "carousel" ? Layers : ImageIcon;

  if (variant === "mini") {
    return (
      <span
        className={cn("relative inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[14px] text-white", className)}
        style={{ background }}
      >
        <span className="absolute -top-3 -right-3 size-8 rounded-full bg-white/25 blur-[2px]" />
        <TypeIcon className={cn("relative size-[18px]", type === "video" && "fill-white")} />
      </span>
    );
  }

  return (
    <div className={cn("relative aspect-[4/5] overflow-hidden rounded-2xl text-white", className)} style={{ background }}>
      <div className={cn("absolute inset-0", type === "video" && "group-hover:thumb-play")}>
        <span className="absolute -top-8 -right-6 size-32 rounded-full bg-white/25 blur-xl" />
        <span className="absolute bottom-10 -left-10 size-36 rounded-full bg-black/10 blur-2xl" />
        <span className="absolute top-1/3 left-1/2 size-20 -translate-x-1/2 rounded-[28px] bg-white/15 backdrop-blur-[2px]" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />

      <div className="absolute top-3 left-3 flex items-center gap-1.5">
        {platform && <PlatformIcon platform={platform} size="md" className="shadow-md" />}
      </div>
      {creative.durationSec !== null && (
        <span className="num absolute top-3 right-3 rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm">
          {formatDuration(creative.durationSec)}
        </span>
      )}

      <span
        className={cn(
          "absolute top-1/2 left-1/2 inline-flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg transition duration-300",
          type === "video" && "group-hover:scale-75 group-hover:opacity-0",
        )}
      >
        <TypeIcon className={cn("size-5", type === "video" && "translate-x-0.5 fill-foreground")} />
      </span>

      <p className="absolute right-3 bottom-4 left-3 line-clamp-2 text-[13px] leading-snug font-semibold drop-shadow">{creative.title}</p>

      {type === "video" && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
          <span className="block h-full w-0 bg-white group-hover:animate-[thumb-progress_5s_linear_infinite]" />
        </span>
      )}
    </div>
  );
}
