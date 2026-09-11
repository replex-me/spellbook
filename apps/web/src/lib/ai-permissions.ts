import { randomUUID } from "node:crypto";
import { db, ensureSchema } from "./db";
import { HttpError } from "./http";
import type { Session, ElementGraph } from "./models";
import { getJsonObject } from "./storage";

export interface AiPermission {
  mode: "read_only" | "selection" | "slides" | "document";
  slideIndexes: number[];
  slidePartUris?: string[];
}

export function permissionForGraph(
  permission: AiPermission,
  graph: ElementGraph | null,
): AiPermission {
  if (permission.mode !== "slides" || !permission.slidePartUris || !graph)
    return permission;
  return {
    ...permission,
    slideIndexes: graph.slides
      .filter((slide) => permission.slidePartUris!.includes(slide.partUri))
      .map((slide) => slide.slideIndex),
  };
}

export function validatePermission(
  input: unknown,
  slideCount: number,
): AiPermission {
  const value = input as AiPermission;
  if (
    !value ||
    !["read_only", "selection", "slides", "document"].includes(value.mode) ||
    !Array.isArray(value.slideIndexes)
  )
    throw new HttpError(400, "invalid_ai_permission");
  if (
    value.mode === "slides" &&
    (!value.slideIndexes.length ||
      value.slideIndexes.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= slideCount,
      ))
  )
    throw new HttpError(400, "invalid_permission_slides");
  return {
    mode: value.mode,
    slideIndexes:
      value.mode === "slides"
        ? [...new Set(value.slideIndexes)].sort((a, b) => a - b)
        : [],
  };
}

// Product-local AI file-write capability, not account/SSO/admin authorization.
export async function updateAiPermission(
  session: Session,
  documentId: string,
  input: { permission?: unknown; messageId?: string; decision?: string },
) {
  await ensureSchema();
  return db().begin(async (sql) => {
    const [document] =
      await sql`select d.*, v.slide_count from spellbook_documents d join spellbook_versions v on v.id = d.current_version_id where d.id = ${documentId} and d.account_id = ${session.accountId} for update of d`;
    if (!document) throw new HttpError(404, "document_not_found");
    let proposed = input.permission;
    if (input.messageId) {
      const [request] =
        await sql`select * from spellbook_messages where id::text = ${input.messageId} and document_id = ${documentId} and status = 'permission_pending' for update`;
      if (!request || !["grant", "deny"].includes(input.decision ?? ""))
        throw new HttpError(409, "permission_request_inactive");
      proposed = request.metadata.permission;
      await sql`update spellbook_messages set status = ${input.decision === "grant" ? "permission_granted" : "permission_denied"}, updated_at = now() where id = ${request.id}`;
      if (input.decision === "deny")
        return { permission: document.ai_permission };
    }
    const [version] =
      await sql`select v.graph_object from spellbook_versions v where v.id = coalesce(
      (select e.candidate_version_id from spellbook_edit_requests e join spellbook_versions c on c.id = e.candidate_version_id
       where e.document_id = ${documentId} and e.status in ('planning','patching','reviewing','candidate_ready') and c.status = 'ready'
       order by e.created_at desc limit 1), ${document.current_version_id})`;
    const graph = version?.graph_object
      ? await getJsonObject<ElementGraph>(version.graph_object)
      : null;
    const permission = validatePermission(
      proposed,
      graph?.slides.length ?? document.slide_count ?? 0,
    );
    if (permission.mode === "slides") {
      if (!graph) throw new HttpError(409, "document_not_ready");
      permission.slidePartUris = graph.slides
        .filter((slide) => permission.slideIndexes.includes(slide.slideIndex))
        .map((slide) => slide.partUri);
    }
    await sql`update spellbook_documents set ai_permission = ${sql.json({ ...permission })}, updated_at = now() where id = ${documentId}`;
    const label =
      permission.mode === "read_only"
        ? "보기·대화만"
        : permission.mode === "selection"
          ? "선택 범위 편집"
          : permission.mode === "document"
            ? "문서 전체 편집"
            : `${permission.slideIndexes.map((index) => index + 1).join(", ")}번 슬라이드 편집`;
    const [active] =
      await sql`select e.id from spellbook_edit_requests e where e.document_id = ${documentId} and e.status in ('planning','patching','reviewing') order by e.created_at desc limit 1`;
    if (active)
      await sql`insert into spellbook_messages (document_id, edit_request_id, source_key, role, content, status) values (${documentId}, ${active.id}, ${`permission:${randomUUID()}`}, 'user', ${`AI 편집 권한을 ‘${label}’으로 변경했습니다. 이후 작업에 적용하세요.`}, 'queued')`;
    return { permission };
  });
}
