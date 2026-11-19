import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { decodedVideoDuration, probeVideoDuration } from "./video-duration";

describe("decoded video duration", () => {
  it("does not trust declared container duration or a forged frame duration", () => {
    expect(decodedVideoDuration(JSON.stringify({
      format: { duration: "999" },
      frames: [
        { best_effort_timestamp_time: "1.000000", pkt_duration_time: "0.250000" },
        { best_effort_timestamp_time: "1.500000", duration_time: "999" },
      ],
    }))).toBe(500);
  });

  it.each([
    [],
    [{ best_effort_timestamp_time: "0" }, { best_effort_timestamp_time: "N/A" }],
    [{ best_effort_timestamp_time: "0" }, { best_effort_timestamp_time: "3000000" }],
    [{ best_effort_timestamp_time: "1" }, { best_effort_timestamp_time: "0" }],
    [{ best_effort_timestamp_time: "0" }, { best_effort_timestamp_time: "0" }],
    [{ best_effort_timestamp_time: "1" }],
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
  const args = [
    "-v", "error", "-f", "lavfi", "-i", "color=black:s=64x64:r=10",
    "-t", "1", "-an", "-c:v", container === "mp4" ? "libx264" : "libvpx", "-f", container,
  ];
  const options = { timeout: 5000, maxBuffer: 1048576, windowsHide: true };
  let video: Buffer;
  if (container === "mp4") {
    // Ordinary MP4 can store its index at the end of a seekable file.
    const directory = mkdtempSync(join(tmpdir(), "vera-duration-test-"));
    const file = join(directory, "ordinary.mp4");
    try {
      execFileSync(ffmpeg, [...args, file], options);
      video = readFileSync(file);
    } finally {
      rmSync(file, { force: true });
      rmdirSync(directory);
    }
  } else {
    // Produce streaming WebM without a declared container duration.
    video = execFileSync(ffmpeg, [...args, "pipe:1"], options);
  }
  return expect(probeVideoDuration(executable!, Readable.from([video]), video.length, `video/${container}`, AbortSignal.timeout(3000)))
    .resolves.toBe(900);
}, 12000);

nativeTest("a matching MP4 signature alone cannot produce a duration", async () => {
  const header = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  await expect(probeVideoDuration(executable!, Readable.from([header]), header.length, "video/mp4", AbortSignal.timeout(3000)))
    .resolves.toBeNull();
});
