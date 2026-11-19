import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { decodedVideoDuration, probeVideoDuration } from "./video-duration";

describe("decoded video duration", () => {
  it("uses frame timestamps instead of declared container duration", () => {
    expect(decodedVideoDuration(JSON.stringify({
      format: { duration: "999" },
      frames: [
        { best_effort_timestamp_time: "1.000000", pkt_duration_time: "0.250000" },
        { best_effort_timestamp_time: "1.500000", duration_time: "0.250000" },
      ],
    }))).toBe(750);
  });

  it.each([
    [],
    [{ best_effort_timestamp_time: "N/A" }],
    [{ best_effort_timestamp_time: "0", duration_time: "3000000" }],
    [{ best_effort_timestamp_time: "0", duration_time: "-1" }],
  ].map(frames => [frames] as const))("rejects missing or invalid timelines: %j", frames => {
    expect(decodedVideoDuration(JSON.stringify({ frames }))).toBeNull();
  });

  it("rejects excess bytes and aborts a stalled input without starting the decoder", async () => {
    const executable = process.execPath;
    expect(await probeVideoDuration(executable, Readable.from([Buffer.from("long")]), 1, "video/mp4", AbortSignal.timeout(1000))).toBeNull();
    const stalled = new Readable({ read() { /* no bytes arrive */ } });
    expect(await probeVideoDuration(executable, stalled, 1, "video/webm", AbortSignal.timeout(50))).toBeNull();
    expect(stalled.destroyed).toBe(true);
  });
});

const executable = process.env.VIDEO_DURATION_FFPROBE;
const nativeTest = executable ? it : it.skip;
nativeTest.each(["mp4", "webm"])("decodes real %s bytes with native FFmpeg tools", container => {
  const ffmpeg = join(dirname(executable!), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const flags = container === "mp4" ? ["-c:v", "libx264", "-movflags", "frag_keyframe+empty_moov"] : ["-c:v", "libvpx"];
  const video = execFileSync(ffmpeg, [
    "-v", "error", "-f", "lavfi", "-i", "color=black:s=64x64:r=10",
    "-t", "1", "-an", ...flags, "-f", container, "pipe:1",
  ], { timeout: 5000, maxBuffer: 1048576, windowsHide: true });
  return expect(probeVideoDuration(executable!, Readable.from([video]), video.length, `video/${container}`, AbortSignal.timeout(3000)))
    .resolves.toBeGreaterThanOrEqual(900);
});
