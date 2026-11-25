/**
 * Port of Chromium's User-Agent Client Hints brand list generation.
 *
 * Source: components/embedder_support/user_agent_utils.cc
 * (GenerateBrandVersionList, GetGreasedUserAgentBrandVersion, GetRandomOrder,
 * ShuffleBrandList), chromium/chromium@20d88b302d624d49eb23e87b6cae4c81d4c2c9c0.
 * https://github.com/chromium/chromium/blob/20d88b302d624d49eb23e87b6cae4c81d4c2c9c0/components/embedder_support/user_agent_utils.cc
 *
 * Chromium seeds the GREASE brand and the order of the list with the major
 * version, so for a given major the list is fixed. A fingerprint that claims
 * Chrome N must send exactly the list Chrome N sends, otherwise
 * `navigator.userAgentData.brands` and `Sec-CH-UA` reveal the spoof.
 */

export interface UserAgentBrand {
  brand: string;
  version: string;
}

// user_agent_utils.cc: GetGreasedUserAgentBrandVersion()
const GREASEY_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASED_VERSIONS = ["8", "99", "24"];

// user_agent_utils.cc: GetRandomOrder(), permutations for 3 and 4 brands.
const ORDERS_3 = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const ORDERS_4 = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
  [0, 3, 2, 1],
  [1, 0, 2, 3],
  [1, 0, 3, 2],
  [1, 2, 0, 3],
  [1, 2, 3, 0],
  [1, 3, 0, 2],
  [1, 3, 2, 0],
  [2, 0, 1, 3],
  [2, 0, 3, 1],
  [2, 1, 0, 3],
  [2, 1, 3, 0],
  [2, 3, 0, 1],
  [2, 3, 1, 0],
  [3, 0, 1, 2],
  [3, 0, 2, 1],
  [3, 1, 0, 2],
  [3, 1, 2, 0],
  [3, 2, 0, 1],
  [3, 2, 1, 0],
];

export function getGreasedBrandVersion(seed: number, fullVersion: boolean): UserAgentBrand {
  const brand = `Not${GREASEY_CHARS[seed % GREASEY_CHARS.length]}A${
    GREASEY_CHARS[(seed + 1) % GREASEY_CHARS.length]
  }Brand`;
  const version = GREASED_VERSIONS[seed % GREASED_VERSIONS.length];
  return { brand, version: fullVersion ? `${version}.0.0.0` : version };
}

function getRandomOrder(seed: number, size: number): number[] {
  if (size === 2) return [seed % size, (seed + 1) % size];
  if (size === 3) return ORDERS_3[seed % ORDERS_3.length];
  if (size === 4) return ORDERS_4[seed % ORDERS_4.length];
  throw new Error(`Chromium only shuffles 2 to 4 brands, got ${size}`);
}

/**
 * Chromium places entry i at position order[i] (ShuffleBrandList), which is
 * the inverse of indexing the list by the permutation.
 */
function shuffleBrandList(brands: UserAgentBrand[], seed: number): UserAgentBrand[] {
  const order = getRandomOrder(seed, brands.length);
  const shuffled = new Array<UserAgentBrand>(brands.length);
  brands.forEach((brand, i) => {
    shuffled[order[i]] = brand;
  });
  return shuffled;
}

/**
 * GenerateBrandVersionList(): GREASE, "Chromium", the product brand (absent in
 * Chromium-branded builds), then any additional brand, shuffled by the seed.
 */
export function generateBrandVersionList(options: {
  seed: number;
  brand: string | null;
  version: string;
  fullVersion: boolean;
  additionalBrand?: UserAgentBrand;
}): UserAgentBrand[] {
  const { seed, brand, version, fullVersion, additionalBrand } = options;
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`Invalid brand seed: ${seed}`);
  }
  const list: UserAgentBrand[] = [
    getGreasedBrandVersion(seed, fullVersion),
    { brand: "Chromium", version },
  ];
  if (brand) list.push({ brand, version });
  if (additionalBrand) list.push(additionalBrand);
  return shuffleBrandList(list, seed);
}

export interface UserAgentBrandLists {
  brands: UserAgentBrand[];
  fullVersionList: UserAgentBrand[];
}

/**
 * Returns the `brands` and `fullVersionList` a browser of the given version
 * reports. `brand` defaults to "Google Chrome"; pass null for a Chromium
 * build, which reports only GREASE and "Chromium".
 */
export function getUserAgentBrandLists(
  fullVersion: string,
  brand: string | null = "Google Chrome",
): UserAgentBrandLists {
  const major = Number.parseInt(fullVersion.split(".")[0], 10);
  if (!Number.isInteger(major)) {
    throw new Error(`Invalid Chrome version: ${fullVersion}`);
  }
  return {
    brands: generateBrandVersionList({
      seed: major,
      brand,
      version: String(major),
      fullVersion: false,
    }),
    fullVersionList: generateBrandVersionList({
      seed: major,
      brand,
      version: fullVersion,
      fullVersion: true,
    }),
  };
}

/** Serializes a brand list the way Chromium writes the Sec-CH-UA header. */
export function formatSecChUa(brands: UserAgentBrand[]): string {
  return brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(", ");
}
