import { useRef, useState } from "react";
import { releaseSession } from "../api";

export function ReleaseButton({
  sessionId,
  onReleased,
}: {
  sessionId: string;
  onReleased: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const release = async () => {
    setPending(true);
    setError(null);
    try {
      await releaseSession(sessionId);
      dialog.current?.close();
      onReleased();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="pill-button"
        data-variant="danger"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        Release session
      </button>
      <dialog
        ref={dialog}
        className="dialog"
        data-size="small"
        aria-labelledby="release-title"
        aria-describedby="release-description"
        onClose={() => setError(null)}
      >
        <div className="dialog-head">
          <h2 id="release-title" className="dialog-title">
            Release session
          </h2>
          <p id="release-description" className="dialog-description">
            This action cannot be undone. This will release your session and delete some of your
            session data.
          </p>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <button
            type="button"
            className="button"
            disabled={pending}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            data-variant="danger"
            disabled={pending}
            onClick={() => void release()}
          >
            {pending ? "Releasing session…" : "Release session"}
          </button>
        </div>
      </dialog>
    </>
  );
}
