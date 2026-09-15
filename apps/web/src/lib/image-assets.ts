import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, ensureSchema } from "./db";
import { HttpError } from "./http";
import { accountPrefix, getObject, putObject } from "./storage";
import type { Session } from "./models";

export function imageInfo(data: Buffer) {
  let width = 0,
    height = 0,
    contentType = "";
  if (
    data.length >= 33 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
    contentType = "image/png";
  } else if (data[0] === 255 && data[1] === 216) {
    let offset = 2;
    while (offset + 4 < data.length) {
      if (data[offset++] !== 255) break;
      while (data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = data.readUInt16BE(offset + 3);
        width = data.readUInt16BE(offset + 5);
        contentType = "image/jpeg";
        break;
      }
      offset += length;
    }
  }
  if (
    !contentType ||
    !width ||
    !height ||
    width * height > 16_000_000 ||
    data.length > 5_000_000
  )
    throw new HttpError(400, "image_requires_png_or_jpeg_under_5mb_and_16mp");
  return { width, height, contentType };
}
export async function uploadImage(
  session: Session,
  documentId: string,
  file: File,
) {
  await ensureSchema();
  const [document] =
    await db()`select id from spellbook_documents where id = ${documentId} and account_id = ${session.accountId}`;
  if (!document) throw new HttpError(404, "document_not_found");
  if (file.size > 5_000_000) throw new HttpError(413, "image_too_large");
  const data = Buffer.from(await file.arrayBuffer());
  return saveImageAsset(
    session.accountId,
    documentId,
    data,
    file.name.slice(0, 200),
  );
}

export async function getImageAsset(
  session: Session,
  documentId: string,
  assetId: string,
) {
  await ensureSchema();
  if (!/^[0-9a-f-]{36}$/i.test(assetId))
    throw new HttpError(404, "asset_not_found");
  const [asset] = await db()`
    select a.object_name, a.content_type
    from spellbook_assets a
    join spellbook_documents d on d.id=a.document_id
    where a.id=${assetId} and a.document_id=${documentId}
      and d.account_id=${session.accountId}
  `;
  if (!asset) throw new HttpError(404, "asset_not_found");
  return {
    data: await getObject(asset.object_name),
    contentType: asset.content_type as string,
  };
}

export async function saveImageAsset(
  accountId: string,
  documentId: string,
  data: Buffer,
  fileName: string,
) {
  await ensureSchema();
  const [document] =
    await db()`select id from spellbook_documents where id = ${documentId} and account_id = ${accountId}`;
  if (!document) throw new HttpError(404, "document_not_found");
  if (data.length > 5_000_000) throw new HttpError(413, "image_too_large");
  const info = imageInfo(data);
  const id = randomUUID();
  try {
    await sharp(data, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
    }).stats();
  } catch {
    throw new HttpError(400, "invalid_image_data");
  }
  const extension = info.contentType === "image/png" ? "png" : "jpg";
  const object = `${accountPrefix(accountId, documentId)}/assets/${id}.${extension}`;
  await putObject(object, data, info.contentType);
  const safeFileName = fileName.trim().slice(0, 200) || `image.${extension}`;
  await db()`insert into spellbook_assets (id, document_id, file_name, object_name, content_type, width, height) values (${id}, ${documentId}, ${safeFileName}, ${object}, ${info.contentType}, ${info.width}, ${info.height})`;
  return { assetId: id, fileName: safeFileName, ...info };
}
