import type { PublicProviderDescriptor } from "./events";

function publicLabel(category: PublicProviderDescriptor["category"]): string {
  if (category === "ai_provider") return "AI provider";
  if (category === "runtime") return "Execution runtime";
  if (category === "tool") return "Runtime tool";
  if (category === "system") return "System";
  return "External service";
}

export function publicProviderDescriptor(
  value: string | null | undefined,
  category: PublicProviderDescriptor["category"] = "ai_provider",
): PublicProviderDescriptor {
  const resolvedCategory = value?.trim() ? category : "unknown";
  return { category: resolvedCategory, label: publicLabel(resolvedCategory) };
}

export function publicRuntimeDescriptor(value: string | null | undefined): PublicProviderDescriptor {
  return publicProviderDescriptor(value, "runtime");
}

export function publicToolDescriptor(value: string | null | undefined): PublicProviderDescriptor {
  const label = value?.trim();
  return label
    ? { category: "tool", label }
    : publicProviderDescriptor(value, "tool");
}
