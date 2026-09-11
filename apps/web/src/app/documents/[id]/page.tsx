import { redirect } from "next/navigation";

import { currentSession } from "@/lib/auth";
import NativeDocument from "@/components/native-document";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await currentSession())) redirect("/auth/login");
  const { id } = await params;
  return <NativeDocument documentId={id} />;
}
