export interface WeekWindow {
  days: string[];
  start: Date;
  end: Date;
  label: string;
}

/**
 * Membuat `Intl.DateTimeFormat` itu mahal, sedangkan kalender memanggil fungsi di file ini ratusan
 * kali per render. Satu formatter per zona waktu disimpan dan dipakai ulang.
 */
const formatterTersimpan = new Map<string, Intl.DateTimeFormat>();
function formatter(kunci: string, buat: () => Intl.DateTimeFormat) {
  let f = formatterTersimpan.get(kunci);
  if (!f) {
    f = buat();
    formatterTersimpan.set(kunci, f);
  }
  return f;
}

const partsFormatter = (timeZone: string) =>
  formatter(
    `parts|${timeZone}`,
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
  );

function parts(value: Date, timeZone: string) {
  const values = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: values.year ?? Number.NaN,
    month: values.month ?? Number.NaN,
    day: values.day ?? Number.NaN,
    hour: values.hour ?? Number.NaN,
    minute: values.minute ?? Number.NaN,
    second: values.second ?? Number.NaN,
  };
}

export function localDateKey(value: Date, timeZone: string) {
  const valueParts = parts(value, timeZone);
  return `${valueParts.year}-${String(valueParts.month).padStart(2, '0')}-${String(valueParts.day).padStart(2, '0')}`;
}

export function zonedLocalDateTime(date: string, time: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) throw new Error('INVALID_LOCAL_DATE_TIME');
  const wanted = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  };
  if (wanted.hour > 23 || wanted.minute > 59) throw new Error('INVALID_LOCAL_DATE_TIME');
  const wantedUtc = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute);
  let instant = new Date(wantedUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = parts(instant, timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant = new Date(instant.getTime() + wantedUtc - actualUtc);
  }
  const verified = parts(instant, timeZone);
  if (
    verified.year !== wanted.year ||
    verified.month !== wanted.month ||
    verified.day !== wanted.day ||
    verified.hour !== wanted.hour ||
    verified.minute !== wanted.minute
  )
    throw new Error('INVALID_LOCAL_DATE_TIME');
  return instant;
}

function addCalendarDays(date: string, amount: number) {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return next.toISOString().slice(0, 10);
}

export function weekWindow(reference: Date, timeZone: string): WeekWindow {
  const localDate = localDateKey(reference, timeZone);
  const [year = 0, month = 0, day = 0] = localDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const monday = addCalendarDays(localDate, -(weekday === 0 ? 6 : weekday - 1));
  const days = Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index));
  const start = zonedLocalDateTime(monday, '00:00', timeZone);
  const end = zonedLocalDateTime(addCalendarDays(monday, 7), '00:00', timeZone);
  const label = `${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone }).format(start)} – ${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(end.getTime() - 1))}`;
  return { days, start, end, label };
}

export function shiftWeek(reference: Date, amount: number) {
  return new Date(reference.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
}

export function formatBranchTime(value: Date, timeZone: string) {
  return formatter(
    `jam|${timeZone}`,
    () =>
      new Intl.DateTimeFormat('id-ID', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
  ).format(value);
}

/** `Sen, 2 Nov`; ditambah tahun bila bukan tahun berjalan di zona waktu itu, supaya riwayat tahun lalu tidak terbaca sebagai minggu ini. */
export function formatBranchDay(date: string, timeZone: string, now: Date = new Date()) {
  const instant = zonedLocalDateTime(date, '12:00', timeZone);
  const showYear = Number(date.slice(0, 4)) !== Number(localDateKey(now, timeZone).slice(0, 4));
  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(showYear ? { year: 'numeric' } : {}),
  }).format(instant);
}

export function formatBranchLongDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value);
}
