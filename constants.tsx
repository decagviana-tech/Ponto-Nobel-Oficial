
import React from 'react';
import { 
  Users, 
  Clock, 
  FileText, 
  Settings, 
  TrendingUp, 
  Calendar,
  BookOpen,
  LogOut,
  UserPlus,
  Download
} from 'lucide-react';

export const NAVIGATION_ITEMS = [
  { id: 'dashboard', label: 'Painel', icon: <TrendingUp size={20} /> },
  { id: 'employees', label: 'Funcionários', icon: <Users size={20} /> },
  { id: 'clock', label: 'Registrar Ponto', icon: <Clock size={20} /> },
  { id: 'reports', label: 'Relatórios', icon: <FileText size={20} /> },
  { id: 'admin', label: 'Configurações', icon: <Settings size={20} /> },
];

export const WEEK_DAYS_BR = [
  'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'
];

export const ICONS = {
  BookOpen,
  LogOut,
  UserPlus,
  Calendar,
  Download,
  Clock
};
