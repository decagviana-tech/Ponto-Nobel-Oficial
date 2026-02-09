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

  const handleDeleteTimeBankEntry = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover este lançamento? Isso afetará o saldo do colaborador imediatamente.")) return;
    if (supabase) {
      const { error } = await supabase.from('timeBank').delete().eq('id', id);
      if (error) alert("Erro ao deletar: " + error.message);
      else fetchData();
    }
  };

  const handleCreateNewRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !newRecordForm.employeeId) return;

    try {
      const emp = data.employees.find(e => e.id === newRecordForm.employeeId)!;
      const expected = getExpectedMinutesForDate(emp, new Date(newRecordForm.date + "T12:00:00"));
      
      const recordToInsert = {
        employeeId: newRecordForm.employeeId,
        date: newRecordForm.date,
        clockIn: `${newRecordForm.date}T${newRecordForm.clockIn}:00Z`,
        clockOut: `${newRecordForm.date}T${newRecordForm.clockOut}:00Z`,
        lunchStart: `${newRecordForm.date}T${newRecordForm.lunchStart}:00Z`,
        lunchEnd: `${newRecordForm.date}T${newRecordForm.lunchEnd}:00Z`,
        expectedMinutes: expected,
        type: 'WORK'
      };

      const { data: insertedRec, error: recError } = await supabase.from('records').insert([recordToInsert]).select().single();
      if (recError) throw recError;

      const worked = calculateWorkedMinutes(insertedRec as ClockRecord);
      await supabase.from('timeBank').insert([{
        employeeId: newRecordForm.employeeId,
        date: newRecordForm.date,
        minutes: worked - expected,
        type: 'WORK'
      }]);

      setIsNewRecordModalOpen(false);
      alert("Ponto lançado retroativamente com sucesso!");
      fetchData();
    } catch (err) {
      alert("Erro ao criar registro: Este dia já possui um registro?");
    }
  };

  const handleSaveRecordEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !editingRecord) return;

    try {
      const { error: recError } = await supabase.from('records').update(editingRecord).eq('id', editingRecord.id);
      if (recError) throw recError;

      if (editingRecord.clockIn && editingRecord.clockOut) {
        const worked = calculateWorkedMinutes(editingRecord);
        const delta = worked - editingRecord.expectedMinutes;
        
        await supabase.from('timeBank').upsert({
          employeeId: editingRecord.employeeId,
          date: editingRecord.date,
          minutes: delta,
          type: 'WORK'
        }, { onConflict: 'employeeId, date, type' });
      }

      setEditingRecord(null);
      alert("Registro atualizado e saldo recalculado!");
      fetchData();
    } catch (err) {
      alert("Erro ao salvar alterações.");
    }
  };

  const handleRetroSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !retroForm.employeeId) return;

    setIsSubmittingRetro(true);
    try {
      const lastDay = new Date(parseInt(retroForm.year), parseInt(retroForm.month) + 1, 0);
      const dateStr = lastDay.toISOString().split('T')[0];
      const minutes = parseTimeStringToMinutes(retroForm.balanceStr);

      await supabase.from('timeBank').insert([{
        employeeId: retroForm.employeeId,
        date: dateStr,
        minutes: minutes,
        type: 'ADJUSTMENT',
        note: `Saldo Retroativo: ${parseInt(retroForm.month)+1}/${retroForm.year}`
      }]);

      alert("Saldo importado com sucesso!");
      setRetroForm({ ...retroForm, balanceStr: '00:00' });
      fetchData();
    } catch (err) {
      alert("Erro ao lançar saldo retroativo.");
    } finally {
      setIsSubmittingRetro(false);
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

  const getNextAction = (record?: ClockRecord) => {
    if (!record?.clockIn) return { label: 'Entrada', stage: 'in', color: 'bg-indigo-600', icon: <LogIn size={20}/> };
    if (!record.lunchStart) return { label: 'Almoço', stage: 'l_start', color: 'bg-amber-600', icon: <Utensils size={20}/> };
    if (!record.lunchEnd) return { label: 'Retorno Almoço', stage: 'l_end', color: 'bg-emerald-600', icon: <Utensils size={20}/> };
    if (!record.snackStart) return { label: 'Lanche', stage: 's_start', color: 'bg-orange-500', icon: <Coffee size={20}/> };
    if (!record.snackEnd) return { label: 'Retorno Lanche', stage: 's_end', color: 'bg-emerald-600', icon: <Coffee size={20}/> };
    if (!record.clockOut) return { label: 'Encerrar Dia', stage: 'out', color: 'bg-rose-600', icon: <LogOut size={20}/> };
    return { label: 'Finalizado', stage: 'done', color: 'bg-slate-800', icon: <UserCheck size={20}/> };
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm("Remover este colaborador permanentemente?")) return;
    if (supabase) await supabase.from('employees').delete().eq('id', id);
  };

  const handleEditEmployee = (emp: Employee) => {
    setEditingEmployeeId(emp.id);
    setNewEmp({
      name: emp.name, role: emp.role, 
      dailyHours: (emp.baseDailyMinutes / 60).toString(),
      englishDay: emp.englishWeekDay.toString(),
      shortDayHours: (emp.englishWeekMinutes / 60).toString(),
      initialBalanceStr: formatMinutes(emp.initialBalanceMinutes).replace('h ', ':').replace('m', '').replace('+', '').replace('-', ''),
      isHourly: !!emp.isHourly
    });
    setActiveTab('employees');
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
    <div className="min-h-screen bg-slate-900 flex items-center justify-center flex-col gap-6">
      <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-white text-[10px] font-black uppercase tracking-[0.4em]">Sincronizando Nobel Cloud...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900 overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-[#1e293b] flex flex-col shadow-2xl z-40 border-r border-white/5 h-screen overflow-hidden">
        <div className="p-6 flex flex-col items-center gap-2 text-center">
          <div className="bg-indigo-500 p-3 rounded-[1.5rem] text-white shadow-xl shadow-indigo-500/20 rotate-3"><BookOpen size={24}/></div>
          <div>
            <span className="text-white font-black text-xl tracking-tighter block font-serif">Nobel Ponto</span>
            <span className="text-indigo-400 text-[8px] font-black uppercase tracking-[0.3em] mt-1 block">Petrópolis</span>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4 overflow-y-auto hide-scrollbar">
          <button onClick={() => { setActiveTab('clock'); setSelectedClockEmployeeId(null); setIsManagerAuthenticated(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-xs ${activeTab === 'clock' && !isManagerAuthenticated ? 'bg-white text-slate-900 shadow-2xl' : 'text-slate-400 hover:text-white'}`}>
            <ClockIcon size={18} /> <span>Registrar Ponto</span>
          </button>
          
          <div className="pt-4 mt-4 border-t border-white/5 space-y-1">
            <p className="px-4 pb-1 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Gerente</p>
            {[
              { id: 'dashboard', label: 'Painel', icon: <TrendingUp size={18}/> },
              { id: 'employees', label: 'Equipe', icon: <Users size={18}/> },
              { id: 'justifications', label: 'Justificativas', icon: <ClipboardCheck size={18}/> },
              { id: 'reports', label: 'Relatórios', icon: <FileText size={18}/> },
              { id: 'admin', label: 'Ajustes', icon: <Settings size={18}/> },
            ].map(item => (
              <button key={item.id} onClick={() => isManagerAuthenticated ? setActiveTab(item.id) : setIsLoginModalOpen(true)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-xs ${activeTab === item.id && isManagerAuthenticated ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'}`}>
                {item.icon} <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="p-4 border-t border-white/5 space-y-3">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${isConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}></div>
            <span>{isConnected ? 'Em Nuvem' : 'Offline'}</span>
          </div>
          
          <a href="#" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/5 transition-all">
            <Github size={14}/>
            <span>Ver no GitHub</span>
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen hide-scrollbar">
        <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-0.5">
            <h1 className="text-3xl font-black tracking-tighter text-slate-900 font-serif lowercase italic capitalize">
              {activeTab === 'clock' ? 'olá, bom dia' : activeTab === 'justifications' ? 'justificativas' : activeTab === 'reports' ? 'relatórios' : activeTab === 'dashboard' ? 'painel de controle' : activeTab}
            </h1>
            <p className="text-slate-400 font-medium text-xs tracking-wide">Livraria Nobel</p>
          </div>
          <div className="bg-white px-6 py-3 rounded-[2rem] shadow-sm border border-slate-200 text-right">
            <p className="text-3xl font-mono font-black text-slate-800 leading-none tracking-tighter">{currentTime.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</p>
            <p className="text-[9px] font-black text-indigo-500 uppercase tracking-[0.3em] mt-1.5">{currentTime.toLocaleDateString('pt-BR', {weekday: 'short', day:'2-digit', month:'short'})}</p>
          </div>
        </header>

        {activeTab === 'clock' && (
          <div className="animate-in fade-in zoom-in-95 duration-500">
            {!selectedClockEmployeeId ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {data.employees.map(emp => (
                  <button key={emp.id} onClick={() => setSelectedClockEmployeeId(emp.id)} className="bg-white p-6 rounded-[2.5rem] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all border border-slate-100 flex flex-col items-center group relative overflow-hidden">
                    <div className="w-14 h-14 bg-slate-50 text-slate-300 rounded-[1.2rem] flex items-center justify-center text-xl font-black group-hover:bg-indigo-600 group-hover:text-white mb-3 transition-all">{emp.name.charAt(0)}</div>
                    <span className="font-black text-slate-800 text-xs text-center line-clamp-1">{emp.name.split(' ')[0]}</span>
                    <span className="text-[8px] font-black text-slate-400 uppercase mt-1 tracking-widest">{emp.role}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="max-w-6xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                  <button onClick={() => setSelectedClockEmployeeId(null)} className="flex items-center gap-2 text-slate-400 font-black uppercase text-[10px] hover:text-indigo-600 transition-all"><ChevronLeft size={16}/> Voltar</button>
                  <button onClick={() => setIsHistoryModalOpen(true)} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-50 text-indigo-600 rounded-full font-black text-[9px] uppercase tracking-widest hover:bg-indigo-100 transition-all shadow-sm"><History size={14}/> Ver Histórico</button>
                </div>
                {data.employees.filter(e => e.id === selectedClockEmployeeId).map(emp => {
                  const todayStr = currentTime.toISOString().split('T')[0];
                  const rec = data.records.find(r => r.employeeId === emp.id && r.date === todayStr);
                  const action = getNextAction(rec);
                  return (
                    <div key={emp.id} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-8 bg-white p-8 rounded-[3.5rem] shadow-2xl border border-indigo-50 flex flex-col justify-between">
                        <div className="flex items-center gap-6 border-b border-slate-50 pb-6">
                          <div className="w-16 h-16 bg-indigo-600 text-white rounded-[1.5rem] flex items-center justify-center text-3xl font-black shadow-lg">{emp.name.charAt(0)}</div>
                          <div>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tighter font-serif italic">{emp.name}</h2>
                            <p className="text-indigo-500 text-[10px] font-black uppercase mt-1 tracking-widest">{emp.role}</p>
                          </div>
                        </div>
                        
                        {/* Status Grid - Melhorado para Mobile */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-8">
                          {[
                            { label: 'Entrada', time: rec?.clockIn },
                            { label: 'Almoço I', time: rec?.lunchStart },
                            { label: 'Almoço F', time: rec?.lunchEnd },
                            { label: 'Lanche I', time: rec?.snackStart },
                            { label: 'Lanche F', time: rec?.snackEnd },
                            { label: 'Saída', time: rec?.clockOut },
                          ].map((it, i) => (
                            <div key={i} className={`p-3.5 rounded-2xl border-2 text-center flex flex-col justify-center ${it.time ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
                              <span className="text-[8px] font-black uppercase mb-0.5 block opacity-60 leading-none">{it.label}</span>
                              <p className="text-sm sm:text-lg font-mono font-black leading-none">{formatTime(it.time || null)}</p>
                            </div>
                          ))}
                        </div>
                        
                        <button disabled={action.stage === 'done'} onClick={() => handleClockAction(emp.id)} className={`w-full py-6 rounded-[2.5rem] font-black text-xl shadow-xl transition-all flex items-center justify-center gap-4 ${action.color} text-white active:scale-95`}>
                          {action.icon} <span className="uppercase tracking-widest">{action.label}</span>
                        </button>
                      </div>
                      
                      <div className="lg:col-span-4 bg-slate-900 text-white p-8 rounded-[3rem] flex flex-col justify-center text-center shadow-xl">
                          <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">Saldo Acumulado</p>
                          <p className={`text-4xl sm:text-5xl font-mono font-black ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {isManagerAuthenticated && (
          <div className="animate-in slide-in-from-bottom-6 duration-500 space-y-8 pb-10">
            {activeTab === 'dashboard' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaboradores</p>
                  <p className="text-4xl font-black text-slate-800 mt-2 leading-none">{data.employees.length}</p>
                </div>
                <div className="bg-indigo-600 p-6 rounded-[2.5rem] shadow-xl text-white">
                  <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest">Saldo Total</p>
                  <p className="text-3xl font-mono font-black mt-2 leading-none">
                    {formatMinutes(data.employees.reduce((acc, emp) => acc + getCumulativeBalance(emp.id), 0))}
                  </p>
                </div>
                <div className="bg-slate-900 p-8 rounded-[3rem] text-white flex flex-col justify-center">
                  <h3 className="text-sm font-black uppercase text-indigo-400 mb-2 flex items-center gap-2"><Sparkles size={14}/> Nobel AI</h3>
                  <p className="text-[10px] italic text-indigo-100 leading-relaxed line-clamp-2">{aiInsights || "Pronto para análise."}</p>
                  <button onClick={analyzeWithAI} disabled={isAnalyzing} className="mt-3 px-4 py-2 bg-white text-slate-900 rounded-full font-black text-[8px] uppercase tracking-widest self-start">{isAnalyzing ? '...' : 'Analisar'}</button>
                </div>
              </div>
            )}

            {activeTab === 'justifications' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-5 space-y-8">
                  <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-indigo-50">
                    <h2 className="text-lg font-black text-slate-900 mb-6 font-serif italic flex items-center gap-3"><ClipboardCheck size={20} className="text-indigo-500"/> Abonos</h2>
                    <form onSubmit={handleJustificationSubmit} className="space-y-4">
                      <select required value={justificationForm.employeeId} onChange={e => setJustificationForm({...justificationForm, employeeId: e.target.value})} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-bold text-xs">
                        <option value="">Selecionar Colaborador...</option>
                        {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        {['MEDICAL', 'VACATION', 'HOLIDAY', 'ADJUSTMENT'].map(type => (
                          <button key={type} type="button" onClick={() => setJustificationForm({...justificationForm, type: type as EntryType})} className={`p-3 rounded-xl border-2 font-black text-[8px] uppercase transition-all ${justificationForm.type === type ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-slate-50 bg-slate-50 text-slate-400'}`}>
                            {type === 'MEDICAL' ? 'Atestado' : type === 'VACATION' ? 'Férias' : type === 'HOLIDAY' ? 'Feriado' : 'Ajuste'}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <input type="date" value={justificationForm.startDate} onChange={e => setJustificationForm({...justificationForm, startDate: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-bold text-xs"/>
                        <input type="date" value={justificationForm.endDate} onChange={e => setJustificationForm({...justificationForm, endDate: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-bold text-xs"/>
                      </div>
                      <button type="submit" className="w-full py-4 bg-indigo-600 text-white rounded-full font-black uppercase text-[9px] shadow-xl">Lançar Período</button>
                    </form>
                  </div>

                  <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl text-white">
                    <h2 className="text-lg font-black mb-6 font-serif italic flex items-center gap-3 text-indigo-400"><History size={20}/> Saldo em Massa</h2>
                    <form onSubmit={handleRetroSubmit} className="space-y-4">
                      <select required value={retroForm.employeeId} onChange={e => setRetroForm({...retroForm, employeeId: e.target.value})} className="w-full p-4 rounded-2xl bg-white/5 border-2 border-white/10 font-bold text-white text-xs">
                        <option value="" className="text-slate-900">Selecionar...</option>
                        {data.employees.map(e => <option key={e.id} value={e.id} className="text-slate-900">{e.name}</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-3">
                        <select value={retroForm.month} onChange={e => setRetroForm({...retroForm, month: e.target.value})} className="w-full p-3 rounded-xl bg-white/5 border-2 border-white/10 font-bold text-xs">
                          {['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map((m, i) => <option key={i} value={i} className="text-slate-900">{m}</option>)}
                        </select>
                        <input type="number" value={retroForm.year} onChange={e => setRetroForm({...retroForm, year: e.target.value})} className="w-full p-3 rounded-xl bg-white/5 border-2 border-white/10 font-bold text-center text-xs"/>
                      </div>
                      <input required value={retroForm.balanceStr} onChange={e => setRetroForm({...retroForm, balanceStr: e.target.value})} className="w-full p-4 rounded-2xl bg-indigo-500/20 border-2 border-indigo-500/30 text-center font-mono text-xl font-black text-indigo-300" placeholder="00:00"/>
                      <button type="submit" disabled={isSubmittingRetro} className="w-full py-4 bg-indigo-50 text-indigo-900 rounded-full font-black uppercase text-[9px] shadow-xl">
                        {isSubmittingRetro ? '...' : 'Importar'}
                      </button>
                    </form>
                  </div>
                </div>

                <div className="lg:col-span-7 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-base font-black font-serif italic">Últimos Lançamentos</h3>
                    <button onClick={() => setIsNewRecordModalOpen(true)} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 text-white rounded-full font-black text-[9px] uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-md"><Plus size={14}/> Novo Registro</button>
                  </div>
                  <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                    <div className="max-h-[500px] overflow-y-auto hide-scrollbar">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="p-4 text-[9px] font-black uppercase text-slate-400">Funcionário</th>
                            <th className="p-4 text-[9px] font-black uppercase text-slate-400">Tipo</th>
                            <th className="p-4 text-[9px] font-black uppercase text-slate-400">Saldo</th>
                            <th className="p-4 text-[9px] font-black uppercase text-slate-400">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {data.timeBank.filter(t => t.type !== 'WORK').slice(0, 15).map(entry => {
                             const emp = data.employees.find(e => e.id === entry.employeeId);
                             return (
                               <tr key={entry.id} className="hover:bg-slate-50/50">
                                 <td className="p-4">
                                   <p className="text-[10px] font-black text-slate-800">{emp?.name || '---'}</p>
                                   <p className="text-[8px] font-bold text-slate-400">{new Date(entry.date + "T00:00:00").toLocaleDateString()}</p>
                                 </td>
                                 <td className="p-4">
                                   <span className={`px-2 py-1 rounded-md text-[8px] font-black uppercase ${entry.type === 'ADJUSTMENT' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-500'}`}>{entry.type}</span>
                                 </td>
                                 <td className={`p-4 text-[10px] font-mono font-black ${entry.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(entry.minutes)}</td>
                                 <td className="p-4">
                                   <button onClick={() => handleDeleteTimeBankEntry(entry.id)} className="p-2 text-slate-200 hover:text-rose-600 transition-all">
                                     <Trash2 size={16}/>
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
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="space-y-6">
                <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-indigo-50">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-black font-serif italic flex items-center gap-3"><Search size={20} className="text-indigo-500"/> Registros Diários</h2>
                    <div className="flex gap-2">
                      <button onClick={() => exportToCSV(data.records, `ponto_nobel`)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-full font-black uppercase text-[8px] flex items-center gap-1.5 hover:bg-slate-200 transition-all"><Download size={14}/> CSV</button>
                    </div>
                  </div>
                  
                  <div className="overflow-x-auto rounded-2xl border border-slate-100 max-h-[600px] overflow-y-auto hide-scrollbar">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="p-4 text-[9px] font-black uppercase text-slate-400">Data / Colab.</th>
                          <th className="p-4 text-[9px] font-black uppercase text-slate-400">Entrada</th>
                          <th className="p-4 text-[9px] font-black uppercase text-slate-400">Intervalo</th>
                          <th className="p-4 text-[9px] font-black uppercase text-slate-400">Saída</th>
                          <th className="p-4 text-[9px] font-black uppercase text-slate-400">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {data.records.slice(0, 30).map(rec => {
                          const emp = data.employees.find(e => e.id === rec.employeeId);
                          return (
                            <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                              <td className="p-4">
                                <p className="text-[10px] font-black text-slate-800">{emp?.name || '---'}</p>
                                <p className="text-[8px] font-bold text-slate-400">{new Date(rec.date + "T00:00:00").toLocaleDateString()}</p>
                              </td>
                              <td className="p-4 text-[10px] font-mono font-bold">{formatTime(rec.clockIn)}</td>
                              <td className="p-4 text-[9px] font-mono text-slate-400">
                                {formatTime(rec.lunchStart)} - {formatTime(rec.lunchEnd)}
                              </td>
                              <td className="p-4 text-[10px] font-mono font-bold">{formatTime(rec.clockOut)}</td>
                              <td className="p-4">
                                <button onClick={() => setEditingRecord(rec)} className="p-2 text-indigo-300 hover:text-indigo-600 transition-all">
                                  <Edit2 size={16}/>
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

            {activeTab === 'employees' && (
              <div className="space-y-8">
                <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-indigo-50">
                   <h2 className="text-xl font-black text-slate-900 mb-6 font-serif italic flex items-center gap-3"><UserPlus size={20}/> {editingEmployeeId ? 'Editar' : 'Novo Funcionário'}</h2>
                   <form onSubmit={async (e) => {
                     e.preventDefault();
                     if (!supabase) return;
                     const dailyMin = parseInt(newEmp.dailyHours) * 60;
                     const shortMin = parseInt(newEmp.shortDayHours) * 60;
                     const payload = { 
                       name: newEmp.name, role: newEmp.role, baseDailyMinutes: dailyMin,
                       englishWeekDay: parseInt(newEmp.englishDay), englishWeekMinutes: shortMin,
                       initialBalanceMinutes: parseTimeStringToMinutes(newEmp.initialBalanceStr), 
                       isHourly: newEmp.isHourly
                     };
                     if (editingEmployeeId) await supabase.from('employees').update(payload).eq('id', editingEmployeeId);
                     else await supabase.from('employees').insert([payload]);
                     
                     setNewEmp({ name:'', role:'', dailyHours:'8', englishDay:'6', shortDayHours:'4', initialBalanceStr:'00:00', isHourly:false });
                     setEditingEmployeeId(null);
                     fetchData();
                   }} className="space-y-6">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input required value={newEmp.name} onChange={e => setNewEmp({...newEmp, name: e.target.value})} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-bold text-xs" placeholder="Nome Completo"/>
                        <input required value={newEmp.role} onChange={e => setNewEmp({...newEmp, role: e.target.value})} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-bold text-xs" placeholder="Cargo/Função"/>
                     </div>
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Hrs/Dia</label>
                          <input type="number" value={newEmp.dailyHours} onChange={e => setNewEmp({...newEmp, dailyHours: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-black text-center text-xs" placeholder="8"/>
                        </div>
                        <div>
                          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Dia Curto</label>
                          <select value={newEmp.englishDay} onChange={e => setNewEmp({...newEmp, englishDay: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-black text-xs">
                            {WEEK_DAYS_BR.map((d, i) => <option key={i} value={i}>{d}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Hrs Curto</label>
                          <input type="number" value={newEmp.shortDayHours} onChange={e => setNewEmp({...newEmp, shortDayHours: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-black text-center text-xs" placeholder="4"/>
                        </div>
                        <div>
                          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Saldo Inic.</label>
                          <input value={newEmp.initialBalanceStr} onChange={e => setNewEmp({...newEmp, initialBalanceStr: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-black text-center text-xs" placeholder="00:00"/>
                        </div>
                     </div>
                     <div className="flex gap-2">
                        <button type="submit" className="px-8 py-3 bg-indigo-600 text-white rounded-full font-black uppercase text-[9px] shadow-lg">{editingEmployeeId ? 'Atualizar' : 'Salvar'}</button>
                        {editingEmployeeId && <button type="button" onClick={() => setEditingEmployeeId(null)} className="px-8 py-3 bg-slate-200 text-slate-600 rounded-full font-black uppercase text-[9px]">Cancelar</button>}
                     </div>
                   </form>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                   {data.employees.map(emp => (
                     <div key={emp.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative group transition-all hover:shadow-md">
                        <div className="flex justify-between items-start mb-3">
                           <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-black text-sm">{emp.name.charAt(0)}</div>
                           <div className="flex gap-1">
                              <button onClick={() => handleEditEmployee(emp)} className="p-1.5 text-slate-300 hover:text-indigo-600 transition-all"><Edit2 size={14}/></button>
                              <button onClick={() => handleDeleteEmployee(emp.id)} className="p-1.5 text-slate-300 hover:text-rose-600 transition-all"><Trash2 size={14}/></button>
                           </div>
                        </div>
                        <h3 className="font-black text-slate-800 text-xs">{emp.name}</h3>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{emp.role}</p>
                        <div className="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center">
                           <span className="text-[8px] font-black uppercase text-slate-400">Saldo</span>
                           <span className={`text-[10px] font-mono font-black ${getCumulativeBalance(emp.id) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(getCumulativeBalance(emp.id))}</span>
                        </div>
                     </div>
                   ))}
                </div>
              </div>
            )}

            {activeTab === 'admin' && (
              <div className="max-w-xs mx-auto bg-white p-8 rounded-[3rem] shadow-xl border border-indigo-50">
                   <h2 className="text-lg font-black text-slate-900 mb-6 font-serif italic flex items-center gap-3"><Lock size={20}/> PIN Gerente</h2>
                   <input type="password" maxLength={4} value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))} className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 font-black text-center text-2xl mb-4" placeholder="••••"/>
                   <button onClick={async () => {
                     if (newPin.length !== 4) return;
                     if (supabase) await supabase.from('settings').upsert({ id: 1, managerPin: newPin });
                     setNewPin(''); alert("PIN alterado!");
                     fetchData();
                   }} className="w-full py-4 bg-slate-900 text-white rounded-full font-black uppercase text-[9px]">Salvar</button>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Modal Histórico do Funcionário */}
      {isHistoryModalOpen && selectedClockEmployeeId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-4">
          <div className="bg-white w-full max-w-2xl max-h-[85vh] p-8 rounded-[3rem] shadow-2xl relative flex flex-col animate-in slide-in-from-bottom-10 duration-500">
            <button onClick={() => setIsHistoryModalOpen(false)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-900"><X size={20}/></button>
            <h2 className="text-2xl font-black font-serif italic mb-6">Meu Histórico</h2>
            <div className="flex-1 overflow-y-auto pr-2 hide-scrollbar">
              <table className="w-full text-left">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="p-3 text-[9px] font-black uppercase text-slate-400">Data</th>
                    <th className="p-3 text-[9px] font-black uppercase text-slate-400">Horários</th>
                    <th className="p-3 text-[9px] font-black uppercase text-slate-400">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.records.filter(r => r.employeeId === selectedClockEmployeeId).slice(0, 31).map(rec => {
                    const worked = calculateWorkedMinutes(rec);
                    const delta = worked - rec.expectedMinutes;
                    return (
                      <tr key={rec.id}>
                        <td className="p-3 font-black text-[10px]">{new Date(rec.date + "T00:00:00").toLocaleDateString('pt-BR', {day: '2-digit', month: 'short'})}</td>
                        <td className="p-3 font-mono text-[9px] text-slate-500">
                          {formatTime(rec.clockIn)} - {formatTime(rec.clockOut)}
                        </td>
                        <td className={`p-3 font-mono font-black text-[10px] ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(delta)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-6 pt-6 border-t border-slate-100 flex justify-between items-center">
               <p className="text-[10px] font-black uppercase text-slate-400">Total</p>
               <p className={`text-2xl font-mono font-black ${getCumulativeBalance(selectedClockEmployeeId) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(getCumulativeBalance(selectedClockEmployeeId))}</p>
            </div>
          </div>
        </div>
      )}

      {/* Modal Novo Registro Manual */}
      {isNewRecordModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-4">
          <div className="bg-white w-full max-w-sm p-8 rounded-[3rem] shadow-2xl relative animate-in zoom-in-95 duration-300">
             <button onClick={() => setIsNewRecordModalOpen(false)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-900"><X size={20}/></button>
             <h2 className="text-xl font-black font-serif italic mb-6 text-emerald-600">Manual</h2>
             <form onSubmit={handleCreateNewRecord} className="space-y-4">
                <select required value={newRecordForm.employeeId} onChange={e => setNewRecordForm({...newRecordForm, employeeId: e.target.value})} className="w-full p-3.5 rounded-xl bg-slate-50 border-2 border-slate-100 font-bold text-xs">
                  <option value="">Colaborador...</option>
                  {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <input type="date" value={newRecordForm.date} onChange={e => setNewRecordForm({...newRecordForm, date: e.target.value})} className="w-full p-3.5 rounded-xl bg-slate-50 border-2 border-slate-100 font-bold text-xs"/>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[8px] font-black uppercase text-slate-400 mb-1 block">In</label>
                    <input type="time" value={newRecordForm.clockIn} onChange={e => setNewRecordForm({...newRecordForm, clockIn: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-bold text-center text-xs"/>
                  </div>
                  <div>
                    <label className="text-[8px] font-black uppercase text-slate-400 mb-1 block">Out</label>
                    <input type="time" value={newRecordForm.clockOut} onChange={e => setNewRecordForm({...newRecordForm, clockOut: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-bold text-center text-xs"/>
                  </div>
                </div>
                <button type="submit" className="w-full py-4 bg-emerald-500 text-white rounded-full font-black uppercase text-[9px] shadow-xl">Criar</button>
             </form>
          </div>
        </div>
      )}

      {/* Modal Editar Registro */}
      {editingRecord && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-lg p-10 rounded-[4rem] shadow-2xl relative animate-in zoom-in-95 duration-300">
            <button onClick={() => setEditingRecord(null)} className="absolute top-8 right-8 text-slate-300 hover:text-slate-900"><X size={20}/></button>
            <h2 className="text-2xl font-black font-serif italic mb-8 text-indigo-600">Ajustar</h2>
            <form onSubmit={handleSaveRecordEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Entrada</label>
                  <input type="datetime-local" value={editingRecord.clockIn ? new Date(editingRecord.clockIn).toISOString().slice(0, 16) : ''} onChange={e => setEditingRecord({...editingRecord, clockIn: e.target.value ? new Date(e.target.value).toISOString() : null})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-bold text-xs"/>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Saída</label>
                  <input type="datetime-local" value={editingRecord.clockOut ? new Date(editingRecord.clockOut).toISOString().slice(0, 16) : ''} onChange={e => setEditingRecord({...editingRecord, clockOut: e.target.value ? new Date(e.target.value).toISOString() : null})} className="w-full p-3 rounded-xl bg-slate-50 border-2 border-slate-100 font-bold text-xs"/>
                </div>
              </div>
              <button type="submit" className="w-full py-4 bg-indigo-600 text-white rounded-full font-black uppercase text-[9px] shadow-xl">Salvar Ajuste</button>
            </form>
          </div>
        </div>
      )}

      {/* Modal PIN Login */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-md animate-in fade-in duration-300">
           <div className="bg-white w-full max-w-[320px] p-10 rounded-[4rem] shadow-2xl relative">
              <button onClick={() => setIsLoginModalOpen(false)} className="absolute top-8 right-8 text-slate-300 hover:text-slate-900 transition-colors"><X size={20}/></button>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-[1.8rem] flex items-center justify-center mx-auto mb-4"><Lock size={28}/></div>
                <h2 className="text-xl font-black font-serif italic lowercase">gerente</h2>
              </div>
              <div className="flex justify-center gap-3 mb-8">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-2.5 h-2.5 rounded-full ${pinInput.length > i ? 'bg-indigo-600 scale-125' : 'bg-slate-100'} ${loginError ? 'bg-rose-500' : ''}`}></div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {['1','2','3','4','5','6','7','8','9','C','0','<'].map(v => (
                  <button key={v} onClick={() => v === 'C' ? setPinInput('') : v === '<' ? setPinInput(p => p.slice(0,-1)) : handlePinDigit(v)} className="h-14 rounded-2xl font-black text-lg bg-slate-50 text-slate-600 hover:bg-white border-2 border-slate-50 hover:border-indigo-100 transition-all flex items-center justify-center active:scale-90">{v}</button>
                ))}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;