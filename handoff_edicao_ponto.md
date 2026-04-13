# Handoff: Atualização de Edição Manual de Ponto (Ponto-Nobel)

## 📌 Contexto e Problema Analisado
A gerência relatou confusão com os cálculos do banco de horas ao lidar com "esquecimentos" ou "batidas erradas" (ex: caso da Patrícia que ficou com 12 horas extras após a exclusão da batida).
- **A Causa:** O app deduz horas diárias (meta) apenas ao encerrar o dia. Se uma batida for **excluída** no dia atual, ela não é penalizada imediatamente, mas se for adicionado um **Ajuste Manual**, esse ajuste soma +X horas imediatamente (aparecendo como horas extras no dia atual e sendo balanceado apenas no dia seguinte).
- **Conclusão:** O sistema matemático subjacente está fazendo o balanço corretamente, mas a experiência do usuário de usar "Apagar Batida" + "Ajuste de Saldo de Horas Extras" para suprir o esquecimento de um ponto normal é muito confusa para quem gere o RH diariamente.

## 🎯 Objetivo da Próxima Sessão
Criar um processo intuitivo para que a gerência possa **Corrigir/Editar os Horários** de quem esqueceu de bater o ponto, preservando a matemática da `metaDoDia`, sem precisar colocar horas no "Ajuste Manual".

## 🛠 Plano de Implementação (O que Fazer a Seguir)
Quando voltarmos nessa tarefa em `App.tsx`:
1. **Nova Seção de UI (Modal ou Expansão na Tabela):**
   - Na aba **Relatórios** (ou na lista de histórico do funcionário), onde já existe o botão de excluir 🗑️ batidas (`handleDeleteFullRecord`), vamos incluir um botão de editar 📝.
2. **Campos a Editar no `ClockRecord`:**
   - O gerente poderá introduzir/editar textos como `"09:00"`, `"13:00"`.
   - Modificaremos as propriedades `clockIn`, `lunchStart`, `lunchEnd`, `snackStart`, `snackEnd`, e `clockOut`.
3. **Lógica de Salvamento e Recálculo no Supabase (`App.tsx`):**
   - Converter os horários submetidos para o formato ISO local com fuso (`getLocalISOString`).
   - Fazer um `UPDATE` no registro em `records`.
   - Executar um `calculateWorkedMinutes` com a nova informação, calcular a nova diferença (`worked - expectedMinutes`) de horas extras do dia.
   - Atualizar a entrada correspondente com o tipo de `'WORK'` atrelada àquela data no `timeBank`.
4. **Verificação da Funcionalidade:**
   - Garantir que não haja quebras para horistas VS CLT.
   - Validar se o formato manual em Horas (09:00) será convertido corretamente pelo `utils.ts`.

---
*Pronto para iniciar! No seu próximo prompt, basta pedir para começarmos a implementar a edição manual seguindo este Handoff.*
