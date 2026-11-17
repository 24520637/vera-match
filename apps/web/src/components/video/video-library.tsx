"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiJson, ApiError } from "@/lib/api";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";
import { EmptyState, LoadingState, Notice } from "../ui/status";
import { useRetryAfter } from "../auth/use-retry-after";
import { RetryAfterFeedback } from "../auth/retry-after-feedback";
type Video = {
  id: string;
  status: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  deletedAt: string | null;
  cleanupCompletedAt: string | null;
};
type VideoPage = { videos: Video[]; nextCursor: string | null };
type Playback = { id: string; url: string; expiresAt: string };

export function VideoLibrary({ revision }: { revision: number }) {
  const [videos, setVideos] = useState<Video[]>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [playback, setPlayback] = useState<Playback>();
  const [deleting, setDeleting] = useState<Video>();
  const sequence = useRef(0);
  const nextFocus = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  const retry = useRetryAfter();
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    nextFocus.current = undefined;
    setPlayback(undefined);
    setError("");
    setAllowed(false);
    setNextCursor(null);
    setLoadingMore(false);
    try {
      const [list, consents] = await Promise.all([
        apiJson<VideoPage>("/videos/me"),
        apiJson<{ consents: { purpose: string; granted: boolean }[] }>(
          "/consents/me",
        ),
      ]);
      if (!list || !consents)
        throw new Error("Your videos could not be loaded.");
      if (alive.current && current === sequence.current) {
        setVideos(list.videos);
        setNextCursor(list.nextCursor ?? null);
        setAllowed(
          consents.consents.some(
            (consent) => consent.purpose === "VIDEO_STORAGE" && consent.granted,
          ),
        );
      }
    } catch (failure) {
      if (alive.current && current === sequence.current) {
        setVideos(undefined);
        setError(
          failure instanceof Error
            ? failure.message
            : "Your videos could not be loaded.",
        );
      }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const recheck = () => {
      if (document.visibilityState === "visible") void refresh();
      else setPlayback(undefined);
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      alive.current = false;
      ++sequence.current;
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [refresh, revision]);
  useEffect(() => {
    if (!playback) return;
    const timer = setTimeout(
      () => setPlayback(undefined),
      Math.max(0, Date.parse(playback.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [playback]);
  useEffect(() => {
    if (nextFocus.current) {
      document.getElementById(`saved-video-${nextFocus.current}`)?.focus();
      nextFocus.current = undefined;
    }
  }, [videos]);
  async function loadMore() {
    if (!nextCursor || loadingMore || busy || retry.seconds > 0) return;
    const current = sequence.current;
    setLoadingMore(true);
    setError("");
    try {
      const page = await apiJson<VideoPage>(
        `/videos/me?cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!page)
        throw new Error("Older videos could not be loaded. Try again.");
      if (alive.current && current === sequence.current) {
        nextFocus.current = page.videos[0]?.id;
        setVideos((previous) => {
          const known = new Set(previous?.map((video) => video.id));
          return [
            ...(previous ?? []),
            ...page.videos.filter((video) => !known.has(video.id)),
          ];
        });
        setNextCursor(page.nextCursor);
      }
    } catch (failure) {
      if (alive.current && current === sequence.current) {
        retry.fromError(failure);
        setError(
          failure instanceof Error
            ? failure.message
            : "Older videos could not be loaded. Try again.",
        );
        if (
          failure instanceof ApiError &&
          [401, 403].includes(failure.status ?? 0)
        ) {
          setVideos(undefined);
          setNextCursor(null);
          setAllowed(false);
          setPlayback(undefined);
        }
      }
    } finally {
      if (alive.current && current === sequence.current) setLoadingMore(false);
    }
  }
  async function action(video: Video, remove: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    setPlayback(undefined);
    try {
      if (remove) {
        await apiJson(`/videos/${encodeURIComponent(video.id)}`, {
          method: "DELETE",
          json: {},
        });
        if (alive.current) {
          setDeleting(undefined);
          setMessage("Video access removed. Storage cleanup is pending.");
          await refresh();
        }
      } else {
        const result = await apiJson<Playback>(
          `/videos/${encodeURIComponent(video.id)}/playback`,
          { method: "POST", json: {} },
        );
        if (alive.current && result) setPlayback(result);
      }
    } catch (failure) {
      if (!alive.current) return;
      retry.fromError(failure);
      setError(
        failure instanceof Error
          ? failure.message
          : "The video request could not be completed.",
      );
      if (
        failure instanceof ApiError &&
        [401, 403, 409].includes(failure.status ?? 0)
      ) {
        setAllowed(false);
        setPlayback(undefined);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section aria-labelledby="library-heading" className="video-library">
      <h2 id="library-heading">Saved videos</h2>
      <p>
        Playback links last one minute. Previously issued links and buffered
        video may remain available briefly after withdrawal.
      </p>
      <Button
        variant="secondary"
        onClick={() => void refresh()}
        disabled={busy || loadingMore}
      >
        Refresh video list
      </Button>
      {error && (
        <Notice tone="error" title="Video request unavailable">
          {error} Refresh before retrying a request whose result is uncertain.
        </Notice>
      )}
      <RetryAfterFeedback id="library-retry" seconds={retry.seconds} />
      {message && (
        <Notice tone="success" title="Video access removed">
          {message}
        </Notice>
      )}
      {!videos && !error && <LoadingState label="Loading your videos…" />}
      {videos?.length === 0 && (
        <EmptyState title="No videos yet">
          Choose or record a video when you are ready.
        </EmptyState>
      )}
      {videos && !allowed && (
        <Notice tone="warning" title="Playback requires current consent">
          <Link href="/account/consents">Review your consent choices</Link>.
          Deletion remains available.
        </Notice>
      )}
      <ul id="saved-video-list" className="video-list" aria-busy={loadingMore}>
        {videos?.map((video, index) => (
          <li key={video.id}>
            <h3 id={`saved-video-${video.id}`} tabIndex={-1}>
              Video {index + 1}
            </h3>
            <p>
              Uploaded{" "}
              {new Intl.DateTimeFormat("en", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(video.createdAt))}
            </p>
            <p>
              {video.status === "DELETED"
                ? video.cleanupCompletedAt
                  ? "Deleted. Object cleanup verified."
                  : "Access removed. Object cleanup pending."
                : video.status === "READY"
                  ? "Ready for private playback."
                  : "Upload not confirmed. Retry with a new upload or remove it."}
            </p>
            {playback?.id === video.id && (
              <video
                key={playback.url}
                src={playback.url}
                controls
                playsInline
                preload="metadata"
                aria-label={`Private playback video ${index + 1}`}
                onError={() => {
                  setPlayback(undefined);
                  setError(
                    "Playback is unavailable or the link expired. Request playback again.",
                  );
                }}
              />
            )}
            <div className="form-actions">
              {video.status === "READY" && (
                <Button
                  onClick={() => void action(video, false)}
                  disabled={
                    busy || loadingMore || !allowed || retry.seconds > 0
                  }
                >
                  Play video {index + 1}
                </Button>
              )}
              {!video.cleanupCompletedAt && (
                <Button
                  variant="danger"
                  disabled={busy || loadingMore || retry.seconds > 0}
                  onClick={() => setDeleting(video)}
                >
                  {video.status === "DELETED"
                    ? "Retry cleanup request"
                    : `Delete video ${index + 1}`}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {videos && videos.length > 0 && (
        <div className="form-actions">
          <p role="status" aria-live="polite">
            Showing {videos.length} {videos.length === 1 ? "video" : "videos"}.
          </p>
          {nextCursor && (
            <Button
              variant="secondary"
              loading={loadingMore}
              loadingLabel="Loading older videos…"
              disabled={busy || retry.seconds > 0}
              aria-controls="saved-video-list"
              aria-describedby={retry.seconds > 0 ? "library-retry" : undefined}
              onClick={() => void loadMore()}
            >
              Load older videos
            </Button>
          )}
        </div>
      )}
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Delete this video?"
        dismissible={!busy}
        description="New playback access will stop. Storage cleanup may take longer; existing streams and buffered bytes cannot be recalled."
      >
        <Button
          variant="danger"
          loading={busy}
          loadingLabel="Removing access…"
          disabled={retry.seconds > 0}
          onClick={() => {
            if (deleting) void action(deleting, true);
          }}
        >
          Delete private video
        </Button>
        {error && (
          <Notice tone="error" title="Deletion not confirmed">
            {error}
          </Notice>
        )}
      </Modal>
    </section>
  );
}
