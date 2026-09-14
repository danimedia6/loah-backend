export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_BY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_BY_WEEKDAY = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

export const isValidTimezone = (timezone) => {
  if (typeof timezone !== "string" || !timezone.trim()) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

export const validateWeeklyHours = (weeklyHours) => {
  if (!weeklyHours || typeof weeklyHours !== "object" || Array.isArray(weeklyHours)) {
    return "weekly_hours debe ser un objeto";
  }

  const receivedDays = Object.keys(weeklyHours);
  const missingDay = WEEK_DAYS.find((day) => !receivedDays.includes(day));
  if (missingDay) return `weekly_hours.${missingDay} es requerido`;

  const extraDay = receivedDays.find((day) => !WEEK_DAYS.includes(day));
  if (extraDay) return `weekly_hours.${extraDay} no es permitido`;

  for (const day of WEEK_DAYS) {
    const config = weeklyHours[day];

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return `weekly_hours.${day} debe ser un objeto`;
    }

    if (typeof config.closed !== "boolean") {
      return `weekly_hours.${day}.closed debe ser boolean`;
    }

    if (!config.closed) {
      if (typeof config.open !== "string" || !TIME_PATTERN.test(config.open)) {
        return `weekly_hours.${day}.open debe tener formato HH:MM`;
      }

      if (typeof config.close !== "string" || !TIME_PATTERN.test(config.close)) {
        return `weekly_hours.${day}.close debe tener formato HH:MM`;
      }
    }
  }

  return null;
};

const parseTime = (value) => {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute, totalMinutes: hour * 60 + minute };
};

const getLocalParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    dayKey: DAY_BY_WEEKDAY[parts.weekday],
  };
};

const addDaysToLocalDate = ({ year, month, day }, days) => {
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const getDayKeyForLocalDate = ({ year, month, day }) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return DAY_BY_INDEX[date.getUTCDay()];
};

const zonedLocalTimeToUtc = ({ year, month, day, hour, minute, second = 0 }, timeZone) => {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = targetAsUtc;

  for (let i = 0; i < 4; i += 1) {
    const actual = getLocalParts(new Date(utcMs), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const diff = targetAsUtc - actualAsUtc;

    if (diff === 0) break;
    utcMs += diff;
  }

  return new Date(utcMs);
};

const buildWindowForLocalDay = ({ localDate, dayKey, weeklyHours, timeZone }) => {
  const config = weeklyHours[dayKey];
  if (!config || config.closed) return null;

  const open = parseTime(config.open);
  const close = parseTime(config.close);
  const closeDate = close.totalMinutes <= open.totalMinutes
    ? addDaysToLocalDate(localDate, 1)
    : localDate;

  return {
    dayKey,
    openAt: zonedLocalTimeToUtc({ ...localDate, hour: open.hour, minute: open.minute }, timeZone),
    closeAt: zonedLocalTimeToUtc({ ...closeDate, hour: close.hour, minute: close.minute }, timeZone),
  };
};

export const getVenueOpenWindow = ({ timezone, weekly_hours }, now = new Date()) => {
  if (!isValidTimezone(timezone)) {
    throw new Error("Venue timezone inválida");
  }

  const weeklyHoursError = validateWeeklyHours(weekly_hours);
  if (weeklyHoursError) {
    throw new Error(weeklyHoursError);
  }

  const localNow = getLocalParts(now, timezone);
  const today = {
    year: localNow.year,
    month: localNow.month,
    day: localNow.day,
  };
  const yesterday = addDaysToLocalDate(today, -1);

  const candidates = [
    buildWindowForLocalDay({
      localDate: yesterday,
      dayKey: getDayKeyForLocalDate(yesterday),
      weeklyHours: weekly_hours,
      timeZone: timezone,
    }),
    buildWindowForLocalDay({
      localDate: today,
      dayKey: localNow.dayKey,
      weeklyHours: weekly_hours,
      timeZone: timezone,
    }),
  ].filter(Boolean);

  const activeWindow = candidates
    .filter((window) => now >= window.openAt && now < window.closeAt)
    .sort((a, b) => b.openAt.getTime() - a.openAt.getTime())[0];

  if (!activeWindow) {
    return {
      isOpen: false,
      closeAt: null,
      hardExpiresAt: null,
    };
  }

  const hardExpiresAt = new Date(activeWindow.closeAt.getTime() + 30 * 60 * 1000);

  return {
    isOpen: true,
    openedAt: activeWindow.openAt,
    closeAt: activeWindow.closeAt,
    hardExpiresAt,
    dayKey: activeWindow.dayKey,
  };
};
