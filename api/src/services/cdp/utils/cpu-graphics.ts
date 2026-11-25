// Managed Core sessions run on CPU-only VMs with an Xvfb display. Keep a
// functioning, shared software backend instead of a synthetic WebGL context or
// an automatic fallback that Chromium can block. This overrides the driver
// blocklist, not shader validation, context state or GPU feature limits.
export const CORE_CPU_GRAPHICS_ARGS = [
  "--use-gl=angle",
  "--use-angle=gl",
  "--ignore-gpu-blocklist",
] as const;

export function coreCpuGraphicsEnvironment(display: string): Record<string, string> {
  return {
    DISPLAY: display,
    LIBGL_ALWAYS_SOFTWARE: "1",
    GALLIUM_DRIVER: "llvmpipe",
  };
}
