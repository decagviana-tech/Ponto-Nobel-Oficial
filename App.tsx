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
  exportToCSV
} from './utils';
import { 
  Coffee, Utensils, LogIn, LogOut, ChevronLeft, Lock, 
  UserCheck, AlertCircle, X, Save, Clock as ClockIcon, 
  Edit2, Trash2, UserPlus, FileText, Download, Cloud, CloudOff, 
  TrendingUp, Users, Settings, BookOpen, ShieldAlert, Sparkles, 
  CheckCircle2, Monitor, Upload, Database, Wifi, WifiOff, Globe,
  CalendarDays, ClipboardCheck, Plane, LifeBuoy, History, Search, Plus,
  Github
} from 'lucide-react';

// ============================================================
// ⬇️ CREDENCIAIS SUPABASE CONFIGURADAS ⬇️
// ============================================================
const SUPABASE_URL = "https://afpcoquiivzrckabcvzo.supabase.co" as string; 
const SUPABASE_KEY = "sb_publishable_-5JWjReTELNk5YKnkX9OZg_EeR6j6Zy" as string; 
// ============================================================

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
  const [editingRecord, setEditingRecord] = useState<ClockRecord | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isNewRecordModalOpen, setIsNewRecordModalOpen] = useState(false);
  
  const [newRecordForm, setNewRecordForm] = useState({
    employeeId: '',
    date: new Date().toISOString().split('T')[0],
    clockIn: '08:00',
    clockOut: '17:00',
    lunchStart: '12:00',
    lunchEnd: '13:00'
  });

  const [newEmp, setNewEmp] = useState({ 
    name: '', role: '', dailyHours: '8', englishDay: '6', shortDayHours: '4', initialBalanceStr: '00:00', isHourly: false 
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
    month: (new Date().getMonth()).toString(),
    year: (new Date().getFullYear()).toString(),
    balanceStr: '00:00'
  });
  const [isSubmittingJustification, setIsSubmittingJustification] = useState(false);
  const [isSubmittingRetro, setIsSubmittingRetro] = useState(false);
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

      setData({
        employees: (emps || []) as Employee[],
        records: (recs || []) as ClockRecord[],
        timeBank: (bank || []) as TimeBankEntry[],
        settings: (sett || { managerPin: "1234" }) as any
      });
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
    localStorage.setItem('nobel_data_v2', JSON.stringify(data));
  }, [data]);

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
    const initial = emp.initialBalanceMinutes || 0;
    const bank = data.timeBank
      .filter(t => t.employeeId === empId)
      .reduce((a, b) => a + b.minutes, 0);
    
    const todayStr = currentTime.toISOString().split('T')[0];
    const rec = data.records.find(r => r.employeeId === empId && r.date === todayStr);
    const alreadyBankedToday = data.timeBank.some(t => t.employeeId === empId && t.date === todayStr);
    
    let todayDelta = 0;
    if (rec && !alreadyBankedToday && !emp.isHourly) {
      todayDelta = calculateWorkedMinutes(rec, currentTime) - rec.expectedMinutes;
    }

    return initial + bank + todayDelta;
  };

  const handleClockAction = async (employeeId: string) => {
    if (!supabase) return alert("Erro de Conexão: Configure o Supabase.");
    
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
    } catch (e) {
      alert("Erro ao gravar ponto.");
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
      const entriesToInsert: any[] = [];

      let curr = new Date(start);
      while (curr <= end) {
        const dateStr = curr.toISOString().split('T')[0];
        const expected = getExpectedMinutesForDate(emp, curr);
        if (expected > 0) {
          entriesToInsert.push({
            employeeId: emp.id, date: dateStr, minutes: expected, 
            type: justificationForm.type, note: justificationForm.note || `Abono: ${justificationForm.type}`
          });
        }
        curr.setDate(curr.getDate() + 1);
      }

      if (entriesToInsert.length > 0) {
        await supabase.from('timeBank').insert(entriesToInsert);
        alert(`${entriesToInsert.length} dias lançados!`);
        setJustificationForm({ ...justificationForm, note: '', startDate: new Date().toISOString().split('T')[0], endDate: new Date().toISOString().split('T')[0] });
        fetchData();
      } else {
        alert("Nenhum dia de trabalho no período.");
      }
    } catch (err) {
      alert("Erro ao lançar abono.");
    } finally {
      setIsSubmittingJustification(false);
    }
  };

  // Fix: Added handleEditEmployee function to populate the form with employee data
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
      shortDayHours: ((emp.englishWeekMinutes || 240) / 60).toString(),
      initialBalanceStr: `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
      isHourly: emp.isHourly || false
    });
  };

  const getNextAction = (record?: ClockRecord) => {
    if (!record?.clockIn) return { label: 'Entrada', stage: 'in', color: 'bg-indigo-600', icon: <LogIn size={18}/> };
    if (!record.lunchStart) return { label: 'Almoço', stage: 'l_start', color: 'bg-amber-600', icon: <Utensils size={18}/> };
    if (!record.lunchEnd) return { label: 'Retorno Almoço', stage: 'l_end', color: 'bg-emerald-600', icon: <Utensils size={18}/> };
    if (!record.snackStart) return { label: 'Lanche', stage: 's_start', color: 'bg-orange-500', icon: <Coffee size={18}/> };
    if (!record.snackEnd) return { label: 'Retorno Lanche', stage: 's_end', color: 'bg-emerald-600', icon: <Coffee size={18}/> };
    if (!record.clockOut) return { label: 'Encerrar Dia', stage: 'out', color: 'bg-rose-600', icon: <LogOut size={18}/> };
    return { label: 'Finalizado', stage: 'done', color: 'bg-slate-800', icon: <UserCheck size={18}/> };
  };

  const analyzeWithAI = async () => {
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const teamSummary = data.employees.map(emp => ({
        nome: emp.name, saldo: formatMinutes(getCumulativeBalance(emp.id))
      }));
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analise o banco de horas da Livraria Nobel Petrópolis. Temos funcionários com os seguintes saldos: ${JSON.stringify(teamSummary)}. Dê dicas de gestão de pessoas para o dono. Responda curto em PT-BR.`
      });
      setAiInsights(response.text || "Análise concluída.");
    } catch (e) {
      setAiInsights("IA offline no momento.");
    } finally { setIsAnalyzing(false); }
  };

  if (isLoading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center flex-col gap-4">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-white text-[9px] font-black uppercase tracking-[0.4em]">Nobel Cloud...</p>
    </div>
  );

  return (
    <div className="h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900 overflow-hidden">
      
      {/* Sidebar Compacta */}
      <aside className="w-full md:w-52 bg-[#1e293b] flex flex-col shadow-2xl z-40 border-r border-white/5 h-screen overflow-hidden">
        <div className="p-4 flex flex-col items-center gap-1 text-center">
          <div className="bg-indigo-500 p-1.5 rounded-lg text-white rotate-3 shadow-lg shadow-indigo-500/20"><BookOpen size={18}/></div>
          <div>
            <span className="text-white font-black text-base tracking-tighter block font-serif">Nobel Ponto</span>
            <span className="text-indigo-400 text-[7px] font-black uppercase tracking-[0.2em] block">Petrópolis</span>
          </div>
        </div>

        <nav className="flex-1 px-2 space-y-0.5 mt-2 overflow-y-auto hide-scrollbar">
          <button onClick={() => { setActiveTab('clock'); setSelectedClockEmployeeId(null); setIsManagerAuthenticated(false); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all font-bold text-[10px] ${activeTab === 'clock' && !isManagerAuthenticated ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:text-white'}`}>
            <ClockIcon size={14} /> <span>Registrar Ponto</span>
          </button>
          
          <div className="pt-3 mt-3 border-t border-white/5 space-y-0.5">
            <p className="px-3 pb-1 text-[7px] font-black text-slate-500 uppercase tracking-[0.2em]">Gerente</p>
            {[
              { id: 'dashboard', label: 'Painel', icon: <TrendingUp size={14}/> },
              { id: 'employees', label: 'Equipe', icon: <Users size={14}/> },
              { id: 'justifications', label: 'Justificativas', icon: <ClipboardCheck size={14}/> },
              { id: 'reports', label: 'Relatórios', icon: <FileText size={14}/> },
              { id: 'admin', label: 'Ajustes', icon: <Settings size={14}/> },
            ].map(item => (
              <button key={item.id} onClick={() => isManagerAuthenticated ? setActiveTab(item.id) : setIsLoginModalOpen(true)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all font-bold text-[10px] ${activeTab === item.id && isManagerAuthenticated ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-white'}`}>
                {item.icon} <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="p-3 border-t border-white/5 space-y-2">
          <a href="https://github.com/decagviana-tech/Ponto-Nobel-Oficial" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[7px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/5 transition-all">
            <Github size={12}/>
            <span>GitHub Repo</span>
          </a>
          <div className={`flex items-center gap-2 px-2 py-1 rounded-lg text-[6px] font-black uppercase tracking-widest ${isConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            <div className={`w-1 h-1 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}></div>
            <span>{isConnected ? 'Em Nuvem' : 'Offline'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content - Zero Scroll Desktop */}
      <main className="flex-1 p-4 md:p-5 overflow-hidden h-screen flex flex-col">
        <header className="mb-3 flex justify-between items-center">
          <div className="space-y-0.5">
            <h1 className="text-xl font-black tracking-tighter text-slate-900 font-serif lowercase italic capitalize">
              {activeTab === 'clock' ? 'olá, bom dia' : activeTab === 'justifications' ? 'justificativas' : activeTab === 'reports' ? 'relatórios' : activeTab === 'dashboard' ? 'painel de controle' : activeTab}
            </h1>
            <p className="text-slate-400 font-medium text-[8px] tracking-wide uppercase">Livraria Nobel Petrópolis</p>
          </div>
          <div className="bg-white px-4 py-1.5 rounded-2xl shadow-sm border border-slate-200 text-right flex flex-col items-end">
              <p className="text-xl font-mono font-black text-slate-800 leading-none tracking-tighter">{currentTime.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</p>
              <p className="text-[7px] font-black text-indigo-500 uppercase tracking-[0.2em] mt-0.5">{currentTime.toLocaleDateString('pt-BR', {weekday: 'short', day:'2-digit', month:'short'})}</p>
          </div>
        </header>

        {/* Dynamic Area */}
        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          
          {activeTab === 'clock' && (
            <div className="h-full flex flex-col animate-in fade-in zoom-in-95 duration-500">
              {!selectedClockEmployeeId ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 overflow-y-auto hide-scrollbar pb-10">
                  {data.employees.map(emp => (
                    <button key={emp.id} onClick={() => setSelectedClockEmployeeId(emp.id)} className="bg-white p-4 rounded-3xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all border border-slate-100 flex flex-col items-center group relative aspect-square justify-center">
                      <div className="w-10 h-10 bg-slate-50 text-slate-300 rounded-xl flex items-center justify-center text-lg font-black group-hover:bg-indigo-600 group-hover:text-white mb-2 transition-all">{emp.name.charAt(0)}</div>
                      <span className="font-black text-slate-800 text-[10px] text-center line-clamp-1">{emp.name.split(' ')[0]}</span>
                      <span className="text-[6px] font-black text-slate-400 uppercase tracking-widest">{emp.role}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="max-w-4xl mx-auto w-full space-y-3">
                  <button onClick={() => setSelectedClockEmployeeId(null)} className="flex items-center gap-1 text-slate-400 font-black uppercase text-[8px] hover:text-indigo-600 transition-all"><ChevronLeft size={12}/> Voltar</button>
                  {data.employees.filter(e => e.id === selectedClockEmployeeId).map(emp => {
                    const todayStr = currentTime.toISOString().split('T')[0];
                    const rec = data.records.find(r => r.employeeId === emp.id && r.date === todayStr);
                    const action = getNextAction(rec);
                    return (
                      <div key={emp.id} className="grid grid-cols-1 md:grid-cols-12 gap-3">
                        <div className="md:col-span-8 bg-white p-5 rounded-[2rem] shadow-xl border border-indigo-50">
                          <div className="flex items-center gap-3 border-b border-slate-50 pb-3 mb-4">
                            <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center text-lg font-black shadow-lg">{emp.name.charAt(0)}</div>
                            <div>
                              <h2 className="text-base font-black text-slate-900 font-serif italic">{emp.name}</h2>
                              <p className="text-indigo-500 text-[7px] font-black uppercase tracking-widest">{emp.role}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mb-5">
                            {[
                              { label: 'Ent.', time: rec?.clockIn },
                              { label: 'Alm. I', time: rec?.lunchStart },
                              { label: 'Alm. F', time: rec?.lunchEnd },
                              { label: 'Lan. I', time: rec?.snackStart },
                              { label: 'Lan. F', time: rec?.snackEnd },
                              { label: 'Saída', time: rec?.clockOut },
                            ].map((it, i) => (
                              <div key={i} className={`p-2 rounded-xl border-2 text-center ${it.time ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
                                <span className="text-[6px] font-black uppercase block opacity-60">{it.label}</span>
                                <p className="text-xs font-mono font-black">{formatTime(it.time || null)}</p>
                              </div>
                            ))}
                          </div>
                          <button disabled={action.stage === 'done'} onClick={() => handleClockAction(emp.id)} className={`w-full py-4 rounded-3xl font-black text-base shadow-lg transition-all flex items-center justify-center gap-2 ${action.color} text-white active:scale-95`}>
                            {action.icon} <span className="uppercase tracking-widest">{action.label}</span>
                          </button>
                        </div>
                        <div className="md:col-span-4 bg-slate-900 text-white p-5 rounded-[2rem] flex flex-col justify-center text-center shadow-xl">
                            <p className="text-[7px] font-black text-indigo-400 uppercase tracking-widest mb-1">Saldo Atual</p>
                            <p className={`text-3xl font-mono font-black ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</p>
                            <button onClick={() => setIsHistoryModalOpen(true)} className="mt-4 text-[7px] font-black uppercase text-slate-500 hover:text-white flex items-center justify-center gap-1"><History size={10}/> Ver histórico</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {isManagerAuthenticated && (
            <div className="h-full overflow-hidden flex flex-col gap-4 animate-in slide-in-from-bottom-6 duration-500">
              {activeTab === 'dashboard' && (
                <div className="flex flex-col gap-4 h-full">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Equipe</p>
                      <p className="text-2xl font-black text-slate-800 mt-0.5">{data.employees.length}</p>
                    </div>
                    <div className="bg-indigo-600 p-4 rounded-3xl shadow-lg text-white">
                      <p className="text-[7px] font-black text-indigo-200 uppercase tracking-widest">Saldo Global</p>
                      <p className="text-xl font-mono font-black mt-0.5">{formatMinutes(data.employees.reduce((acc, emp) => acc + getCumulativeBalance(emp.id), 0))}</p>
                    </div>
                    <div className="bg-slate-900 p-4 rounded-3xl text-white flex flex-col justify-center">
                      <h3 className="text-[8px] font-black uppercase text-indigo-400 mb-0.5 flex items-center gap-1"><Sparkles size={10}/> Nobel AI</h3>
                      <p className="text-[8px] italic text-indigo-100 line-clamp-1">{aiInsights || "Análise disponível."}</p>
                      <button onClick={analyzeWithAI} disabled={isAnalyzing} className="mt-1 px-2 py-0.5 bg-white text-slate-900 rounded-full font-black text-[6px] uppercase self-start">{isAnalyzing ? '...' : 'Gerar'}</button>
                    </div>
                  </div>
                  
                  {/* Lista de Saldos Rápida */}
                  <div className="flex-1 bg-white rounded-3xl border border-slate-100 overflow-hidden flex flex-col">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex justify-between items-center">
                      <span className="text-[8px] font-black uppercase text-slate-400">Situação da Equipe</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 hide-scrollbar grid grid-cols-2 lg:grid-cols-3 gap-2">
                      {data.employees.map(emp => (
                        <div key={emp.id} className="p-3 bg-slate-50 rounded-2xl flex justify-between items-center border border-slate-100/50">
                          <div>
                            <p className="text-[9px] font-black text-slate-800">{emp.name.split(' ')[0]}</p>
                            <p className="text-[7px] text-slate-400 uppercase font-bold">{emp.role}</p>
                          </div>
                          <span className={`text-[10px] font-mono font-black ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'justifications' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full overflow-hidden">
                  <div className="lg:col-span-4 flex flex-col gap-4">
                    <div className="bg-white p-5 rounded-3xl shadow-lg border border-indigo-50">
                      <h2 className="text-[11px] font-black text-slate-900 mb-3 font-serif italic flex items-center gap-2"><ClipboardCheck size={16} className="text-indigo-500"/> Abonos</h2>
                      <form onSubmit={handleJustificationSubmit} className="space-y-2">
                        <select required value={justificationForm.employeeId} onChange={e => setJustificationForm({...justificationForm, employeeId: e.target.value})} className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-100 font-bold text-[9px]">
                          <option value="">Colaborador...</option>
                          {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="date" value={justificationForm.startDate} onChange={e => setJustificationForm({...justificationForm, startDate: e.target.value})} className="w-full p-2 rounded-xl bg-slate-50 border border-slate-100 font-bold text-[9px]"/>
                          <input type="date" value={justificationForm.endDate} onChange={e => setJustificationForm({...justificationForm, endDate: e.target.value})} className="w-full p-2 rounded-xl bg-slate-50 border border-slate-100 font-bold text-[9px]"/>
                        </div>
                        <button type="submit" className="w-full py-2.5 bg-indigo-600 text-white rounded-full font-black uppercase text-[8px]">Lançar Período</button>
                      </form>
                    </div>
                  </div>
                  <div className="lg:col-span-8 bg-white rounded-3xl border border-slate-100 overflow-hidden flex flex-col">
                    <div className="bg-slate-50 p-3 border-b border-slate-100 flex justify-between items-center">
                       <span className="text-[8px] font-black uppercase text-slate-400">Lançamentos Recentes</span>
                       <button onClick={() => setIsNewRecordModalOpen(true)} className="px-3 py-1 bg-emerald-500 text-white rounded-full text-[7px] font-black uppercase"><Plus size={10} className="inline mr-1"/> Manual</button>
                    </div>
                    <div className="flex-1 overflow-y-auto hide-scrollbar">
                      <table className="w-full text-left text-[9px]">
                        <thead className="bg-slate-50/50 sticky top-0 backdrop-blur-sm">
                          <tr>
                            <th className="p-3 font-black uppercase text-slate-400">Colaborador</th>
                            <th className="p-3 font-black uppercase text-slate-400">Tipo</th>
                            <th className="p-3 font-black uppercase text-slate-400 text-right">Saldo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {data.timeBank.filter(t => t.type !== 'WORK').slice(0, 15).map(entry => {
                             const emp = data.employees.find(e => e.id === entry.employeeId);
                             return (
                               <tr key={entry.id} className="hover:bg-slate-50/50">
                                 <td className="p-3">
                                   <p className="font-black text-slate-800">{emp?.name || '---'}</p>
                                   <p className="text-[7px] font-bold text-slate-400">{new Date(entry.date + "T00:00:00").toLocaleDateString()}</p>
                                 </td>
                                 <td className="p-3"><span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[7px] font-black uppercase">{entry.type}</span></td>
                                 <td className={`p-3 text-right font-mono font-black ${entry.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(entry.minutes)}</td>
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
                <div className="flex flex-col gap-3 h-full overflow-hidden">
                  <div className="bg-white p-3 rounded-2xl flex justify-between items-center border border-slate-100">
                    <h2 className="text-[10px] font-black font-serif italic">Registros de Ponto</h2>
                    <button onClick={() => exportToCSV(data.records, 'ponto_nobel')} className="px-3 py-1 bg-slate-100 rounded-full text-[7px] font-black uppercase text-slate-600 hover:bg-slate-200"><Download size={10} className="inline mr-1"/> Exportar CSV</button>
                  </div>
                  <div className="flex-1 bg-white rounded-3xl border border-slate-100 overflow-hidden flex flex-col">
                    <div className="flex-1 overflow-y-auto hide-scrollbar">
                      <table className="w-full text-left text-[9px]">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="p-3 font-black uppercase text-slate-400">Data / Nome</th>
                            <th className="p-3 font-black uppercase text-slate-400">Entrada</th>
                            <th className="p-3 font-black uppercase text-slate-400">Intervalo</th>
                            <th className="p-3 font-black uppercase text-slate-400">Saída</th>
                            <th className="p-3 font-black uppercase text-slate-400 text-right">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {data.records.slice(0, 30).map(rec => {
                            const emp = data.employees.find(e => e.id === rec.employeeId);
                            return (
                              <tr key={rec.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="p-3">
                                  <p className="font-black text-slate-800">{emp?.name || '---'}</p>
                                  <p className="text-[7px] font-bold text-slate-400">{new Date(rec.date + "T00:00:00").toLocaleDateString()}</p>
                                </td>
                                <td className="p-3 font-mono font-bold">{formatTime(rec.clockIn)}</td>
                                <td className="p-3 font-mono text-slate-400 opacity-60">
                                  {formatTime(rec.lunchStart)} - {formatTime(rec.lunchEnd)}
                                </td>
                                <td className="p-3 font-mono font-bold">{formatTime(rec.clockOut)}</td>
                                <td className="p-3 text-right">
                                  <button onClick={() => setEditingRecord(rec)} className="p-1 text-indigo-300 hover:text-indigo-600"><Edit2 size={12}/></button>
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

              {activeTab === 'employees' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full overflow-hidden">
                  <div className="lg:col-span-4 bg-white p-5 rounded-3xl shadow-lg border border-indigo-50 flex flex-col">
                    <h2 className="text-[11px] font-black mb-4 font-serif italic"><UserPlus size={16} className="inline mr-2"/> {editingEmployeeId ? 'Editar' : 'Novo'}</h2>
                    <form onSubmit={async (e) => {
                       e.preventDefault();
                       if (!supabase) return;
                       const payload = { 
                         name: newEmp.name, role: newEmp.role, baseDailyMinutes: parseInt(newEmp.dailyHours) * 60,
                         englishWeekDay: parseInt(newEmp.englishDay), englishWeekMinutes: parseInt(newEmp.shortDayHours) * 60,
                         initialBalanceMinutes: parseTimeStringToMinutes(newEmp.initialBalanceStr), isHourly: newEmp.isHourly
                       };
                       if (editingEmployeeId) await supabase.from('employees').update(payload).eq('id', editingEmployeeId);
                       else await supabase.from('employees').insert([payload]);
                       setEditingEmployeeId(null); setNewEmp({ name:'', role:'', dailyHours:'8', englishDay:'6', shortDayHours:'4', initialBalanceStr:'00:00', isHourly:false }); fetchData();
                    }} className="space-y-3">
                      <input required value={newEmp.name} onChange={e => setNewEmp({...newEmp, name: e.target.value})} className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-[9px] font-bold" placeholder="Nome completo"/>
                      <input required value={newEmp.role} onChange={e => setNewEmp({...newEmp, role: e.target.value})} className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-[9px] font-bold" placeholder="Cargo"/>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[6px] font-black uppercase text-slate-400">Hrs/Dia</label>
                          <input type="number" value={newEmp.dailyHours} onChange={e => setNewEmp({...newEmp, dailyHours: e.target.value})} className="w-full p-2 rounded-xl bg-slate-50 border border-slate-100 text-[9px] font-black text-center"/>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[6px] font-black uppercase text-slate-400">Dia Curto</label>
                          <select value={newEmp.englishDay} onChange={e => setNewEmp({...newEmp, englishDay: e.target.value})} className="w-full p-2 rounded-xl bg-slate-50 border border-slate-100 text-[9px] font-black">
                            {WEEK_DAYS_BR.map((d, i) => <option key={i} value={i}>{d}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Added missing fields to the employee form for better control */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[6px] font-black uppercase text-slate-400">Hrs Dia Curto</label>
                          <input type="number" value={newEmp.shortDayHours} onChange={e => setNewEmp({...newEmp, shortDayHours: e.target.value})} className="w-full p-2 rounded-xl bg-slate-50 border border-slate-100 text-[9px] font-black text-center"/>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[6px] font-black uppercase text-slate-400">Saldo Inicial</label>
                          <input type="text" value={newEmp.initialBalanceStr} onChange={e => setNewEmp({...newEmp, initialBalanceStr: e.target.value})} className="w-full p-2 rounded-xl bg-slate-50 border border-slate-100 text-[9px] font-black text-center" placeholder="00:00"/>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 px-2">
                         <input type="checkbox" id="isHourly" checked={newEmp.isHourly} onChange={e => setNewEmp({...newEmp, isHourly: e.target.checked})} className="rounded text-indigo-600"/>
                         <label htmlFor="isHourly" className="text-[8px] font-black uppercase text-slate-500">Horista (Sem carga fixa)</label>
                      </div>
                      <button type="submit" className="w-full py-2.5 bg-indigo-600 text-white rounded-full font-black uppercase text-[8px] shadow-lg">Salvar Colaborador</button>
                      {editingEmployeeId && <button onClick={() => setEditingEmployeeId(null)} className="w-full text-[7px] font-black uppercase text-slate-400">Cancelar edição</button>}
                    </form>
                  </div>
                  <div className="lg:col-span-8 overflow-y-auto hide-scrollbar grid grid-cols-2 xl:grid-cols-3 gap-3 pb-10">
                    {data.employees.map(emp => (
                      <div key={emp.id} className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm relative group">
                        <div className="flex justify-between items-start mb-2">
                          <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-black text-[10px]">{emp.name.charAt(0)}</div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                             <button onClick={() => handleEditEmployee(emp)} className="p-1 text-slate-300 hover:text-indigo-600"><Edit2 size={12}/></button>
                          </div>
                        </div>
                        <h3 className="font-black text-slate-800 text-[10px] truncate">{emp.name}</h3>
                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">{emp.role}</p>
                        <div className="mt-3 pt-3 border-t border-slate-50 flex justify-between items-center">
                           <span className={`text-[10px] font-mono font-black ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</span>
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

      {/* Modais - Unificados e Compactos */}
      {isHistoryModalOpen && selectedClockEmployeeId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-4">
          <div className="bg-white w-full max-w-lg max-h-[70vh] p-6 rounded-[2.5rem] shadow-2xl relative flex flex-col">
            <button onClick={() => setIsHistoryModalOpen(false)} className="absolute top-5 right-5 text-slate-300 hover:text-slate-900"><X size={18}/></button>
            <h2 className="text-xl font-black font-serif italic mb-4">Meus Registros</h2>
            <div className="flex-1 overflow-y-auto hide-scrollbar">
              <table className="w-full text-left text-[9px]">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="p-2 font-black uppercase text-slate-400">Data</th>
                    <th className="p-2 font-black uppercase text-slate-400">Horários</th>
                    <th className="p-2 font-black uppercase text-slate-400 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.records.filter(r => r.employeeId === selectedClockEmployeeId).slice(0, 31).map(rec => {
                    const worked = calculateWorkedMinutes(rec);
                    const delta = worked - rec.expectedMinutes;
                    return (
                      <tr key={rec.id}>
                        <td className="p-2 font-black">{new Date(rec.date + "T00:00:00").toLocaleDateString('pt-BR', {day: '2-digit', month: 'short'})}</td>
                        <td className="p-2 font-mono text-slate-500 opacity-70">{formatTime(rec.clockIn)} - {formatTime(rec.clockOut)}</td>
                        <td className={`p-2 text-right font-mono font-black ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(delta)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Login Modal */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-md">
           <div className="bg-white w-full max-w-[260px] p-8 rounded-[3rem] shadow-2xl relative">
              <button onClick={() => setIsLoginModalOpen(false)} className="absolute top-6 right-6 text-slate-300"><X size={16}/></button>
              <div className="text-center mb-4">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-2"><Lock size={18}/></div>
                <h2 className="text-sm font-black font-serif italic lowercase">gerente</h2>
              </div>
              <div className="flex justify-center gap-2 mb-6">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-2 h-2 rounded-full ${pinInput.length > i ? 'bg-indigo-600' : 'bg-slate-100'}`}></div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {['1','2','3','4','5','6','7','8','9','C','0','<'].map(v => (
                  <button key={v} onClick={() => v === 'C' ? setPinInput('') : v === '<' ? setPinInput(p => p.slice(0,-1)) : handlePinDigit(v)} className="h-10 rounded-xl font-black text-sm bg-slate-50 text-slate-600 hover:bg-white border hover:border-indigo-100 transition-all">{v}</button>
                ))}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;