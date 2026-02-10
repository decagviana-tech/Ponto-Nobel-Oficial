
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
  History, SlidersHorizontal, Info, Database, AlertTriangle
} from 'lucide-react';

const SUPABASE_URL = "https://afpcoquiivzrckabcvzo.supabase.co" as string; 
const SUPABASE_KEY = "sb_publishable_-5JWjReTELNk5YKnkX9OZg_EeR6j6Zy" as string; 

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
    type: 'WORK_RETRO' as EntryType,
    isPositive: true
  });

  const [justificationForm, setJustificationForm] = useState({
    employeeId: '',
    date: getLocalDateString(new Date()),
    type: 'MEDICAL' as EntryType,
    note: ''
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
    const today = new Date(currentTime);
    today.setHours(0,0,0,0);
    
    const entriesMap = new Map<string, TimeBankEntry[]>();
    data.timeBank.filter(t => t.employeeId === empId).forEach(t => {
      const list = entriesMap.get(t.date) || [];
      list.push(t);
      entriesMap.set(t.date, list);
    });

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    let maxSafety = 0; 
    while (getLocalDateString(loopDate) <= yesterdayStr && maxSafety < 3000) {
      maxSafety++;
      const dateKey = getLocalDateString(loopDate);
      const dayEntries = entriesMap.get(dateKey) || [];
      const metaDoDia = getExpectedMinutesForDate(emp, loopDate);
      
      if (dayEntries.length > 0) {
        dayEntries.forEach(ent => {
          if (['WORK', 'WORK_RETRO', 'ADJUSTMENT', 'BONUS', 'MEDICAL', 'HOLIDAY', 'VACATION', 'OFF_DAY'].includes(ent.type)) {
            totalBalance += ent.minutes;
          }
        });
      } else {
        if (!emp.isHourly && metaDoDia > 0) {
          totalBalance -= metaDoDia;
        }
      }
      loopDate.setDate(loopDate.getDate() + 1);
    }

    const todayStr = getLocalDateString(currentTime);
    const todayRec = data.records.find(r => r.employeeId === empId && r.date === todayStr);
    const todayManualEntries = entriesMap.get(todayStr) || [];

    if (todayManualEntries.length > 0) {
      todayManualEntries.forEach(ent => {
        if (['WORK', 'WORK_RETRO', 'ADJUSTMENT'].includes(ent.type)) totalBalance += ent.minutes;
      });
    } else if (todayRec) {
      const workedSoFar = calculateWorkedMinutes(todayRec, currentTime);
      totalBalance += (workedSoFar - todayRec.expectedMinutes);
    }

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
    if (confirm(`Atenção: Isso apagará permanentemente as batidas do dia ${new Date(date + "T12:00:00").toLocaleDateString('pt-BR')}. Confirmar?`)) {
      setIsSaving(true);
      try {
        // Apagar do banco de horas primeiro
        await supabase.from('timeBank').delete().match({ employeeId, date, type: 'WORK' });
        // Depois apagar o registro físico das batidas
        const { error } = await supabase.from('records').delete().eq('id', recordId);
        
        if (error) throw error;
        
        await fetchData();
        alert("Ponto excluído com sucesso!");
      } catch (err: any) {
        alert("Erro ao excluir registro: " + err.message);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !adjustmentForm.employeeId) return;
    setIsSaving(true);
    try {
      const emp = data.employees.find(e => e.id === adjustmentForm.employeeId);
      if (!emp) return;
      const baseMinutes = parseTimeStringToMinutes(adjustmentForm.amountStr);
      const finalMinutes = adjustmentForm.isPositive ? Math.abs(baseMinutes) : -Math.abs(baseMinutes);
      let impactMinutes = finalMinutes;
      if (adjustmentForm.type === 'WORK_RETRO') {
        const metaDoDia = getExpectedMinutesForDate(emp, new Date(adjustmentForm.date + "T12:00:00"));
        impactMinutes = finalMinutes - metaDoDia;
      }
      const { error } = await supabase.from('timeBank').insert([{
        employeeId: adjustmentForm.employeeId,
        date: adjustmentForm.date,
        minutes: impactMinutes,
        type: adjustmentForm.type,
        note: 'Ajuste manual administrativo'
      }]);
      if (error) throw error;
      setAdjustmentForm({ ...adjustmentForm, amountStr: '00:00', employeeId: '' });
      await fetchData();
      alert("Ajuste aplicado com sucesso!");
    } catch (err: any) { alert("Erro ao salvar ajuste: " + err.message); } finally { setIsSaving(false); }
  };

  const handleSaveJustification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !justificationForm.employeeId) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('timeBank').insert([{
        employeeId: justificationForm.employeeId,
        date: justificationForm.date,
        minutes: 0, 
        type: justificationForm.type,
        note: justificationForm.note
      }]);
      if (error) throw error;
      setJustificationForm({ ...justificationForm, note: '', employeeId: '' });
      await fetchData();
      alert("Abono registrado!");
    } catch (err: any) { alert("Erro ao salvar: " + err.message); } finally { setIsSaving(false); }
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
    const mapped = filteredRecords.map(r => {
      const emp = data.employees.find(e => e.id === r.employeeId);
      const tbe = data.timeBank.find(t => t.employeeId === r.employeeId && t.date === r.date && t.type === 'WORK');
      return {
        'Funcionário': emp?.name || '---',
        'Data': new Date(r.date + "T12:00:00").toLocaleDateString('pt-BR'),
        'Entrada': formatTime(r.clockIn),
        'I.Almoço': formatTime(r.lunchStart),
        'R.Almoço': formatTime(r.lunchEnd),
        'Saldo do Dia': tbe ? formatMinutes(tbe.minutes) : '---',
        'Tipo': ENTRY_TYPE_LABELS[r.type] || 'Trabalho'
      };
    });
    exportToCSV(mapped, 'Folha_Ponto_Nobel');
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipe Ativa</p>
                      <p className="text-4xl font-black mt-1 text-slate-800">{data.employees.length}</p>
                    </div>
                    <div className="bg-indigo-600 p-8 rounded-3xl shadow-xl text-white">
                      <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest">Saldo Geral da Loja</p>
                      <p className="text-3xl font-mono font-black mt-1">{formatMinutes(data.employees.reduce((acc, e) => acc + getCumulativeBalance(e.id), 0))}</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'employees' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-4 bg-white p-8 rounded-[2.5rem] shadow-lg border border-slate-100">
                    <h2 className="text-xl font-black font-serif italic mb-6">Perfil do Colaborador</h2>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      if(!supabase) return;
                      setIsSaving(true);
                      
                      // USANDO APENAS camelCase - CONFIRMADO PELO ERRO DO BANCO
                      const payload = {
                        name: newEmp.name, 
                        role: newEmp.role, 
                        baseDailyMinutes: parseInt(newEmp.dailyHours)*60,
                        englishWeekDay: parseInt(newEmp.englishDay), 
                        englishWeekMinutes: parseInt(newEmp.shortDayHours)*60,
                        initialBalanceMinutes: parseTimeStringToMinutes(newEmp.initialBalanceStr), 
                        startDate: newEmp.startDate
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
                        alert("ERRO NO BANCO: " + err.message);
                      } finally {
                        setIsSaving(false);
                      }
                    }} className="space-y-4">
                      <input required value={newEmp.name} onChange={e => setNewEmp({...newEmp, name:e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-bold text-sm" placeholder="Nome Completo"/>
                      <input required value={newEmp.role} onChange={e => setNewEmp({...newEmp, role:e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-bold text-sm" placeholder="Cargo"/>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Início do Cálculo</label>
                        <input type="date" required value={newEmp.startDate} onChange={e => setNewEmp({...newEmp, startDate:e.target.value})} className="w-full p-4 rounded-xl bg-indigo-50 border-2 border-indigo-100 font-black text-indigo-700 text-sm"/>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Meta (h)</label>
                          <input type="number" value={newEmp.dailyHours} onChange={e => setNewEmp({...newEmp, dailyHours:e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-sm"/>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Folga fixa</label>
                          <select value={newEmp.englishDay} onChange={e => setNewEmp({...newEmp, englishDay:parseInt(e.target.value) as any})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-sm">
                            {WEEK_DAYS_BR.map((d,i) => <option key={i} value={i}>{d}</option>)}
                          </select>
                        </div>
                      </div>
                      <button type="submit" disabled={isSaving} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] shadow-lg mt-4 flex items-center justify-center gap-2">
                        {isSaving ? <RefreshCw className="animate-spin" size={14}/> : <CheckCircle2 size={14}/>} 
                        {editingEmployeeId ? 'Confirmar Alteração' : 'Cadastrar Colaborador'}
                      </button>
                    </form>
                  </div>
                  <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4 h-fit">
                    {data.employees.map(emp => (
                      <div key={emp.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
                         <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-black">{emp.name.charAt(0)}</div>
                            <div>
                              <p className="font-black text-slate-800 text-sm">{emp.name}</p>
                              <p className="text-[8px] font-bold text-indigo-500 uppercase">Início: {new Date(emp.startDate + "T12:00:00").toLocaleDateString('pt-BR')}</p>
                            </div>
                         </div>
                         <div className="flex gap-2">
                            <button type="button" onClick={() => {
                               setEditingEmployeeId(emp.id);
                               setNewEmp({
                                 name: emp.name, role: emp.role, dailyHours: (emp.baseDailyMinutes/60).toString(),
                                 englishDay: emp.englishWeekDay.toString() as any, 
                                 shortDayHours: (emp.englishWeekMinutes/60).toString(),
                                 initialBalanceStr: formatMinutes(emp.initialBalanceMinutes).replace('+', '').replace('-', '').replace('h ', ':').replace('m', '').trim(),
                                 startDate: emp.startDate.split('T')[0], isHourly: emp.isHourly || false
                               });
                            }} className="p-2 bg-slate-50 text-slate-400 rounded-lg hover:bg-indigo-600 hover:text-white transition-all"><Edit2 size={16}/></button>
                            <button type="button" onClick={async () => { 
                              if(confirm(`Remover permanentemente ${emp.name}?`)) { 
                                await supabase!.from('employees').delete().eq('id', emp.id); fetchData();
                              } 
                            }} className="p-2 bg-slate-50 text-rose-300 rounded-lg hover:bg-rose-600 hover:text-white transition-all"><Trash2 size={16}/></button>
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
                      <input type="date" value={justificationForm.date} onChange={e => setJustificationForm({...justificationForm, date: e.target.value})} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 font-black text-xs"/>
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
                                   <td className="px-8 py-4">{ENTRY_TYPE_LABELS[t.type]}</td>
                                   <td className="px-8 py-4 font-mono">{new Date(t.date + "T12:00:00").toLocaleDateString('pt-BR')}</td>
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
                                  <td className="px-6 py-4 font-mono">{new Date(r.date + "T12:00:00").toLocaleDateString('pt-BR')}</td>
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

              {activeTab === 'admin' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-5">
                    <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100">
                      <h2 className="text-3xl font-black font-serif italic mb-8 text-center">Ajuste de Saldo</h2>
                      <form onSubmit={handleSaveAdjustment} className="space-y-6">
                        <select required value={adjustmentForm.employeeId} onChange={e => setAdjustmentForm({...adjustmentForm, employeeId: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-200 font-black text-slate-800 shadow-inner">
                          <option value="">Colaborador...</option>
                          {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        <input type="date" value={adjustmentForm.date} onChange={e => setAdjustmentForm({...adjustmentForm, date: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-200 font-black text-slate-800 shadow-inner text-sm"/>
                        <input type="text" value={adjustmentForm.amountStr} onChange={e => setAdjustmentForm({...adjustmentForm, amountStr: e.target.value})} className="w-full p-8 rounded-[2rem] bg-slate-50 border-2 border-indigo-100 text-6xl font-mono font-black text-center text-slate-800 shadow-inner" placeholder="00:00"/>
                        <button type="submit" disabled={isSaving} className="w-full py-6 bg-indigo-600 text-white rounded-3xl font-black uppercase text-sm shadow-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3">
                          {isSaving ? <RefreshCw className="animate-spin"/> : <Plus/>} Aplicar Ajuste
                        </button>
                      </form>
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
