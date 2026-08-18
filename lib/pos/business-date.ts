export function getUlaanbaatarBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\//g, ".");
}

export function isValidBusinessDate(value: string) {
  return /^\d{4}[.-]\d{2}[.-]\d{2}$/.test(value);
}
