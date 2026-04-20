import { redirect } from "next/navigation";

export default function AiClientsPage() {
  redirect("/settings?panel=ai-clients");
}
