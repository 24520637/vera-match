export function RetryAfterFeedback({
  seconds,
  id,
}: {
  seconds: number;
  id: string;
}) {
  return seconds > 0 ? (
    <p id={id} className="small muted">
      You can try again in {new Intl.NumberFormat("en").format(seconds)}{" "}
      seconds.
    </p>
  ) : null;
}
