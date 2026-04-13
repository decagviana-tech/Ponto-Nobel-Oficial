
import csv
from datetime import datetime, timedelta
import collections

def parse_time(t_str):
    if not t_str or t_str == '---' or t_str == '--:--':
        return None
    try:
        return datetime.strptime(t_str, '%H:%M')
    except:
        return None

def parse_delta(d_str):
    if not d_str or d_str == '---' or d_str == 'Abonado/Neutro':
        return 0
    # format: +08h 00m or -00h 15m
    try:
        is_neg = d_str.startswith('-')
        clean = d_str.replace('+', '').replace('-', '').replace('h', '').replace('m', '').strip()
        parts = clean.split()
        if len(parts) == 2:
            h = int(parts[0])
            m = int(parts[1])
            total = h * 60 + m
            return -total if is_neg else total
    except:
        pass
    return 0

def format_minutes(minutes):
    is_neg = minutes < 0
    abs_m = abs(minutes)
    h = abs_m // 60
    m = abs_m % 60
    return f"{'-' if is_neg else '+'}{h:02d}h {m:02d}m"

# Path to the CSV
csv_path = r'c:\ponto e banco\Relatorio_Nobel_Completo_12-04-2026.csv'

employees_data = collections.defaultdict(list)

try:
    with open(csv_path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            employees_data[row['Funcionário']].append(row)
except Exception as e:
    print(f"Error reading CSV: {e}")
    exit(1)

report = []

for emp_name, rows in employees_data.items():
    # Sort by date
    rows.sort(key=lambda x: datetime.strptime(x['Data'], '%d/%m/%Y'))
    
    # Journey identification
    metas = [parse_delta(r['Meta do Dia']) for r in rows if r['Meta do Dia'] != '---']
    avg_meta = sum(metas) / len(metas) if metas else 0
    journey_type = "44h" if avg_meta > 300 else "30h" # Simple heuristic: if meta avg > 5h, likely 44h regular
    
    # Special case for Milena if meta is 0
    if emp_name == "Milena":
        journey_type = "44h" # Based on observed patterns in CSV
    
    weekly_stats = collections.defaultdict(lambda: {
        'worked': 0, 
        'meta': 44*60 if journey_type == "44h" else 30*60, 
        'days': [],
        'adj_days': [],
        'incomplete_days': []
    })
    
    monthly_stats = collections.defaultdict(int)
    total_period = 0
    
    observations = []
    
    for row in rows:
        date_obj = datetime.strptime(row['Data'], '%d/%m/%Y')
        # ISO week
        week_key = f"{date_obj.year}-W{date_obj.isocalendar()[1]:02d}"
        month_key = f"{date_obj.year}-{date_obj.month:02d}"
        
        worked = parse_delta(row['Total Trabalhado'])
        adjusted = parse_delta(row['Horas de Ajuste'])
        total_day = worked + adjusted
        
        # Check if batidas are incomplete
        clocks = [row['Entrada'], row['Início Almoço'], row['Retorno Almoço'], row['Início Lanche'], row['Retorno Lanche'], row['Saída Final']]
        incomplete = '---' in clocks or '--:--' in clocks
        # BUT check if they are all '---'
        all_missing = all(c == '---' or c == '--:--' for c in clocks)
        
        if incomplete and not all_missing:
            weekly_stats[week_key]['incomplete_days'].append(row['Data'])
            
        if row['Horas de Ajuste'] != '---' and adjusted != 0:
             weekly_stats[week_key]['adj_days'].append((row['Data'], row['Horas de Ajuste'], row['Justificativas / Abonos']))

        weekly_stats[week_key]['worked'] += total_day
        weekly_stats[week_key]['days'].append({
            'date': row['Data'],
            'total': total_day,
            'incomplete': incomplete and not all_missing,
            'all_missing': all_missing,
            'adjustment': adjusted,
            'note': row['Justificativas / Abonos']
        })
        
        monthly_stats[month_key] += total_day
        total_period += total_day

    # Generate Report Section
    emp_report = {
        'name': emp_name,
        'journey': journey_type,
        'weeks': [],
        'months': [],
        'total': total_period,
        'obs': []
    }
    
    for wk, data in sorted(weekly_stats.items()):
        balance = data['worked'] - data['meta']
        data['balance'] = balance
        emp_report['weeks'].append({
            'week': wk,
            'worked': data['worked'],
            'meta': data['meta'],
            'balance': balance,
            'incomplete': data['incomplete_days'],
            'adjustments': data['adj_days']
        })
        
    for mo, val in sorted(monthly_stats.items()):
        emp_report['months'].append({'month': mo, 'total': val})
        
    # Standard check for inconsistencies
    for row in rows:
        # Padrão: Entrada muito tarde ou saída muito cedo
        entrada = parse_time(row['Entrada'])
        if entrada and entrada.hour >= 11:
            emp_report['obs'].append(f"Horário fora do padrão: Entrada em {row['Data']} às {row['Entrada']}")
        
        # Inconsistência real: Batida existe mas ajuste manual é grande sem motivo claro
        worked = parse_delta(row['Total Trabalhado'])
        adjusted = parse_delta(row['Horas de Ajuste'])
        if worked > 0 and adjusted > 240: # Mais de 4h de ajuste manual num dia que trabalhou
            emp_report['obs'].append(f"Ajuste manual expressivo (+{format_minutes(adjusted)}) em dia com batidas: {row['Data']}")

    report.append(emp_report)

# Output format
for emp in report:
    print(f"\nNome do funcionário: {emp['name']}")
    print(f"Tipo de jornada: {emp['journey']}")
    print("-" * 30)
    print("RESUMO SEMANAL:")
    for wk in emp['weeks']:
        print(f"Semana {wk['week']}: Total {format_minutes(wk['worked'])} / Meta {format_minutes(wk['meta'])} | Saldo: {format_minutes(wk['balance'])}")
        if wk['incomplete']:
            print(f"  > Dias com batidas incompletas: {', '.join(wk['incomplete'])}")
        if wk['adjustments']:
            # print(f"  > Ajustes manuais: {len(wk['adjustments'])} registros")
            for d, val, note in wk['adjustments']:
                 print(f"  > Ajuste em {d}: {val} ({note})")
    
    print("-" * 30)
    print("RESUMO MENSAL:")
    for mo in emp['months']:
        print(f"Mês {mo['month']}: {format_minutes(mo['total'])}")
        
    print(f"TOTAL ACUMULADO NO PERÍODO: {format_minutes(emp['total'])}")
    
    if emp['obs']:
        print("-" * 30)
        print("OBSERVAÇÕES E INCONSISTÊNCIAS:")
        for o in set(emp['obs']):
            print(f"- {o}")
    print("=" * 50)
