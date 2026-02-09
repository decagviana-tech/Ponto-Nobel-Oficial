
import React, { useState, useEffect, useMemo } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenAI } from "@google/genai";
import { AppData, Employee, ClockRecord, TimeBankEntry, EntryType, WeekDay } from './types';
import { WEEK_DAYS_BR } from './constants';
import { 
  formatMinutes, 
  getExpectedMinutesForDate, 
  calculateWorkedMinutes, 
  formatTime,
  parseTimeStringToMinutes,
  exportToCSV,
  ENTRY_TYPE_LABELS
} from './utils';
import { 
  Coffee, Utensils, LogIn, LogOut, ChevronLeft, Lock, 
  UserCheck, X, Clock as ClockIcon, 
  Edit2, Trash2, UserPlus, FileText, Download, 
  TrendingUp, Users, Settings, BookOpen, Sparkles, 
  History, Plus, RefreshCw, Info, ClipboardCheck, Palmtree, Gift, Globe, Stethoscope
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
  const [isConnected, setIsConnected] = useState(false);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [idAwaitingDelete, setIdAwaitingDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const DEFAULT_START_DATE = '2026-02-01';

  const [newEmp, setNewEmp] = useState({ 
    name: '', role: '', dailyHours: '8', englishDay: '6', shortDayHours: '0', initialBalanceStr: '00:00', isHourly: false, startDate: DEFAULT_START_DATE
  });

  const [justificationForm, setJustificationForm] = useState({
    employeeId: '',
    type: 'MEDICAL' as EntryType,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    note: ''
  });
  
  const [retroForm, setRetroForm] = useState({
    employeeId: '',
    date: new Date().toISOString().split('T')[0],
    amountStr: '00:00',
    type: 'WORK_RETRO' as EntryType,
    note: '',
    isPositive: true
  });

  const [isSubmittingJustification, setIsSubmittingJustification] = useState(false);
  const [newPin, setNewPin] = useState('');

  const fetchData = async () => {
    if (!supabase) {
      const saved = localStorage.getItem('nobel_data_v2');
      if (saved) setData(JSON.parse(saved));
      setIsLoading(false);
      return;
    }

    try {
      const [ { data: emps }, { data: recs }, { data: bank }, { data: sett } ] = await Promise.all([
        supabase.from('employees').select('*').order('name'),
        supabase.from('records').select('*').order('date', { ascending: false }),
        supabase.from('timeBank').select('*').order('date', { ascending: false }),
        supabase.from('settings').select('*').eq('id', 1).maybeSingle()
      ]);

      const freshData = {
        employees: (emps || []) as Employee[],
        records: (recs || []) as ClockRecord[],
        timeBank: (bank || []) as TimeBankEntry[],
        settings: (sett || { managerPin: "1234" }) as any
      };
      
      setData(freshData);
      localStorage.setItem('nobel_data_v2', JSON.stringify(freshData));
      setIsConnected(true);
    } catch (err) {
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (supabase) {
      const channel = supabase
        .channel('changes')
        .on('postgres_changes', { event: '*', schema: 'public' }, () => fetchData())
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [supabase]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getCumulativeBalance = (empId: string) => {
    const emp = data.employees.find(e => e.id === empId);
    if (!emp) return 0;
    
    let balance = emp.initialBalanceMinutes || 0;
    const startStr = emp.startDate ? emp.startDate.split('T')[0] : DEFAULT_START_DATE;
    const startDate = new Date(startStr + "T00:00:00");
    
    const yesterday = new Date(currentTime);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59);

    if (!emp.isHourly) {
      let curr = new Date(startDate);
      while (curr <= yesterday) {
        balance -= getExpectedMinutesForDate(emp, curr);
        curr.setDate(curr.getDate() + 1);
      }
    }

    const entries = data.timeBank.filter(t => t.employeeId === empId);
    entries.forEach(ent => {
      const entDate = new Date(ent.date + "T00:00:00");
      if (entDate < startDate) return;

      if (ent.type === 'WORK') {
        balance += (ent.minutes + getExpectedMinutesForDate(emp, entDate));
      } else {
        balance += ent.minutes;
      }
    });

    const todayStr = currentTime.toISOString().split('T')[0];
    const activeRec = data.records.find(r => r.employeeId === empId && r.date === todayStr);
    const hasFinalizedWorkToday = entries.some(t => t.date === todayStr && t.type === 'WORK');
    
    if (activeRec && !hasFinalizedWorkToday) {
      const workedSoFar = calculateWorkedMinutes(activeRec, currentTime);
      balance += (workedSoFar - activeRec.expectedMinutes);
    }

    return balance;
  };

  const handlePinDigit = (digit: string) => {
    if (pinInput.length < 4) {
      const currentPin = data.settings?.managerPin || "1234";
      const nextPin = pinInput + digit;
      setPinInput(nextPin);
      if (nextPin === currentPin) {
        setTimeout(() => {
          setIsManagerAuthenticated(true);
          setIsLoginModalOpen(false);
          setPinInput('');
          setActiveTab('dashboard');
        }, 300);
      } else if (nextPin.length === 4) {
        setLoginError(true);
        setTimeout(() => { setPinInput(''); setLoginError(false); }, 600);
      }
    }
  };

  const handleClockAction = async (employeeId: string) => {
    if (!supabase) return;
    const todayStr = currentTime.toISOString().split('T')[0];
    const record = data.records.find(r => r.employeeId === employeeId && r.date === todayStr);
    const action = getNextAction(record);
    const nowISO = currentTime.toISOString();

    try {
      if (!record) {
        const emp = data.employees.find(e => e.id === employeeId)!;
        await supabase.from('records').insert([{
          employeeId, date: todayStr, clockIn: nowISO, type: 'WORK',
          expectedMinutes: getExpectedMinutesForDate(emp, currentTime)
        }]);
      } else {
        const update: any = {};
        if (action.stage === 'l_start') update.lunchStart = nowISO;
        else if (action.stage === 'l_end') update.lunchEnd = nowISO;
        else if (action.stage === 's_start') update.snackStart = nowISO;
        else if (action.stage === 's_end') update.snackEnd = nowISO;
        else if (action.stage === 'out') update.clockOut = nowISO;
        
        await supabase.from('records').update(update).eq('id', record.id);

        if (action.stage === 'out') {
          const worked = calculateWorkedMinutes({ ...record, ...update });
          await supabase.from('timeBank').insert([{
            employeeId, date: todayStr, minutes: worked - record.expectedMinutes, type: 'WORK'
          }]);
          setSelectedClockEmployeeId(null);
        }
      }
      fetchData();
    } catch (e) {
      alert("Erro de conexão.");
    }
  };

  const handleDeleteTimeBankEntry = async (id: string) => {
    if (!supabase || isDeleting) return;
    if (idAwaitingDelete !== id) {
      setIdAwaitingDelete(id);
      setTimeout(() => setIdAwaitingDelete(prev => prev === id ? null : prev), 3500);
      return;
    }
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('timeBank').delete().eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (e) { 
      alert("Erro ao excluir.");
      fetchData();
    } finally {
      setIsDeleting(false);
      setIdAwaitingDelete(null);
    }
  };

  const handleRetroAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !retroForm.employeeId) return;
    try {
      const mins = parseTimeStringToMinutes(retroForm.amountStr);
      let finalMins = retroForm.isPositive ? Math.abs(mins) : -Math.abs(mins);
      
      // Se for trabalho retroativo, o usuário está entrando com o tempo TRABALHADO REAL.
      // Precisamos subtrair a meta do dia para o saldo ficar correto no banco.
      if (retroForm.type === 'WORK_RETRO') {
        const emp = data.employees.find(ev => ev.id === retroForm.employeeId)!;
        const targetDate = new Date(retroForm.date + "T12:00:00");
        const meta = getExpectedMinutesForDate(emp, targetDate);
        finalMins = mins - meta;
      }

      const { error } = await supabase.from('timeBank').insert([{
        employeeId: retroForm.employeeId,
        date: retroForm.date,
        minutes: finalMins,
        type: retroForm.type,
        note: retroForm.note || `Ajuste manual: ${ENTRY_TYPE_LABELS[retroForm.type]}`
      }]);
      if (error) throw error;
      setRetroForm({ ...retroForm, amountStr: '00:00', note: '' });
      fetchData();
      alert("Ajuste aplicado!");
    } catch (err) {
      alert("Erro ao aplicar ajuste.");
    }
  };

  const fillStandardShift = () => {
    const emp = data.employees.find(e => e.id === retroForm.employeeId);
    if (!emp) {
      alert("Selecione um funcionário primeiro.");
      return;
    }
    const selectedDate = new Date(retroForm.date + "T12:00:00");
    const expected = getExpectedMinutesForDate(emp, selectedDate);
    const h = Math.floor(expected / 60);
    const m = expected % 60;
    setRetroForm({ ...retroForm, amountStr: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`, type: 'WORK_RETRO' });
  };

  const handleJustificationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !justificationForm.employeeId) return;
    setIsSubmittingJustification(true);
    try {
      const emp = data.employees.find(e => e.id === justificationForm.employeeId);
      if (!emp) return;
      const start = new Date(justificationForm.startDate + "T00:00:00");
      const end = new Date(justificationForm.endDate + "T00:00:00");
      const newEntries = [];
      let curr = new Date(start);
      while (curr <= end) {
        const expected = getExpectedMinutesForDate(emp, curr);
        if (expected > 0) {
          newEntries.push({
            employeeId: justificationForm.employeeId,
            date: curr.toISOString().split('T')[0],
            minutes: expected,
            type: justificationForm.type,
            note: justificationForm.note || `Abono: ${ENTRY_TYPE_LABELS[justificationForm.type]}`
          });
        }
        curr.setDate(curr.getDate() + 1);
      }
      if (newEntries.length > 0) await supabase.from('timeBank').insert(newEntries);
      setJustificationForm({ ...justificationForm, note: '' });
      fetchData();
      alert("Abono(s) registrado(s)!");
    } catch (err) {
      alert("Erro ao registrar abono.");
    } finally {
      setIsSubmittingJustification(false);
    }
  };

  const getNextAction = (record?: ClockRecord) => {
    if (!record?.clockIn) return { label: 'Entrada', stage: 'in', color: 'bg-indigo-600', icon: <LogIn size={20}/> };
    if (!record.lunchStart) return { label: 'Almoço', stage: 'l_start', color: 'bg-amber-600', icon: <Utensils size={20}/> };
    if (!record.lunchEnd) return { label: 'Retorno Almoço', stage: 'l_end', color: 'bg-emerald-600', icon: <Utensils size={20}/> };
    if (!record.snackStart) return { label: 'Lanche', stage: 's_start', color: 'bg-orange-500', icon: <Coffee size={20}/> };
    if (!record.snackEnd) return { label: 'Retorno Lanche', stage: 's_end', color: 'bg-emerald-600', icon: <Coffee size={20}/> };
    if (!record.clockOut) return { label: 'Encerrar Dia', stage: 'out', color: 'bg-rose-600', icon: <LogOut size={20}/> };
    return { label: 'Finalizado', stage: 'done', color: 'bg-slate-800', icon: <UserCheck size={20}/> };
  };

  const handleEditEmployee = (emp: Employee) => {
    setEditingEmployeeId(emp.id);
    const absMins = Math.abs(emp.initialBalanceMinutes || 0);
    const h = Math.floor(absMins / 60);
    const m = absMins % 60;
    const sign = (emp.initialBalanceMinutes || 0) < 0 ? '-' : '';
    setNewEmp({
      name: emp.name,
      role: emp.role,
      dailyHours: ((emp.baseDailyMinutes || 480) / 60).toString(),
      englishDay: (emp.englishWeekDay ?? 6).toString(),
      shortDayHours: ((emp.englishWeekMinutes || 0) / 60).toString(),
      initialBalanceStr: `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
      isHourly: emp.isHourly || false,
      startDate: emp.startDate ? emp.startDate.split('T')[0] : DEFAULT_START_DATE
    });
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col md:flex-row font-sans text-slate-200">
      
      <aside className="w-full md:w-64 bg-[#1e293b] flex flex-col shadow-2xl border-r border-white/5 md:fixed md:inset-y-0 z-50">
        <div className="p-8 flex flex-col items-center gap-4 border-b border-white/5">
          <div className="bg-indigo-600 p-3 rounded-2xl text-white shadow-xl rotate-3"><BookOpen size={28}/></div>
          <div className="text-center">
            <span className="text-white font-black text-xl tracking-tighter block font-serif">Nobel Ponto</span>
            <span className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.3em] block mt-1">Petrópolis</span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-8 space-y-2 overflow-y-auto">
          <button onClick={() => { setActiveTab('clock'); setSelectedClockEmployeeId(null); setIsManagerAuthenticated(false); }} className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all font-bold text-sm ${activeTab === 'clock' && !isManagerAuthenticated ? 'bg-white text-slate-900 shadow-xl scale-105' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <ClockIcon size={20} /> <span>Registrar Ponto</span>
          </button>
          
          <div className="pt-10 pb-4">
             <p className="px-6 text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Gerente</p>
             {[
               { id: 'dashboard', label: 'Painel', icon: <TrendingUp size={20}/> },
               { id: 'employees', label: 'Equipe', icon: <Users size={20}/> },
               { id: 'justifications', label: 'Justificativas', icon: <ClipboardCheck size={20}/> },
               { id: 'reports', label: 'Relatórios', icon: <FileText size={20}/> },
               { id: 'admin', label: 'Ajustes', icon: <Settings size={20}/> },
             ].map(item => (
               <button key={item.id} onClick={() => isManagerAuthenticated ? setActiveTab(item.id) : setIsLoginModalOpen(true)} className={`w-full flex items-center gap-4 px-6 py-3.5 rounded-2xl transition-all font-bold text-sm mb-1 ${activeTab === item.id && isManagerAuthenticated ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
                 {item.icon} <span>{item.label}</span>
               </button>
             ))}
          </div>
        </nav>

        <div className="p-6 border-t border-white/5">
           <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest ${isConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_emerald]' : 'bg-rose-500 animate-pulse'}`}></div>
              <span>{isConnected ? 'Em Nuvem' : 'Offline'}</span>
           </div>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-12 md:ml-64 bg-slate-50 text-slate-900 min-h-screen">
        <header className="mb-12 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
          <div className="space-y-1">
            <h1 className="text-4xl font-black tracking-tighter text-slate-900 font-serif italic lowercase first-letter:capitalize">
               {activeTab === 'clock' ? 'olá, bom dia' : activeTab === 'justifications' ? 'justificativas' : activeTab === 'reports' ? 'relatórios' : activeTab === 'dashboard' ? 'painel' : activeTab === 'admin' ? 'ajustes' : activeTab === 'employees' ? 'equipe' : activeTab}
            </h1>
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Livraria Nobel Petrópolis</p>
          </div>
          <div className="bg-white px-8 py-5 rounded-[2.5rem] shadow-xl border border-slate-100 flex flex-col items-end min-w-[200px]">
              <p className="text-3xl font-mono font-black text-slate-800 leading-none">{currentTime.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</p>
              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] mt-2">{currentTime.toLocaleDateString('pt-BR', {weekday: 'short', day:'2-digit', month:'short'}).replace('.','')}</p>
          </div>
        </header>

        <div className="flex flex-col gap-10 pb-32">
          
          {activeTab === 'clock' && (
            <div className="animate-in fade-in zoom-in-95 duration-500">
              {!selectedClockEmployeeId ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {data.employees.map(emp => (
                    <button key={emp.id} onClick={() => setSelectedClockEmployeeId(emp.id)} className="bg-white p-8 rounded-[3.5rem] shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all border border-slate-100 flex flex-col items-center group aspect-square justify-center">
                      <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-[2.5rem] flex items-center justify-center text-4xl font-black group-hover:bg-indigo-600 group-hover:text-white mb-5 transition-all shadow-inner">{emp.name.charAt(0)}</div>
                      <span className="font-black text-slate-800 text-lg truncate w-full px-4 text-center">{emp.name.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="max-w-6xl mx-auto w-full space-y-8">
                  <button onClick={() => setSelectedClockEmployeeId(null)} className="flex items-center gap-2 text-slate-400 font-black uppercase text-[10px] hover:text-indigo-600 transition-all mb-4"><ChevronLeft size={16}/> Voltar</button>
                  {data.employees.filter(e => e.id === selectedClockEmployeeId).map(emp => {
                    const todayStr = currentTime.toISOString().split('T')[0];
                    const rec = data.records.find(r => r.employeeId === emp.id && r.date === todayStr);
                    const action = getNextAction(rec);
                    const balance = getCumulativeBalance(emp.id);
                    return (
                      <div key={emp.id} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        <div className="lg:col-span-8 bg-white p-12 rounded-[4rem] shadow-2xl border border-slate-100">
                          <div className="flex items-center gap-8 mb-12">
                             <div className="w-24 h-24 bg-indigo-600 text-white rounded-[2.5rem] flex items-center justify-center text-5xl font-black shadow-2xl">{emp.name.charAt(0)}</div>
                             <div>
                                <h2 className="text-4xl font-black text-slate-900 font-serif italic">{emp.name}</h2>
                                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mt-1">{emp.role}</p>
                             </div>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 mb-12">
                            {[
                              { label: 'Ent.', time: rec?.clockIn },
                              { label: 'Alm. I', time: rec?.lunchStart },
                              { label: 'Alm. F', time: rec?.lunchEnd },
                              { label: 'Lan. I', time: rec?.snackStart },
                              { label: 'Lan. F', time: rec?.snackEnd },
                              { label: 'Saída', time: rec?.clockOut },
                            ].map((it, i) => (
                              <div key={i} className={`p-6 rounded-[2rem] border-2 text-center transition-all ${it.time ? 'bg-indigo-50/50 border-indigo-100' : 'bg-slate-50/50 border-transparent opacity-40'}`}>
                                <span className="text-[9px] font-black uppercase block text-slate-400 mb-2">{it.label}</span>
                                <p className="text-xl font-mono font-black text-slate-800">{formatTime(it.time || null)}</p>
                              </div>
                            ))}
                          </div>

                          <button disabled={action.stage === 'done'} onClick={() => handleClockAction(emp.id)} className={`w-full py-10 rounded-[3rem] font-black text-3xl shadow-2xl transition-all flex items-center justify-center gap-6 ${action.color} text-white active:scale-95`}>
                            {action.icon} <span className="uppercase tracking-widest">{action.label}</span>
                          </button>
                        </div>

                        <div className="lg:col-span-4 bg-[#1e293b] text-white p-12 rounded-[4rem] flex flex-col justify-center text-center shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
                            <p className="text-[11px] font-black text-indigo-400 uppercase tracking-widest mb-4">Saldo Atual</p>
                            <p className={`text-6xl font-mono font-black ${balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMinutes(balance)}</p>
                            <button onClick={() => setIsHistoryModalOpen(true)} className="mt-12 py-5 border border-white/10 rounded-2xl text-[11px] font-black uppercase text-slate-400 hover:text-white flex items-center justify-center gap-3 transition-all hover:bg-white/5"><History size={20}/> Ver Histórico</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {isManagerAuthenticated && (
            <div className="flex flex-col gap-10 animate-in slide-in-from-bottom-8 duration-500">
              
              {activeTab === 'dashboard' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white p-10 rounded-[3.5rem] border border-slate-100 shadow-sm">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaboradores Ativos</p>
                      <p className="text-5xl font-black text-slate-800 mt-4">{data.employees.length}</p>
                    </div>
                    <div className="bg-indigo-600 p-10 rounded-[3.5rem] shadow-2xl text-white">
                      <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest">Déficit/Superávit Geral</p>
                      <p className="text-4xl font-mono font-black mt-4">{formatMinutes(data.employees.reduce((acc, emp) => acc + getCumulativeBalance(emp.id), 0))}</p>
                    </div>
                    <div className="bg-[#0f172a] p-10 rounded-[3.5rem] text-white flex flex-col justify-between relative overflow-hidden shadow-2xl">
                       <div className="flex items-center gap-3 text-indigo-400 z-10"><Sparkles size={20}/> <span className="text-[10px] font-black uppercase">Insights Nobel</span></div>
                       <p className="text-sm italic text-slate-300 mt-4 z-10">{aiInsights || "Gestão inteligente baseada em dados reais."}</p>
                       <button onClick={() => setAiInsights("IA processando dados da Petrópolis...")} className="mt-6 px-6 py-3 bg-white/5 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase hover:bg-white/10 self-start z-10">Recalcular Análise</button>
                    </div>
                  </div>

                  <div className="bg-white rounded-[3.5rem] shadow-sm border border-slate-100 p-10">
                     <h3 className="text-[11px] font-black uppercase text-slate-400 tracking-widest mb-10">Monitor de Bancos Individuais</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {data.employees.map(emp => {
                          const bal = getCumulativeBalance(emp.id);
                          return (
                            <div key={emp.id} className="p-8 bg-slate-50/50 rounded-[3rem] border border-slate-100 flex flex-col gap-6">
                               <div className="flex justify-between items-start">
                                  <div className="max-w-[150px]">
                                     <p className="font-black text-slate-800 truncate">{emp.name}</p>
                                     <p className="text-[10px] text-slate-400 font-black uppercase mt-1">{emp.role}</p>
                                  </div>
                                  <span className={`text-xl font-mono font-black ${bal >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(bal)}</span>
                               </div>
                               <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                  <div className={`h-full transition-all duration-1000 ${bal >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{width: `${Math.min(100, (Math.abs(bal) / 360) * 100)}%`}}></div>
                               </div>
                            </div>
                          )
                        })}
                     </div>
                  </div>
                </>
              )}

              {activeTab === 'employees' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                   <div className="lg:col-span-4 bg-white p-12 rounded-[4rem] shadow-xl border border-slate-100 flex flex-col">
                      <h2 className="text-2xl font-black font-serif italic mb-10 flex items-center gap-4"><UserPlus size={28}/> {editingEmployeeId ? 'Editar Perfil' : 'Novo Perfil'}</h2>
                      <form onSubmit={async (e) => {
                         e.preventDefault();
                         if (!supabase) return;
                         const payload = { 
                           name: newEmp.name, role: newEmp.role, baseDailyMinutes: parseInt(newEmp.dailyHours) * 60,
                           englishWeekDay: parseInt(newEmp.englishDay), englishWeekMinutes: parseInt(newEmp.shortDayHours) * 60,
                           initialBalanceMinutes: parseTimeStringToMinutes(newEmp.initialBalanceStr), isHourly: newEmp.isHourly,
                           startDate: newEmp.startDate
                         };
                         if (editingEmployeeId) await supabase.from('employees').update(payload).eq('id', editingEmployeeId);
                         else await supabase.from('employees').insert([payload]);
                         setEditingEmployeeId(null); 
                         setNewEmp({ name:'', role:'', dailyHours:'8', englishDay:'6', shortDayHours:'0', initialBalanceStr:'00:00', isHourly:false, startDate: DEFAULT_START_DATE }); 
                         fetchData();
                         alert("Cadastro salvo com sucesso!");
                      }} className="space-y-6">
                         <div className="space-y-2">
                            <label className="text-[11px] font-black uppercase text-slate-400 ml-1">Nome do Funcionário</label>
                            <input required value={newEmp.name} onChange={e => setNewEmp({...newEmp, name: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold" placeholder="Nome Completo..."/>
                         </div>
                         <div className="space-y-2">
                            <label className="text-[11px] font-black uppercase text-slate-400 ml-1">Data Início do Controle</label>
                            <input type="date" value={newEmp.startDate} onChange={e => setNewEmp({...newEmp, startDate: e.target.value})} className="w-full p-5 rounded-2xl bg-indigo-50 border-2 border-indigo-100 font-black text-indigo-700"/>
                         </div>
                         <div className="grid grid-cols-2 gap-5">
                            <div className="space-y-2">
                               <label className="text-[11px] font-black uppercase text-slate-400 ml-1">Meta Horas/Dia</label>
                               <input type="number" value={newEmp.dailyHours} onChange={e => setNewEmp({...newEmp, dailyHours: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center font-black"/>
                            </div>
                            <div className="space-y-2">
                               <label className="text-[11px] font-black uppercase text-slate-400 ml-1">Dia Folga Extra</label>
                               <select value={newEmp.englishDay} onChange={e => setNewEmp({...newEmp, englishDay: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 font-black">
                                  {WEEK_DAYS_BR.map((d, i) => <option key={i} value={i}>{d}</option>)}
                               </select>
                            </div>
                         </div>
                         <div className="space-y-2">
                            <label className="text-[11px] font-black uppercase text-slate-400 ml-1">Meta na Folga Extra (Semana Inglesa)</label>
                            <input type="number" value={newEmp.shortDayHours} onChange={e => setNewEmp({...newEmp, shortDayHours: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center font-black" placeholder="0 para folga total"/>
                         </div>
                         <button type="submit" className="w-full py-6 bg-indigo-600 text-white rounded-[2.5rem] font-black uppercase text-sm shadow-xl hover:bg-indigo-700 transition-all">Salvar Alterações</button>
                      </form>
                   </div>

                   <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6 self-start">
                      {data.employees.map(emp => (
                         <div key={emp.id} className="bg-white p-10 rounded-[3.5rem] border border-slate-100 shadow-sm relative group hover:shadow-xl transition-all border-b-8 hover:border-b-indigo-500">
                            <div className="flex justify-between items-start mb-6">
                               <div className="w-16 h-16 bg-slate-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-2xl shadow-inner">{emp.name.charAt(0)}</div>
                               <button onClick={() => handleEditEmployee(emp)} className="p-3 bg-slate-50 text-slate-400 rounded-xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm opacity-0 group-hover:opacity-100"><Edit2 size={20}/></button>
                            </div>
                            <h3 className="font-black text-slate-800 text-xl truncate">{emp.name}</h3>
                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mt-1">{emp.role}</p>
                            <div className="mt-8 pt-8 border-t border-slate-50 flex justify-between items-center">
                               <span className="text-[10px] font-black uppercase text-slate-400">Banco Atual</span>
                               <span className={`text-2xl font-mono font-black ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</span>
                            </div>
                         </div>
                      ))}
                   </div>
                </div>
              )}

              {activeTab === 'justifications' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                   <div className="lg:col-span-5 bg-white p-12 rounded-[4rem] shadow-xl border border-slate-100">
                      <h2 className="text-2xl font-black font-serif italic mb-10 flex items-center gap-4 text-emerald-600"><Palmtree size={28}/> Novo Abono</h2>
                      <form onSubmit={handleJustificationSubmit} className="space-y-6">
                         <select required value={justificationForm.employeeId} onChange={e => setJustificationForm({...justificationForm, employeeId: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold">
                            <option value="">Para quem?</option>
                            {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                         </select>
                         <div className="grid grid-cols-2 gap-5">
                            <input type="date" value={justificationForm.startDate} onChange={e => setJustificationForm({...justificationForm, startDate: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 font-black"/>
                            <input type="date" value={justificationForm.endDate} onChange={e => setJustificationForm({...justificationForm, endDate: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 font-black"/>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                            {[
                              { id: 'MEDICAL', label: 'Atestado', icon: <Stethoscope size={18}/> },
                              { id: 'VACATION', label: 'Férias', icon: <Palmtree size={18}/> },
                              { id: 'OFF_DAY', label: 'Folga', icon: <Gift size={18}/> },
                              { id: 'HOLIDAY', label: 'Feriado', icon: <Globe size={18}/> }
                            ].map(t => (
                              <button key={t.id} type="button" onClick={() => setJustificationForm({...justificationForm, type: t.id as EntryType})} className={`flex items-center gap-3 p-5 rounded-2xl border-2 font-black text-xs uppercase transition-all ${justificationForm.type === t.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-slate-50 border-transparent text-slate-500 hover:border-slate-200'}`}>
                                {t.icon} <span>{t.label}</span>
                              </button>
                            ))}
                         </div>
                         <button type="submit" disabled={isSubmittingJustification} className="w-full py-6 bg-indigo-600 text-white rounded-[2.5rem] font-black uppercase shadow-xl hover:bg-indigo-700 transition-all">Registrar Abono</button>
                      </form>
                   </div>
                   
                   <div className="lg:col-span-7 bg-white rounded-[4rem] shadow-sm border border-slate-100 overflow-hidden flex flex-col">
                      <div className="bg-slate-50/50 px-10 py-6 border-b border-slate-100">
                         <span className="text-xs font-black uppercase text-slate-400">Histórico de Justificativas</span>
                      </div>
                      <div className="overflow-y-auto">
                        <table className="w-full text-left">
                           <thead className="bg-slate-50">
                              <tr>
                                 <th className="px-10 py-5 font-black uppercase text-[10px] text-slate-400">Pessoa</th>
                                 <th className="px-10 py-5 font-black uppercase text-[10px] text-slate-400">Ação</th>
                                 <th className="px-10 py-5 font-black uppercase text-[10px] text-slate-400 text-right">Crédito</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-50">
                              {data.timeBank.filter(t => t.type !== 'WORK' && t.type !== 'WORK_RETRO').slice(0, 30).map(t => {
                                const emp = data.employees.find(e => e.id === t.employeeId);
                                return (
                                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                                     <td className="px-10 py-6">
                                        <p className="font-black text-slate-800">{emp?.name || '---'}</p>
                                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">{new Date(t.date + "T00:00:00").toLocaleDateString('pt-BR')}</p>
                                     </td>
                                     <td className="px-10 py-6">
                                        <span className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase">{ENTRY_TYPE_LABELS[t.type]}</span>
                                     </td>
                                     <td className={`px-10 py-6 text-right font-mono font-black ${t.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(t.minutes)}</td>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                   <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-slate-100 flex flex-col gap-10">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-5">
                          <div className="p-5 bg-indigo-50 text-indigo-600 rounded-[2rem] shadow-inner"><Plus size={32}/></div>
                          <h2 className="text-3xl font-black font-serif italic">Ajuste Manual</h2>
                        </div>
                        <button onClick={fillStandardShift} type="button" className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-xl text-[10px] font-black uppercase hover:bg-indigo-600 hover:text-white transition-all">Lançar Dia Inteiro</button>
                      </div>
                      <form onSubmit={handleRetroAdjust} className="space-y-6">
                         <select required value={retroForm.employeeId} onChange={e => setRetroForm({...retroForm, employeeId: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 font-black">
                            <option value="">Selecionar Funcionário...</option>
                            {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                         </select>
                         <div className="grid grid-cols-2 gap-5">
                            <input type="date" value={retroForm.date} onChange={e => setRetroForm({...retroForm, date: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 font-black"/>
                            <div className="flex bg-slate-50 rounded-2xl p-2 border border-slate-100">
                               <button type="button" onClick={() => setRetroForm({...retroForm, isPositive: true})} className={`flex-1 py-3 rounded-xl font-black ${retroForm.isPositive ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'}`}>+</button>
                               <button type="button" onClick={() => setRetroForm({...retroForm, isPositive: false})} className={`flex-1 py-3 rounded-xl font-black ${!retroForm.isPositive ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'}`}>-</button>
                            </div>
                         </div>
                         <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                               <button type="button" onClick={() => setRetroForm({...retroForm, type: 'WORK_RETRO'})} className={`p-4 rounded-2xl border-2 font-black text-[10px] uppercase transition-all ${retroForm.type === 'WORK_RETRO' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 border-transparent text-slate-500'}`}>Trabalho Real</button>
                               <button type="button" onClick={() => setRetroForm({...retroForm, type: 'ADJUSTMENT'})} className={`p-4 rounded-2xl border-2 font-black text-[10px] uppercase transition-all ${retroForm.type === 'ADJUSTMENT' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 border-transparent text-slate-500'}`}>Ajuste Delta</button>
                            </div>
                            <div className="flex gap-5">
                               <input type="text" value={retroForm.amountStr} onChange={e => setRetroForm({...retroForm, amountStr: e.target.value})} className="flex-1 p-6 rounded-3xl bg-slate-50 border-2 border-slate-100 font-mono font-black text-3xl text-center" placeholder="00:00"/>
                               <button type="submit" className="px-10 bg-indigo-600 text-white rounded-3xl font-black uppercase hover:bg-indigo-700 transition-all shadow-xl">Salvar</button>
                            </div>
                         </div>
                         <p className="text-[10px] text-slate-400 font-bold uppercase text-center leading-relaxed">
                            {retroForm.type === 'WORK_RETRO' 
                              ? "Modo 'Trabalho Real': Digite as horas totais que a pessoa trabalhou. O sistema subtrairá a meta automaticamente."
                              : "Modo 'Ajuste Delta': Digite apenas o valor a ser adicionado ou removido do saldo total."}
                         </p>
                      </form>
                   </div>
                   
                   <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-slate-100 flex flex-col gap-10 justify-between">
                      <div className="flex items-center gap-5">
                         <div className="p-5 bg-rose-50 text-rose-600 rounded-[2rem] shadow-inner"><Settings size={32}/></div>
                         <h2 className="text-3xl font-black font-serif italic">Segurança</h2>
                      </div>
                      <div className="space-y-6">
                         <div className="space-y-2">
                            <label className="text-xs font-black uppercase text-slate-400 ml-1">Atualizar PIN Gerencial</label>
                            <input maxLength={4} type="password" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g,''))} className="w-full p-6 rounded-3xl bg-slate-50 border border-slate-100 font-mono font-black text-3xl text-center tracking-[1em]" placeholder="****"/>
                         </div>
                         <button onClick={async () => {
                           if (newPin.length !== 4) return;
                           await supabase?.from('settings').update({ managerPin: newPin }).eq('id', 1);
                           setNewPin(''); alert("PIN Atualizado!");
                         }} className="w-full py-6 bg-slate-900 text-white rounded-[2.5rem] font-black uppercase shadow-xl hover:bg-black transition-all">Salvar PIN</button>
                      </div>
                      <div className="pt-6 border-t border-slate-50 text-center">
                         <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="text-[9px] font-black text-rose-400 uppercase tracking-widest hover:text-rose-600">Limpar Cache Local</button>
                         <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.5em] mt-4">Nobel Ponto v5.1 - Petrópolis Office Sync</p>
                      </div>
                   </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="bg-white p-10 rounded-[3.5rem] border border-slate-100 shadow-sm">
                   <div className="flex justify-between items-center mb-10">
                      <h2 className="text-2xl font-black font-serif italic">Relatórios Fiscais</h2>
                      <div className="flex gap-4">
                        <button onClick={() => exportToCSV(data.records, 'folha_nobel')} className="px-6 py-4 bg-indigo-50 text-indigo-700 rounded-2xl font-black uppercase text-[10px] flex items-center gap-2"><Download size={18}/> Folha de Ponto</button>
                        <button onClick={() => exportToCSV(data.timeBank, 'banco_nobel')} className="px-6 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] flex items-center gap-2"><Download size={18}/> Banco de Horas</button>
                      </div>
                   </div>
                   <div className="overflow-x-auto border rounded-[2rem]">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-8 py-5 font-black uppercase text-[10px] text-slate-400">Data</th>
                            <th className="px-8 py-5 font-black uppercase text-[10px] text-slate-400">Pessoa</th>
                            <th className="px-8 py-5 font-black uppercase text-[10px] text-slate-400 text-center">Entrada</th>
                            <th className="px-8 py-5 font-black uppercase text-[10px] text-slate-400 text-center">Intervalo</th>
                            <th className="px-8 py-5 font-black uppercase text-[10px] text-slate-400 text-center">Saída</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {data.records.slice(0, 50).map(r => (
                            <tr key={r.id} className="hover:bg-slate-50/50">
                               <td className="px-8 py-5 font-bold text-slate-400">{new Date(r.date + "T00:00:00").toLocaleDateString('pt-BR')}</td>
                               <td className="px-8 py-5 font-black text-slate-800">{data.employees.find(e => e.id === r.employeeId)?.name || '---'}</td>
                               <td className="px-8 py-5 text-center font-mono font-bold text-indigo-600">{formatTime(r.clockIn)}</td>
                               <td className="px-8 py-5 text-center font-mono text-slate-400 text-xs">{formatTime(r.lunchStart)} - {formatTime(r.lunchEnd)}</td>
                               <td className="px-8 py-5 text-center font-mono font-bold text-rose-600">{formatTime(r.clockOut)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                   </div>
                </div>
              )}

            </div>
          )}
        </div>
      </main>

      {/* LOGIN MODAL */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-2xl animate-in fade-in duration-300">
           <div className="bg-white w-full max-w-[400px] p-12 rounded-[5rem] shadow-2xl relative">
              <button onClick={() => setIsLoginModalOpen(false)} className="absolute top-12 right-12 text-slate-300 hover:text-slate-900 transition-colors"><X size={32}/></button>
              <div className="text-center mb-10">
                <div className="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-[3rem] flex items-center justify-center mx-auto mb-6 shadow-inner"><Lock size={44}/></div>
                <h2 className="text-4xl font-black font-serif italic leading-tight">Painel Gerencial</h2>
                <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mt-2">Acesso Restrito Nobel</p>
              </div>
              <div className="flex justify-center gap-5 mb-12">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-5 h-5 rounded-full transition-all duration-300 ${pinInput.length > i ? 'bg-indigo-600 scale-125 shadow-lg' : 'bg-slate-200'} ${loginError ? 'bg-rose-500 animate-bounce' : ''}`}></div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4">
                {['1','2','3','4','5','6','7','8','9','C','0','<'].map(v => (
                  <button key={v} onClick={() => v === 'C' ? setPinInput('') : v === '<' ? setPinInput(p => p.slice(0,-1)) : handlePinDigit(v)} className="h-20 rounded-[2.5rem] font-black text-2xl bg-slate-50 text-slate-600 hover:bg-indigo-600 hover:text-white transition-all active:scale-90 shadow-sm">{v}</button>
                ))}
              </div>
           </div>
        </div>
      )}

      {/* EXTRATO MODAL */}
      {isHistoryModalOpen && selectedClockEmployeeId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f172a]/95 backdrop-blur-md p-6 animate-in fade-in">
          <div className="bg-white w-full max-w-4xl max-h-[85vh] p-12 rounded-[5rem] shadow-2xl relative flex flex-col">
            <button onClick={() => setIsHistoryModalOpen(false)} className="absolute top-12 right-12 text-slate-300 hover:text-slate-900 transition-colors"><X size={36}/></button>
            <h2 className="text-4xl font-black font-serif italic mb-12 text-slate-900">Histórico de Ponto</h2>
            <div className="flex-1 overflow-y-auto hide-scrollbar border-2 rounded-[3.5rem] border-slate-50">
              <table className="w-full text-left">
                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-10 py-6 font-black uppercase text-[10px] text-slate-400">Data</th>
                    <th className="px-10 py-6 font-black uppercase text-[10px] text-slate-400 text-center">Horário Ponto</th>
                    <th className="px-10 py-6 font-black uppercase text-[10px] text-slate-400 text-right">Resultado Dia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.records.filter(r => r.employeeId === selectedClockEmployeeId).slice(0, 50).map(rec => {
                    const worked = calculateWorkedMinutes(rec);
                    const delta = worked - rec.expectedMinutes;
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50/50">
                        <td className="px-10 py-8 font-black text-slate-800 text-lg">{new Date(rec.date + "T00:00:00").toLocaleDateString('pt-BR', {weekday: 'short', day:'2-digit', month:'short'})}</td>
                        <td className="px-10 py-8 text-center font-mono text-slate-500 text-lg font-bold">{formatTime(rec.clockIn)} - {formatTime(rec.clockOut)}</td>
                        <td className={`px-10 py-8 text-right font-mono font-black text-xl ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(delta)}</td>
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
  );
};

export default App;
