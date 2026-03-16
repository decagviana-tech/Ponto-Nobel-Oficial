
export enum WeekDay {
  SUNDAY = 0,
  MONDAY = 1,
  TUESDAY = 2,
  WEDNESDAY = 3,
  THURSDAY = 4,
  FRIDAY = 5,
  SATURDAY = 6
}

export type EntryType = 'WORK' | 'MEDICAL' | 'HOLIDAY' | 'ADJUSTMENT' | 'PAYMENT' | 'VACATION' | 'BONUS' | 'OFF_DAY' | 'WORK_RETRO';

export interface Employee {
  id: string;
  name: string;
  role: string;
  baseDailyMinutes: number; 
  englishWeekDay: WeekDay;
  englishWeekMinutes: number; 
  isActive: boolean;
  startDate: string;
  initialBalanceMinutes: number;
  isHourly?: boolean;
}

export interface ClockRecord {
  id: string;
  employeeId: string;
  date: string; 
  clockIn: string | null;
  lunchStart: string | null;
  lunchEnd: string | null;
  snackStart: string | null;
  snackEnd: string | null;
  clockOut: string | null;
  expectedMinutes: number;
  type: EntryType;
  note?: string;
}

export interface TimeBankEntry {
  id: string;
  employeeId: string;
  date: string;
  minutes: number; 
  type: EntryType;
  note?: string;
}

export interface AppSettings {
  managerPin: string;
}

export interface AppData {
  employees: Employee[];
  records: ClockRecord[];
  timeBank: TimeBankEntry[];
  settings?: AppSettings;
}
