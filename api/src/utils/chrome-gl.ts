const GL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Chrome `--use-gl` value for this deployment.
 * Empty or unset keeps the built-in default (SwiftShader when headed, omitted when headless).
 */
export function parseChromeUseGl(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return undefined;
  if (!GL_NAME.test(trimmed)) {
    throw new Error(
      `Invalid CHROME_USE_GL "${value}". Expected a Chrome --use-gl name such as angle, egl, desktop, or swiftshader.`,
    );
  }
  return trimmed;
}

/**
 * Whether to pass `--disable-gpu`. Unset or empty keeps the default of forcing it.
 * `false` or `0` omits the flag so a self-hosted GPU host can use hardware GL.
 */
export function parseChromeDisableGpu(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return trimmed === "true" || trimmed === "1";
}

export function chromeGlLaunchArgs(options: {
  headless: boolean;
  useGl?: string;
  disableGpu: boolean;
}): { disableGpu: string[]; useGl: string[] } {
  const useGl = options.headless ? options.useGl : options.useGl || "swiftshader";
  return {
    disableGpu: options.disableGpu ? ["--disable-gpu"] : [],
    useGl: useGl ? [`--use-gl=${useGl}`] : [],
  };
}
