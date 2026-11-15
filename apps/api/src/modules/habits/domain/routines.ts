type RoutineSchedule = {
  startDate: string;
  endDate?: string | undefined;
  kind: 'DAILY' | 'WEEKLY' | 'WEEKDAYS';
  weekdays?: number[] | undefined;
};
export function routineDue(schedule: RoutineSchedule, date: string) {
  if (
    date < schedule.startDate ||
    (schedule.endDate && date > schedule.endDate)
  )
    return false;
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  return (
    schedule.kind === 'DAILY' ||
    (schedule.kind === 'WEEKDAYS'
      ? schedule.weekdays!.includes(weekday)
      : weekday === new Date(schedule.startDate + 'T00:00:00Z').getUTCDay())
  );
}
