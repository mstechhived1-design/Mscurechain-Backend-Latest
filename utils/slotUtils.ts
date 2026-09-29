export interface Slot {
    startTime: string;
    endTime: string;
    rawStart: Date;
    rawEnd: Date;
}

export const generateSlots = (
    startTime: string,
    endTime: string,
    breakStart?: string,
    breakEnd?: string,
    duration: number = 5
): Slot[] => {
    const parseTime = (timeStr?: string): Date | null => {
        if (!timeStr) return null;
        const normalized = timeStr.trim().toLowerCase();

        // Regex matches: H, H:mm, HH:mm, HH:mm:ss with optional AM/PM
        // Group 1: Hour, Group 2: optional Minute, Group 3: optional Second, Group 4: optional AM/PM
        const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/);
        if (!match) return null;

        let [_, hStr, mStr, sStr, ampm] = match;
        let h = parseInt(hStr);
        const m = mStr ? parseInt(mStr) : 0;
        const s = sStr ? parseInt(sStr) : 0;

        if (ampm === "pm" && h < 12) h += 12;
        if (ampm === "am" && h === 12) h = 0;

        // If no AM/PM, take h as is (24h format), but sanity check
        if (!ampm && h > 23) h = h % 24;

        return new Date(1970, 0, 1, h, m, s);
    };

    const slots: Slot[] = [];
    const start = parseTime(startTime);
    const end = parseTime(endTime);
    if (!start || !end) return [];

    const bStart = parseTime(breakStart);
    const bEnd = parseTime(breakEnd);

    let current = new Date(start);

    while (current < end) {
        // Check if current time is within break
        if (bStart && bEnd && current >= bStart && current < bEnd) {
            current = new Date(bEnd); // Skip to end of break
            continue;
        }

        const slotEnd = new Date(current.getTime() + duration * 60000);
        if (slotEnd > end) break;

        // Check if slot overlaps with break
        if (bStart && bEnd && slotEnd > bStart && current < bEnd) {
            current = new Date(bEnd); // Skip to end of break
            continue;
        }

        const formatTime = (d: Date): string => {
            let h = d.getHours();
            const m = d.getMinutes().toString().padStart(2, '0');
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12;
            h = h ? h : 12;
            return `${h}:${m} ${ampm}`;
        };

        slots.push({
            startTime: formatTime(current),
            endTime: formatTime(slotEnd),
            rawStart: new Date(current),
            rawEnd: new Date(slotEnd)
        });

        current = slotEnd;
    }

    return slots;
};

export const isHourBlockFull = (appointments: any[], date: string | Date, hour: number): boolean => {
    const count = appointments.filter(app => {
        const appDate = new Date(app.date);
        const appTime: string = app.startTime; // "10:00 AM"

        const parts = appTime.split(" ");
        if (parts.length < 2) return false;
        const [time, modifier] = parts;
        let [h] = time.split(":").map(Number);
        if (modifier === "PM" && h < 12) h += 12;
        if (modifier === "AM" && h === 12) h = 0;

        return appDate.toDateString() === new Date(date).toDateString() && h === hour;
    }).length;

    return count >= 12;
};
