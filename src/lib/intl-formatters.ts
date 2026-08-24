const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const displayNamesFormatters = new Map<string, Intl.DisplayNames>();

function formatterKey(
  locales: Intl.LocalesArgument | undefined,
  options: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions | undefined,
): string {
  return JSON.stringify([locales ?? null, options ?? null]);
}

export function getDateTimeFormatter(
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const resolvedLocales = locales ?? "en";
  const resolvedOptions = options?.timeZone ? options : { ...options, timeZone: "UTC" };
  const key = formatterKey(resolvedLocales, resolvedOptions);
  const cached = dateTimeFormatters.get(key);
  if (cached) return cached;

  const formatter = Intl.DateTimeFormat(resolvedLocales, resolvedOptions);
  dateTimeFormatters.set(key, formatter);
  return formatter;
}

export function getNumberFormatter(
  locales?: Intl.LocalesArgument,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const resolvedLocales = locales ?? "en";
  const key = formatterKey(resolvedLocales, options);
  const cached = numberFormatters.get(key);
  if (cached) return cached;

  const formatter = Intl.NumberFormat(resolvedLocales, options);
  numberFormatters.set(key, formatter);
  return formatter;
}

export function getDisplayNames(
  locales: Intl.LocalesArgument,
  options: Intl.DisplayNamesOptions,
): Intl.DisplayNames {
  const key = formatterKey(locales, options);
  const cached = displayNamesFormatters.get(key);
  if (cached) return cached;

  const formatter = Reflect.construct(Intl.DisplayNames, [locales, options]) as Intl.DisplayNames;
  displayNamesFormatters.set(key, formatter);
  return formatter;
}
