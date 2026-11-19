import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const VIDEO_PROBE_TIMEOUT_MS = 2000;
const MAX_PROBE_BYTES = 100 * 1024 * 1024;
const MAX_SQL_INT = 2147483647;

// Use the span of observed decoded frame starts. A container can declare a
// longer playback duration or attach an oversized duration to the last frame.
export function decodedVideoDuration(output: string): number | null {
  const result = JSON.parse(output) as { frames?: Array<{
    best_effort_timestamp_time?: string;
  }> };
  if (!Array.isArray(result.frames) || result.frames.length < 2) return null;
  let start: number | undefined;
  let end: number | undefined;
  for (const frame of result.frames) {
    const timestamp = frame?.best_effort_timestamp_time;
    if (typeof timestamp !== "string" || !/^-?\d+(?:\.\d{1,6})?$/.test(timestamp)) return null;
    const micros = Math.round(Number(timestamp) * 1_000_000);
    if (!Number.isSafeInteger(micros) || Math.abs(micros) > MAX_SQL_INT * 1000 ||
        (end !== undefined && micros < end)) return null;
    start ??= micros;
    end = micros;
  }
  const ms = Math.floor((end! - Math.max(0, start!)) / 1000);
  return ms > 0 && ms <= MAX_SQL_INT ? ms : null;
}

export async function probeVideoDuration(executable: string, body: Readable, size: number,
  mime: string, signal: AbortSignal): Promise<number | null> {
  if (!isAbsolute(executable) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_PROBE_BYTES ||
      (mime !== "video/mp4" && mime !== "video/webm")) {
    body.destroy();
    return null;
  }
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "vera-video-probe-"));
    const input = join(directory, "input");
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > size) callback(new Error("Probe input exceeded its checked size"));
        else callback(null, chunk);
      },
    });
    await pipeline(body, limit, createWriteStream(input, { flags: "wx", mode: 0o600 }), { signal });
    if (bytes !== size) return null;
    signal.throwIfAborted();
    const args = [
      "-v", "error", "-protocol_whitelist", "file", "-max_alloc", "33554432",
      "-threads", "1", "-max_pixels", "8294400", "-err_detect", "explode",
      "-codec_whitelist", "h264,hevc,av1,vp8,vp9,aac,opus,vorbis",
      "-f", mime === "video/mp4" ? "mov" : "matroska",
      ...(mime === "video/mp4" ? ["-enable_drefs", "0", "-use_absolute_path", "0"] : []),
      "-select_streams", "V:0", "-show_frames",
      "-show_entries", "frame=best_effort_timestamp_time",
      "-of", "json", "-i", input,
    ];
    return await new Promise<number | null>((resolve) => {
      // Avoid passing storage credentials or application environment to the parser.
      let duration: number | null = null;
      const child = execFile(executable, args, {
        cwd: directory, env: {}, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
        signal, killSignal: "SIGKILL",
      }, (error, stdout, stderr) => {
        if (error || stderr.trim()) return;
        try { duration = decodedVideoDuration(stdout); } catch { /* invalid probe output */ }
      });
      // On abort the callback can run before Windows releases the input file.
      child.once("close", () => resolve(duration));
    });
  } catch {
    return null;
  } finally {
    body.destroy();
    if (directory) {
      await rm(join(directory, "input"), { force: true });
      await rmdir(directory);
    }
  }
}
