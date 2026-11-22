// Schedules are stored as cron, but people pick and read them in words. Each repeat the
// builder offers is one cron shape; a cron outside those shapes reads as custom.

export type Repeat = "hourly" | "daily" | "weekdays" | "weekly" | "monthly";

export type ScheduleTime = {
    repeat: Repeat;
    minute: number;
    // Unused when hourly.
    hour: number;
    // 0 is Sunday. Only weekly uses it.
    weekday: number;
    // Only monthly uses it. Capped at 28 so it lands in every month.
    monthDay: number;
};

export const REPEAT_LABELS: Record<Repeat, string> = {
    hourly: "Every hour",
    daily: "Every day",
    weekdays: "Every weekday",
    weekly: "Every week",
    monthly: "Every month",
};

export function isRepeat(value: string): value is Repeat {
    return value in REPEAT_LABELS;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const MONTH_DAYS = Array.from({ length: 28 }, (_, index) => index + 1);

export const DEFAULT_TIME: ScheduleTime = {
    repeat: "daily",
    minute: 0,
    hour: 9,
    weekday: 1,
    monthDay: 1,
};

export function toCron(time: ScheduleTime) {
    const { repeat, minute, hour, weekday, monthDay } = time;
    if (repeat === "hourly") {
        return `${minute} * * * *`;
    }
    if (repeat === "weekdays") {
        return `${minute} ${hour} * * 1-5`;
    }
    if (repeat === "weekly") {
        return `${minute} ${hour} * * ${weekday}`;
    }
    if (repeat === "monthly") {
        return `${minute} ${hour} ${monthDay} * *`;
    }
    return `${minute} ${hour} * * *`;
}

// null when the cron is a shape the builder doesn't offer.
export function fromCron(cron: string): ScheduleTime | null {
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) {
        return null;
    }
    const [minuteField, hourField, monthDayField, monthField, weekdayField] = fields;
    const minute = whole(minuteField, 0, 59);
    if (minute === null || monthField !== "*") {
        return null;
    }
    if (hourField === "*") {
        if (monthDayField !== "*" || weekdayField !== "*") {
            return null;
        }
        return {
            ...DEFAULT_TIME,
            repeat: "hourly",
            minute,
        };
    }
    const hour = whole(hourField, 0, 23);
    if (hour === null) {
        return null;
    }
    const time = {
        ...DEFAULT_TIME,
        minute,
        hour,
    };
    if (monthDayField === "*" && weekdayField === "*") {
        return time;
    }
    if (monthDayField === "*" && weekdayField === "1-5") {
        return {
            ...time,
            repeat: "weekdays",
        };
    }
    // Cron allows 7 for Sunday too.
    const weekday = whole(weekdayField, 0, 7);
    if (monthDayField === "*" && weekday !== null) {
        return {
            ...time,
            repeat: "weekly",
            weekday: weekday % 7,
        };
    }
    const monthDay = whole(monthDayField, 1, 28);
    if (weekdayField === "*" && monthDay !== null) {
        return {
            ...time,
            repeat: "monthly",
            monthDay,
        };
    }
    return null;
}

// "Every day at 9:00 AM", "Every Monday at 9:00 AM", "Every hour at :15".
export function describeCron(cron: string) {
    const time = fromCron(cron);
    if (!time) {
        return "Custom schedule";
    }
    const { repeat, minute, hour, weekday, monthDay } = time;
    const at = clockTime(hour, minute);
    if (repeat === "hourly") {
        return minute === 0 ? "Every hour on the hour" : `Every hour at :${pad(minute)}`;
    }
    if (repeat === "weekdays") {
        return `Weekdays at ${at}`;
    }
    if (repeat === "weekly") {
        return `Every ${WEEKDAYS[weekday]} at ${at}`;
    }
    if (repeat === "monthly") {
        return `Monthly on the ${ordinal(monthDay)} at ${at}`;
    }
    return `Every day at ${at}`;
}

export function ordinal(day: number) {
    const lastTwo = day % 100;
    if (lastTwo >= 11 && lastTwo <= 13) {
        return `${day}th`;
    }
    const suffixes: Record<number, string> = {
        1: "st",
        2: "nd",
        3: "rd",
    };
    return `${day}${suffixes[day % 10] ?? "th"}`;
}

export function pad(value: number) {
    return String(value).padStart(2, "0");
}

function clockTime(hour: number, minute: number) {
    const period = hour < 12 ? "AM" : "PM";
    const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelveHour}:${pad(minute)} ${period}`;
}

function whole(field: string, min: number, max: number) {
    if (!/^\d+$/.test(field)) {
        return null;
    }
    const value = Number(field);
    return value >= min && value <= max ? value : null;
}
