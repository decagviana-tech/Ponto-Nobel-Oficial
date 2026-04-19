
import React, { useState, useEffect, useMemo } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenAI } from "@google/genai";
import { AppData, Employee, ClockRecord, TimeBankEntry, EntryType } from './types';
import { WEEK_DAYS_BR } from './constants';
import { 
  formatMinutes, 
  getExpectedMinutesForDate, 
  calculateWorkedMinutes, 
  formatTime,
  parseTimeStringToMinutes,
  exportToCSV,
  ENTRY_TYPE_LABELS,
  getLocalDateString,
  getLocalISOString
} from './utils';
import { 
  Coffee, Utensils, LogIn, LogOut, ChevronLeft, Lock, 
  UserCheck, X, Clock as ClockIcon, 
  Edit2, Trash2, UserPlus, FileText, Download, 
  TrendingUp, Users, Settings, BookOpen, Sparkles, 
  Plus, RefreshCw, AlertCircle, CheckCircle2, Search,
  Calendar, BrainCircuit, HeartPulse, Palmtree, ShieldCheck,
  History, SlidersHorizontal, Info, Database, AlertTriangle,
  GraduationCap, Briefcase, Minus
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://afpcoquiivzrckabcvzo.supabase.co"; 
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_-5JWjReTELNk5YKnkX9OZg_EeR6j6Zy"; 

const isConfigured = SUPABASE_URL !== "" && SUPABASE_KEY !== "";
const supabase: SupabaseClient | null = isConfigured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const App: React.FC = () => {
  const [data, setData] = useState<AppData>({
    employees: [],
    records: [],
    timeBank: [],
    settings: { managerPin: "1234" }
  });
  
  const [activeTab, setActiveTab] = useState('clock'); 
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedClockEmployeeId, setSelectedClockEmployeeId] = useState<string | null>(null);
  const [isManagerAuthenticated, setIsManagerAuthenticated] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [isLoading, setIsLoading] = useState(isConfigured);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const DEFAULT_START_DATE = getLocalDateString(new Date());

  const [newEmp, setNewEmp] = useState({ 
    name: '', role: '', dailyHours: '8', englishDay: '6', shortDayHours: '4', initialBalanceStr: '00:00', isHourly: false, startDate: DEFAULT_START_DATE
  });

  const [adjustmentForm, setAdjustmentForm] = useState({
    employeeId: '',
    date: getLocalDateString(new Date()),
    amountStr: '00:00',
    type: 'ADJUSTMENT' as EntryType,
    isPositive: true,
    note: ''
  });

  const [justificationForm, setJustificationForm] = useState({
    employeeId: '',
    date: getLocalDateString(new Date()),
    endDate: getLocalDateString(new Date()),
    type: 'MEDICAL' as EntryType,
    note: '',
    isRange: false
  });

  const [reportFilter, setReportFilter] = useState({
    startDate: getLocalDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: getLocalDateString(new Date()),
    employeeId: 'all'
  });

  const fetchData = async () => {
    if (!supabase) return;
    try {
      const [ { data: empsRaw }, { data: recs }, { data: bank }, { data: sett } ] = await Promise.all([
        supabase.from('employees').select('*').order('name'),
        supabase.from('records').select('*').order('date', { ascending: false }),
        supabase.from('timeBank').select('*').order('date', { ascending: false }),
        supabase.from('settings').select('*').eq('id', 1).maybeSingle()
      ]);

      const normalizedEmployees = (empsRaw || []).map((e: any) => ({
        ...e,
        startDate: e.startDate || e.start_date || DEFAULT_START_DATE,
        baseDailyMinutes: e.baseDailyMinutes || e.base_daily_minutes || 480,
        englishWeekDay: e.englishWeekDay !== undefined ? e.englishWeekDay : (e.english_week_day !== undefined ? e.english_week_day : 6),
        englishWeekMinutes: e.englishWeekMinutes !== undefined ? e.englishWeekMinutes : (e.english_week_minutes !== undefined ? e.english_week_minutes : 240),
        initialBalanceMinutes: e.initialBalanceMinutes || e.initial_balance_minutes || 0,
        isHourly: e.isHourly || e.is_hourly || false
      })) as Employee[];

      setData({
        employees: normalizedEmployees,
        records: (recs || []) as ClockRecord[],
        timeBank: (bank || []) as TimeBankEntry[],
        settings: (sett || { managerPin: "1234" }) as any
      });
    } catch (err) {
      console.error("Erro ao buscar dados", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getCumulativeBalance = (empId: string) => {
    const emp = data.employees.find(e => e.id === empId);
    if (!emp) return 0;
    
    let totalBalance = emp.initialBalanceMinutes || 0;
    let startDateStr = emp.startDate || DEFAULT_START_DATE;
    if (startDateStr.includes('T')) startDateStr = startDateStr.split('T')[0];
    
    let loopDate = new Date(startDateStr + "T12:00:00");
    const todayStr = getLocalDateString(currentTime);
    
    const entriesMap = new Map<string, TimeBankEntry[]>();
    data.timeBank.filter(t => t.employeeId === empId).forEach(t => {
      const list = entriesMap.get(t.date) || [];
      list.push(t);
      entriesMap.set(t.date, list);
    });

    let maxSafety = 0; 
    const yesterday = new Date(currentTime);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    while (getLocalDateString(loopDate) <= yesterdayStr && maxSafety < 4500) {
      maxSafety++;
      const dateKey = getLocalDateString(loopDate);
      const dayEntries = entriesMap.get(dateKey) || [];
      const metaDoDia = getExpectedMinutesForDate(emp, loopDate);
      
      const workEntry = dayEntries.find(e => e.type === 'WORK');
      const otherEntries = dayEntries.filter(e => e.type !== 'WORK');
      const isExcused = otherEntries.some(e => ['MEDICAL', 'HOLIDAY', 'VACATION', 'OFF_DAY'].includes(e.type));

      if (workEntry) {
        totalBalance += workEntry.minutes;
      } else if (metaDoDia > 0 && !isExcused) {
        totalBalance -= metaDoDia;
      }

      otherEntries.forEach(ent => {
        if (['ADJUSTMENT', 'WORK_RETRO', 'BONUS'].includes(ent.type)) {
          totalBalance += ent.minutes;
        }
      });

      loopDate.setDate(loopDate.getDate() + 1);
    }

    const todayRec = data.records.find(r => r.employeeId === empId && r.date === todayStr);
    const todayManualEntries = entriesMap.get(todayStr) || [];

    if (todayRec) {
      const workedSoFar = calculateWorkedMinutes(todayRec, currentTime);
      totalBalance += (workedSoFar - todayRec.expectedMinutes);
    } else {
      const isExcusedToday = todayManualEntries.some(e => ['MEDICAL', 'HOLIDAY', 'VACATION', 'OFF_DAY'].includes(e.type));
      if (todayManualEntries.length > 0 && !isExcusedToday) {
        const metaDoDiaHoje = getExpectedMinutesForDate(emp, currentTime);
        totalBalance -= metaDoDiaHoje;
      }
    }
    
    todayManualEntries.forEach(ent => {
      if (['ADJUSTMENT', 'WORK_RETRO', 'BONUS'].includes(ent.type)) totalBalance += ent.minutes;
    });

    return totalBalance;
  };

  const handleClockAction = async (employeeId: string) => {
    if (!supabase) return;
    const todayStr = getLocalDateString(currentTime);
    const record = data.records.find(r => r.employeeId === employeeId && r.date === todayStr);
    const nowISO = getLocalISOString(currentTime);

    try {
      if (!record) {
        const emp = data.employees.find(e => e.id === employeeId)!;
        await supabase.from('records').insert([{
          employeeId, 
          date: todayStr, 
          clockIn: nowISO, 
          type: 'WORK',
          expectedMinutes: getExpectedMinutesForDate(emp, currentTime)
        }]);
      } else {
        const action = getNextAction(record);
        const update: any = {};
        if (action.stage === 'l_start') update.lunchStart = nowISO;
        else if (action.stage === 'l_end') update.lunchEnd = nowISO;
        else if (action.stage === 's_start') update.snackStart = nowISO;
        else if (action.stage === 's_end') update.snackEnd = nowISO;
        else if (action.stage === 'out') update.clockOut = nowISO;
        
        await supabase.from('records').update(update).eq('id', record.id);

        if (action.stage === 'out') {
          const worked = calculateWorkedMinutes({ ...record, ...update }, currentTime);
          await supabase.from('timeBank').insert([{
            employeeId, date: todayStr, minutes: worked - record.expectedMinutes, type: 'WORK'
          }]);
          setSelectedClockEmployeeId(null);
        }
      }
      await fetchData();
    } catch (e) { alert("Erro de conexão."); }
  };

  const handleDeleteFullRecord = async (recordId: string, employeeId: string, date: string) => {
    if (!supabase) return;
    if (confirm(`Excluir batidas do dia ${new Date(date + "T12:00:00").toLocaleDateString('pt-BR')}?`)) {
      setIsSaving(true);
      try {
        await supabase.from('timeBank').delete().match({ employeeId, date, type: 'WORK' });
        const { error } = await supabase.from('records').delete().eq('id', recordId);
        if (error) throw error;
        await fetchData();
        alert("Ponto excluído!");
      } catch (err: any) { alert("Erro: " + err.message); } finally { setIsSaving(false); }
    }
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !adjustmentForm.employeeId) return;
    setIsSaving(true);
    try {
      const baseMinutes = parseTimeStringToMinutes(adjustmentForm.amountStr);
      const finalMinutes = adjustmentForm.isPositive ? Math.abs(baseMinutes) : -Math.abs(baseMinutes);
      const { error } = await supabase.from('timeBank').insert([{
        employeeId: adjustmentForm.employeeId,
        date: adjustmentForm.date,
        minutes: finalMinutes,
        type: adjustmentForm.type,
        note: adjustmentForm.note.trim() || 'Ajuste manual administrativo'
      }]);
      if (error) throw error;
      setAdjustmentForm({ ...adjustmentForm, amountStr: '00:00', note: '' });
      await fetchData();
      alert("Ajuste aplicado com sucesso!");
    } catch (err: any) { alert("Erro: " + err.message); } finally { setIsSaving(false); }
  };

  const handleSaveJustification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !justificationForm.employeeId) return;
    setIsSaving(true);
    try {
      const entries = [];
      if (justificationForm.isRange && justificationForm.endDate > justificationForm.date) {
        let current = new Date(justificationForm.date + "T12:00:00");
        const end = new Date(justificationForm.endDate + "T12:00:00");
        while (current <= end) {
          entries.push({
            employeeId: justificationForm.employeeId,
            date: getLocalDateString(current),
            minutes: 0, 
            type: justificationForm.type,
            note: justificationForm.note.trim() || 'Abono/Justificativa'
          });
          current.setDate(current.getDate() + 1);
        }
      } else {
        entries.push({
          employeeId: justificationForm.employeeId,
          date: justificationForm.date,
          minutes: 0, 
          type: justificationForm.type,
          note: justificationForm.note.trim() || 'Abono/Justificativa'
        });
      }

      const { error } = await supabase.from('timeBank').insert(entries);
      if (error) throw error;
      setJustificationForm({ ...justificationForm, note: '', isRange: false });
      await fetchData();
      alert(entries.length > 1 ? `${entries.length} dias registrados com sucesso!` : "Abono registrado!");
    } catch (err: any) { alert("Erro: " + err.message); } finally { setIsSaving(false); }
  };

  const handleDeleteEntry = async (id: string, message: string) => {
    if (!supabase) return;
    if (confirm(message)) {
      const { error } = await supabase.from('timeBank').delete().eq('id', id);
      if (error) alert("Erro ao excluir: " + error.message);
      else await fetchData();
    }
  };

  const handleExportAccountantReport = () => {
    const entriesList: { empId: string, date: string }[] = [];
    const empsToProcess = reportFilter.employeeId === 'all' 
      ? data.employees 
      : data.employees.filter(e => e.id === reportFilter.employeeId);

    const startD = new Date(reportFilter.startDate + "T12:00:00");
    const endD = new Date(reportFilter.endDate + "T12:00:00");

    empsToProcess.forEach(emp => {
      let currentD = new Date(startD);
      // Ignora datas antes da admissão do funcionário para não gerar faltas falsas
      const empStart = emp.startDate ? new Date(emp.startDate + "T12:00:00") : new Date(0);
      
      while (currentD <= endD) {
        if (currentD >= empStart) {
          const dateStr = getLocalDateString(currentD);
          const expected = getExpectedMinutesForDate(emp, currentD);
          const hasRecord = data.records.some(rx => rx.employeeId === emp.id && rx.date === dateStr);
          const hasBank = data.timeBank.some(t => t.employeeId === emp.id && t.date === dateStr);
          
          if (hasRecord || hasBank || expected > 0) {
             entriesList.push({ empId: emp.id, date: dateStr });
          }
        }
        currentD.setDate(currentD.getDate() + 1);
      }
    });

    // Converter para array e ordenar (nome asc, data asc)
    entriesList.sort((a, b) => {
       const empA = data.employees.find(e => e.id === a.empId)?.name || '';
       const empB = data.employees.find(e => e.id === b.empId)?.name || '';
       if (empA > empB) return 1;
       if (empA < empB) return -1;
       return a.date > b.date ? 1 : -1;
    });

    const finalReportData: any[] = [];
    let currentEmpId = '';
    let currentWeekKey = '';
    let weekWorkedMins = 0;
    let weekExpectedMins = 0;
    let weekAdjustmentMins = 0;
    let weekBalanceMins = 0;

    const getWeekKey = (dStr: string) => {
       const d = new Date(dStr + "T12:00:00");
       const day = d.getDay();
       const diffToMon = day === 0 ? -6 : 1 - day;
       const mon = new Date(d); mon.setDate(d.getDate() + diffToMon);
       const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
       return `${mon.toLocaleDateString('pt-BR')} a ${sun.toLocaleDateString('pt-BR')}`;
    };

    entriesList.forEach((entry, idx) => {
      const r = data.records.find(rx => rx.employeeId === entry.empId && rx.date === entry.date);
      const emp = data.employees.find(e => e.id === entry.empId);
      
      const dayTimeBank = data.timeBank.filter(t => t.employeeId === entry.empId && t.date === entry.date);
      const workEntry = dayTimeBank.find(t => t.type === 'WORK');
      const otherEntries = dayTimeBank.filter(t => t.type !== 'WORK');
      
      const expected = r?.expectedMinutes ?? (emp ? getExpectedMinutesForDate(emp as any, new Date(entry.date + "T12:00:00")) : 0);
      const workedMins = workEntry ? (workEntry.minutes + expected) : 0;
      
      let adjustmentMins = 0;
      let notes: string[] = [];
      let isAbscence = false;

      otherEntries.forEach(t => {
         adjustmentMins += t.minutes;
         if (['MEDICAL', 'VACATION', 'HOLIDAY', 'OFF_DAY'].includes(t.type)) {
           isAbscence = true;
         }
         const label = ENTRY_TYPE_LABELS[t.type as keyof typeof ENTRY_TYPE_LABELS] || t.type;
         notes.push(`${label}${t.note && t.note !== 'Abono/Justificativa' && t.note !== 'Abono' ? ' (' + t.note + ')' : ''}`);
      });

      let dailyBalance = 0;
      if (workEntry) {
         dailyBalance += workEntry.minutes;
      } else {
         if (expected > 0 && !isAbscence) {
            dailyBalance -= expected;
         }
      }
      dailyBalance += adjustmentMins;

      const weekKey = getWeekKey(entry.date);

      if ((currentEmpId !== entry.empId || currentWeekKey !== weekKey) && currentEmpId !== '') {
          finalReportData.push({
             'Funcionário': '---',
             'Data': `RESUMO: ${currentWeekKey}`,
             'Entrada': '---',
             'Início Almoço': '---',
             'Retorno Almoço': '---',
             'Início Lanche': '---',
             'Retorno Lanche': '---',
             'Saída Final': '---',
             'Meta do Dia': formatMinutes(weekExpectedMins),
             'Total Trabalhado': formatMinutes(weekWorkedMins),
             'Justificativas / Abonos': '---',
             'Horas de Ajuste': formatMinutes(weekAdjustmentMins),
             'Saldo do Dia': formatMinutes(weekBalanceMins)
          });
          weekWorkedMins = 0;
          weekExpectedMins = 0;
          weekAdjustmentMins = 0;
          weekBalanceMins = 0;
      }

      currentEmpId = entry.empId;
      currentWeekKey = weekKey;
      weekExpectedMins += expected;
      weekWorkedMins += workedMins;
      weekAdjustmentMins += adjustmentMins;
      weekBalanceMins += dailyBalance;

      finalReportData.push({
        'Funcionário': emp?.name || '---',
        'Data': new Date(entry.date + "T12:00:00").toLocaleDateString('pt-BR'),
        'Entrada': r ? formatTime(r.clockIn) : '---',
        'Início Almoço': r ? formatTime(r.lunchStart) : '---',
        'Retorno Almoço': r ? formatTime(r.lunchEnd) : '---',
        'Início Lanche': r ? formatTime(r.snackStart) : '---',
        'Retorno Lanche': r ? formatTime(r.snackEnd) : '---',
        'Saída Final': r ? formatTime(r.clockOut) : '---',
        'Meta do Dia': formatMinutes(expected),
        'Total Trabalhado': (r || workEntry) ? formatMinutes(workedMins) : '---',
        'Justificativas / Abonos': notes.length > 0 ? notes.join(' | ') : '---',
        'Horas de Ajuste': adjustmentMins !== 0 ? formatMinutes(adjustmentMins) : (isAbscence ? 'Abonado/Neutro' : '---'),
        'Saldo do Dia': formatMinutes(dailyBalance)
      });

      if (idx === entriesList.length - 1) {
          finalReportData.push({
             'Funcionário': '---',
             'Data': `RESUMO: ${currentWeekKey}`,
             'Entrada': '---',
             'Início Almoço': '---',
             'Retorno Almoço': '---',
             'Início Lanche': '---',
             'Retorno Lanche': '---',
             'Saída Final': '---',
             'Meta do Dia': formatMinutes(weekExpectedMins),
             'Total Trabalhado': formatMinutes(weekWorkedMins),
             'Justificativas / Abonos': '---',
             'Horas de Ajuste': formatMinutes(weekAdjustmentMins),
             'Saldo do Dia': formatMinutes(weekBalanceMins)
          });
      }
    });
    
    exportToCSV(finalReportData, 'Relatorio_Nobel_Completo');
  };

  const filteredRecords = data.records.filter(r => {
    const isDateInRange = r.date >= reportFilter.startDate && r.date <= reportFilter.endDate;
    const isEmployeeMatch = reportFilter.employeeId === 'all' || r.employeeId === reportFilter.employeeId;
    return isDateInRange && isEmployeeMatch;
  });

  const getNextAction = (record?: ClockRecord) => {
    if (!record?.clockIn) return { label: 'Entrada', stage: 'in', color: 'bg-indigo-600', icon: <LogIn size={20}/> };
    if (!record.lunchStart) return { label: 'Início Almoço', stage: 'l_start', color: 'bg-amber-600', icon: <Utensils size={20}/> };
    if (!record.lunchEnd) return { label: 'Retorno Almoço', stage: 'l_end', color: 'bg-emerald-600', icon: <Utensils size={20}/> };
    if (!record.snackStart) return { label: 'Início Lanche', stage: 's_start', color: 'bg-orange-500', icon: <Coffee size={20}/> };
    if (!record.snackEnd) return { label: 'Retorno Lanche', stage: 's_end', color: 'bg-teal-600', icon: <Coffee size={20}/> };
    if (!record.clockOut) return { label: 'Saída Final', stage: 'out', color: 'bg-rose-600', icon: <LogOut size={20}/> };
    return { label: 'Finalizado', stage: 'done', color: 'bg-slate-800', icon: <UserCheck size={20}/> };
  };

  const handlePinDigit = (digit: string) => {
    if (pinInput.length < 4) {
      const currentPin = data.settings?.managerPin || "1234";
      const nextPin = pinInput + digit;
      setPinInput(nextPin);
      if (nextPin === currentPin) {
        setIsManagerAuthenticated(true);
        setIsLoginModalOpen(false);
        setPinInput('');
        setActiveTab('dashboard');
      } else if (nextPin.length === 4) {
        setLoginError(true);
        setTimeout(() => { setPinInput(''); setLoginError(false); }, 600);
      }
    }
  };

  const safeFormatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "N/A";
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const parts = cleanDate.split('-');
    if (parts.length !== 3) return cleanDate;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col md:flex-row text-slate-200 overflow-x-hidden">
      
      {/* SIDEBAR */}
      <aside className="w-full md:w-64 bg-[#1e293b] flex flex-col shadow-2xl md:fixed md:inset-y-0 z-50 overflow-y-auto">
        <div className="p-6 border-b border-white/5 flex flex-col items-center">
          <div className="bg-indigo-600 p-2.5 rounded-xl text-white shadow-xl mb-3"><BookOpen size={24}/></div>
          <span className="text-white font-serif italic text-lg tracking-tight">Nobel Petrópolis</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <button onClick={() => { setActiveTab('clock'); setIsManagerAuthenticated(false); setSelectedClockEmployeeId(null); }} className={`w-full flex items-center gap-3 px-5 py-3 rounded-xl font-bold text-xs transition-all ${activeTab === 'clock' && !isManagerAuthenticated ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}>
            <ClockIcon size={18}/> Registrar Ponto
          </button>
          <div className="pt-6 opacity-30 px-5 text-[9px] font-black uppercase tracking-widest mb-1">Gestão</div>
          {[
            { id: 'dashboard', label: 'Painel Geral', icon: <TrendingUp size={18}/> },
            { id: 'employees', label: 'Equipe', icon: <Users size={18}/> },
            { id: 'justifications', label: 'Justificativas', icon: <ShieldCheck size={18}/> },
            { id: 'admin', label: 'Ajustes', icon: <SlidersHorizontal size={18}/> },
            { id: 'reports', label: 'Relatórios', icon: <FileText size={18}/> },
          ].map(item => (
            <button key={item.id} onClick={() => isManagerAuthenticated ? setActiveTab(item.id) : setIsLoginModalOpen(true)} className={`w-full flex items-center gap-3 px-5 py-3 rounded-xl font-bold text-xs transition-all ${activeTab === item.id && isManagerAuthenticated ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
              {item.icon} {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-6 md:p-10 md:ml-64 bg-slate-50 text-slate-900 min-h-screen">
        <header className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Nobel Petrópolis</p>
            <h1 className="text-3xl font-black font-serif italic capitalize leading-none">{activeTab}</h1>
          </div>
          <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-slate-100 text-right w-full sm:w-auto">
            <p className="text-xl font-mono font-black text-slate-800 leading-none">{currentTime.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</p>
            <p className="text-[9px] font-black text-indigo-500 uppercase mt-1">{currentTime.toLocaleDateString('pt-BR', {weekday:'short', day:'2-digit', month:'short'})}</p>
          </div>
        </header>

        <div className="max-w-7xl mx-auto pb-10">
          
          {activeTab === 'clock' && (
            <div className="animate-in fade-in duration-300">
              {!selectedClockEmployeeId ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {data.employees.map(emp => (
                    <button key={emp.id} onClick={() => setSelectedClockEmployeeId(emp.id)} className="bg-white p-6 rounded-3xl shadow-sm hover:shadow-md transition-all border border-slate-100 flex flex-col items-center group">
                      <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-2xl flex items-center justify-center text-2xl font-black mb-3 group-hover:bg-indigo-600 group-hover:text-white transition-all">{emp.name.charAt(0)}</div>
                      <span className="font-bold text-slate-700 truncate w-full text-center text-sm">{emp.name.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="max-w-3xl mx-auto w-full space-y-6">
                  <button onClick={() => setSelectedClockEmployeeId(null)} className="flex items-center gap-2 text-slate-400 font-black uppercase text-[10px] hover:text-indigo-600"><ChevronLeft size={14}/> Voltar para lista</button>
                  {data.employees.filter(e => e.id === selectedClockEmployeeId).map(emp => {
                    const balance = getCumulativeBalance(emp.id);
                    const record = data.records.find(r => r.employeeId === emp.id && r.date === getLocalDateString(currentTime));
                    const action = getNextAction(record);
                    return (
                      <div key={emp.id} className="space-y-6">
                        <div className="bg-white p-8 md:p-12 rounded-[3rem] shadow-xl border border-slate-100 flex flex-col items-center text-center">
                          <h2 className="text-3xl font-black font-serif italic mb-1">{emp.name}</h2>
                          <p className="text-slate-400 font-bold uppercase text-[10px] mb-10 tracking-widest">{emp.role}</p>
                          <button disabled={action.stage === 'done'} onClick={() => handleClockAction(emp.id)} className={`w-full max-w-md py-10 rounded-[2.5rem] font-black text-2xl shadow-xl transition-all flex items-center justify-center gap-4 ${action.color} text-white active:scale-95 mb-10`}>
                            {action.icon} {action.label}
                          </button>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full max-w-2xl">
                             {[
                               { l: 'Entrada', v: record?.clockIn, i: <LogIn size={14}/> },
                               { l: 'I. Almoço', v: record?.lunchStart, i: <Utensils size={14}/> },
                               { l: 'R. Almoço', v: record?.lunchEnd, i: <Utensils size={14}/> },
                               { l: 'I. Lanche', v: record?.snackStart, i: <Coffee size={14}/> },
                               { l: 'R. Lanche', v: record?.snackEnd, i: <Coffee size={14}/> },
                               { l: 'Saída', v: record?.clockOut, i: <LogOut size={14}/> },
                             ].map((t, idx) => (
                               <div key={idx} className={`p-4 rounded-2xl border transition-all ${t.v ? 'bg-indigo-50 border-indigo-100' : 'bg-slate-50 border-slate-100 opacity-40'}`}>
                                  <div className="flex items-center justify-center gap-2 mb-1">
                                    <span className="text-indigo-400">{t.i}</span>
                                    <p className="text-[8px] font-black text-slate-400 uppercase">{t.l}</p>
                                  </div>
                                  <p className="font-mono font-black text-lg text-slate-800">{formatTime(t.v)}</p>
                               </div>
                             ))}
                          </div>
                        </div>
                        <div className="bg-[#1e293b] text-white p-8 rounded-[2.5rem] flex flex-col items-center justify-center shadow-xl text-center relative overflow-hidden">
                          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 relative z-10">Saldo Acumulado</p>
                          <p className={`text-5xl font-mono font-black relative z-10 ${balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMinutes(balance)}</p>
                          <div className="absolute top-0 right-0 p-4 opacity-5"><ClockIcon size={120}/></div>
                        </div>

                        {/* Employee History Table */}
                        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                          <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-sm font-black uppercase text-slate-400 tracking-widest">Meu Histórico Recente</h3>
                            <History size={16} className="text-slate-300"/>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-[10px] font-bold">
                              <thead className="bg-slate-50 text-[8px] font-black uppercase text-slate-400 border-b border-slate-100">
                                <tr>
                                  <th className="px-6 py-3">Data</th>
                                  <th className="px-6 py-3">Entrada/Saída</th>
                                  <th className="px-6 py-3 text-center">Almoço</th>
                                  <th className="px-6 py-3 text-center">Lanche</th>
                                  <th className="px-6 py-3 text-center">Saldo</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {(() => {
                                  const timelineItems: any[] = [];
                                  
                                  // Add clock records
                                  data.records.filter(r => r.employeeId === emp.id).forEach(r => {
                                    timelineItems.push({ type: 'RECORD', date: r.date, data: r });
                                  });

                                  // Add absences and justifications
                                  data.timeBank
                                    .filter(t => t.employeeId === emp.id && ['MEDICAL', 'VACATION', 'HOLIDAY', 'OFF_DAY'].includes(t.type))
                                    .forEach(t => {
                                      timelineItems.push({ type: 'ABSENCE', date: t.date, data: t });
                                    });

                                  // Sort by date descending
                                  timelineItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || (a.type === 'RECORD' ? -1 : 1));

                                  const itemsToShow = timelineItems.slice(0, 15);

                                  if (itemsToShow.length === 0) {
                                    return (
                                      <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-slate-300 italic">Nenhum registro encontrado</td>
                                      </tr>
                                    );
                                  }

                                  return itemsToShow.map((item, index) => {
                                    if (item.type === 'RECORD') {
                                      const r = item.data;
                                      const tbe = data.timeBank.find(t => t.employeeId === r.employeeId && t.date === r.date && t.type === 'WORK');
                                      return (
                                        <tr key={`rec-${r.id}-${index}`}>
                                          <td className="px-6 py-3 font-mono text-slate-500">{safeFormatDate(r.date)}</td>
                                          <td className="px-6 py-3 text-slate-700 whitespace-nowrap">
                                            {formatTime(r.clockIn)} - {formatTime(r.clockOut)}
                                          </td>
                                          <td className="px-6 py-3 text-center text-slate-400 font-mono">
                                            {r.lunchStart ? `${formatTime(r.lunchStart)}-${formatTime(r.lunchEnd)}` : '---'}
                                          </td>
                                          <td className="px-6 py-3 text-center text-slate-400 font-mono">
                                            {r.snackStart ? `${formatTime(r.snackStart)}-${formatTime(r.snackEnd)}` : '---'}
                                          </td>
                                          <td className={`px-6 py-3 text-center font-mono ${tbe && tbe.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {tbe ? formatMinutes(tbe.minutes) : '--:--'}
                                          </td>
                                        </tr>
                                      );
                                    } else {
                                      const t = item.data;
                                      return (
                                        <tr key={`abs-${t.id}-${index}`} className="bg-indigo-50/40">
                                          <td className="px-6 py-3 font-mono text-slate-500">{safeFormatDate(t.date)}</td>
                                          <td colSpan={3} className="px-6 py-3 text-center text-indigo-600 font-black uppercase text-[9px] tracking-widest">
                                            {ENTRY_TYPE_LABELS[t.type as keyof typeof ENTRY_TYPE_LABELS]} {t.note && t.note !== 'Abono/Justificativa' && t.note !== 'Abono' ? `• ${t.note}` : ''}
                                          </td>
                                          <td className="px-6 py-3 text-center font-mono text-slate-400">
                                            Abonado
                                          </td>
                                        </tr>
                                      );
                                    }
                                  });
                                })()}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Employee Adjustments and Justifications Table */}
                        {data.timeBank.filter(t => t.employeeId === emp.id && t.type !== 'WORK').length > 0 && (
                          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden mt-6">
                            <div className="bg-indigo-50/50 px-6 py-4 border-b border-indigo-100 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-black uppercase text-indigo-800 tracking-widest">Ajustes e Abonos</h3>
                                <span className="bg-indigo-600 text-white text-[8px] px-2 py-0.5 rounded-full uppercase tracking-widest">Ciência do Colaborador</span>
                              </div>
                              <Info size={16} className="text-indigo-400"/>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-[10px] font-bold">
                                <thead className="bg-slate-50 text-[8px] font-black uppercase text-slate-400 border-b border-slate-100">
                                  <tr>
                                    <th className="px-6 py-3">Data</th>
                                    <th className="px-6 py-3">Tipo / Descrição</th>
                                    <th className="px-6 py-3">Anotação Gerencial</th>
                                    <th className="px-6 py-3 text-center">Impacto (Horas)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {data.timeBank
                                    .filter(t => t.employeeId === emp.id && t.type !== 'WORK')
                                    .slice(0, 15)
                                    .map(t => (
                                      <tr key={t.id}>
                                        <td className="px-6 py-3 font-mono text-slate-500">{safeFormatDate(t.date)}</td>
                                        <td className="px-6 py-3 text-indigo-700">{ENTRY_TYPE_LABELS[t.type as keyof typeof ENTRY_TYPE_LABELS] || t.type}</td>
                                        <td className="px-6 py-3 text-slate-500 italic truncate max-w-[150px]">{t.note || '---'}</td>
                                        <td className={`px-6 py-3 text-center font-mono ${t.minutes > 0 ? 'text-emerald-500' : t.minutes < 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                                          {t.minutes !== 0 ? formatMinutes(t.minutes) : 'Abonado/Neutro'}
                                        </td>
                                      </tr>
                                    ))
                                  }
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {isManagerAuthenticated && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
              
              {activeTab === 'dashboard' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipe Total</p>
                      <p className="text-3xl font-black mt-1 text-slate-800">{data.employees.length}</p>
                    </div>
                    {(() => {
                      const cltEmps = data.employees.filter(e => !e.isHourly);
                      const horistas = data.employees.filter(e => e.isHourly);
                      
                      const cltBalances = cltEmps.map(e => getCumulativeBalance(e.id));
                      const posBalance = cltBalances.filter(b => b > 0).reduce((acc, b) => acc + b, 0);
                      const negBalance = cltBalances.filter(b => b < 0).reduce((acc, b) => acc + b, 0);
                      const horistaTotal = horistas.reduce((acc, e) => acc + getCumulativeBalance(e.id), 0);

                      return (
                        <>
                          <div className="bg-emerald-50 p-6 rounded-3xl shadow-sm border border-emerald-100">
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Saldo Positivo (CLT)</p>
                            <p className="text-2xl font-mono font-black mt-1 text-emerald-700">{formatMinutes(posBalance)}</p>
                          </div>
                          <div className="bg-rose-50 p-6 rounded-3xl shadow-sm border border-rose-100">
                            <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Saldo Negativo (CLT)</p>
                            <p className="text-2xl font-mono font-black mt-1 text-rose-700">{formatMinutes(negBalance)}</p>
                          </div>
                          <div className="bg-amber-50 p-6 rounded-3xl shadow-sm border border-amber-100">
                            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Total Horistas</p>
                            <p className="text-2xl font-mono font-black mt-1 text-amber-700">{formatMinutes(horistaTotal)}</p>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  <div className="bg-indigo-600 p-8 rounded-[2.5rem] shadow-xl text-white relative overflow-hidden">
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
                      <div className="text-center md:text-left">
                        <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1">Saldo Líquido da Loja (Banco de Horas)</p>
                        <h3 className="text-5xl font-mono font-black">
                          {formatMinutes(data.employees.filter(e => !e.isHourly).reduce((acc, e) => acc + getCumulativeBalance(e.id), 0))}
                        </h3>
                        <p className="text-[9px] text-indigo-300 mt-2 font-bold uppercase">* Soma apenas de funcionários CLT. Horistas são contabilizados separadamente.</p>
                      </div>
                      <div className="bg-white/10 p-6 rounded-3xl backdrop-blur-sm border border-white/10 w-full md:w-auto text-center">
                        <p className="text-[10px] font-black text-white/60 uppercase mb-2">Resumo Financeiro</p>
                        <div className="text-sm font-bold flex flex-col gap-1">
                          <span className="flex justify-between gap-8"><span>CLT:</span> <span>{formatMinutes(data.employees.filter(e => !e.isHourly).reduce((acc, e) => acc + getCumulativeBalance(e.id), 0))}</span></span>
                          <span className="flex justify-between gap-8"><span>Horistas:</span> <span>{formatMinutes(data.employees.filter(e => e.isHourly).reduce((acc, e) => acc + getCumulativeBalance(e.id), 0))}</span></span>
                        </div>
                      </div>
                    </div>
                    <div className="absolute -right-10 -bottom-10 opacity-10 rotate-12">
                      <TrendingUp size={240}/>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'employees' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-5 bg-white p-8 rounded-[2.5rem] shadow-lg border border-slate-100">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        {editingEmployeeId ? <Edit2 size={20}/> : <UserPlus size={20}/>}
                      </div>
                      <h2 className="text-xl font-black font-serif italic">
                        {editingEmployeeId ? 'Editar Colaborador' : 'Novo Cadastro'}
                      </h2>
                    </div>
                    
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      if(!supabase) return;
                      setIsSaving(true);
                      
                      const payload = {
                        name: newEmp.name, 
                        role: newEmp.role, 
                        baseDailyMinutes: newEmp.isHourly ? 0 : parseInt(newEmp.dailyHours)*60,
                        englishWeekDay: parseInt(newEmp.englishDay), 
                        englishWeekMinutes: newEmp.isHourly ? 0 : parseInt(newEmp.shortDayHours)*60,
                        initialBalanceMinutes: parseTimeStringToMinutes(newEmp.initialBalanceStr), 
                        startDate: newEmp.startDate,
                        isHourly: newEmp.isHourly
                      };

                      try {
                        const { error } = editingEmployeeId 
                          ? await supabase.from('employees').update(payload).eq('id', editingEmployeeId)
                          : await supabase.from('employees').insert([payload]);

                        if (error) throw error;

                        alert("Dados salvos com sucesso!");
                        setEditingEmployeeId(null); 
                        setNewEmp({ name:'', role:'', dailyHours:'8', englishDay:'6', shortDayHours:'4', initialBalanceStr:'00:00', isHourly:false, startDate: DEFAULT_START_DATE }); 
                        await fetchData();
                      } catch (err: any) {
                        alert("ERRO: " + err.message);
                      } finally {
                        setIsSaving(false);
                      }
                    }} className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Nome Completo</label>
                        <input required value={newEmp.name} onChange={e => setNewEmp({...newEmp, name:e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-bold text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all" placeholder="Nome do funcionário"/>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Cargo</label>
                          <input required value={newEmp.role} onChange={e => setNewEmp({...newEmp, role:e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-bold text-sm" placeholder="Ex: Vendedor"/>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Regime</label>
                          <select value={newEmp.isHourly ? 'H' : 'C'} onChange={e => setNewEmp({...newEmp, isHourly: e.target.value === 'H'})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-sm">
                            <option value="C">CLT / Estagiário</option>
                            <option value="H">Horista (Sem Meta)</option>
                          </select>
                        </div>
                      </div>

                      {!newEmp.isHourly && (
                        <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 space-y-4">
                          <div className="flex items-center gap-2 mb-1">
                            <Briefcase size={12} className="text-indigo-600"/>
                            <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Jornada de Trabalho</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Meta Diária (h)</label>
                              <input type="number" step="0.5" value={newEmp.dailyHours} onChange={e => setNewEmp({...newEmp, dailyHours:e.target.value})} className="w-full p-4 rounded-xl bg-white border border-slate-100 font-black text-sm" placeholder="Ex: 8 ou 6"/>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Folga/Dia Curto</label>
                              <select value={newEmp.englishDay} onChange={e => setNewEmp({...newEmp, englishDay:parseInt(e.target.value) as any})} className="w-full p-4 rounded-xl bg-white border border-slate-100 font-black text-sm">
                                {WEEK_DAYS_BR.map((d,i) => <option key={i} value={i}>{d}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between items-center px-2">
                              <label className="text-[9px] font-black text-slate-400 uppercase">Horas no Dia Curto</label>
                              {parseInt(newEmp.shortDayHours) === 0 && (
                                <span className="text-[8px] font-black text-amber-600 uppercase">Semana de 5 dias (Sábado Off)</span>
                              )}
                            </div>
                            <input type="number" step="0.5" value={newEmp.shortDayHours} onChange={e => setNewEmp({...newEmp, shortDayHours:e.target.value})} className="w-full p-4 rounded-xl bg-white border border-slate-100 font-black text-sm" placeholder="0 para folga total"/>
                          </div>
                          <p className="text-[8px] text-slate-400 italic">Dica: Para estagiários que trabalham 5 dias por semana, defina a Folga como Sábado e Carga Horária como 0.</p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Data de Início</label>
                          <input type="date" required value={newEmp.startDate} onChange={e => setNewEmp({...newEmp, startDate:e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-sm"/>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Saldo Atual (HH:mm)</label>
                          <input type="text" value={newEmp.initialBalanceStr} onChange={e => setNewEmp({...newEmp, initialBalanceStr:e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-sm" placeholder="00:00"/>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button type="submit" disabled={isSaving} className="flex-1 py-4 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] shadow-lg flex items-center justify-center gap-2 hover:bg-indigo-700 active:scale-[0.98] transition-all">
                          {isSaving ? <RefreshCw className="animate-spin" size={14}/> : <CheckCircle2 size={14}/>} 
                          {editingEmployeeId ? 'Salvar Alterações' : 'Cadastrar Colaborador'}
                        </button>
                        {editingEmployeeId && (
                          <button type="button" onClick={() => {
                            setEditingEmployeeId(null);
                            setNewEmp({ name:'', role:'', dailyHours:'8', englishDay:'6', shortDayHours:'4', initialBalanceStr:'00:00', isHourly:false, startDate: DEFAULT_START_DATE });
                          }} className="px-6 py-4 bg-slate-200 text-slate-600 rounded-xl font-black uppercase text-[10px] hover:bg-slate-300 transition-all">Cancelar</button>
                        )}
                      </div>
                    </form>
                  </div>

                  <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4 h-fit">
                    {data.employees.map(emp => (
                      <div key={emp.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between group hover:border-indigo-200 hover:shadow-md transition-all">
                         <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-black group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-all">
                              {emp.role.toLowerCase().includes('estagi') ? <GraduationCap size={24}/> : emp.name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-black text-slate-800 text-sm leading-tight">{emp.name}</p>
                              <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{emp.role}</p>
                              <div className="flex flex-wrap gap-x-2 mt-1">
                                <span className="text-[8px] font-black text-indigo-500 uppercase">
                                  {emp.isHourly ? 'Horista' : `${emp.baseDailyMinutes/60}h • ${emp.englishWeekMinutes === 0 ? '5 dias' : '6 dias'}`}
                                </span>
                                <span className="text-[8px] font-black text-slate-300 uppercase">Início: {safeFormatDate(emp.startDate)}</span>
                              </div>
                            </div>
                         </div>
                         <div className="flex gap-2">
                            <button onClick={() => {
                               setEditingEmployeeId(emp.id);
                               setNewEmp({
                                 name: emp.name, role: emp.role, 
                                 dailyHours: (emp.baseDailyMinutes/60).toString(),
                                 englishDay: emp.englishWeekDay.toString() as any, 
                                 shortDayHours: (emp.englishWeekMinutes/60).toString(),
                                 initialBalanceStr: formatMinutes(emp.initialBalanceMinutes).replace('+', '').replace('-', '').replace('h ', ':').replace('m', '').trim(),
                                 startDate: (emp.startDate || '').split('T')[0], 
                                 isHourly: emp.isHourly || false
                               });
                            }} className="p-2 bg-slate-50 text-slate-400 rounded-lg hover:bg-indigo-600 hover:text-white transition-all" title="Editar"><Edit2 size={16}/></button>
                            <button onClick={async () => { 
                              if(confirm(`Remover permanentemente ${emp.name}?`)) { 
                                await supabase!.from('employees').delete().eq('id', emp.id); fetchData();
                              } 
                            }} className="p-2 bg-slate-50 text-rose-300 rounded-lg hover:bg-rose-600 hover:text-white transition-all" title="Excluir"><Trash2 size={16}/></button>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'justifications' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-4 bg-white p-8 rounded-[2.5rem] shadow-lg border border-slate-100 h-fit">
                    <h2 className="text-xl font-black font-serif italic mb-6">Abonar ou Justificar</h2>
                    <form onSubmit={handleSaveJustification} className="space-y-4">
                      <select required value={justificationForm.employeeId} onChange={e => setJustificationForm({...justificationForm, employeeId: e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-sm">
                        <option value="">Selecione Colaborador...</option>
                        {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                      <div className="flex items-center gap-2 mb-2 p-1">
                        <input type="checkbox" id="isRange" checked={justificationForm.isRange} onChange={e => setJustificationForm({...justificationForm, isRange: e.target.checked})} className="w-4 h-4 text-indigo-600 rounded" />
                        <label htmlFor="isRange" className="text-[10px] font-black text-slate-600 uppercase cursor-pointer">Lançar Período (Intervalo)</label>
                      </div>

                      <div className={`grid ${justificationForm.isRange ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                        <div className="space-y-1">
                          {justificationForm.isRange && <label className="text-[8px] font-black text-slate-400 uppercase ml-2">Data Início</label>}
                          <input type="date" value={justificationForm.date} onChange={e => setJustificationForm({...justificationForm, date: e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-xs"/>
                        </div>
                        {justificationForm.isRange && (
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase ml-2">Data Fim</label>
                            <input type="date" value={justificationForm.endDate} onChange={e => setJustificationForm({...justificationForm, endDate: e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-xs"/>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'MEDICAL', label: 'Atestado', icon: <HeartPulse size={14}/> },
                          { id: 'VACATION', label: 'Férias', icon: <Palmtree size={14}/> },
                          { id: 'HOLIDAY', label: 'Feriado', icon: <Calendar size={14}/> },
                          { id: 'OFF_DAY', label: 'Folga', icon: <UserCheck size={14}/> },
                        ].map(type => (
                          <button key={type.id} type="button" onClick={() => setJustificationForm({...justificationForm, type: type.id as EntryType})} className={`p-4 rounded-xl border-2 flex flex-col items-center gap-1 font-black text-[9px] uppercase transition-all ${justificationForm.type === type.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 border-transparent text-slate-400'}`}>
                            {type.icon} {type.label}
                          </button>
                        ))}
                      </div>
                      <input required type="text" placeholder="Justificativa (obrigatório, ex: CID, Erro Ponto)" value={justificationForm.note} onChange={e => setJustificationForm({...justificationForm, note: e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                      <button type="submit" disabled={isSaving} className="w-full py-5 bg-[#0f172a] text-white rounded-2xl font-black uppercase text-xs shadow-xl flex items-center justify-center gap-3">
                         {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <Plus size={16}/>} Lançar Abono
                      </button>
                    </form>
                  </div>
                  <div className="lg:col-span-8 bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden h-fit">
                    <div className="bg-slate-50/50 px-8 py-5 border-b border-slate-100 flex justify-between items-center"><span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Histórico de Abonos</span> <ShieldCheck className="text-indigo-400" size={16}/></div>
                    <div className="overflow-x-auto">
                       <table className="w-full text-left text-xs font-bold">
                          <thead className="bg-slate-50 text-[9px] font-black uppercase text-slate-400">
                             <tr><th className="px-8 py-4">Pessoa</th><th className="px-8 py-4">Tipo</th><th className="px-8 py-4">Data</th><th className="px-8 py-4 text-center">Ações</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                             {data.timeBank.filter(t => ['MEDICAL', 'VACATION', 'HOLIDAY', 'OFF_DAY'].includes(t.type)).map(t => {
                               const emp = data.employees.find(e => e.id === t.employeeId);
                               return (
                                 <tr key={t.id} className="text-slate-700">
                                   <td className="px-8 py-4">{emp?.name}</td>
                                   <td className="px-8 py-4">{ENTRY_TYPE_LABELS[t.type as keyof typeof ENTRY_TYPE_LABELS]}</td>
                                   <td className="px-8 py-4 font-mono">{safeFormatDate(t.date)}</td>
                                   <td className="px-8 py-4 text-center">
                                      <button onClick={() => handleDeleteEntry(t.id, "Remover?")} className="text-rose-400 hover:text-rose-600 p-2"><Trash2 size={16}/></button>
                                   </td>
                                 </tr>
                               )
                             })}
                          </tbody>
                       </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'admin' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <div className="lg:col-span-5">
                    <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-xl border border-slate-200">
                      <h2 className="text-2xl font-black font-serif italic mb-6 text-center text-slate-800">Ajuste de Saldo</h2>
                      <form onSubmit={handleSaveAdjustment} className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Colaborador</label>
                          <select required value={adjustmentForm.employeeId} onChange={e => setAdjustmentForm({...adjustmentForm, employeeId: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="">Selecione...</option>
                            {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </div>
                        
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Data</label>
                          <input type="date" value={adjustmentForm.date} onChange={e => setAdjustmentForm({...adjustmentForm, date: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"/>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Valor do Ajuste (HH:mm)</label>
                          <div className="flex items-stretch gap-2">
                            <button type="button" onClick={() => setAdjustmentForm({...adjustmentForm, isPositive: !adjustmentForm.isPositive})} className={`w-14 rounded-xl font-black text-2xl transition-all flex items-center justify-center shadow-sm ${adjustmentForm.isPositive ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                              {adjustmentForm.isPositive ? <Plus size={24}/> : <Minus size={24}/>}
                            </button>
                            <input 
                              type="text" 
                              value={adjustmentForm.amountStr} 
                              onChange={e => setAdjustmentForm({...adjustmentForm, amountStr: e.target.value})} 
                              className="flex-1 p-3 rounded-xl bg-slate-50 border-2 border-indigo-100 text-3xl font-mono font-black text-center text-slate-800 outline-none focus:border-indigo-400" 
                              placeholder="00:00"
                            />
                          </div>
                        </div>

                        <div className="space-y-1 mt-4">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Observação / Justificativa</label>
                          <input required type="text" placeholder="Ex: Esquecimento, Acerto Bônus..." value={adjustmentForm.note} onChange={e => setAdjustmentForm({...adjustmentForm, note: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"/>
                        </div>

                        <div className="pt-2">
                          <button type="submit" disabled={isSaving} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-black uppercase text-xs shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                            {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>} APLICAR AJUSTE
                          </button>
                        </div>
                        <p className="text-[9px] text-center text-slate-400 font-bold uppercase tracking-wider">Lançar crédito (+) ou débito (-)</p>
                      </form>
                    </div>
                  </div>

                  <div className="lg:col-span-7 bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 h-fit">
                    <div className="flex justify-between items-center mb-6 px-1">
                      <h3 className="text-lg font-black font-serif italic">Histórico Recente</h3> 
                      <History className="text-indigo-400" size={18}/>
                    </div>
                    <div className="space-y-2 overflow-y-auto max-h-[400px] pr-1 custom-scrollbar">
                       {data.timeBank.filter(t => ['WORK_RETRO', 'ADJUSTMENT', 'BONUS'].includes(t.type)).map(t => {
                          const emp = data.employees.find(e => e.id === t.employeeId);
                          return (
                            <div key={t.id} className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex justify-between items-center hover:bg-white hover:border-indigo-100 transition-all">
                               <div>
                                  <p className="font-bold text-slate-800 text-[11px]">{emp?.name}</p>
                                  <span className="text-[9px] font-bold text-slate-400 uppercase">{safeFormatDate(t.date)} • {ENTRY_TYPE_LABELS[t.type]}</span>
                               </div>
                               <div className="flex items-center gap-3">
                                  <p className={`font-mono font-black text-sm ${t.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(t.minutes)}</p>
                                  <button onClick={() => handleDeleteEntry(t.id, "Remover?")} className="text-slate-300 hover:text-rose-500 p-1"><Trash2 size={14}/></button>
                               </div>
                            </div>
                          )
                       })}
                       {data.timeBank.filter(t => ['WORK_RETRO', 'ADJUSTMENT', 'BONUS'].includes(t.type)).length === 0 && (
                         <div className="text-center py-10 opacity-30">
                           <p className="text-[10px] font-black uppercase">Vazio</p>
                         </div>
                       )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="space-y-6">
                   <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex flex-wrap gap-4 items-end">
                      <div className="flex-1 min-w-[200px]"><label className="text-[9px] font-black text-slate-400 uppercase ml-2">Filtrar Pessoa</label><select value={reportFilter.employeeId} onChange={e => setReportFilter({...reportFilter, employeeId: e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-xs"><option value="all">Todos</option>{data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
                      <div className="flex gap-2"><input type="date" value={reportFilter.startDate} onChange={e => setReportFilter({...reportFilter, startDate: e.target.value})} className="p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-xs"/><input type="date" value={reportFilter.endDate} onChange={e => setReportFilter({...reportFilter, endDate: e.target.value})} className="p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-xs"/></div>
                      <button onClick={handleExportAccountantReport} className="p-4 bg-indigo-600 text-white rounded-xl shadow-lg font-black uppercase text-[10px] flex items-center gap-2"><Download size={16}/> Exportar CSV</button>
                   </div>
                   <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-bold">
                          <thead className="bg-slate-50 text-[9px] font-black uppercase text-slate-400"><tr><th className="px-6 py-4">Data</th><th className="px-6 py-4">Colaborador</th><th className="px-6 py-4 text-center">Horário E/S</th><th className="px-6 py-4 text-center">Saldo Diário</th><th className="px-6 py-4 text-center">Excluir</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredRecords.map(r => {
                              const emp = data.employees.find(e => e.id === r.employeeId);
                              const tbe = data.timeBank.find(t => t.employeeId === r.employeeId && t.date === r.date && t.type === 'WORK');
                              return (
                                <tr key={r.id} className="text-slate-600 hover:bg-slate-50 transition-colors">
                                  <td className="px-6 py-4 font-mono">{safeFormatDate(r.date)}</td>
                                  <td className="px-6 py-4">{emp?.name || '---'}</td>
                                  <td className="px-6 py-4 text-center font-mono">{formatTime(r.clockIn)} - {formatTime(r.clockOut)}</td>
                                  <td className={`px-6 py-4 text-center font-mono ${tbe && tbe.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{tbe ? formatMinutes(tbe.minutes) : '---'}</td>
                                  <td className="px-6 py-4 text-center"><button onClick={() => handleDeleteFullRecord(r.id, r.employeeId, r.date)} className="p-2 text-rose-300 hover:text-rose-600"><Trash2 size={16}/></button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                   </div>
                </div>
              )}

            </div>
          )}
        </div>
      </main>

      {/* MODAL PIN */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-md">
           <div className="bg-white w-full max-w-[340px] p-10 rounded-[3rem] shadow-2xl relative text-center">
              <button onClick={() => setIsLoginModalOpen(false)} className="absolute top-8 right-8 text-slate-300 hover:text-slate-900"><X size={24}/></button>
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner"><Lock size={32}/></div>
              <h2 className="text-2xl font-black font-serif italic mb-1">Acesso Gerente</h2>
              <div className="flex justify-center gap-4 my-8">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-3 h-3 rounded-full ${pinInput.length > i ? 'bg-indigo-600 scale-125' : 'bg-slate-200'} ${loginError ? 'bg-rose-500' : ''}`}></div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {['1','2','3','4','5','6','7','8','9','C','0','<'].map(v => (
                  <button key={v} onClick={() => v === 'C' ? setPinInput('') : v === '<' ? setPinInput(p => p.slice(0,-1)) : handlePinDigit(v)} className="h-14 rounded-xl font-black text-xl bg-slate-50 hover:bg-indigo-600 hover:text-white transition-all">{v}</button>
                ))}
              </div>
           </div>
        </div>
      )}

    </div>
  );
};

export default App;
