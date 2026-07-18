import { cn } from "@/lib/utils";

// Announced form-level error box. `role="alert"` makes assistive tech read the
// message the moment it mounts (implicit aria-live="assertive"), and the `id`
// lets the relevant inputs point back to it via aria-describedby. Renders
// nothing when there is no message, so the surrounding `space-y-*` gap never
// shows for the happy path.
export function FormError({
  id,
  message,
  className,
}: {
  id: string;
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className={cn(
        "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive",
        className,
      )}
    >
      {message}
    </p>
  );
}
