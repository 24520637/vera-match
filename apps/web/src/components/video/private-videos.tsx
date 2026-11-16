"use client";
import { useAuth } from "../auth/auth-provider";
import { LoadingState, Notice } from "../ui/status";
import { PageHeader } from "../layout/page-layout";
import { MemberSettingsNav } from "../member/member-settings";
import { VideoUpload } from "./video-upload";
import { VideoLibrary } from "./video-library";
import { useState } from "react";
import "./video.css";

export function PrivateVideos() {
  const { state } = useAuth();
  const [revision, setRevision] = useState(0);
  if (state.status === "checking")
    return <LoadingState label="Checking your session…" />;
  if (state.status !== "authenticated" || state.user.role !== "MEMBER")
    return (
      <Notice tone="warning" title="Private video unavailable">
        A confirmed member session is required.
      </Notice>
    );
  return (
    <div className="container private-videos">
      <MemberSettingsNav />
      <PageHeader
        title="Your private videos"
        description="Share only what you choose. Your video stays private, with access controlled by your consent."
      />
      <VideoUpload
        key={state.user.id}
        onUploaded={() => setRevision((value) => value + 1)}
      />
      <VideoLibrary key={`library:${state.user.id}`} revision={revision} />
    </div>
  );
}
