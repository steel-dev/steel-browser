import { useRef, useState, type FormEvent } from "react";
import { createSession } from "../api";
import { KeyChip } from "./key-chip";
import { Segmented } from "./segmented";

type Device = "desktop" | "mobile";

const devices = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
] as const;

export function NewSessionButton({ onStarted }: { onStarted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim() || undefined;
    const width = text("width");
    const height = text("height");
    if (Boolean(width) !== Boolean(height)) {
      setError("Enter both width and height, or leave both empty.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await createSession({
        deviceConfig: { device },
        dimensions: width && height ? { width: Number(width), height: Number(height) } : undefined,
        userAgent: text("userAgent"),
        proxyUrl: text("proxyUrl"),
        blockAds: data.get("blockAds") === "on",
      });
      dialog.current?.close();
      form.reset();
      setDevice("desktop");
      onStarted();
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
        className="button"
        data-variant="primary"
        data-shortcut="s"
        aria-keyshortcuts="S"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        Start session
        <KeyChip k="S" />
      </button>
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby="new-session-title"
        aria-describedby="new-session-description"
        onClose={() => setError(null)}
      >
        <form className="dialog-form" onSubmit={(event) => void submit(event)}>
          <div className="dialog-head">
            <h2 id="new-session-title" className="dialog-title">
              Start a new session
            </h2>
            <p id="new-session-description" className="dialog-description">
              Configure options and start a new session. The current browser closes.
            </p>
          </div>
          <div className="dialog-body">
            <div className="field">
              <span>Device</span>
              <Segmented label="Device" value={device} onChange={setDevice} options={devices} />
            </div>
            <div className="field" role="group" aria-labelledby="viewport-label">
              <span id="viewport-label">Viewport</span>
              <div className="viewport-inputs">
                <input
                  className="input"
                  name="width"
                  type="number"
                  inputMode="numeric"
                  min={320}
                  max={7680}
                  placeholder="1920"
                  aria-label="Width"
                />
                <span aria-hidden="true">×</span>
                <input
                  className="input"
                  name="height"
                  type="number"
                  inputMode="numeric"
                  min={240}
                  max={4320}
                  placeholder="1080"
                  aria-label="Height"
                />
              </div>
              <p className="field-hint">Leave empty to use the default size.</p>
            </div>
            <label className="field">
              <span>User agent</span>
              <input
                className="input"
                name="userAgent"
                placeholder="Default"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Proxy URL</span>
              <input
                className="input"
                name="proxyUrl"
                type="url"
                placeholder="http://user:pass@host:port"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="switch-row">
              <span className="switch-text">
                <span>Block ads</span>
                <span className="field-hint">Blocks requests to known ad hosts.</span>
              </span>
              <input
                className="switch"
                name="blockAds"
                type="checkbox"
                role="switch"
                defaultChecked
              />
            </label>
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
            <button type="submit" className="button" data-variant="primary" disabled={pending}>
              {pending ? "Starting session…" : "Start session"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
