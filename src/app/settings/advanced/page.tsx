import { redirect } from "next/navigation";

export default function AdvancedSettingsPage() {
  redirect("/settings?panel=advanced");
}
