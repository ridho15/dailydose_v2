'use client';

import { ClassSlotView } from '../../classes/class-slot-view';
import { isInstructorOnlySession } from '@/lib/session-audience';
import { useSessionContext } from '../../session-context';
import { InstructorTodayView } from '../instructor-today-view';

/**
 * "Jadwal Saya" instruktur memakai kartu yang sama dengan Hari Ini, seminggu penuh, bukan timetable
 * staf yang dirancang untuk menyusun jadwal. Peran lain tetap melihat timetable.
 */
export function JadwalSesuaiPeran() {
  const session = useSessionContext()?.session;
  if (isInstructorOnlySession(session)) return <InstructorTodayView mode="minggu" />;
  return <ClassSlotView />;
}
