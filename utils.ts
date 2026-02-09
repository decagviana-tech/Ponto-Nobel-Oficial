
import { Employee, ClockRecord, WeekDay } from './types';

export const formatMinutes = (minutes: number): string => {
  const isNegative = minutes < 0;
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = Math.floor(abs % 60);
  // Retorna formato amigável como +02h 30m ou -01h 15m
  return `${isNegative ? '-' : '+'}${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
};

export const parseTimeStringToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const isNegative = timeStr.trim().startsWith('-');
  const cleanStr = timeStr.replace('+', '').replace('-', '').trim();
  const parts = cleanStr.split(':');
  
  const h = parseInt(parts[0]) || 0;
  const m = parseInt(parts[1]) || 0;
  
  const total = h * 60 + m;
  return isNegative ? -total : total;
};

export const formatTime = (dateString: string | null): string => {
  if (!dateString) return '--:--';
  const date = new Date(dateString);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export const getExpectedMinutesForDate = (employee: Employee, date: Date): number => {
  if (employee.isHourly) return 0; 
  
  const dayOfWeek = date.getDay(); // 0 = Domingo, 1 = Segunda...
  
  // Se for Domingo: Geralmente folga na escala 6/1
  if (dayOfWeek === 0) return 0; 

  // Se for o dia da "Semana Inglesa/Dia Curto" (ex: Sábado)
  // Para fechar 44h (5x8h + 1x4h), o dia curto deve ser 4h (240 min)
  if (dayOfWeek === employee.englishWeekDay) {
    return employee.englishWeekMinutes || 240; 
  }

  // Dias normais: 8h (480 min)
  return employee.baseDailyMinutes || 480;
};

export const calculateWorkedMinutes = (record: ClockRecord, now: Date = new Date()): number => {
  if (!record.clockIn) return 0;
  
  const start = new Date(record.clockIn);
  // Se ainda não bateu saída, calcula com base no "agora" para mostrar saldo parcial
  const end = record.clockOut ? new Date(record.clockOut) : now;
  
  let totalMinutes = Math.floor((end.getTime() - start.getTime()) / (1000 * 60));

  // Subtrai intervalo de almoço
  if (record.lunchStart) {
    const lStart = new Date(record.lunchStart);
    const lEnd = record.lunchEnd ? new Date(record.lunchEnd) : (record.clockOut ? new Date(record.clockOut) : now);
    const lunchDuration = Math.max(0, Math.floor((lEnd.getTime() - lStart.getTime()) / (1000 * 60)));
    totalMinutes -= lunchDuration;
  }

  // Subtrai intervalo de lanche
  if (record.snackStart) {
    const sStart = new Date(record.snackStart);
    const sEnd = record.snackEnd ? new Date(record.snackEnd) : (record.clockOut ? new Date(record.clockOut) : now);
    const snackDuration = Math.max(0, Math.floor((sEnd.getTime() - sStart.getTime()) / (1000 * 60)));
    totalMinutes -= snackDuration;
  }

  return Math.max(0, totalMinutes);
};

export const exportToCSV = (data: any[], filename: string) => {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row => headers.map(header => `"${row[header]}"`).join(','))
  ];
  const csvContent = "\uFEFF" + csvRows.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
