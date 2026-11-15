import { Module } from '@nestjs/common';
import { RoutineReminders } from './routine-reminders.js';
import { RoutineRemindersRepository } from '../infrastructure/routine-reminders.repository.js';
@Module({
  providers: [
    { provide: RoutineReminders, useClass: RoutineRemindersRepository },
  ],
  exports: [RoutineReminders],
})
export class RoutineRemindersModule {}
