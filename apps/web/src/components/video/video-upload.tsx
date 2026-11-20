"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiJson, ApiError } from "@/lib/api";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { Button } from "../ui/button";
import { Form, FormActions, Input } from "../ui/form";
import { Notice } from "../ui/status";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";

type Intent = {
  id: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};
const MAX_BYTES = 100 * 1024 * 1024;

/** Binary transport only. Authentication and all feature JSON use the shared client. */
export function uploadVideoBytes(
  intent: Intent,
  file: File,
  progress: (value: number) => void,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    xhr.open("PUT", intent.uploadUrl);
    xhr.withCredentials = false;
    xhr.timeout = 240000;
    for (const [key, value] of Object.entries(intent.headers))
      xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      finish(
        xhr.status >= 200 && xhr.status < 300
          ? undefined
          : new Error("The upload was not accepted. Try uploading again."),
      );
    xhr.onerror = () =>
      finish(
        new Error(
          "The upload connection failed. Your selected video is still available to retry.",
        ),
      );
    xhr.ontimeout = () =>
      finish(new Error("The upload timed out. Try uploading again."));
    xhr.onabort = () =>
      finish(new DOMException("Upload cancelled.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      finish(new DOMException("Upload cancelled.", "AbortError"));
      return;
    }
    xhr.send(file);
  });
}

export function VideoUpload({ onUploaded }: { onUploaded?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const activeIntent = useRef<Intent | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const camera = useRef<HTMLVideoElement>(null);
  const alive = useRef(true);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const retry = useRetryAfter();
  useUnsavedChanges(
    !!file || recording || busy,
    "Leave this page? Your selected video or recording will be lost.",
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ++attempt.current;
      controller.current?.abort();
      const capture = recorder.current;
      recorder.current = null;
      if (capture && capture.state !== "inactive") capture.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function choose(value: File | null) {
    setSuccess(false);
    setError("");
    if (
      value &&
      (!["video/mp4", "video/webm"].includes(value.type) ||
        value.size < 12 ||
        value.size > MAX_BYTES)
    ) {
      setFile(null);
      setError("Choose an MP4 or WebM video up to 100 MiB.");
      return;
    }
    setFile(value);
  }
  function stop() {
    const capture = recorder.current;
    if (!capture || capture.state === "inactive") return;
    if (timer.current) clearTimeout(timer.current);
    setFinalizing(true);
    // Stopping input tracks here can leave the final WebM chunk incomplete.
    // The stop event follows the final dataavailable event.
    capture.stop();
    timer.current = setTimeout(() => {
      if (recorder.current !== capture || !alive.current) return;
      releaseRecording();
      setError("Recording could not be finalized. Record again or choose a video file.");
    }, 5000);
  }
  function releaseRecording() {
    recorder.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (camera.current) camera.current.srcObject = null;
    if (timer.current) clearTimeout(timer.current);
    setRecording(false);
    setFinalizing(false);
  }
  async function record() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Camera recording is unavailable in this browser. Choose a video file instead.",
      );
      return;
    }
    const mime = ["video/webm", "video/mp4"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mime) {
      setError(
        "This browser cannot record MP4 or WebM. Choose a video file instead.",
      );
      return;
    }
    setCameraPending(true);
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      if (!alive.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const chunks: BlobPart[] = [];
      let size = 0;
      let discarded = false;
      const capture = new MediaRecorder(media, { mimeType: mime });
      recorder.current = capture;
      capture.ondataavailable = (event) => {
        if (discarded || recorder.current !== capture) return;
        size += event.data.size;
        if (size <= MAX_BYTES) chunks.push(event.data);
        else {
          discarded = true;
          stop();
          if (alive.current)
            setError(
              "Recording reached the 100 MiB limit. Record a shorter video.",
            );
        }
      };
      capture.onstop = () => {
        if (recorder.current !== capture || !alive.current) return;
        releaseRecording();
        if (!discarded)
          choose(
            new File(
              chunks,
              mime === "video/mp4" ? "recording.mp4" : "recording.webm",
              { type: mime },
            ),
          );
      };
      capture.onerror = () => {
        if (recorder.current !== capture || !alive.current) return;
        discarded = true;
        if (capture.state !== "inactive") capture.stop();
        releaseRecording();
        setError("Recording failed. Choose a video file instead.");
      };
      setRecording(true);
      capture.start(1000);
      // Bound unattended capture. This is a recording limit, not inferred content.
      timer.current = setTimeout(stop, 180000);
      requestAnimationFrame(() => {
        if (camera.current) camera.current.srcObject = media;
      });
    } catch {
      if (alive.current) releaseRecording();
      setError(
        "Camera or microphone access was unavailable. Choose a video file instead.",
      );
    } finally {
      if (alive.current) setCameraPending(false);
    }
  }
  async function upload() {
    if (busy) return;
    if (!file) {
      setError("Choose or record a video before uploading.");
      inputRef.current?.focus();
      return;
    }
    const current = ++attempt.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setSuccess(false);
    setProgress(0);
    activeIntent.current = null;
    try {
      const intent = await apiJson<Intent>("/videos/upload-intent", {
        method: "POST",
        json: { mimeType: file.type, sizeBytes: file.size },
        signal: abort.signal,
      });
      if (!intent) throw new Error("The upload could not be started.");
      activeIntent.current = intent;
      await uploadVideoBytes(intent, file, setProgress, abort.signal);
      await apiJson(`/videos/${encodeURIComponent(intent.id)}/confirm`, {
        method: "POST",
        json: {},
        signal: abort.signal,
      });
      if (alive.current && current === attempt.current) {
        setSuccess(true);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        onUploaded?.();
      }
    } catch (failure) {
      if (!alive.current || current !== attempt.current) return;
      if (abort.signal.aborted)
        setError(
          "Cancellation requested. A completed confirmation may still have saved the video. Check your video list before retrying.",
        );
      else if (failure instanceof ApiError && failure.status === 429) {
        retry.fromError(failure);
        setError("Too many video requests. Wait before retrying.");
      } else
        setError(
          failure instanceof Error
            ? failure.message
            : "The upload could not be confirmed. Try again.",
        );
    } finally {
      if (alive.current && current === attempt.current) setBusy(false);
    }
  }
  async function cancelUpload() {
    setCancelling(true);
    controller.current?.abort();
    const intent = activeIntent.current;
    try {
      if (intent) {
        await apiJson(`/videos/${encodeURIComponent(intent.id)}`, {
          method: "DELETE",
          json: {},
        });
        if (alive.current) {
          setError(
            "Video access removed. Temporary bytes are queued for cleanup.",
          );
          onUploaded?.();
        }
      }
    } catch {
      if (alive.current)
        setError(
          "Cancellation could not be confirmed. Refresh your video list and remove the upload there.",
        );
    } finally {
      if (alive.current) setCancelling(false);
    }
  }
  return (
    <section aria-labelledby="upload-heading" className="video-upload">
      <h2 id="upload-heading">A video in your own words</h2>
      <p>
        Choose a video or record one here. Uploading does not assign an expert
        or publish your video.
      </p>
      <p>
        <Link href="/account/consents">Review your consent choices</Link> before
        uploading. Video storage consent is required.
      </p>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          void upload();
        }}
      >
        <Input
          ref={inputRef}
          label="Video file"
          name="video"
          type="file"
          accept="video/mp4,video/webm"
          hint="MP4 or WebM, up to 100 MiB."
          disabled={busy || cancelling || recording || cameraPending}
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
          error={error && !file ? error : undefined}
        />
        <FormActions>
          {recording ? (
            <Button onClick={stop} disabled={finalizing}>Stop recording</Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => void record()}
              disabled={busy || cameraPending}
            >
              {cameraPending ? "Opening camera…" : "Record a video"}
            </Button>
          )}
        </FormActions>
        {recording && (
          <>
            <p role="status">
              {finalizing
                ? "Finishing recording…"
                : "Recording. Stop when you are finished; recording stops after three minutes."}
            </p>
            <video
              ref={camera}
              autoPlay
              muted
              playsInline
              aria-label="Live camera preview"
            />
          </>
        )}
        {preview && !recording && (
          <div>
            <p>Local preview. This video has not been uploaded yet.</p>
            <video
              src={preview}
              controls
              playsInline
              preload="metadata"
              aria-label="Selected video preview"
            />
          </div>
        )}
        {busy && (
          <div role="status">
            <label htmlFor="video-progress">Uploading: {progress}%</label>
            <progress id="video-progress" max={100} value={progress} />
            {progress === 100 && <p>Checking your upload…</p>}
          </div>
        )}
        {error && (
          <Notice tone="error" title="Video upload unavailable">
            {error}
          </Notice>
        )}
        <RetryAfterFeedback seconds={retry.seconds} id="video-retry" />
        {success && (
          <Notice tone="success" title="Video uploaded">
            Your private video has been confirmed.
          </Notice>
        )}
        <FormActions>
          <Button
            type="submit"
            loading={busy}
            loadingLabel="Uploading…"
            disabled={
              recording || cancelling || cameraPending || retry.seconds > 0
            }
          >
            Upload private video
          </Button>
          {busy && (
            <Button
              variant="secondary"
              onClick={() => void cancelUpload()}
              disabled={cancelling}
            >
              Cancel upload
            </Button>
          )}
        </FormActions>
      </Form>
    </section>
  );
}
