import { VideoUpload } from "../../../../../src/components/video/video-upload";
import "../../../../../src/components/video/video.css";
export default function VideoUploadFixture() {
  return (
    <main className="container private-videos">
      <h1>Private video upload</h1>
      <VideoUpload />
    </main>
  );
}
