import { db, ensureSchema } from "./db";
import { HttpError } from "./http";
import type { Session } from "./models";

// Durable additional input. The document lock serializes submission with completion/cancellation.
export async function steerConversation(
  session: Session,
  documentId: string,
  input: { text: string; requestId: string },
) {
  await ensureSchema();
  const text = input.text.trim();
  if (
    !text ||
    text.length > 2000 ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)
  )
    throw new HttpError(400, "invalid_message");
  return db().begin(async (sql) => {
    const [document] =
      await sql`select id, status from spellbook_documents where id = ${documentId} and account_id = ${session.accountId} for update`;
    if (!document) throw new HttpError(404, "document_not_found");
    const [prior] =
      await sql`select id, status from spellbook_messages where document_id = ${documentId} and source_key = ${`steer:${input.requestId}`}`;
    if (prior) return prior;
    if (document.status !== "editing")
      throw new HttpError(409, "turn_finished_resend");
    const [edit] =
      await sql`select e.id from spellbook_edit_requests e join spellbook_jobs j on j.edit_request_id = e.id where e.document_id = ${documentId} and e.status in ('planning','patching','reviewing') and j.job_type = 'ai_plan' and j.payload->>'execution' = 'agent' and j.status in ('queued','running') order by e.created_at desc limit 1`;
    if (!edit) throw new HttpError(409, "turn_finished_resend");
    const [message] =
      await sql`insert into spellbook_messages (document_id, edit_request_id, source_key, role, content, status) values (${documentId}, ${edit.id}, ${`steer:${input.requestId}`}, 'user', ${text}, 'queued') returning id, status`;
    return message;
  });
}

export async function readConversation(session: Session, documentId: string) {
  await ensureSchema();
  const [document] =
    await db()`select id, status from spellbook_documents where id = ${documentId} and account_id = ${session.accountId}`;
  if (!document) throw new HttpError(404, "document_not_found");
  const messages =
    await db()`select id::text, edit_request_id as "editRequestId", role, content, status, metadata, source_key as "sourceKey", created_at as "createdAt" from spellbook_messages where document_id = ${documentId} order by id`;
  return { status: document.status, messages };
}
