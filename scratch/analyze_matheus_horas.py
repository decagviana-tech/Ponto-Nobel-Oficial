import csv
import re

def parse_time(time_str):
    if time_str == '---' or pd.isna(time_str):
        return 0
    # +00h 40m
    match = re.match(r'([+-])(\d{2})h (\d{2})m', time_str)
    if match:
        sign = 1 if match.group(1) == '+' else -1
        hours = int(match.group(2))
        minutes = int(match.group(3))
        return sign * (hours * 60 + minutes)
    
    # 09:41
    match = re.match(r'(\d{2}):(\d{2})', time_str)
    if match:
        hours = int(match.group(1))
        minutes = int(match.group(2))
        return hours * 60 + minutes
        
    return 0
    
def format_time(minutes):
    sign = '+' if minutes >= 0 else '-'
    minutes = abs(minutes)
    h = minutes // 60
    m = minutes % 60
    return f"{sign}{h:02d}h {m:02d}m"

total_saldo = 0
total_ajuste = 0
total_ajuste_externo = 0
externo_saldo = 0

with open(r'c:\Users\LEONARDO\OneDrive\Área de Trabalho\ponto\Relatorio_Nobel_Completo_16-04-2026.csv', encoding='utf-8') as f:
    reader = csv.DictReader(f, delimiter=';')
    for row in reader:
        saldo_min = parse_time(row['Saldo do Dia'])
        total_saldo += saldo_min
        
        ajuste_min = parse_time(row['Horas de Ajuste'])
        if row['Horas de Ajuste'] != '---' and row['Horas de Ajuste'] != 'Abonado/Neutro':
             total_ajuste += ajuste_min
             
        # Check if external / manual adjustment
        just = row['Justificativas / Abonos']
        if 'Ajuste Manual' in just and ('evento' in just.lower() or 'páscoa' in just.lower() or 'alceu' in just.lower() or 'médico' in just.lower() or 'botafogo' in just.lower()):
            total_ajuste_externo += ajuste_min
            externo_saldo += saldo_min
            print(f"{row['Data']} | Meta: {row['Meta do Dia']} | Ajuste: {row['Horas de Ajuste']} | Saldo: {row['Saldo do Dia']} | Just: {just}")
            
print(f"\nTotal Saldo Matheus: {format_time(total_saldo)}")
print(f"Total Horas Ajustadas (Geral): {format_time(total_ajuste)}")
print(f"Total Saldo em dias de Ajuste por Evento/Externo: {format_time(externo_saldo)}")

