export type VersionNotice = {
  installed: string;
  available: string;
  changelogUrl: string;
};

export type VersionCheckResult = {
  label: string;
  notice: VersionNotice | null;
};

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function checkInstalledVersion(
  installed: string,
  request: typeof fetch = fetch,
): Promise<VersionCheckResult> {
  const response = await request("https://registry.npmjs.org/@grasdouble%2Fkitia/latest", {
    signal: AbortSignal.timeout(1500),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("npm registry unavailable");
  const { version } = await response.json() as { version: string };
  if (installed !== "unknown" && compareVersions(version, installed) > 0) {
    const heading = version.toLowerCase().replace(/[^a-z0-9-]/g, "");
    return {
      label: `${installed} - New version available`,
      notice: {
        installed,
        available: version,
        changelogUrl: `https://github.com/grasdouble/Kitia/blob/main/CHANGELOG.md#${heading}`,
      },
    };
  }
  return { label: installed, notice: null };
}
