import { describe, expect, test } from "vitest";
import { hideSecrets, SECRET_MASK, secretMask } from "./secrets.js";

function slowHide(text: string, secrets: string[], minimum: number): string {
  const ends = new Array<number>(text.length).fill(0);
  for (const secret of secrets) {
    for (const variant of [secret, secret.replace(/\s+/g, " ").trim()]) {
      if (variant.length < minimum) {
        continue;
      }
      for (let at = text.indexOf(variant); at >= 0; at = text.indexOf(variant, at + 1)) {
        ends[at] = Math.max(ends[at], at + variant.length);
      }
    }
  }
  let hidden = "";
  let until = 0;
  ends.forEach((end, index) => {
    if (end === 0) {
      return;
    }
    if (index >= until) {
      hidden += text.slice(until, index) + SECRET_MASK;
      until = end;
    } else {
      until = Math.max(until, end);
    }
  });
  return hidden + text.slice(until);
}

describe("hideSecrets", () => {
  test("hides a longer secret that contains a shorter one", () => {
    expect(hideSecrets("old Summer, new Summer2025!", ["Summer", "Summer2025!"])).toBe(
      `old ${SECRET_MASK}, new ${SECRET_MASK}`,
    );
  });

  test("hides overlapping secrets as one and keeps short ones unless asked", () => {
    expect(hideSecrets("xabcdefx", ["abcd", "cdef"])).toBe(`x${SECRET_MASK}x`);
    expect(hideSecrets("pin 123 here", ["123"])).toBe("pin 123 here");
    expect(hideSecrets("pin 123 here", ["123"], 1)).toBe(`pin ${SECRET_MASK} here`);
    expect(hideSecrets("say open sesame", ["open\n  sesame"])).toBe(`say ${SECRET_MASK}`);
  });

  test("matches a plain search for every secret", () => {
    let seed = 7;
    const random = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    const word = (length: number) => Array.from({ length }, () => "ab c"[random(4)]).join("");
    for (let round = 0; round < 3_000; round++) {
      const secrets = Array.from({ length: 1 + random(6) }, () => word(1 + random(6)));
      const text = word(random(40));
      const minimum = random(2) === 0 ? 1 : 4;
      expect(hideSecrets(text, secrets, minimum), JSON.stringify({ text, secrets, minimum })).toBe(
        slowHide(text, secrets, minimum),
      );
    }
  });

  test("stays fast with thousands of secrets", () => {
    const secrets = Array.from({ length: 5_000 }, (_, index) => `pw-${index}-${index * 7919}`);
    const started = performance.now();
    const hide = secretMask(secrets);
    for (let index = 0; index < 10_000; index++) {
      const name = `Button ${index}`;
      expect(hide(`${name} ${secrets[index] ?? "plain"}`)).toBe(
        `${name} ${secrets[index] ? SECRET_MASK : "plain"}`,
      );
    }
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  test("hides the secrets that fit its budget and skips the rest", () => {
    const secrets = Array.from({ length: 30 }, (_, index) => `${index}:`.padEnd(10_000, "x"));
    const hide = secretMask(secrets);
    expect(hide(`a ${secrets[0]} b`)).toBe(`a ${SECRET_MASK} b`);
    expect(hide(secrets[29])).toBe(secrets[29]);
  });
});
