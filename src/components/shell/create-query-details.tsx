"use client";

import { useSearchParams } from "next/navigation";
import type { ComponentPropsWithoutRef } from "react";

interface CreateQueryDetailsProps extends ComponentPropsWithoutRef<"details"> {
  target: string;
}

export function CreateQueryDetails({ target, open, ...props }: CreateQueryDetailsProps) {
  const searchParams = useSearchParams();
  return <details {...props} open={open || searchParams.get("create") === target} />;
}
