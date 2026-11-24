import { AttachmentBuilder } from 'discord.js';

function uniqueName(originalName, usedNames) {
  const cleaned =
    String(originalName || 'attachment')
      .replace(/[\\/:*?"<>|\r\n]/g, '_')
      .trim()
      .slice(-90)
      .replace(/^[.]+/, '') || 'attachment';

  const dot = cleaned.lastIndexOf('.');
  const base = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const ext = dot > 0 ? cleaned.slice(dot) : '';

  let candidate = `${base}${ext}`;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}-${counter}${ext}`;
    counter += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Downloads attachments so they can be re-uploaded to the order channel.
 * Re-uploading keeps the images available even after the ticket (and its
 * signed CDN links) disappear.
 */
export async function downloadAttachments(
  attachments,
  { maxFiles = 10, maxTotalBytes = 20 * 1024 * 1024, timeoutMs = 30_000 } = {},
) {
  const files = [];
  const failed = [];
  const skipped = [];
  const usedNames = new Set();
  let totalBytes = 0;

  for (const attachment of attachments) {
    if (files.length >= maxFiles) {
      skipped.push({ name: attachment.name, reason: 'attachment limit reached' });
      continue;
    }
    if (attachment.size > maxTotalBytes || attachment.size > maxTotalBytes - totalBytes) {
      skipped.push({ name: attachment.name, reason: 'file too large' });
      continue;
    }

    try {
      const response = await fetch(attachment.url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`download failed (HTTP ${response.status})`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxTotalBytes - totalBytes) {
        skipped.push({ name: attachment.name, reason: 'file too large' });
        continue;
      }

      totalBytes += buffer.byteLength;
      files.push(
        new AttachmentBuilder(buffer, {
          name: uniqueName(attachment.name, usedNames),
          description: attachment.description || undefined,
        }),
      );
    } catch (error) {
      failed.push({
        name: attachment.name,
        url: attachment.url,
        reason: error.message,
      });
    }
  }

  return { files, failed, skipped, totalBytes };
}
