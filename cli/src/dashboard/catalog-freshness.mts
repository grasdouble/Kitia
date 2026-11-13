export type CatalogFreshnessStatus = "checking" | "current" | "outdated" | "unknown";

type Catalog = { name: string };
type FreshnessResult = { name: string; status: CatalogFreshnessStatus };
type FreshnessState = Record<string, CatalogFreshnessStatus>;
type UpdateFreshnessState = (update: (current: FreshnessState) => FreshnessState) => void;
type CheckFreshness = (names: string[]) => Promise<FreshnessResult[]>;

export async function updateCatalogFreshness(
  catalogs: Catalog[],
  names: string[],
  requests: Map<string, number>,
  updateState: UpdateFreshnessState,
  check?: CheckFreshness,
): Promise<void> {
  const requestIds = new Map<string, number>();
  for (const name of names) {
    const key = name.toLowerCase();
    const requestId = (requests.get(key) || 0) + 1;
    requests.set(key, requestId);
    requestIds.set(key, requestId);
  }

  const updateStatuses = (statusFor: (name: string) => CatalogFreshnessStatus) => {
    const catalogNames = new Set(catalogs.map(({ name }) => name.toLowerCase()));
    updateState((current) => {
      const next = Object.fromEntries(Object.entries(current)
        .filter(([name]) => catalogNames.has(name.toLowerCase()))) as FreshnessState;
      for (const name of names) {
        const key = name.toLowerCase();
        if (requests.get(key) === requestIds.get(key)) next[name] = statusFor(name);
      }
      return next;
    });
  };

  updateStatuses(() => "checking");
  if (!check) {
    updateStatuses(() => "unknown");
    return;
  }
  try {
    const results = await check(names);
    const statusByName = new Map(results.map(({ name, status }) => [name.toLowerCase(), status]));
    updateStatuses((name) => statusByName.get(name.toLowerCase()) || "unknown");
  } catch {
    updateStatuses(() => "unknown");
  }
}
