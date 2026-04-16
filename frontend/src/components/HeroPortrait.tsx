import type { Hero } from "../types";

interface Props {
  hero: Hero;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE = {
  sm: "w-10 h-6",
  md: "w-14 h-8",
  lg: "w-20 h-12",
} as const;

export function HeroPortrait({ hero, size = "md", className = "" }: Props) {
  return (
    <img
      src={hero.iconUrl}
      alt={hero.localizedName}
      loading="lazy"
      className={`${SIZE[size]} object-cover rounded-sm ${className}`}
      draggable={false}
    />
  );
}
