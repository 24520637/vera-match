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

type ProbeResult =
  | { status: "measured"; durationMs: number; frameCount: number }
  | { status: "insufficient-frames" | "invalid-timestamps"; frameCount: number }
  | { status: "malformed-json" | "decoder-failure" | "output-limit" | "timeout" | "aborted" | "invalid-input" | "input-failure" };

// Use the span of observed decoded frame starts. A container can declare a
// longer playback duration or attach an oversized duration to the last frame.
export function inspectDecodedVideo(output: string): ProbeResult {
  let result: unknown;
  try { result = JSON.parse(output); } catch { return { status: "malformed-json" }; }
  if (!result || typeof result !== "object" || Array.isArray(result)) return { status: "malformed-json" };
  const frames = "frames" in result ? result.frames : [];
  if (!Array.isArray(frames)) return { status: "malformed-json" };
  const frameCount = frames.length;
  if (frameCount < 2) return { status: "insufficient-frames", frameCount };
  let start: number | undefined;
  let end: number | undefined;
  for (const frame of frames) {
    const timestamp = frame?.best_effort_timestamp_time;
    if (typeof timestamp !== "string" || !/^-?\d+(?:\.\d{1,6})?$/.test(timestamp)) {
      return { status: "invalid-timestamps", frameCount };
    }
    const micros = Math.round(Number(timestamp) * 1_000_000);
    if (!Number.isSafeInteger(micros) || Math.abs(micros) > MAX_SQL_INT * 1000 ||
        (end !== undefined && micros < end)) return { status: "invalid-timestamps", frameCount };
    start ??= micros;
    end = micros;
  }
  const ms = Math.floor((end! - Math.max(0, start!)) / 1000);
  return ms > 0 && ms <= MAX_SQL_INT
    ? { status: "measured", durationMs: ms, frameCount }
    : { status: "invalid-timestamps", frameCount };
}

// Synthetic tests can inspect these bounded results. The production caller
// receives only the duration. Never return decoder output or process errors.
export async function inspectVideoProbe(executable: string, body: Readable, size: number,
  mime: string, signal: AbortSignal): Promise<ProbeResult> {
  if (!isAbsolute(executable) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_PROBE_BYTES ||
      (mime !== "video/mp4" && mime !== "video/webm")) {
    body.destroy();
    return { status: "invalid-input" };
  }
  const abortResult = (): ProbeResult => ({
    status: signal.reason?.name === "TimeoutError" ? "timeout" : "aborted",
  });
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
    if (bytes !== size) return { status: "invalid-input" };
    signal.throwIfAborted();
    const args = [
      "-v", "error", "-protocol_whitelist", "file", "-max_alloc", "33554432",
      "-threads", "1", "-max_pixels", "8294400", "-err_detect", "explode",
      "-codec_whitelist", "h264,hevc,av1,vp8,vp9,aac,opus,vorbis",
      "-f", mime === "video/mp4" ? "mov" : "matroska",
      // WebM track headers suffice for decoding the selected video stream.
      // Stream discovery can decode unselected Opus packets and log errors.
      ...(mime === "video/mp4" ? ["-enable_drefs", "0", "-use_absolute_path", "0"] : ["-nofind_stream_info"]),
      "-select_streams", "V:0", "-show_frames",
      "-show_entries", "frame=best_effort_timestamp_time",
      "-of", "json", "-i", input,
    ];
    return await new Promise<ProbeResult>((resolve) => {
      // Avoid passing storage credentials or application environment to the parser.
      let result: ProbeResult = { status: "decoder-failure" };
      const child = execFile(executable, args, {
        cwd: directory, env: { NODE_ENV: "production" }, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
        signal, killSignal: "SIGKILL",
      }, (error, stdout, stderr) => {
        if (error?.code === "ABORT_ERR") result = abortResult();
        else if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") result = { status: "output-limit" };
        else if (!error && !stderr.trim()) result = inspectDecodedVideo(stdout);
      });
      // On abort the callback can run before Windows releases the input file.
      child.once("close", () => resolve(result));
    });
  } catch {
    return signal.aborted ? abortResult() : { status: "input-failure" };
  } finally {
    body.destroy();
    if (directory) {
      await rm(join(directory, "input"), { force: true });
      await rmdir(directory);
    }
  }
}

export async function probeVideoDuration(executable: string, body: Readable, size: number,
  mime: string, signal: AbortSignal): Promise<number | null> {
  const result = await inspectVideoProbe(executable, body, size, mime, signal);
  return result.status === "measured" ? result.durationMs : null;
}
