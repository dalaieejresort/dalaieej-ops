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
