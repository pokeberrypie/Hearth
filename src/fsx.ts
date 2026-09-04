/**
 * The one filesystem primitive `index.ts` needs that Bun and Node spell
 * differently. `Bun` is a real global under Bun and does not exist at all
 * under Node — `typeof Bun !== "undefined"` is a safe runtime check in both,
 * and it is the only branch in this file, so the desktop path takes exactly
 * the line it always took.
 */
export async function writeFile(path: string, data: Uint8Array | ArrayBuffer): Promise<void> {
  if (typeof (globalThis as any).Bun !== "undefined") {
    await (globalThis as any).Bun.write(path, data);
    return;
  }
  const { writeFile: nodeWriteFile } = await import("node:fs/promises");
  await nodeWriteFile(path, data instanceof Uint8Array ? data : new Uint8Array(data));
}
