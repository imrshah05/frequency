import { getLocalDateString } from './resonance';

export type ResonanceCalendarDay = {
  dateKey: string;
  date: Date;
};

// null represents a blank cell — before day 1 or after the last day of the
// month — which must render as truly empty, not another month's date.
export type ResonanceCalendarCell = ResonanceCalendarDay | null;
export type ResonanceCalendarWeek = ResonanceCalendarCell[];

// Builds exactly one calendar month (Sunday-start), day 1 through the last
// day, each in its correct weekday column. Leading/trailing cells outside
// the month are null.
export function buildResonanceCalendarMonth(year: number, month: number): ResonanceCalendarWeek[] {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay(); // 0 = Sunday

  const cells: ResonanceCalendarCell[] = [];

  for (let i = 0; i < leadingBlanks; i++) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    cells.push({ dateKey: getLocalDateString(date), date });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: ResonanceCalendarWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return weeks;
}
