import Image from "next/image";

import { cn } from "@/lib/cn";

interface BrandLogoProps {
  className?: string;
  decorative?: boolean;
  inverse?: boolean;
  priority?: boolean;
  variant?: "mark" | "wordmark";
}

const assets = {
  mark: {
    height: 463,
    src: "/agencyos-mark-transparent.png",
    width: 463,
  },
  wordmark: {
    height: 758,
    src: "/agencyos-logo-transparent.png",
    width: 2076,
  },
} as const;

export function BrandLogo({
  className,
  decorative = false,
  inverse = false,
  priority = false,
  variant = "wordmark",
}: BrandLogoProps) {
  const asset = assets[variant];

  return (
    <Image
      className={cn(
        "brand-logo",
        `brand-logo--${variant}`,
        inverse && "brand-logo--inverse",
        className,
      )}
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt={decorative ? "" : "AgencyOS"}
      aria-hidden={decorative || undefined}
      priority={priority}
    />
  );
}
