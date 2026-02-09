
import React, { useState, useEffect, useRef } from 'react';
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
  UserCheck, AlertCircle, X, Save, Clock as ClockIcon, 
  Edit2, Trash2, UserPlus, FileText, Download, Cloud, CloudOff, 
  TrendingUp, Users, Settings, BookOpen, ShieldAlert, Sparkles, 
  CheckCircle2, Monitor, Upload, Database, Wifi, WifiOff, Globe,
  CalendarDays, ClipboardCheck, Plane, LifeBuoy, History, Search, Plus,
  Github, Key, Wallet, Briefcase, Stethoscope, Gift, Palmtree, Building2, RefreshCw,
  Info
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
    name: '', role: '', dailyHours: '8', englishDay: '6', shortDayHours: '4', initialBalanceStr: '00:00', isHourly: false, startDate: DEFAULT_START_DATE
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
      console.error("Erro Supabase:", err);
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

  const getCumulativeBalance = (empId: string) => {
    const emp = data.employees.find(e => e.id === empId);
    if (!emp) return 0;
    
    let totalMinutes = emp.initialBalanceMinutes || 0;
    const processedEntries = data.timeBank.filter(t => t.employeeId === empId);
    const todayStr = currentTime.toISOString().split('T')[0];

    if (!emp.isHourly) {
      const startStr = emp.startDate ? emp.startDate.split('T')[0] : DEFAULT_START_DATE;
      const start = new Date(startStr + "T00:00:00");
      const yesterday = new Date(currentTime);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(23, 59, 59);

      let curr = new Date(start);
      while (curr <= yesterday) {
        const dateStr = curr.toISOString().split('T')[0];
        const expected = getExpectedMinutesForDate(emp, curr);
        totalMinutes -= expected;

        const dayEntries = processedEntries.filter(t => t.date === dateStr);
        dayEntries.forEach(ent => {
          if (ent.type === 'WORK') {
            totalMinutes += (ent.minutes + expected); 
          } else {
            totalMinutes += ent.minutes;
          }
        });
        curr.setDate(curr.getDate() + 1);
      }

      const todayNonWorkEntries = processedEntries.filter(t => t.date === todayStr && t.type !== 'WORK');
      totalMinutes += todayNonWorkEntries.reduce((acc, t) => acc + t.minutes, 0);

      const activeRec = data.records.find(r => r.employeeId === empId && r.date === todayStr);
      const hasFinalizedWorkToday = processedEntries.some(t => t.date === todayStr && t.type === 'WORK');
      
      if (activeRec && !hasFinalizedWorkToday) {
        totalMinutes += (calculateWorkedMinutes(activeRec, currentTime) - activeRec.expectedMinutes);
      }
    } else {
      totalMinutes += processedEntries.reduce((acc, t) => acc + t.minutes, 0);
      const activeRec = data.records.find(r => r.employeeId === empId && r.date === todayStr);
      const hasFinalizedWorkToday = processedEntries.some(t => t.date === todayStr && t.type === 'WORK');
      if (activeRec && !hasFinalizedWorkToday) {
        totalMinutes += calculateWorkedMinutes(activeRec, currentTime);
      }
    }
    return totalMinutes;
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
      const finalMins = retroForm.isPositive ? Math.abs(mins) : -Math.abs(mins);
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
      alert("Ajuste aplicado com sucesso!");
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
    setRetroForm({ ...retroForm, amountStr: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}` });
  };

  const analyzeWithAI = async () => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const summary = {
        total: data.employees.length,
        saldos: data.employees.map(e => ({ n: e.name, s: formatMinutes(getCumulativeBalance(e.id)) }))
      };
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analise brevemente o estado da equipe Nobel Petrópolis: ${JSON.stringify(summary)}. Forneça uma dica curta de gestão de banco de horas.`
      });
      setAiInsights(response.text || "Análise concluída.");
    } catch (err) {
      setAiInsights("IA nobre pronta.");
    } finally {
      setIsAnalyzing(false);
    }
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

  const handleUpdatePin = async () => {
    if (!supabase || newPin.length !== 4) return;
    try {
      await supabase.from('settings').update({ managerPin: newPin }).eq('id', 1);
      setNewPin('');
      alert("PIN atualizado!");
    } catch (err) { alert("Falha no PIN."); }
  };

  const handleDeepClean = () => {
    localStorage.removeItem('nobel_data_v2');
    fetchData();
    alert("Cache limpo e dados sincronizados.");
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
    const formattedStartDate = emp.startDate ? emp.startDate.split('T')[0] : DEFAULT_START_DATE;
    
    setNewEmp({
      name: emp.name,
      role: emp.role,
      dailyHours: ((emp.baseDailyMinutes || 480) / 60).toString(),
      englishDay: (emp.englishWeekDay ?? 6).toString(),
      shortDayHours: ((emp.englishWeekMinutes || 240) / 60).toString(),
      initialBalanceStr: `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
      isHourly: emp.isHourly || false,
      startDate: formattedStartDate
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      
      <aside className="w-full md:w-60 bg-[#1e293b] flex flex-col shadow-2xl z-40 border-r border-white/5 md:fixed md:inset-y-0">
        <div className="p-6 flex flex-col items-center gap-2 text-center">
          <div className="bg-indigo-500 p-2.5 rounded-xl text-white rotate-3 shadow-lg"><BookOpen size={24}/></div>
          <div>
            <span className="text-white font-black text-[18px] tracking-tighter block font-serif">Nobel Ponto</span>
            <span className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.2em] block">Petrópolis</span>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1.5 mt-4 overflow-y-auto hide-scrollbar pb-10">
          <button onClick={() => { setActiveTab('clock'); setSelectedClockEmployeeId(null); setIsManagerAuthenticated(false); }} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all font-bold text-[14px] ${activeTab === 'clock' && !isManagerAuthenticated ? 'bg-white text-slate-900 shadow-xl scale-105' : 'text-slate-400 hover:text-white'}`}>
            <ClockIcon size={20} /> <span>Registrar Ponto</span>
          </button>
          
          <div className="pt-8 mt-8 border-t border-white/10 space-y-1.5">
            <p className="px-5 pb-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Gerência</p>
            {[
              { id: 'dashboard', label: 'Estatísticas', icon: <TrendingUp size={19}/> },
              { id: 'employees', label: 'Colaboradores', icon: <Users size={19}/> },
              { id: 'justifications', label: 'Abonos e Ajustes', icon: <ClipboardCheck size={19}/> },
              { id: 'reports', label: 'Relatórios', icon: <FileText size={19}/> },
              { id: 'admin', label: 'Configurações', icon: <Settings size={19}/> },
            ].map(item => (
              <button key={item.id} onClick={() => isManagerAuthenticated ? setActiveTab(item.id) : setIsLoginModalOpen(true)} className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all font-bold text-[14px] ${activeTab === item.id && isManagerAuthenticated ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-white'}`}>
                {item.icon} <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="p-5 border-t border-white/5">
          <div className={`flex items-center gap-3.5 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest ${isConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 animate-pulse'}`}></div>
            <span>{isConnected ? 'Sincronizado' : 'Offline'}</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-8 md:ml-60 bg-slate-50 min-h-screen">
        <header className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tighter text-slate-900 font-serif italic lowercase first-letter:capitalize">
               {activeTab === 'clock' ? 'olá, bem-vindo' : activeTab === 'justifications' ? 'ajustes e abonos' : activeTab === 'reports' ? 'folha de ponto' : activeTab === 'dashboard' ? 'estatísticas loja' : activeTab === 'admin' ? 'configurações' : activeTab === 'employees' ? 'equipe nobel' : activeTab}
            </h1>
            <p className="text-slate-400 font-bold text-[11px] tracking-wider uppercase">Nobel Petrópolis</p>
          </div>
          <div className="bg-white px-7 py-4 rounded-[2.2rem] shadow-sm border border-slate-200 text-right flex flex-col items-end min-w-[180px]">
              <p className="text-3xl font-mono font-black text-slate-800 leading-none">{currentTime.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</p>
              <p className="text-[11px] font-black text-indigo-500 uppercase tracking-[0.2em] mt-1.5">{currentTime.toLocaleDateString('pt-BR', {weekday: 'long', day:'2-digit', month:'long'})}</p>
          </div>
        </header>

        <div className="flex flex-col gap-8 pb-32">
          
          {activeTab === 'clock' && (
            <div className="animate-in fade-in zoom-in-95 duration-500">
              {!selectedClockEmployeeId ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                  {data.employees.map(emp => (
                    <button key={emp.id} onClick={() => setSelectedClockEmployeeId(emp.id)} className="bg-white p-7 rounded-[3rem] shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all border border-slate-100 flex flex-col items-center group aspect-square justify-center">
                      <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-3xl flex items-center justify-center text-3xl font-black group-hover:bg-indigo-600 group-hover:text-white mb-4 transition-all shadow-inner">{emp.name.charAt(0)}</div>
                      <span className="font-black text-slate-800 text-[15px] text-center truncate w-full px-2">{emp.name.split(' ')[0]}</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{emp.role}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="max-w-5xl mx-auto w-full space-y-6">
                  <button onClick={() => setSelectedClockEmployeeId(null)} className="flex items-center gap-2 text-slate-500 font-black uppercase text-[11px] hover:text-indigo-600 transition-all"><ChevronLeft size={18}/> Voltar para lista</button>
                  {data.employees.filter(e => e.id === selectedClockEmployeeId).map(emp => {
                    const todayStr = currentTime.toISOString().split('T')[0];
                    const rec = data.records.find(r => r.employeeId === emp.id && r.date === todayStr);
                    const action = getNextAction(rec);
                    return (
                      <div key={emp.id} className="grid grid-cols-1 md:grid-cols-12 gap-6">
                        <div className="md:col-span-8 bg-white p-10 rounded-[3.5rem] shadow-2xl border border-indigo-50">
                          <div className="flex items-center gap-6 border-b border-slate-100 pb-8 mb-8">
                            <div className="w-20 h-20 bg-indigo-600 text-white rounded-[2rem] flex items-center justify-center text-4xl font-black shadow-xl">{emp.name.charAt(0)}</div>
                            <div>
                              <h2 className="text-3xl font-black text-slate-900 font-serif italic">{emp.name}</h2>
                              <p className="text-indigo-500 text-[12px] font-black uppercase tracking-widest">{emp.role}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-10">
                            {[
                              { label: 'Entrada', time: rec?.clockIn },
                              { label: 'Almoço (I)', time: rec?.lunchStart },
                              { label: 'Almoço (F)', time: rec?.lunchEnd },
                              { label: 'Lanche (I)', time: rec?.snackStart },
                              { label: 'Lanche (F)', time: rec?.snackEnd },
                              { label: 'Saída', time: rec?.clockOut },
                            ].map((it, i) => (
                              <div key={i} className={`p-4 rounded-3xl border-2 text-center transition-all ${it.time ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
                                <span className="text-[11px] font-black uppercase block opacity-60 mb-2">{it.label}</span>
                                <p className="text-xl font-mono font-black">{formatTime(it.time || null)}</p>
                              </div>
                            ))}
                          </div>
                          <button disabled={action.stage === 'done'} onClick={() => handleClockAction(emp.id)} className={`w-full py-8 rounded-[2.5rem] font-black text-2xl shadow-2xl transition-all flex items-center justify-center gap-4 ${action.color} text-white active:scale-95 group`}>
                            {action.icon} <span className="uppercase tracking-widest">{action.label}</span>
                          </button>
                        </div>
                        <div className="md:col-span-4 bg-slate-900 text-white p-10 rounded-[3.5rem] flex flex-col justify-center text-center shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
                            <p className="text-[13px] font-black text-indigo-400 uppercase tracking-widest mb-3">Banco de Horas</p>
                            <p className={`text-5xl font-mono font-black ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</p>
                            <button onClick={() => setIsHistoryModalOpen(true)} className="mt-10 py-4 px-8 border border-white/10 rounded-2xl text-[12px] font-black uppercase text-slate-400 hover:text-white flex items-center justify-center gap-2 transition-all hover:bg-white/5"><History size={20}/> Ver Extrato</button>
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col justify-center">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Pessoas na Equipe</p>
                      <p className="text-4xl font-black text-slate-800 mt-2">{data.employees.length}</p>
                    </div>
                    <div className="bg-indigo-600 p-8 rounded-[3rem] shadow-xl text-white flex flex-col justify-center">
                      <p className="text-[11px] font-black text-indigo-200 uppercase tracking-widest">Saldo Geral Consolidado</p>
                      <p className="text-3xl font-mono font-black mt-2">{formatMinutes(data.employees.reduce((acc, emp) => acc + getCumulativeBalance(emp.id), 0))}</p>
                    </div>
                    <div className="bg-slate-900 p-8 rounded-[3rem] text-white flex flex-col justify-center relative overflow-hidden">
                      <h3 className="text-[11px] font-black uppercase text-indigo-400 mb-2 flex items-center gap-2 z-10"><Sparkles size={16}/> Gestão Nobel IA</h3>
                      <p className="text-[13px] italic text-indigo-100 line-clamp-2 leading-relaxed z-10">{aiInsights || "Sua análise estratégica está pronta."}</p>
                      <button onClick={analyzeWithAI} disabled={isAnalyzing} className="mt-4 px-5 py-2.5 bg-white text-slate-900 rounded-full font-black text-[10px] uppercase self-start hover:scale-105 transition-all shadow-md z-10">{isAnalyzing ? 'Processando...' : 'Analisar Equipe'}</button>
                    </div>
                  </div>
                  
                  <div className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                    <div className="bg-slate-50/50 px-8 py-5 border-b border-slate-100">
                      <span className="text-[13px] font-black uppercase text-slate-500 tracking-wider">Monitoramento de Saldos (Meta vs Lançado)</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 p-8">
                      {data.employees.map(emp => (
                        <div key={emp.id} className="p-6 bg-white rounded-[2.5rem] flex flex-col gap-4 border border-slate-100 hover:border-indigo-100 hover:shadow-lg transition-all">
                          <div className="flex justify-between items-start">
                             <div className="flex-1 mr-2 overflow-hidden">
                               <p className="text-[16px] font-black text-slate-800 truncate">{emp.name}</p>
                               <p className="text-[11px] text-slate-400 font-black uppercase truncate">{emp.role}</p>
                             </div>
                             <span className={`text-[16px] font-mono font-black whitespace-nowrap ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</span>
                          </div>
                          <div className="w-full bg-slate-50 h-2.5 rounded-full overflow-hidden">
                             <div className={`h-full transition-all duration-1000 ${getCumulativeBalance(emp.id) >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} style={{width: `${Math.min(100, Math.abs(getCumulativeBalance(emp.id)) / 15)}%`}}></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'justifications' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                  <div className="lg:col-span-5 flex flex-col gap-10">
                    <div className="bg-white p-10 rounded-[3.5rem] shadow-xl border border-indigo-50">
                      <h2 className="text-2xl font-black text-slate-900 mb-8 font-serif italic flex items-center gap-4"><Palmtree size={28} className="text-emerald-500"/> Registrar Abono</h2>
                      <form onSubmit={handleJustificationSubmit} className="space-y-5">
                        <select required value={justificationForm.employeeId} onChange={e => setJustificationForm({...justificationForm, employeeId: e.target.value})} className="w-full p-5 rounded-2xl bg-slate-50 border border-slate-100 font-bold text-[15px] outline-none">
                          <option value="">Selecione o funcionário...</option>
                          {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-5">
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-black uppercase text-slate-400 ml-1">Data Início</label>
                            <input type="date" value={justificationForm.startDate} onChange={e => setJustificationForm({...justificationForm, startDate: e.target.value})} className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 font-bold text-[14px]"/>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-black uppercase text-slate-400 ml-1">Data Fim</label>
                            <input type="date" value={justificationForm.endDate} onChange={e => setJustificationForm({...justificationForm, endDate: e.target.value})} className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 font-bold text-[14px]"/>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          {[
                            { id: 'MEDICAL', label: 'Atestado', icon: <Stethoscope size={18}/> },
                            { id: 'VACATION', label: 'Férias', icon: <Palmtree size={18}/> },
                            { id: 'OFF_DAY', label: 'Folga', icon: <Gift size={18}/> },
                            { id: 'HOLIDAY', label: 'Feriado', icon: <Globe size={18}/> }
                          ].map(t => (
                            <button key={t.id} type="button" onClick={() => setJustificationForm({...justificationForm, type: t.id as EntryType})} className={`flex items-center gap-3.5 p-5 rounded-2xl border-2 font-black transition-all text-[13px] ${justificationForm.type === t.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-slate-50 border-slate-100 text-slate-500 hover:border-indigo-100'}`}>
                              {t.icon} <span className="uppercase">{t.label}</span>
                            </button>
                          ))}
                        </div>
                        <button type="submit" disabled={isSubmittingJustification} className="w-full py-5 bg-indigo-600 text-white rounded-[2.5rem] font-black uppercase text-[15px] hover:bg-indigo-700 shadow-xl transition-all">
                          {isSubmittingJustification ? 'Lançando...' : 'Lançar Abono'}
                        </button>
                      </form>
                    </div>

                    <div className="bg-slate-900 p-10 rounded-[3.5rem] shadow-2xl border border-white/5">
                      <div className="flex justify-between items-start mb-8">
                        <h2 className="text-2xl font-black text-indigo-400 font-serif italic flex items-center gap-4"><Plus size={28}/> Ajuste Manual</h2>
                        <button onClick={fillStandardShift} type="button" className="px-4 py-2 bg-indigo-500/20 text-indigo-300 rounded-xl text-[10px] font-black uppercase hover:bg-indigo-500/40 transition-all border border-indigo-500/30">Sugestão: Jornada do Dia</button>
                      </div>
                      <form onSubmit={handleRetroAdjust} className="space-y-5">
                        <select required value={retroForm.employeeId} onChange={e => setRetroForm({...retroForm, employeeId: e.target.value})} className="w-full p-5 rounded-2xl bg-white/5 border border-white/10 font-bold text-[15px] text-white outline-none">
                          <option value="" className="bg-slate-900">Selecione o funcionário...</option>
                          {data.employees.map(e => <option key={e.id} value={e.id} className="bg-slate-900">{e.name}</option>)}
                        </select>
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-black uppercase text-slate-400 ml-1">Data do Lançamento</label>
                            <input type="date" value={retroForm.date} onChange={e => setRetroForm({...retroForm, date: e.target.value})} className="w-full p-4 rounded-2xl bg-white/5 border border-white/10 font-bold text-[14px] text-white"/>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                           {[
                             { id: 'WORK_RETRO', label: 'Trabalho Retro', icon: <CalendarDays size={16}/> },
                             { id: 'BONUS', label: 'Bônus/Hora Extra', icon: <Gift size={16}/> },
                             { id: 'ADJUSTMENT', label: 'Outro Ajuste', icon: <RefreshCw size={16}/> },
                             { id: 'PAYMENT', label: 'Saída/Desc.', icon: <Wallet size={16}/> }
                           ].map(t => (
                             <button key={t.id} type="button" onClick={() => setRetroForm({...retroForm, type: t.id as EntryType})} className={`flex items-center gap-2 p-3 rounded-xl border font-black transition-all text-[11px] ${retroForm.type === t.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white/5 border-white/10 text-slate-400'}`}>
                               {t.icon} <span className="uppercase">{t.label}</span>
                             </button>
                           ))}
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                           <div className="flex gap-2.5 p-2 bg-white/5 rounded-2xl border border-white/10">
                              <button type="button" onClick={() => setRetroForm({...retroForm, isPositive: true})} className={`flex-1 py-4 rounded-xl text-[13px] font-black uppercase transition-all ${retroForm.isPositive ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-500'}`}>+</button>
                              <button type="button" onClick={() => setRetroForm({...retroForm, isPositive: false})} className={`flex-1 py-4 rounded-xl text-[13px] font-black uppercase transition-all ${!retroForm.isPositive ? 'bg-rose-500 text-white shadow-md' : 'text-slate-500'}`}>-</button>
                           </div>
                           <input type="text" value={retroForm.amountStr} onChange={e => setRetroForm({...retroForm, amountStr: e.target.value})} className="w-full p-5 rounded-2xl bg-white/5 border border-white/10 font-black text-[15px] text-center text-white" placeholder="00:00"/>
                        </div>
                        <button type="submit" className="w-full py-5 bg-white text-slate-900 rounded-[2.5rem] font-black uppercase text-[15px] hover:bg-indigo-100 shadow-xl transition-all">Aplicar Ajuste</button>
                      </form>
                    </div>
                  </div>

                  <div className="lg:col-span-7 bg-white rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                    <div className="bg-slate-50 px-8 py-5 border-b border-slate-100 flex justify-between items-center">
                       <span className="text-[13px] font-black uppercase text-slate-500 tracking-wider">Histórico de Lançamentos</span>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      <table className="w-full text-left text-[14px]">
                        <thead className="bg-slate-50/80 sticky top-0 backdrop-blur-md z-10">
                          <tr>
                            <th className="px-8 py-6 font-black uppercase text-[11px] text-slate-400">Pessoa</th>
                            <th className="px-8 py-6 font-black uppercase text-[11px] text-slate-400 text-center">Tipo</th>
                            <th className="px-8 py-6 font-black uppercase text-[11px] text-slate-400 text-right">Valor</th>
                            <th className="px-8 py-6 font-black uppercase text-[11px] text-slate-400 text-center">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {data.timeBank.filter(t => t.type !== 'WORK').slice(0, 50).map(entry => {
                             const emp = data.employees.find(e => e.id === entry.employeeId);
                             const isAwaiting = idAwaitingDelete === entry.id;
                             return (
                               <tr key={entry.id} className="hover:bg-slate-50/50 transition-colors group">
                                 <td className="px-8 py-6">
                                   <p className="font-black text-slate-800 leading-none truncate max-w-[150px]">{emp?.name || '---'}</p>
                                   <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase">{new Date(entry.date + "T00:00:00").toLocaleDateString('pt-BR')}</p>
                                 </td>
                                 <td className="px-8 py-6 text-center">
                                   <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase border shadow-sm ${
                                      entry.type === 'MEDICAL' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                                      entry.type === 'VACATION' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                      entry.type === 'BONUS' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                      'bg-indigo-50 text-indigo-600 border-indigo-100'
                                   }`}>
                                      {ENTRY_TYPE_LABELS[entry.type]}
                                   </span>
                                 </td>
                                 <td className={`px-8 py-6 text-right font-mono font-black text-[15px] ${entry.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(entry.minutes)}</td>
                                 <td className="px-8 py-6 text-center">
                                   <button 
                                      onClick={() => handleDeleteTimeBankEntry(entry.id)} 
                                      disabled={isDeleting && isAwaiting}
                                      className={`p-4 rounded-3xl transition-all shadow-md group relative overflow-hidden min-w-[50px] ${
                                        isAwaiting 
                                          ? 'bg-rose-600 text-white scale-110' 
                                          : 'bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white'
                                      }`}
                                   >
                                      {isAwaiting ? (
                                        <div className="flex items-center gap-2 animate-pulse">
                                          <CheckCircle2 size={22}/>
                                          <span className="text-[10px] font-black uppercase whitespace-nowrap">APAGAR?</span>
                                        </div>
                                      ) : <Trash2 size={22}/>}
                                   </button>
                                 </td>
                               </tr>
                             );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="flex flex-col gap-8">
                  <div className="bg-white p-10 rounded-[3.5rem] flex flex-col md:flex-row justify-between items-center border border-slate-100 shadow-sm gap-6">
                    <div className="text-center md:text-left">
                      <h2 className="text-2xl font-black font-serif italic">Relatórios Fiscais</h2>
                      <p className="text-[13px] text-slate-400 uppercase font-black">Exportação consolidada para Excel</p>
                    </div>
                    <div className="flex gap-4">
                      <button onClick={() => exportToCSV(data.records, 'folha_diaria')} className="px-8 py-4 bg-indigo-50 text-indigo-600 rounded-2xl text-[12px] font-black uppercase hover:bg-indigo-100 transition-all flex items-center gap-3"><Download size={20}/> Registros Brutos</button>
                      <button onClick={() => exportToCSV(data.timeBank, 'banco_consolidado')} className="px-8 py-4 bg-slate-900 text-white rounded-2xl text-[12px] font-black uppercase hover:bg-black transition-all flex items-center gap-3 shadow-xl"><Download size={20}/> Banco de Horas</button>
                    </div>
                  </div>
                  <div className="bg-white rounded-[4rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[14px]">
                        <thead className="bg-slate-50 sticky top-0 z-10">
                          <tr>
                            <th className="px-8 py-6 font-black uppercase text-[11px] text-slate-400">Data / Nome</th>
                            <th className="px-8 py-6 font-black uppercase text-[11px] text-slate-400 text-center">Entrada</th>
                            <th className="px-8 py-6 font-black uppercase text-[11px] text-slate-400 text-center">Intervalos</th>
                            <th className="px-8 py-6 font-black uppercase text-[11px] text-slate-400 text-center">Saída</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {data.records.slice(0, 60).map(rec => {
                            const emp = data.employees.find(e => e.id === rec.employeeId);
                            return (
                              <tr key={rec.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-8 py-6">
                                  <p className="font-black text-slate-800 leading-tight">{emp?.name || '---'}</p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{new Date(rec.date + "T00:00:00").toLocaleDateString('pt-BR', {weekday: 'short', day:'2-digit', month:'short'})}</p>
                                </td>
                                <td className="px-8 py-6 text-center font-mono font-bold text-indigo-600 text-[17px]">{formatTime(rec.clockIn)}</td>
                                <td className="px-8 py-6 text-center font-mono text-slate-400 text-[13px]">
                                  {formatTime(rec.lunchStart)} <span className="mx-1.5 opacity-30">|</span> {formatTime(rec.lunchEnd)}
                                </td>
                                <td className="px-8 py-6 text-center font-mono font-bold text-rose-600 text-[17px]">{formatTime(rec.clockOut)}</td>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-indigo-50 flex flex-col gap-8 self-start">
                     <div className="flex items-center gap-4">
                        <div className="p-4 bg-indigo-50 text-indigo-600 rounded-3xl shadow-inner"><Key size={30}/></div>
                        <h2 className="text-2xl font-black font-serif italic">PIN Gerencial</h2>
                     </div>
                     <div className="space-y-6 pt-4">
                        <input maxLength={4} type="password" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g,''))} className="w-full p-6 rounded-[2.5rem] bg-slate-50 border border-slate-100 font-black tracking-[1.5em] text-center text-4xl" placeholder="****"/>
                        <button onClick={handleUpdatePin} disabled={newPin.length !== 4} className="w-full py-6 bg-slate-900 text-white rounded-[2.5rem] font-black uppercase text-[15px] hover:bg-black transition-all shadow-xl">Salvar PIN</button>
                     </div>
                  </div>

                  <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-indigo-600 flex flex-col gap-10 self-start">
                     <div className="flex items-center gap-4">
                        <div className="p-4 bg-indigo-600 text-white rounded-3xl shadow-lg"><RefreshCw size={30}/></div>
                        <h2 className="text-2xl font-black font-serif italic">Manutenção</h2>
                     </div>
                     <div className="space-y-8">
                        <button onClick={handleDeepClean} className="w-full py-6 bg-rose-50 text-rose-600 border-2 border-rose-100 rounded-[2.5rem] font-black uppercase text-[13px] hover:bg-rose-100 transition-all flex items-center justify-center gap-3 shadow-sm">
                           <RefreshCw size={22}/> Resetar Cache e Recalcular
                        </button>
                        <p className="text-center text-[10px] font-black text-slate-300 uppercase tracking-[0.5em] pt-4">Nobel Ponto v4.5 - Cálculo Matemático Fixo</p>
                     </div>
                  </div>
                </div>
              )}

              {activeTab === 'employees' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                  <div className="lg:col-span-4 bg-white p-10 rounded-[3.5rem] shadow-xl border border-indigo-50 flex flex-col">
                    <h2 className="text-2xl font-black mb-8 font-serif italic flex items-center gap-4"><UserPlus size={28}/> {editingEmployeeId ? 'Editar Perfil' : 'Novo Perfil'}</h2>
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
                       setNewEmp({ name:'', role:'', dailyHours:'8', englishDay:'6', shortDayHours:'4', initialBalanceStr:'00:00', isHourly:false, startDate: DEFAULT_START_DATE }); 
                       fetchData();
                       alert("Cadastro salvo com sucesso!");
                    }} className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-[13px] font-black uppercase text-slate-400 ml-1">Nome Completo</label>
                        <input required value={newEmp.name} onChange={e => setNewEmp({...newEmp, name: e.target.value})} className="w-full p-5 rounded-3xl bg-slate-50 border border-slate-100 text-[15px] font-bold" placeholder="Andrea Silva"/>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[13px] font-black uppercase text-slate-400 ml-1">Início do Controle (Neste App)</label>
                        <input 
                          type="date" 
                          required 
                          value={newEmp.startDate} 
                          onChange={e => setNewEmp(prev => ({...prev, startDate: e.target.value}))} 
                          className="w-full p-5 rounded-[2rem] bg-indigo-50 border-2 border-indigo-200 text-[16px] font-black text-slate-800 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/10 outline-none transition-all shadow-sm"
                        />
                        <p className="text-[10px] text-indigo-600 font-bold flex items-start gap-1.5 px-1 mt-1 leading-tight"><Info size={12} className="shrink-0 mt-0.5"/> Dica: Se o saldo estiver muito negativo hoje, mude esta data para o dia atual para zerar a "dívida" acumulada.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-5">
                        <div className="space-y-2">
                          <label className="text-[11px] font-black uppercase text-slate-400">Horas Diárias (Meta)</label>
                          <input type="number" value={newEmp.dailyHours} onChange={e => setNewEmp({...newEmp, dailyHours: e.target.value})} className="w-full p-5 rounded-3xl bg-slate-50 border border-slate-100 text-[15px] font-black text-center"/>
                          <p className="text-[9px] text-slate-400 font-bold uppercase text-center">Ex: 6 para estagiário</p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[11px] font-black uppercase text-slate-400">Dia de Folga Extra</label>
                          <select value={newEmp.englishDay} onChange={e => setNewEmp({...newEmp, englishDay: e.target.value})} className="w-full p-5 rounded-3xl bg-slate-50 border border-slate-100 text-[15px] font-black">
                            {WEEK_DAYS_BR.map((d, i) => <option key={i} value={i}>{d}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                         <label className="text-[11px] font-black uppercase text-slate-400">Meta de Horas na Folga Extra</label>
                         <input type="number" value={newEmp.shortDayHours} onChange={e => setNewEmp({...newEmp, shortDayHours: e.target.value})} className="w-full p-5 rounded-3xl bg-slate-50 border border-slate-100 text-[15px] font-black text-center" placeholder="0 para folga total"/>
                         <p className="text-[9px] text-slate-400 font-bold uppercase text-center">Use 0 para fechar a semana de 5 dias</p>
                      </div>
                      <div className="flex items-center gap-4 px-2 pt-2">
                         <input type="checkbox" id="isHourly" checked={newEmp.isHourly} onChange={e => setNewEmp({...newEmp, isHourly: e.target.checked})} className="w-6 h-6 rounded-xl border-slate-300 text-indigo-600"/>
                         <label htmlFor="isHourly" className="text-sm font-black uppercase text-slate-500">Regime Horista (Sem meta/débito)</label>
                      </div>
                      <button type="submit" className="w-full py-5 bg-indigo-600 text-white rounded-[2.5rem] font-black uppercase text-[15px] shadow-xl hover:bg-indigo-700 mt-4">Salvar Colaborador</button>
                    </form>
                  </div>
                  <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 self-start">
                    {data.employees.map(emp => (
                      <div key={emp.id} className="bg-white p-8 rounded-[3.5rem] border border-slate-100 shadow-sm relative group hover:shadow-2xl transition-all border-b-8 hover:border-b-indigo-500">
                        <div className="flex justify-between items-start mb-6">
                          <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-2xl shadow-inner">{emp.name.charAt(0)}</div>
                          <button onClick={() => handleEditEmployee(emp)} className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm opacity-0 group-hover:opacity-100"><Edit2 size={20}/></button>
                        </div>
                        <h3 className="font-black text-slate-800 text-[17px] truncate leading-tight">{emp.name}</h3>
                        <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest mt-1">{emp.role}</p>
                        <div className="mt-6 pt-6 border-t border-slate-50 flex justify-between items-center">
                           <span className="text-[10px] font-black uppercase text-slate-400">Saldo Atual</span>
                           <span className={`text-xl font-mono font-black ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-2xl animate-in fade-in duration-300">
           <div className="bg-white w-full max-w-[380px] p-12 rounded-[5rem] shadow-2xl relative">
              <button onClick={() => setIsLoginModalOpen(false)} className="absolute top-10 right-10 text-slate-300 hover:text-slate-900 transition-colors"><X size={32}/></button>
              <div className="text-center mb-10">
                <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 shadow-inner"><Lock size={36}/></div>
                <h2 className="text-3xl font-black font-serif italic lowercase first-letter:capitalize leading-tight">Painel Gerencial</h2>
              </div>
              <div className="flex justify-center gap-4 mb-10">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-4 h-4 rounded-full transition-all duration-300 ${pinInput.length > i ? 'bg-indigo-600 scale-125 shadow-[0_0_15px_rgba(79,70,229,0.5)]' : 'bg-slate-200'} ${loginError ? 'bg-rose-500 animate-bounce' : ''}`}></div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {['1','2','3','4','5','6','7','8','9','C','0','<'].map(v => (
                  <button key={v} onClick={() => v === 'C' ? setPinInput('') : v === '<' ? setPinInput(p => p.slice(0,-1)) : handlePinDigit(v)} className="h-16 rounded-[2rem] font-black text-2xl bg-slate-50 text-slate-600 hover:bg-indigo-600 hover:text-white transition-all active:scale-90 shadow-sm">{v}</button>
                ))}
              </div>
           </div>
        </div>
      )}
      
      {isHistoryModalOpen && selectedClockEmployeeId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-6">
          <div className="bg-white w-full max-w-2xl max-h-[85vh] p-10 rounded-[4rem] shadow-2xl relative flex flex-col">
            <button onClick={() => setIsHistoryModalOpen(false)} className="absolute top-10 right-10 text-slate-300 hover:text-slate-900 transition-colors"><X size={32}/></button>
            <h2 className="text-2xl font-black font-serif italic mb-10">Extrato Consolidado</h2>
            <div className="flex-1 overflow-y-auto hide-scrollbar border rounded-[3rem] border-slate-100">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-8 py-5 font-black uppercase text-[11px] text-slate-400">Data</th>
                    <th className="px-8 py-5 font-black uppercase text-[11px] text-slate-400 text-center">Horário</th>
                    <th className="px-8 py-5 font-black uppercase text-[11px] text-slate-400 text-right">Saldo Dia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.records.filter(r => r.employeeId === selectedClockEmployeeId).slice(0, 45).map(rec => {
                    const worked = calculateWorkedMinutes(rec);
                    const delta = worked - rec.expectedMinutes;
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50/50">
                        <td className="px-8 py-6 font-black text-slate-700">{new Date(rec.date + "T00:00:00").toLocaleDateString('pt-BR')}</td>
                        <td className="px-8 py-6 text-center font-mono text-slate-500 text-lg">{formatTime(rec.clockIn)} - {formatTime(rec.clockOut)}</td>
                        <td className={`px-8 py-6 text-right font-mono font-black text-lg ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(delta)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest mt-8">Cálculo proativo baseado na jornada contratual.</p>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;
