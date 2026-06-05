    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
    const money = (cents) => (Number(cents || 0) / 100).toFixed(2);
    const increaseTypes = new Set(['收入', '借入', '收款']);
    const decreaseTypes = new Set(['支出', '借出', '还款']);
    let pendingAnimating = false;
    let entries = [];
    let accountBalances = [];
    let debtBalances = [];
    let pendingItems = [];
    let categoryOptions = [];
    let categoryTree = {};
    let accountOptions = [];
    let accountFilterOptions = [];
    let keywordRules = [];
    let summaryData = null;
    let periodMode = 'month';
    let cycleMode = 'quarter';
    let selectedCycleIndex = 0;
    let yearOffset = 0;
    let monthOffset = 0;
    let customStart = '';
    let customEnd = '';
    let periodInitialized = false;
    let activeDateTarget = null;
    let pickerMonth = new Date();
    let entryPage = 1;
    let entryPageSize = localStorage.getItem('bookkeeping.entryPageSize') || '50';
    let editingEntryId = null;
    let entryFilters = {year: '', month: '', day: '', type: '', category: '', account: '', transaction_object: '', tone: '', start: '', end: ''};
    let entryTypes = [];
    let pendingDelete = null;
    let pendingCategoryDelete = null;
    let pendingDebtDelete = null;
    let pendingAccountDelete = null;
    let pendingSuggestionCache = {};
    let pendingSkippedIds = JSON.parse(localStorage.getItem('bookkeeping.pendingSkippedIds') || '[]');
    let expenseCategoryLevel = localStorage.getItem('bookkeeping.expenseCategoryLevel') || 'major';
    let editingCategoryKey = null;
    let addingKeywordKey = null;
    let editingAccountName = null;
    let editingAccountBalanceName = null;

    async function api(path, options) {
      const requestOptions = {...(options || {}), cache: 'no-store'};
      const res = await fetch(path, requestOptions);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);
      return data;
    }

    function savePendingSkippedIds() {
      localStorage.setItem('bookkeeping.pendingSkippedIds', JSON.stringify(pendingSkippedIds));
    }

    function orderPendingItems(items) {
      const itemKey = item => String(item.ui_id || item.id);
      const availableIds = new Set(items.map(itemKey));
      pendingSkippedIds = pendingSkippedIds.filter(id => availableIds.has(String(id)));
      savePendingSkippedIds();
      const skippedIndex = new Map(pendingSkippedIds.map((id, index) => [String(id), index]));
      return [...items].sort((a, b) => {
        const ai = skippedIndex.has(itemKey(a)) ? skippedIndex.get(itemKey(a)) : -1;
        const bi = skippedIndex.has(itemKey(b)) ? skippedIndex.get(itemKey(b)) : -1;
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return -1;
        if (bi === -1) return 1;
        return ai - bi;
      });
    }

    function signedMoney(cents, tone = 'neutral') {
      const value = Math.abs(Number(cents || 0)) / 100;
      const sign = tone === 'income' ? '+' : tone === 'expense' ? '-' : Number(cents || 0) < 0 ? '-' : '+';
      return `${sign}${value.toFixed(2)}`;
    }

    function balanceMoney(cents) {
      const value = Number(cents || 0) / 100;
      return value < 0 ? `-${Math.abs(value).toFixed(2)}` : value.toFixed(2);
    }

    function moneyTone(row) {
      if (!row) return 'neutral';
      if (row.type === '余额修正') return 'neutral';
      if (increaseTypes.has(row.type)) return 'income';
      if (decreaseTypes.has(row.type)) return 'expense';
      return 'neutral';
    }

    function reportableEntry(row) {
      return row && row.type !== '转账' && row.type !== '余额修正' && row.category !== '转账';
    }

    function moneyClass(_value, row) {
      const tone = moneyTone(row);
      return `money-cell ${tone === 'income' ? 'income' : tone === 'expense' ? 'expense' : 'neutral-money'}`;
    }

    function signedEntryMoney(cents, row) {
      return signedMoney(cents, moneyTone(row));
    }

    function amountValue(cents) {
      return (Math.abs(Number(cents || 0)) / 100).toFixed(2);
    }

    function nowDatetimeLocal() {
      const date = new Date();
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      return date.toISOString().slice(0, 16);
    }

    function datetimeInputValue(value) {
      return String(value || '').replace(' ', 'T').slice(0, 16);
    }

    function optionsHtml(options, selected, allowBlank = false) {
      const values = [...new Set(options.filter(value => value !== undefined && value !== null && String(value).trim() !== '').map(String))];
      if (selected && !values.includes(String(selected))) values.unshift(String(selected));
      const blank = allowBlank ? '<option value=""></option>' : '';
      return blank + values.map(value => `<option value="${esc(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${esc(value)}</option>`).join('');
    }

    function categoryLabel(category) {
      return String(category || '').replaceAll('/', '·');
    }

    function majorCategory(category) {
      const value = String(category || '').trim();
      if (!value || value === '未分类') return '未分类';
      return value.split('/')[0] || value;
    }

    function categoryOptionsHtml(options, selected, allowBlank = false) {
      const values = [...new Set(options.filter(value => value !== undefined && value !== null && String(value).trim() !== '').map(String))];
      if (selected && !values.includes(String(selected))) values.unshift(String(selected));
      const blank = allowBlank ? '<option value=""></option>' : '';
      return blank + values.map(value => `<option value="${esc(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${esc(categoryLabel(value))}</option>`).join('');
    }

    function uniqueEntryValues(field) {
      return [...new Set(entries.map(entry => String(entry[field] || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    }

    function entryFilterCategoryOptions() {
      return entryFilters.type ? categoriesForType(entryFilters.type) : categoryOptions;
    }

    function filterValueLabel(field) {
      if (field === 'category') return categoryLabel(entryFilters.category);
      return entryFilters[field] || '';
    }

    function entryDateParts() {
      const years = [...new Set(entries.map(entry => entryDay(entry).slice(0, 4)).filter(Boolean))].sort().reverse();
      const months = Array.from({length: 12}, (_, i) => pad2(i + 1));
      const maxDay = entryFilters.year && entryFilters.month ? new Date(Number(entryFilters.year), Number(entryFilters.month), 0).getDate() : 31;
      const days = Array.from({length: maxDay}, (_, i) => pad2(i + 1));
      return {years, months, days};
    }

    function syncEntryDateRange() {
      const selectedDay = String(entryFilters.day || '').includes('-') ? String(entryFilters.day).slice(8, 10) : entryFilters.day;
      entryFilters.start = '';
      entryFilters.end = '';
      if (!entryFilters.year) {
        entryFilters.month = '';
        entryFilters.day = '';
        return;
      }
      if (!entryFilters.month) {
        entryFilters.start = `${entryFilters.year}-01-01`;
        entryFilters.end = `${entryFilters.year}-12-31`;
        return;
      }
      const lastDay = pad2(new Date(Number(entryFilters.year), Number(entryFilters.month), 0).getDate());
      if (!selectedDay) {
        entryFilters.day = '';
        entryFilters.start = `${entryFilters.year}-${entryFilters.month}-01`;
        entryFilters.end = `${entryFilters.year}-${entryFilters.month}-${lastDay}`;
        return;
      }
      entryFilters.day = `${entryFilters.year}-${entryFilters.month}-${selectedDay}`;
    }

    function clearEntryFilters() {
      entryFilters = {year: '', month: '', day: '', type: '', category: '', account: '', transaction_object: '', tone: '', start: '', end: ''};
    }

    function headerFilterCell(field, label, options, attrs = '') {
      const html = field === 'category' ? categoryOptionsHtml(options, entryFilters[field], true) : optionsHtml(options, entryFilters[field], true);
      const value = filterValueLabel(field);
      return `
        <th>
          <div class="entry-head-filter ${value ? 'is-active' : ''}">
            <span class="entry-head-label">${esc(label)}<span class="entry-head-arrow">⌄</span></span>
            ${value ? `<span class="entry-head-value">${esc(value)}</span>` : ''}
            <select data-entry-filter="${field}" aria-label="${esc(label)}" ${attrs}>${html}</select>
          </div>
        </th>`;
    }

    function dateHeaderCell() {
      const {years, months, days} = entryDateParts();
      const dayPart = String(entryFilters.day || '').includes('-') ? String(entryFilters.day).slice(8, 10) : entryFilters.day;
      const dateText = entryFilters.year
        ? [entryFilters.year, entryFilters.month, dayPart].filter(Boolean).join('/')
        : '';
      return `
        <th>
          <div class="entry-head-filter entry-time-head ${dateText ? 'is-active' : ''}">
            <span class="entry-head-label">时间<span class="entry-head-arrow">⌄</span></span>
            ${dateText ? `<span class="entry-head-value">${esc(dateText)}</span>` : ''}
            <div class="entry-time-selects">
              <select data-entry-filter="year" aria-label="年">${optionsHtml(years, entryFilters.year, true)}</select>
              <select data-entry-filter="month" aria-label="月" ${entryFilters.year ? '' : 'disabled'}>${optionsHtml(months, entryFilters.month, true)}</select>
              <select data-entry-filter="day" aria-label="日" ${entryFilters.year && entryFilters.month ? '' : 'disabled'}>${optionsHtml(days, dayPart, true)}</select>
            </div>
          </div>
        </th>`;
    }

    function entryMatchesFilters(entry) {
      const day = entryDay(entry);
      if (entryFilters.day && day !== entryFilters.day) return false;
      if (entryFilters.start && day < entryFilters.start) return false;
      if (entryFilters.end && day > entryFilters.end) return false;
      if (entryFilters.type && entry.type !== entryFilters.type) return false;
      if (entryFilters.category && (entry.category || '') !== entryFilters.category) return false;
      if (entryFilters.account && (entry.account || '') !== entryFilters.account) return false;
      if (entryFilters.transaction_object && (entry.transaction_object || '') !== entryFilters.transaction_object) return false;
      if (entryFilters.tone && moneyTone(entry) !== entryFilters.tone) return false;
      return true;
    }

    function entryFilterSummary() {
      const parts = [];
      if (entryFilters.tone === 'income') parts.push('收入账单');
      if (entryFilters.tone === 'expense') parts.push('支出账单');
      if (entryFilters.start || entryFilters.end) parts.push(`${slashDate(entryFilters.start)} - ${slashDate(entryFilters.end)}`);
      if (entryFilters.day) parts.push(slashDate(entryFilters.day));
      ['type', 'category', 'account', 'transaction_object'].forEach(field => {
        if (entryFilters[field]) parts.push(field === 'category' ? categoryLabel(entryFilters[field]) : entryFilters[field]);
      });
      return parts.join(' / ');
    }

    function clearDeleteToast() {
      const toast = $('deleteToast');
      if (toast) toast.remove();
    }

    function renderDeleteToast() {
      clearDeleteToast();
      const pending = pendingDelete || pendingCategoryDelete || pendingDebtDelete || pendingAccountDelete;
      if (!pending) return;
      const toast = document.createElement('div');
      toast.id = 'deleteToast';
      toast.className = 'delete-toast';
      const labels = {
        account: `已移除账户 ${pending.row.name}`,
        category: `已移除分类 ${categoryLabel(pending.category)}`,
        debt: `已移除 ${pending.row.name}`,
        entry: '已移除 1 条账单',
      };
      const label = labels[pending.kind || 'entry'];
      toast.innerHTML = `
        <span>${esc(label)}</span>
        <button data-undo-delete>撤销(${pending.remaining}s)</button>`;
      document.body.appendChild(toast);
      toast.querySelector('[data-undo-delete]').onclick = pending.kind === 'category'
        ? undoPendingCategoryDelete
        : pending.kind === 'debt'
          ? undoPendingDebtDelete
          : pending.kind === 'account'
            ? undoPendingAccountDelete
            : undoPendingDelete;
    }

    function pendingDeleteRequest(item) {
      if ((item.kind || 'entry') === 'category') {
        return {path: '/api/category-delete', body: {type: item.type, category: item.category}};
      }
      if (item.kind === 'debt') {
        return {path: '/api/account-debt-delete', body: {id: item.row.id}};
      }
      if (item.kind === 'account') {
        return {path: '/api/account-delete', body: {name: item.row.name}};
      }
      return {path: '/api/entry-delete', body: {id: item.row.id}};
    }

    function sendPendingDelete(item, keepalive = false) {
      const request = pendingDeleteRequest(item);
      const body = JSON.stringify(request.body);
      if (keepalive) {
        const blob = new Blob([body], {type: 'application/json'});
        if (navigator.sendBeacon && navigator.sendBeacon(request.path, blob)) return Promise.resolve();
        return fetch(request.path, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body,
          keepalive: true
        }).catch(() => {});
      }
      return api(request.path, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body
      });
    }

    function takePendingDeletes() {
      const items = [pendingDelete, pendingCategoryDelete, pendingDebtDelete, pendingAccountDelete].filter(Boolean);
      pendingDelete = null;
      pendingCategoryDelete = null;
      pendingDebtDelete = null;
      pendingAccountDelete = null;
      items.forEach(item => {
        clearInterval(item.intervalId);
        clearTimeout(item.timeoutId);
      });
      clearDeleteToast();
      return items;
    }

    async function commitPendingDeletes(options = {}) {
      const items = takePendingDeletes();
      if (!items.length) return;
      try {
        await Promise.all(items.map(item => sendPendingDelete(item, Boolean(options.keepalive))));
        if (options.refreshAfter) await refresh();
      } catch (err) {
        if (options.refreshAfter) await refresh();
        if (!options.silent) alert(err.message === 'not found' ? '后端接口未加载，请重启 Dashboard 后再删除。' : err.message);
      }
    }

    async function finalizePendingDelete() {
      if (!pendingDelete) return;
      const item = pendingDelete;
      pendingDelete = null;
      clearInterval(item.intervalId);
      clearTimeout(item.timeoutId);
      clearDeleteToast();
      try {
        await api('/api/entry-delete', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({id: item.row.id})
        });
        await refresh();
      } catch (err) {
        if (!entries.some(entry => Number(entry.id) === Number(item.row.id))) {
          entries.splice(Math.min(item.index, entries.length), 0, item.row);
        }
        renderEntries();
        alert(err.message === 'not found' ? '后端接口未加载，请重启 Dashboard 后再删除。' : err.message);
      }
    }

    function undoPendingDelete() {
      if (!pendingDelete) return;
      const item = pendingDelete;
      pendingDelete = null;
      clearInterval(item.intervalId);
      clearTimeout(item.timeoutId);
      clearDeleteToast();
      if (!entries.some(entry => Number(entry.id) === Number(item.row.id))) {
        entries.splice(Math.min(item.index, entries.length), 0, item.row);
      }
      renderEntries();
    }

    function scheduleEntryDelete(id) {
      if (pendingCategoryDelete) finalizePendingCategoryDelete();
      if (pendingDebtDelete) finalizePendingDebtDelete();
      if (pendingAccountDelete) finalizePendingAccountDelete();
      if (pendingDelete) finalizePendingDelete();
      const index = entries.findIndex(entry => Number(entry.id) === Number(id));
      if (index < 0) return;
      const [row] = entries.splice(index, 1);
      if (editingEntryId === Number(id)) editingEntryId = null;
      pendingDelete = {row, index, remaining: 5, intervalId: null, timeoutId: null};
      pendingDelete.intervalId = setInterval(() => {
        if (!pendingDelete || pendingDelete.row.id !== row.id) return;
        pendingDelete.remaining -= 1;
        renderDeleteToast();
      }, 1000);
      pendingDelete.timeoutId = setTimeout(finalizePendingDelete, 5000);
      renderEntries();
      renderDeleteToast();
    }

    async function finalizePendingCategoryDelete() {
      if (!pendingCategoryDelete) return;
      const item = pendingCategoryDelete;
      pendingCategoryDelete = null;
      clearInterval(item.intervalId);
      clearTimeout(item.timeoutId);
      clearDeleteToast();
      try {
        await api('/api/category-delete', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({type: item.type, category: item.category})
        });
        await refresh();
      } catch (err) {
        renderCategoryRules();
        alert(err.message === 'not found' ? '后端接口未加载，请重启 Dashboard 后再删除。' : err.message);
      }
    }

    function undoPendingCategoryDelete() {
      if (!pendingCategoryDelete) return;
      const item = pendingCategoryDelete;
      pendingCategoryDelete = null;
      clearInterval(item.intervalId);
      clearTimeout(item.timeoutId);
      clearDeleteToast();
      renderCategoryRules();
    }

    function scheduleCategoryDelete(type, category) {
      if (pendingDelete) finalizePendingDelete();
      if (pendingDebtDelete) finalizePendingDebtDelete();
      if (pendingAccountDelete) finalizePendingAccountDelete();
      if (pendingCategoryDelete) finalizePendingCategoryDelete();
      if (editingCategoryKey === `${type}|||${category}`) editingCategoryKey = null;
      if (addingKeywordKey === `${type}|||${category}`) addingKeywordKey = null;
      pendingCategoryDelete = {kind: 'category', type, category, remaining: 5, intervalId: null, timeoutId: null};
      pendingCategoryDelete.intervalId = setInterval(() => {
        if (!pendingCategoryDelete || pendingCategoryDelete.type !== type || pendingCategoryDelete.category !== category) return;
        pendingCategoryDelete.remaining -= 1;
        renderDeleteToast();
      }, 1000);
      pendingCategoryDelete.timeoutId = setTimeout(finalizePendingCategoryDelete, 5000);
      renderCategoryRules();
      renderDeleteToast();
    }

    async function finalizePendingDebtDelete() {
      if (!pendingDebtDelete) return;
      const item = pendingDebtDelete;
      pendingDebtDelete = null;
      clearInterval(item.intervalId);
      clearTimeout(item.timeoutId);
      clearDeleteToast();
      try {
        await api('/api/account-debt-delete', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({id: item.row.id})
        });
        await refresh();
      } catch (err) {
        if (!debtBalances.some(row => Number(row.id) === Number(item.row.id))) {
          debtBalances.splice(Math.min(item.index, debtBalances.length), 0, item.row);
        }
        $('debtList').innerHTML = renderDebtBalances(debtBalances);
        bindDebtActions();
        alert(err.message === 'not found' ? '后端接口未加载，请重启 Dashboard 后再删除。' : err.message);
      }
    }

    function undoPendingDebtDelete() {
      if (!pendingDebtDelete) return;
      const item = pendingDebtDelete;
      pendingDebtDelete = null;
      clearInterval(item.intervalId);
      clearTimeout(item.timeoutId);
      clearDeleteToast();
      if (!debtBalances.some(row => Number(row.id) === Number(item.row.id))) {
        debtBalances.splice(Math.min(item.index, debtBalances.length), 0, item.row);
      }
      $('debtList').innerHTML = renderDebtBalances(debtBalances);
      bindDebtActions();
    }

    function scheduleDebtDelete(id) {
      if (pendingDelete) finalizePendingDelete();
      if (pendingCategoryDelete) finalizePendingCategoryDelete();
      if (pendingAccountDelete) finalizePendingAccountDelete();
      if (pendingDebtDelete) finalizePendingDebtDelete();
      const index = debtBalances.findIndex(row => Number(row.id) === Number(id));
      if (index < 0) return;
      const [row] = debtBalances.splice(index, 1);
      pendingDebtDelete = {kind: 'debt', row, index, remaining: 5, intervalId: null, timeoutId: null};
      pendingDebtDelete.intervalId = setInterval(() => {
        if (!pendingDebtDelete || pendingDebtDelete.row.id !== row.id) return;
        pendingDebtDelete.remaining -= 1;
        renderDeleteToast();
      }, 1000);
      pendingDebtDelete.timeoutId = setTimeout(finalizePendingDebtDelete, 5000);
      $('debtList').innerHTML = renderDebtBalances(debtBalances);
      bindDebtActions();
      renderDeleteToast();
    }

    async function finalizePendingAccountDelete() {
      if (!pendingAccountDelete) return;
      const item = pendingAccountDelete;
      pendingAccountDelete = null;
      clearInterval(item.intervalId);
      clearTimeout(item.timeoutId);
      clearDeleteToast();
      try {
        await api('/api/account-delete', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({name: item.row.name})
        });
        await refresh();
      } catch (err) {
        if (!accountBalances.some(row => row.name === item.row.name)) {
          accountBalances.splice(Math.min(item.index, accountBalances.length), 0, item.row);
        }
        $('assetList').innerHTML = renderAccountBalances(accountBalances);
        bindAccountActions();
        alert(err.message === 'cannot delete account with existing entries'
          ? '该账户已有账单或待确认记录，不能删除。'
          : err.message === 'not found'
            ? '后端接口未加载，请重启 Dashboard 后再删除。'
            : err.message);
      }
    }

    function undoPendingAccountDelete() {
      if (!pendingAccountDelete) return;
      const item = pendingAccountDelete;
      pendingAccountDelete = null;
      clearInterval(item.intervalId);
      clearTimeout(item.timeoutId);
      clearDeleteToast();
      if (!accountBalances.some(row => row.name === item.row.name)) {
        accountBalances.splice(Math.min(item.index, accountBalances.length), 0, item.row);
      }
      $('assetList').innerHTML = renderAccountBalances(accountBalances);
      bindAccountActions();
    }

    function scheduleAccountDelete(name) {
      if (pendingDelete) finalizePendingDelete();
      if (pendingCategoryDelete) finalizePendingCategoryDelete();
      if (pendingDebtDelete) finalizePendingDebtDelete();
      if (pendingAccountDelete) finalizePendingAccountDelete();
      const index = accountBalances.findIndex(row => row.name === name);
      if (index < 0) return;
      const [row] = accountBalances.splice(index, 1);
      if (editingAccountName === name) editingAccountName = null;
      if (editingAccountBalanceName === name) editingAccountBalanceName = null;
      pendingAccountDelete = {kind: 'account', row, index, remaining: 5, intervalId: null, timeoutId: null};
      pendingAccountDelete.intervalId = setInterval(() => {
        if (!pendingAccountDelete || pendingAccountDelete.row.name !== row.name) return;
        pendingAccountDelete.remaining -= 1;
        renderDeleteToast();
      }, 1000);
      pendingAccountDelete.timeoutId = setTimeout(finalizePendingAccountDelete, 5000);
      $('assetList').innerHTML = renderAccountBalances(accountBalances);
      bindAccountActions();
      renderDeleteToast();
    }

    function toneColor(tone) {
      const inverted = document.body.dataset.colorInverted === 'true';
      if (tone === 'income') return cssVar(inverted ? '--green' : '--red');
      if (tone === 'expense') return cssVar(inverted ? '--red' : '--green');
      return cssVar('--ink');
    }

    const pad2 = (n) => String(n).padStart(2, '0');
    const ymd = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const slashDate = (value) => value ? value.replaceAll('-', '/') : '--/--/--';
    const entryDay = (entry) => String(entry.transaction_time || '').slice(0, 10);
    const parseDay = (value) => {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day);
    };
    const addDays = (date, days) => {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    };

    function table(rows, columns) {
      if (!rows.length) return '<div class="muted">暂无数据</div>';
      return '<table><thead><tr>' + columns.map(c => `<th>${c[1]}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + columns.map(c => {
          const cls = c[3] ? ` class="${esc(c[3](r[c[0]], r))}"` : '';
          return `<td${cls}>${esc(c[2] ? c[2](r[c[0]], r) : r[c[0]])}</td>`;
        }).join('') + '</tr>').join('') +
        '</tbody></table>';
    }

    function renderAccountBalances(rows) {
      const body = rows.length ? rows.map(row => {
        const value = row.computed_balance_cents ?? row.current_balance_cents;
        const isNameEditing = editingAccountName === row.name;
        const isBalanceEditing = editingAccountBalanceName === row.name;
        return `
          <tr>
            <td>
              <div class="account-name-cell">
                ${isNameEditing
                  ? `<input class="account-name-input" type="text" value="${esc(row.name)}" aria-label="账户名" data-account-name-input="${esc(row.name)}">`
                  : `<span>${esc(row.name)}</span>
                    <button type="button" class="icon-button" title="编辑账户名" aria-label="编辑账户名" data-account-name-edit="${esc(row.name)}">✎</button>`}
              </div>
            </td>
            <td class="money-cell debt-money">
              <div class="account-balance-cell">
                ${isBalanceEditing
                  ? `<input class="account-balance-input" type="text" inputmode="decimal" value="${esc(money(value))}" aria-label="账户余额" data-account-balance-input="${esc(row.name)}">`
                  : `<span>${esc(balanceMoney(value))}</span>
                    <button type="button" class="icon-button" title="编辑余额" aria-label="编辑余额" data-account-balance-edit="${esc(row.name)}">✎</button>`}
              </div>
            </td>
            <td>${esc(row.currency)}</td>
            <td class="account-actions"><button type="button" class="text-delete" data-account-delete="${esc(row.name)}">删除</button></td>
          </tr>
        `;
      }).join('') : '<tr><td class="entry-empty" colspan="4">暂无数据</td></tr>';
      return `<table class="account-table">
        <thead><tr><th>账户</th><th>余额</th><th>币种</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="account-add-form">
        <input id="newAccountName" type="text" placeholder="新增账户名称">
        <input id="newAccountBalance" type="text" inputmode="decimal" placeholder="初始余额">
        <button type="button" class="primary" id="addAccount">新增账户</button>
      </div>`;
    }

    async function saveAccountName(input, oldName) {
      if (input.dataset.saving === 'true') return;
      const newName = input.value.trim();
      editingAccountName = null;
      if (!newName || newName === oldName) {
        $('assetList').innerHTML = renderAccountBalances(accountBalances);
        bindAccountActions();
        return;
      }
      input.dataset.saving = 'true';
      await api('/api/account-rename', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({old_name: oldName, new_name: newName})
      });
      await refresh();
    }

    async function saveAccountBalance(input, name) {
      if (input.dataset.saving === 'true') return;
      const actual = input.value.trim();
      editingAccountBalanceName = null;
      if (!actual) {
        $('assetList').innerHTML = renderAccountBalances(accountBalances);
        bindAccountActions();
        return;
      }
      input.dataset.saving = 'true';
      await api('/api/correct-balance', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({account: name, actual})
      });
      await refresh();
    }

    async function addAccountFromAssets() {
      const name = $('newAccountName').value.trim();
      const balance = $('newAccountBalance').value.trim();
      if (!name) return;
      const endpoint = balance ? '/api/account-set' : '/api/account-add';
      const payload = balance ? {name, balance} : {name};
      await api(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(payload)
      });
      $('newAccountName').value = '';
      $('newAccountBalance').value = '';
      await refresh();
    }

    function bindAccountActions() {
      document.querySelectorAll('[data-account-name-edit]').forEach(btn => {
        btn.onclick = () => {
          editingAccountName = btn.dataset.accountNameEdit;
          editingAccountBalanceName = null;
          $('assetList').innerHTML = renderAccountBalances(accountBalances);
          bindAccountActions();
          document.querySelector(`[data-account-name-input="${CSS.escape(editingAccountName)}"]`)?.focus();
        };
      });
      document.querySelectorAll('[data-account-name-input]').forEach(input => {
        input.onkeydown = event => {
          if (event.key === 'Enter') saveAccountName(input, input.dataset.accountNameInput).catch(err => alert(err.message));
          if (event.key === 'Escape') {
            editingAccountName = null;
            $('assetList').innerHTML = renderAccountBalances(accountBalances);
            bindAccountActions();
          }
        };
        input.onblur = () => saveAccountName(input, input.dataset.accountNameInput).catch(err => {
          alert(err.message === 'account already exists' ? '账户名已存在。' : err.message);
          $('assetList').innerHTML = renderAccountBalances(accountBalances);
          bindAccountActions();
        });
      });
      document.querySelectorAll('[data-account-balance-edit]').forEach(btn => {
        btn.onclick = () => {
          editingAccountBalanceName = btn.dataset.accountBalanceEdit;
          editingAccountName = null;
          $('assetList').innerHTML = renderAccountBalances(accountBalances);
          bindAccountActions();
          document.querySelector(`[data-account-balance-input="${CSS.escape(editingAccountBalanceName)}"]`)?.focus();
        };
      });
      document.querySelectorAll('[data-account-balance-input]').forEach(input => {
        input.onkeydown = event => {
          if (event.key === 'Enter') saveAccountBalance(input, input.dataset.accountBalanceInput).catch(err => alert(err.message));
          if (event.key === 'Escape') {
            editingAccountBalanceName = null;
            $('assetList').innerHTML = renderAccountBalances(accountBalances);
            bindAccountActions();
          }
        };
        input.onblur = () => saveAccountBalance(input, input.dataset.accountBalanceInput).catch(err => {
          alert(err.message);
          $('assetList').innerHTML = renderAccountBalances(accountBalances);
          bindAccountActions();
        });
      });
      document.querySelectorAll('[data-account-delete]').forEach(btn => {
        btn.onclick = () => scheduleAccountDelete(btn.dataset.accountDelete);
      });
      if ($('addAccount')) $('addAccount').onclick = () => addAccountFromAssets().catch(err => alert(err.message));
      ['newAccountName', 'newAccountBalance'].forEach(id => {
        if ($(id)) $(id).onkeydown = event => {
          if (event.key === 'Enter') addAccountFromAssets().catch(err => alert(err.message));
        };
      });
    }

    function renderDebtBalances(rows) {
      if (!rows.length) return '<div class="muted">暂无数据</div>';
      return `<table class="debt-table">
        <thead><tr><th>交易对象</th><th>应收</th><th>应付</th><th></th></tr></thead>
        <tbody>${rows.map(row => `
          <tr>
            <td>${esc(row.name)}</td>
            <td class="money-cell debt-money">${esc(money(row.receivable_cents))}</td>
            <td class="money-cell debt-money">${esc(money(row.payable_cents))}</td>
            <td class="debt-actions"><button class="text-delete" data-debt-delete="${esc(row.id)}">删除</button></td>
          </tr>
        `).join('')}</tbody>
      </table>`;
    }

    function bindDebtActions() {
      document.querySelectorAll('[data-debt-delete]').forEach(btn => {
        btn.onclick = () => scheduleDebtDelete(Number(btn.dataset.debtDelete));
      });
    }

    const trendHoverPoints = {};
    const pieHoverRegions = {};
    let chartAnimationToken = 0;
    let chartResizeTimer = null;

    function cssVar(name) {
      return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    function chartFont(size, weight = 500) {
      return `${weight} ${size}px "Times New Roman", Times, FangSong, STFangsong, serif`;
    }

    function prepareCanvas(canvas, cssWidth, cssHeight, displayWidth = cssWidth, displayHeight = cssHeight) {
      const ratio = window.devicePixelRatio || 1;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      canvas.width = Math.round(cssWidth * ratio);
      canvas.height = Math.round(cssHeight * ratio);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      return {ctx, width: cssWidth, height: cssHeight};
    }

    function chartDisplaySize(canvas, square = false) {
      const wrap = canvas.parentElement;
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      if (!square) return {width, height};
      const size = Math.min(width, height);
      return {width: size, height: size};
    }

    function textPill(ctx, text, x, y, align, color) {
      ctx.font = chartFont(11);
      const metrics = ctx.measureText(text);
      const width = metrics.width + 12;
      const height = 18;
      const left = align === 'right' ? x - width : x;
      roundedRect(ctx, left, y - height + 4, width, height, 5);
      ctx.fillStyle = cssVar('--panel');
      ctx.globalAlpha = .94;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(text, x + (align === 'right' ? -6 : 6), y);
    }

    function roundedRect(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + width, y, x + width, y + height, radius);
      ctx.arcTo(x + width, y + height, x, y + height, radius);
      ctx.arcTo(x, y + height, x, y, radius);
      ctx.arcTo(x, y, x + width, y, radius);
      ctx.closePath();
    }

    function drawSmoothLine(ctx, points) {
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
          return;
        }
        const prev = points[index - 1];
        const midX = (prev.x + point.x) / 2;
        ctx.bezierCurveTo(midX, prev.y, midX, point.y, point.x, point.y);
      });
    }

    function drawTrend(canvasId, points, progress = 1) {
      const canvas = $(canvasId);
      const display = chartDisplaySize(canvas);
      const {ctx, width, height} = prepareCanvas(canvas, display.width, display.height);
      ctx.clearRect(0, 0, width, height);
      const pad = {left: 58, right: 26, top: 18, bottom: 34};
      const chartW = width - pad.left - pad.right;
      const chartH = height - pad.top - pad.bottom;
      roundedRect(ctx, 8, 8, width - 16, height - 16, 8);
      ctx.fillStyle = colorMixPanel();
      ctx.fill();
      ctx.strokeStyle = cssVar('--line');
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i += 1) {
        const y = pad.top + chartH * i / 4;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
      }
      if (!points.length) {
        ctx.fillStyle = cssVar('--muted');
        ctx.font = chartFont(14);
        ctx.textAlign = 'center';
        ctx.fillText('暂无数据', width / 2, height / 2);
        return;
      }
      const values = points.flatMap(p => [Number(p.income_cents || 0), Number(p.expense_cents || 0)]);
      const max = Math.max(...values, 100);
      const step = chartW / Math.max(points.length - 1, 1);
      trendHoverPoints[canvasId] = [];
      const zeroY = pad.top + chartH / 2;
      ctx.strokeStyle = cssVar('--ink');
      ctx.globalAlpha = .7;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(width - pad.right, zeroY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      [
        {key: 'income_cents', label: '收入', tone: 'income', direction: -1},
        {key: 'expense_cents', label: '支出', tone: 'expense', direction: 1},
      ].forEach(seriesConfig => {
        const color = toneColor(seriesConfig.tone);
        const series = points.map((p, i) => ({
          x: pad.left + i * step,
          y: zeroY + seriesConfig.direction * (Number(p[seriesConfig.key] || 0) / max) * (chartH / 2 - 12) * progress,
          value: Number(p[seriesConfig.key] || 0),
          day: p.day,
          label: seriesConfig.label,
          tone: seriesConfig.tone,
        }));
        drawSmoothLine(ctx, series);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        const avg = series.reduce((sum, point) => sum + point.value, 0) / Math.max(series.length, 1);
        const avgY = zeroY + seriesConfig.direction * (avg / max) * (chartH / 2 - 12) * progress;
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = .58;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, avgY);
        ctx.lineTo(width - pad.right, avgY);
        ctx.stroke();
        ctx.restore();
        const labelY = avgY + (seriesConfig.direction < 0 ? -10 : 22);
        textPill(ctx, `${seriesConfig.label}日均 ${money(avg)}`, width - pad.right - 4, labelY, 'right', color);
        ctx.globalAlpha = 1;
        series.forEach(point => {
          trendHoverPoints[canvasId].push(point);
        });
      });
      ctx.font = chartFont(12);
      ctx.fillStyle = cssVar('--muted');
      ctx.textAlign = 'center';
      points.filter((_, i) => i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 5) === 0).forEach(p => {
        const index = points.indexOf(p);
        ctx.fillText(String(p.day || '').slice(5).replace('-', '/'), pad.left + index * step, height - 16);
      });
    }

    function colorMixPanel() {
      return document.body.dataset.theme === 'dark' ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.42)';
    }

    const pieColors = ['#0e6f5c', '#a83f2d', '#2459a6', '#8a5a16', '#6f4aa8', '#18704b', '#b45c38', '#557a2f', '#8f3f67', '#5f6f7a'];

    function drawPie(canvasId, rows, tone, progress = 1) {
      const canvas = $(canvasId);
      const display = chartDisplaySize(canvas);
      const {ctx, width, height} = prepareCanvas(canvas, display.width, display.height);
      ctx.clearRect(0, 0, width, height);
      pieHoverRegions[canvasId] = [];
      const total = rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
      if (!total) {
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim();
        ctx.font = chartFont(14);
        ctx.textAlign = 'center';
        ctx.fillText('暂无数据', width / 2, height / 2);
        return;
      }
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.max(44, Math.min(height * .31, width * .18));
      const innerRadius = radius * .6;
      let start = -Math.PI / 2;
      const labels = [];
      rows.forEach((row, index) => {
        const value = Number(row.amount_cents || 0);
        const percent = value / total;
        const angle = percent * Math.PI * 2 * progress;
        const end = start + angle;
        if (progress > .98) {
          pieHoverRegions[canvasId].push({start, end, row, percent, tone, cx, cy, innerRadius, radius});
        }
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, end);
        ctx.arc(cx, cy, innerRadius, end, start, true);
        ctx.closePath();
        ctx.fillStyle = pieColors[index % pieColors.length];
        ctx.fill();
        const fullMid = start + (percent * Math.PI * 2) / 2;
        labels.push({
          row,
          percent,
          color: pieColors[index % pieColors.length],
          mid: fullMid,
          side: Math.cos(fullMid) >= 0 ? 'right' : 'left',
          sourceX: cx + Math.cos(fullMid) * (radius + 4),
          sourceY: cy + Math.sin(fullMid) * (radius + 4),
          elbowX: cx + Math.cos(fullMid) * (radius + 30),
          elbowY: cy + Math.sin(fullMid) * (radius + 30),
          labelY: cy + Math.sin(fullMid) * (radius + 42),
        });
        start += percent * Math.PI * 2 * progress;
      });
      ctx.fillStyle = toneColor(tone);
      ctx.font = chartFont(22, 800);
      ctx.textAlign = 'center';
      ctx.fillText(money(total * progress), cx, cy + 8);
      if (progress > .98) drawPieLabels(ctx, {width, height}, labels.filter(label => label.percent >= .035));
    }

    function distributeLabels(labels, canvasHeight) {
      const sorted = labels.slice().sort((a, b) => a.labelY - b.labelY);
      const gap = 26;
      const minY = 26;
      const maxY = canvasHeight - 26;
      sorted.forEach(label => {
        label.labelY = Math.max(minY, Math.min(maxY, label.labelY));
      });
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i].labelY - sorted[i - 1].labelY < gap) {
          sorted[i].labelY = sorted[i - 1].labelY + gap;
        }
      }
      const overflow = sorted.length ? sorted.at(-1).labelY - maxY : 0;
      if (overflow > 0) {
        sorted.forEach(label => {
          label.labelY -= overflow;
        });
      }
      for (let i = sorted.length - 2; i >= 0; i -= 1) {
        if (sorted[i + 1].labelY - sorted[i].labelY < gap) {
          sorted[i].labelY = sorted[i + 1].labelY - gap;
        }
      }
      sorted.forEach(label => {
        label.labelY = Math.max(minY, Math.min(maxY, label.labelY));
      });
      return sorted;
    }

    function drawPieLabels(ctx, canvas, labels) {
      const sides = {
        left: distributeLabels(labels.filter(label => label.side === 'left'), canvas.height),
        right: distributeLabels(labels.filter(label => label.side === 'right'), canvas.height),
      };
      ctx.font = chartFont(12, 650);
      Object.entries(sides).forEach(([side, sideLabels]) => {
        const right = side === 'right';
        const labelInset = Math.min(190, Math.max(110, canvas.width * .28));
        const lineX = right ? canvas.width - labelInset : labelInset;
        const textX = right ? lineX + 8 : lineX - 8;
        sideLabels.forEach(label => {
          const name = categoryLabel(label.row.category || '未分类');
          const percent = `${(label.percent * 100).toFixed(1)}%`;
          ctx.strokeStyle = label.color;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(label.sourceX, label.sourceY);
          ctx.lineTo(label.elbowX, label.elbowY);
          ctx.lineTo(lineX, label.labelY);
          ctx.stroke();
          ctx.fillStyle = cssVar('--ink-soft');
          ctx.textAlign = right ? 'left' : 'right';
          ctx.fillText(`${name} ${percent}`, textX, label.labelY + 4);
        });
      });
    }

    function animateOverviewCharts(analysis) {
      const token = ++chartAnimationToken;
      const start = performance.now();
      const duration = 620;
      const easeOut = (t) => 1 - Math.pow(1 - t, 3);
      function frame(now) {
        if (token !== chartAnimationToken) return;
        const progress = easeOut(Math.min((now - start) / duration, 1));
        drawTrend('cashflowTrend', analysis.trend, progress);
        drawPie('expensePie', analysis.expenseCategories, 'expense', progress);
        drawPie('incomePie', analysis.incomeCategories, 'income', progress);
        if (progress < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    function bindTrendHover(canvasId, tipId) {
      const canvas = $(canvasId);
      canvas.addEventListener('mousemove', (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * (canvas.width / (window.devicePixelRatio || 1)) / rect.width;
        const nearest = (trendHoverPoints[canvasId] || [])
          .map(point => ({point, distance: Math.abs(point.x - x)}))
          .sort((a, b) => a.distance - b.distance)[0];
        const tip = $(tipId);
        if (!nearest || nearest.distance > 24) {
          tip.style.display = 'none';
          return;
        }
        const sameDay = (trendHoverPoints[canvasId] || []).filter(point => point.day === nearest.point.day);
        tip.innerHTML = `<strong>${esc(nearest.point.day)}</strong>` + sameDay.map(point =>
          `${esc(point.label)}：${esc(signedMoney(point.value, point.tone))}`
        ).join('<br>');
        tip.style.left = `${event.clientX - rect.left}px`;
        tip.style.top = `${event.clientY - rect.top}px`;
        tip.style.display = 'block';
      });
      canvas.addEventListener('mouseleave', () => {
        $(tipId).style.display = 'none';
      });
    }

    bindTrendHover('cashflowTrend', 'cashflowTrendTip');

    function bindPieHover(canvasId, tipId) {
      const canvas = $(canvasId);
      canvas.addEventListener('mousemove', (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * (canvas.width / (window.devicePixelRatio || 1)) / rect.width;
        const y = (event.clientY - rect.top) * (canvas.height / (window.devicePixelRatio || 1)) / rect.height;
        const regions = pieHoverRegions[canvasId] || [];
        const hit = regions.find(region => {
          const dx = x - region.cx;
          const dy = y - region.cy;
          const distance = Math.hypot(dx, dy);
          if (distance < region.innerRadius || distance > region.radius) return false;
          let angle = Math.atan2(dy, dx);
          if (angle < -Math.PI / 2) angle += Math.PI * 2;
          return angle >= region.start && angle <= region.end;
        });
        const tip = $(tipId);
        if (!hit) {
          tip.style.display = 'none';
          return;
        }
        const percent = (hit.percent * 100).toFixed(1);
        tip.innerHTML = `<strong>${esc(categoryLabel(hit.row.category || '未分类'))}</strong>${esc(signedMoney(hit.row.amount_cents, hit.tone))} · ${percent}%`;
        const wrapRect = canvas.parentElement.getBoundingClientRect();
        tip.style.left = `${event.clientX - wrapRect.left}px`;
        tip.style.top = `${event.clientY - wrapRect.top}px`;
        tip.style.display = 'block';
      });
      canvas.addEventListener('mouseleave', () => {
        $(tipId).style.display = 'none';
      });
    }

    bindPieHover('expensePie', 'expensePieTip');
    bindPieHover('incomePie', 'incomePieTip');
    window.addEventListener('resize', () => {
      clearTimeout(chartResizeTimer);
      chartResizeTimer = setTimeout(() => {
        if (summaryData) updateOverview();
      }, 120);
    });

    function initPeriodDefaults() {
      if (periodInitialized) {
        clampCycleIndex();
        return;
      }
      const days = entries.map(entryDay).filter(Boolean).sort();
      const today = ymd(new Date());
      customStart = customStart || days[0] || today;
      customEnd = customEnd || today;
      clampCycleIndex();
      periodInitialized = true;
    }

    function weekStart(date) {
      const start = new Date(date);
      const day = start.getDay() || 7;
      start.setDate(start.getDate() - day + 1);
      return start;
    }

    function buildCycles() {
      const today = new Date();
      if (cycleMode === 'quarter') {
        const currentQuarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
        const cycles = [];
        for (let i = 0; i < 40; i += 1) {
          const startDate = new Date(today.getFullYear(), currentQuarterStartMonth - i * 3, 1);
          const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 3, 0);
          const quarter = Math.floor(startDate.getMonth() / 3) + 1;
          cycles.push({label: `${startDate.getFullYear()} Q${quarter}`, start: ymd(startDate), end: ymd(endDate)});
        }
        return cycles;
      }
      if (cycleMode === 'week') {
        const cycles = [];
        const cursor = weekStart(today);
        for (let i = 0; i < 60; i += 1) {
          const start = addDays(cursor, -7 * i);
          const end = addDays(start, 6);
          cycles.push({label: `${ymd(start).replaceAll('-', '/')} - ${ymd(end).replaceAll('-', '/')}`, start: ymd(start), end: ymd(end)});
        }
        return cycles;
      }
      const cycles = [];
      for (let i = 0; i < 90; i += 1) {
        const day = ymd(addDays(today, -i));
        cycles.push({label: day.replaceAll('-', '/'), start: day, end: day});
      }
      return cycles;
    }

    function clampCycleIndex() {
      const cycles = buildCycles();
      selectedCycleIndex = Math.min(selectedCycleIndex, Math.max(cycles.length - 1, 0));
    }

    function currentRange() {
      if (periodMode === 'all') return {start: customStart, end: customEnd};
      if (periodMode === 'year') {
        const year = new Date().getFullYear() + yearOffset;
        return {start: `${year}-01-01`, end: `${year}-12-31`};
      }
      if (periodMode === 'month') {
        const now = new Date();
        const date = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
        const month = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
        return {start: `${month}-01`, end: ymd(new Date(date.getFullYear(), date.getMonth() + 1, 0))};
      }
      const cycles = buildCycles();
      return cycles[selectedCycleIndex] || {start: customStart, end: customEnd};
    }

    function entriesInRange(range) {
      return entries.filter(entry => {
        const day = entryDay(entry);
        return day && day >= range.start && day <= range.end;
      });
    }

    function daysInRange(range) {
      const start = parseDay(range.start);
      const end = parseDay(range.end);
      if (!start || !end || start > end) return [];
      const days = [];
      for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
        days.push(ymd(cursor));
      }
      return days;
    }

    function aggregateRange(range) {
      const scoped = entriesInRange(range);
      const reportable = scoped.filter(reportableEntry);
      const income = reportable.filter(e => increaseTypes.has(e.type)).reduce((sum, e) => sum + Number(e.amount_cents || 0), 0);
      const expense = reportable.filter(e => decreaseTypes.has(e.type)).reduce((sum, e) => sum + Number(e.amount_cents || 0), 0);
      const expenseCategoryMap = new Map();
      reportable.filter(e => decreaseTypes.has(e.type)).forEach(e => {
        const rawCategory = e.category || '未分类';
        const key = expenseCategoryLevel === 'minor' ? rawCategory : majorCategory(rawCategory);
        expenseCategoryMap.set(key, (expenseCategoryMap.get(key) || 0) + Number(e.amount_cents || 0));
      });
      const incomeCategoryMap = new Map();
      reportable.filter(e => increaseTypes.has(e.type)).forEach(e => {
        const key = e.category || '未分类';
        incomeCategoryMap.set(key, (incomeCategoryMap.get(key) || 0) + Number(e.amount_cents || 0));
      });
      const byDay = new Map(daysInRange(range).map(day => [day, {day, income_cents: 0, expense_cents: 0}]));
      reportable.forEach(e => {
        const day = entryDay(e);
        if (!day) return;
        const current = byDay.get(day) || {day, income_cents: 0, expense_cents: 0};
        if (increaseTypes.has(e.type)) current.income_cents += Number(e.amount_cents || 0);
        if (decreaseTypes.has(e.type)) current.expense_cents += Number(e.amount_cents || 0);
        byDay.set(day, current);
      });
      return {
        scoped,
        income,
        expense,
        expenseCategories: [...expenseCategoryMap.entries()].map(([category, amount_cents]) => ({category, amount_cents})).sort((a, b) => b.amount_cents - a.amount_cents),
        incomeCategories: [...incomeCategoryMap.entries()].map(([category, amount_cents]) => ({category, amount_cents})).sort((a, b) => b.amount_cents - a.amount_cents),
        trend: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      };
    }

    function updatePeriodVisibility() {
      $('moreControls').classList.toggle('hidden', periodMode !== 'more');
      $('prevCycle').classList.toggle('hidden', !['year', 'month', 'more'].includes(periodMode));
      $('nextCycle').classList.toggle('hidden', !['year', 'month', 'more'].includes(periodMode));
      document.querySelectorAll('[data-period-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.periodMode === periodMode));
      document.querySelectorAll('[data-cycle]').forEach(btn => btn.classList.toggle('active', btn.dataset.cycle === cycleMode));
    }

    function updateOverview() {
      if (!summaryData) return;
      clampCycleIndex();
      updatePeriodVisibility();
      document.querySelectorAll('[data-expense-category-level]').forEach(btn => btn.classList.toggle('active', btn.dataset.expenseCategoryLevel === expenseCategoryLevel));
      const range = currentRange();
      const analysis = aggregateRange(range);
      $('rangeStartText').textContent = slashDate(range.start);
      $('rangeEndText').textContent = slashDate(range.end);
      $('mIncome').textContent = signedMoney(analysis.income, 'income');
      $('mExpense').textContent = signedMoney(analysis.expense, 'expense');
      $('mBalance').textContent = signedMoney(analysis.income - analysis.expense, analysis.income - analysis.expense < 0 ? 'expense' : 'income');
      $('mPending').textContent = summaryData.unconfirmed_count;
      $('pendingNavBadge').textContent = summaryData.unconfirmed_count;
      $('pendingNavBadge').classList.toggle('hidden', Number(summaryData.unconfirmed_count || 0) === 0);
      animateOverviewCharts(analysis);
    }

    function activePickerValue() {
      const range = currentRange();
      return activeDateTarget === 'start' ? range.start : range.end;
    }

    function renderDatePicker() {
      const yearSelect = $('datePickerYear');
      const monthSelect = $('datePickerMonth');
      const selectedValue = activePickerValue();
      const selected = selectedValue ? parseDay(selectedValue) : new Date();
      const currentYear = new Date().getFullYear();
      const minYear = Math.min(currentYear - 10, selected.getFullYear() - 5);
      const maxYear = Math.max(currentYear + 5, selected.getFullYear() + 5);
      yearSelect.innerHTML = Array.from({length: maxYear - minYear + 1}, (_, i) => minYear + i)
        .map(year => `<option value="${year}">${year}年</option>`).join('');
      monthSelect.innerHTML = Array.from({length: 12}, (_, i) => i)
        .map(month => `<option value="${month}">${month + 1}月</option>`).join('');
      yearSelect.value = String(pickerMonth.getFullYear());
      monthSelect.value = String(pickerMonth.getMonth());

      const first = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth(), 1);
      const gridStart = addDays(first, -(first.getDay() || 7) + 1);
      const cells = [];
      for (let i = 0; i < 42; i += 1) {
        const day = addDays(gridStart, i);
        const value = ymd(day);
        const classes = [
          day.getMonth() !== pickerMonth.getMonth() ? 'outside' : '',
          value === selectedValue ? 'selected' : '',
        ].filter(Boolean).join(' ');
        cells.push(`<button class="${classes}" data-date="${value}">${day.getDate()}</button>`);
      }
      $('datePickerGrid').innerHTML = cells.join('');
    }

    function openDatePicker(target, trigger) {
      activeDateTarget = target;
      const value = activePickerValue();
      pickerMonth = value ? parseDay(value) : new Date();
      renderDatePicker();
      const picker = $('datePicker');
      const panelRect = $('periodPanel').getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      picker.style.left = `${Math.max(0, triggerRect.left - panelRect.left)}px`;
      picker.style.top = `${triggerRect.bottom - panelRect.top + 8}px`;
      picker.classList.remove('hidden');
    }

    function closeDatePicker() {
      $('datePicker').classList.add('hidden');
      activeDateTarget = null;
    }

    async function refresh() {
      const [summary, entryData, pending, cats, tree, accounts, accountFilters, debts, rules] = await Promise.all([
        api('/api/summary'), api('/api/entries-all'), api('/api/unconfirmed'), api('/api/categories'), api('/api/category-tree'), api('/api/account-names'), api('/api/account-filter-names'), api('/api/account-debts'), api('/api/keyword-rules')
      ]);
      entries = pendingDelete ? entryData.filter(entry => Number(entry.id) !== Number(pendingDelete.row.id)) : entryData;
      const summaryAccounts = summary.account_balances || summary.accounts || [];
      accountBalances = pendingAccountDelete ? summaryAccounts.filter(row => row.name !== pendingAccountDelete.row.name) : summaryAccounts;
      debtBalances = pendingDebtDelete ? debts.filter(row => Number(row.id) !== Number(pendingDebtDelete.row.id)) : debts;
      pendingItems = orderPendingItems(pending.map(item => ({
        ...item,
        ui_id: `${item.source || 'unconfirmed'}:${item.id}`
      })));
      categoryOptions = cats;
      categoryTree = tree;
      entryTypes = Object.keys(categoryTree);
      if (entryFilters.type && !entryTypes.includes(entryFilters.type)) {
        entryFilters.type = '';
        entryFilters.category = '';
      }
      if (entryFilters.category && !categoryOptions.includes(entryFilters.category)) entryFilters.category = '';
      if (entryFilters.type && entryFilters.category && !categoriesForType(entryFilters.type).includes(entryFilters.category)) entryFilters.category = '';
      accountOptions = accounts;
      accountFilterOptions = accountFilters;
      keywordRules = rules;
      summaryData = summary;
      initPeriodDefaults();
      $('assetList').innerHTML = renderAccountBalances(accountBalances);
      $('debtList').innerHTML = renderDebtBalances(debtBalances);
      bindAccountActions();
      bindDebtActions();
      renderQuickFormOptions();
      if (!$('fTime').value) $('fTime').value = nowDatetimeLocal();
      renderEntries();
      updateOverview();
      renderPending();
      renderCategoryRules();
    }

    function renderEntries() {
      const q = $('search').value.trim();
      const searched = q ? entries.filter(e => JSON.stringify(e).includes(q)) : entries;
      const filtered = searched.filter(entryMatchesFilters);
      const pageSize = entryPageSize === 'all' ? filtered.length || 1 : Number(entryPageSize);
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      entryPage = Math.min(Math.max(1, entryPage), totalPages);
      const start = (entryPage - 1) * pageSize;
      const pageRows = filtered.slice(start, start + pageSize);
      const shownStart = filtered.length ? start + 1 : 0;
      const shownEnd = Math.min(start + pageSize, filtered.length);
      const pageSizeOptions = ['10', '20', '50', '100', '200', '500', 'all'];
      const controls = `
        <div class="entry-controls">
          <div class="muted">共 ${filtered.length} 条，当前 ${shownStart}-${shownEnd} 条${entryFilterSummary() ? ` · ${esc(entryFilterSummary())}` : ''}</div>
          <div class="entry-pager">
            <button id="entryClearFilters" ${entryFilterSummary() ? '' : 'disabled'}>清除筛选</button>
            <label>每页
              <select id="entryPageSize">
                ${pageSizeOptions.map(value => `<option value="${value}" ${value === entryPageSize ? 'selected' : ''}>${value === 'all' ? '全部' : value}</option>`).join('')}
              </select>
            </label>
            <button class="secondary" id="entryPrev" ${entryPage <= 1 ? 'disabled' : ''}>上一页</button>
            <span>${entryPage} / ${totalPages}</span>
            <button class="secondary" id="entryNext" ${entryPage >= totalPages ? 'disabled' : ''}>下一页</button>
          </div>
        </div>`;
      const statusLabel = value => value === 'pending' ? '待确认' : '已确认';
      const columns = [['transaction_time','时间'], ['type','类型'], ['category','分类', categoryLabel], ['status','状态', statusLabel], ['amount_cents','金额', signedEntryMoney, moneyClass], ['account','账户'], ['transaction_object','交易对象'], ['note','备注']];
      const headerCells = [
        dateHeaderCell(),
        headerFilterCell('type', '类型', entryTypes),
        headerFilterCell('category', '分类', entryFilterCategoryOptions()),
        '<th><div class="entry-head-filter static"><span class="entry-head-label">状态</span></div></th>',
        '<th><div class="entry-head-filter static"><span class="entry-head-label">金额</span></div></th>',
        headerFilterCell('account', '账户', accountFilterOptions),
        '<th><div class="entry-head-filter static"><span class="entry-head-label">交易对象</span></div></th>',
        '<th><div class="entry-head-filter static"><span class="entry-head-label">备注</span></div></th>',
        '<th class="entry-actions-head"></th>',
      ];
      const header = '<table class="entry-table"><thead><tr>' + headerCells.join('') + '</tr></thead><tbody>';
      const rows = pageRows.map(row => {
        const cells = columns.map(c => {
          const value = c[2] ? c[2](row[c[0]], row) : row[c[0]];
          const classes = ['entry-cell'];
          if (c[3]) classes.push(c[3](row[c[0]], row));
          return `<td class="${esc(classes.filter(Boolean).join(' '))}" title="${esc(value)}"><span class="entry-cell-text">${esc(value)}</span></td>`;
        }).join('');
        const editRow = editingEntryId === row.id ? `
          <tr class="entry-edit-row">
            <td colspan="${columns.length + 1}">
              <div class="entry-edit-panel" data-entry-form="${row.id}">
                <label>时间<input data-field="transaction_time" type="datetime-local" value="${esc(datetimeInputValue(row.transaction_time))}"></label>
                <label>类型<select data-field="type" data-entry-type="${row.id}">${optionsHtml(entryTypes, row.type)}</select></label>
                <label>分类<select data-field="category" data-entry-category="${row.id}">${categoryOptionsHtml(categoriesForType(row.type), row.category, true)}</select></label>
                <label class="entry-edit-amount">金额<input data-field="amount" type="number" step="0.01" inputmode="decimal" value="${amountValue(row.amount_cents)}"></label>
                <label>账户<select data-field="account">${optionsHtml(accountOptions, row.account)}</select></label>
                <label class="entry-target-account ${row.type === '转账' ? '' : 'hidden'}" data-entry-target-wrap="${row.id}">转入账户<select data-field="target_account">${optionsHtml(accountOptions, row.target_account, true)}</select></label>
                <label>交易对象<input data-field="transaction_object" value="${esc(row.transaction_object)}"></label>
                <label class="entry-edit-note">备注<input data-field="note" value="${esc(row.note)}"></label>
                <div class="entry-edit-actions">
                  <button class="primary" data-entry-save="${row.id}">保存</button>
                  <button class="secondary" data-entry-cancel>取消</button>
                </div>
              </div>
            </td>
          </tr>` : '';
        return `
          <tr class="entry-row">
            ${cells}
            <td class="entry-actions">
              <button data-entry-edit="${row.id}">编辑</button>
              <button data-entry-delete="${row.id}">删除</button>
            </td>
          </tr>${editRow}`;
      }).join('');
      const emptyRow = `<tr><td class="entry-empty" colspan="${columns.length + 1}">暂无数据</td></tr>`;
      const body = header + (pageRows.length ? rows : emptyRow) + '</tbody></table>';
      $('entryTable').innerHTML = body + controls;
      document.querySelectorAll('[data-entry-filter]').forEach(select => select.onchange = () => {
        const field = select.dataset.entryFilter;
        entryFilters[field] = select.value;
        if (field === 'year' && !entryFilters.year) {
          entryFilters.month = '';
          entryFilters.day = '';
        }
        if (field === 'month') {
          entryFilters.day = '';
        }
        if (field === 'type') {
          const scopedCategories = entryFilterCategoryOptions();
          if (entryFilters.category && !scopedCategories.includes(entryFilters.category)) entryFilters.category = '';
        }
        if (['year', 'month', 'day'].includes(field)) {
          syncEntryDateRange();
        }
        entryPage = 1;
        renderEntries();
      });
      $('entryClearFilters').onclick = () => {
        clearEntryFilters();
        entryPage = 1;
        renderEntries();
      };
      $('entryPageSize').onchange = () => {
        entryPageSize = $('entryPageSize').value;
        localStorage.setItem('bookkeeping.entryPageSize', entryPageSize);
        entryPage = 1;
        renderEntries();
      };
      $('entryPrev').onclick = () => {
        entryPage -= 1;
        renderEntries();
      };
      $('entryNext').onclick = () => {
        entryPage += 1;
        renderEntries();
      };
      document.querySelectorAll('[data-entry-edit]').forEach(btn => btn.onclick = () => {
        editingEntryId = Number(btn.dataset.entryEdit);
        renderEntries();
      });
      document.querySelectorAll('[data-entry-cancel]').forEach(btn => btn.onclick = () => {
        editingEntryId = null;
        renderEntries();
      });
      document.querySelectorAll('[data-entry-delete]').forEach(btn => btn.onclick = () => scheduleEntryDelete(Number(btn.dataset.entryDelete)));
      document.querySelectorAll('[data-entry-type]').forEach(select => select.onchange = () => {
        const categorySelect = document.querySelector(`[data-entry-category="${select.dataset.entryType}"]`);
        categorySelect.innerHTML = categoryOptionsHtml(categoriesForType(select.value), '', true);
        const targetWrap = document.querySelector(`[data-entry-target-wrap="${select.dataset.entryType}"]`);
        if (targetWrap) targetWrap.classList.toggle('hidden', select.value !== '转账');
      });
      document.querySelectorAll('[data-entry-save]').forEach(btn => btn.onclick = async () => {
        const id = Number(btn.dataset.entrySave);
        const form = document.querySelector(`[data-entry-form="${id}"]`);
        const payload = {id};
        form.querySelectorAll('[data-field]').forEach(input => payload[input.dataset.field] = input.value.trim());
        try {
          await api('/api/entry-update', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(payload)
          });
          editingEntryId = null;
          await refresh();
        } catch (err) {
          alert(err.message === 'not found' ? '后端接口未加载，请重启 Dashboard 后再保存。' : err.message);
        }
      });
    }

    function categoryPath(group, leaf) {
      return leaf ? `${group}/${leaf}` : group;
    }

    function categoriesForType(type) {
      const groups = categoryTree[type] || {};
      return Object.entries(groups).flatMap(([group, leaves]) => {
        if (!leaves.length) return [group];
        return leaves.map(leaf => categoryPath(group, leaf));
      });
    }

    function categoryRuleRows() {
      return entryTypes.flatMap(type => categoriesForType(type).map(category => ({type, category})));
    }

    async function saveCategoryRename(input, key) {
      if (input.dataset.saving === 'true') return;
      const [type, oldCategory] = key.split('|||');
      const newCategory = input.value.trim();
      editingCategoryKey = null;
      if (!newCategory || newCategory === oldCategory) {
        renderCategoryRules();
        return;
      }
      input.dataset.saving = 'true';
      await api('/api/category-rename', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({type, old_category: oldCategory, new_category: newCategory})
      });
      await refresh();
    }

    async function saveKeywordAdd(input, key) {
      if (input.dataset.saving === 'true') return;
      const [type, category] = key.split('|||');
      const keyword = input.value.trim();
      addingKeywordKey = null;
      if (!keyword) {
        renderCategoryRules();
        return;
      }
      input.dataset.saving = 'true';
      const result = await api('/api/keyword-rule-add', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({type, category, keyword})
      });
      if (result.applied_unconfirmed) {
        $('status').textContent = `已自动归类 ${result.applied_unconfirmed} 条待确认记录`;
      }
      await refresh();
    }

    function renderCategoryRules() {
      if (!$('categoryRules')) return;
      const typeValue = entryTypes.includes($('categoryRuleType').value) ? $('categoryRuleType').value : (entryTypes.includes('支出') ? '支出' : entryTypes[0]);
      $('categoryRuleType').innerHTML = optionsHtml(entryTypes, typeValue);
      if (typeValue) $('categoryRuleType').value = typeValue;
      const rows = categoryRuleRows().filter(row =>
        !pendingCategoryDelete || row.type !== pendingCategoryDelete.type || row.category !== pendingCategoryDelete.category
      );
      const firstTypeRows = new Set();
      $('categoryRules').innerHTML = rows.length ? rows.map(row => {
        const rules = keywordRules.filter(rule => rule.category === row.category && (!rule.type || rule.type === row.type));
        const key = `${row.type}|||${row.category}`;
        const isEditing = editingCategoryKey === key;
        const isAddingKeyword = addingKeywordKey === key;
        const showType = !firstTypeRows.has(row.type);
        firstTypeRows.add(row.type);
        return `
          <section class="category-rule-row">
            <div class="category-rule-main">
              <strong>${showType ? esc(row.type) : ''}</strong>
              ${isEditing
                ? `<input class="category-inline-input" value="${esc(row.category)}" aria-label="分类名称" data-category-edit-input="${esc(key)}">`
                : `<span class="category-rule-name">${esc(categoryLabel(row.category))}</span>`}
              <button type="button" class="icon-button" title="编辑分类" aria-label="编辑分类" data-category-edit="${esc(key)}">✎</button>
            </div>
            <div class="keyword-rule-chips">
              ${rules.length ? rules.map(rule => `
                <span class="keyword-rule-chip">
                  ${esc(rule.keyword)}
                  <button type="button" aria-label="删除 ${esc(rule.keyword)}" data-rule-delete="${esc(rule.id)}">×</button>
                </span>
              `).join('') : '<span class="muted">暂无关键词</span>'}
              ${isAddingKeyword
                ? `<input class="keyword-inline-input" placeholder="关键词" aria-label="新增关键词" data-keyword-add-input="${esc(key)}">`
                : `<button type="button" class="icon-button add" title="新增关键词" aria-label="新增关键词" data-keyword-add="${esc(key)}">+</button>`}
            </div>
            <button type="button" class="text-delete" data-category-delete="${esc(key)}">删除</button>
          </section>
        `;
      }).join('') : '<div class="muted">暂无分类</div>';
      document.querySelectorAll('[data-category-edit]').forEach(btn => btn.onclick = () => {
        editingCategoryKey = btn.dataset.categoryEdit;
        addingKeywordKey = null;
        renderCategoryRules();
        document.querySelector(`[data-category-edit-input="${CSS.escape(editingCategoryKey)}"]`)?.focus();
      });
      document.querySelectorAll('[data-category-edit-input]').forEach(input => {
        input.onkeydown = event => {
          if (event.key === 'Enter') saveCategoryRename(input, input.dataset.categoryEditInput).catch(err => alert(err.message));
          if (event.key === 'Escape') {
            editingCategoryKey = null;
            renderCategoryRules();
          }
        };
        input.onblur = () => saveCategoryRename(input, input.dataset.categoryEditInput).catch(err => {
          alert(err.message);
          renderCategoryRules();
        });
      });
      document.querySelectorAll('[data-category-delete]').forEach(btn => btn.onclick = async () => {
        const [type, category] = btn.dataset.categoryDelete.split('|||');
        scheduleCategoryDelete(type, category);
      });
      document.querySelectorAll('[data-keyword-add]').forEach(btn => btn.onclick = () => {
        addingKeywordKey = btn.dataset.keywordAdd;
        editingCategoryKey = null;
        renderCategoryRules();
        document.querySelector(`[data-keyword-add-input="${CSS.escape(addingKeywordKey)}"]`)?.focus();
      });
      document.querySelectorAll('[data-keyword-add-input]').forEach(input => {
        input.onkeydown = event => {
          if (event.key === 'Enter') saveKeywordAdd(input, input.dataset.keywordAddInput).catch(err => alert(err.message));
          if (event.key === 'Escape') {
            addingKeywordKey = null;
            renderCategoryRules();
          }
        };
        input.onblur = () => saveKeywordAdd(input, input.dataset.keywordAddInput).catch(err => {
          alert(err.message);
          renderCategoryRules();
        });
      });
      document.querySelectorAll('[data-rule-delete]').forEach(btn => btn.onclick = async () => {
        await api('/api/keyword-rule-delete', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({id: Number(btn.dataset.ruleDelete)})
        });
        keywordRules = await api('/api/keyword-rules');
        renderCategoryRules();
      });
    }

    function renderQuickFormOptions() {
      const typeValue = $('fType').value;
      $('fType').innerHTML = optionsHtml(entryTypes, typeValue || entryTypes[0]);
      if (entryTypes.includes(typeValue)) $('fType').value = typeValue;
      const accountValue = $('fAccount').value;
      $('fAccount').innerHTML = accountOptions.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('') +
        '<option value="__add_account__">+ 新增账户</option>';
      if (accountOptions.includes(accountValue)) $('fAccount').value = accountValue;
      const targetValue = $('fTargetAccount')?.value;
      if ($('fTargetAccount')) {
        $('fTargetAccount').innerHTML = accountOptions.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('') +
          '<option value="__add_account__">+ 新增账户</option>';
        if (accountOptions.includes(targetValue)) $('fTargetAccount').value = targetValue;
      }
      renderQuickCategoryOptions();
    }

    function renderQuickCategoryOptions() {
      const type = $('fType').value;
      const categoryValue = $('fCategory').value;
      const categories = categoriesForType(type);
      const isTransfer = type === '转账';
      const accountLabel = $('fAccountWrap')?.firstChild;
      if (accountLabel && accountLabel.nodeType === Node.TEXT_NODE) accountLabel.textContent = isTransfer ? '转出账户' : '账户';
      document.querySelector('.quick-main-row')?.classList.toggle('is-transfer', isTransfer);
      $('fTargetAccountWrap')?.classList.toggle('hidden', type !== '转账');
      $('fCategoryWrap')?.classList.toggle('hidden', type === '转账');
      $('fCategory').innerHTML = categories.map(name => `<option value="${esc(name)}">${esc(categoryLabel(name))}</option>`).join('') +
        '<option value="__add_category__">+ 新增分类</option>';
      if (categories.includes(categoryValue)) $('fCategory').value = categoryValue;
    }

    function recentCategorySuggestions(type) {
      const allCategories = categoriesForType(type);
      const counts = new Map();
      entries
        .filter(entry => entry.type === type && entry.category && entry.category !== '转账' && allCategories.includes(entry.category))
        .slice(0, 30)
        .forEach(entry => counts.set(entry.category, (counts.get(entry.category) || 0) + 1));
      const ranked = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
        .map(([category]) => category);
      return ranked.slice(0, 10);
    }

    function snapshotPendingSuggestions() {
      const types = [...new Set(pendingItems.map(item => item.type).filter(Boolean))];
      pendingSuggestionCache = types.reduce((acc, type) => {
        acc[type] = recentCategorySuggestions(type);
        return acc;
      }, {});
    }

    function categoryPicker(id, type) {
      const suggestions = pendingSuggestionCache[type] || [];
      const body = suggestions.map(category =>
        `<button class="chip" data-confirm-id="${esc(id)}" data-category="${esc(category)}">${esc(categoryLabel(category))}</button>`
      ).join('');
      return `<div class="category-picker" id="picker-${esc(id)}">
        <div class="category-group-title">推荐分类</div>
        <div class="category-group-options">${body || '<div class="muted">暂无可选分类</div>'}</div>
      </div>`;
    }

    function renderPendingSummary() {
      const counts = pendingItems.reduce((acc, item) => {
        const key = item.type || '未知';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      $('pendingSummary').innerHTML = rows.length ? rows.map(([name, count]) =>
        `<div class="side-item"><span>${esc(name)}</span><strong>${count}</strong></div>`
      ).join('') : '<div class="muted">没有待确认条目</div>';
    }

    function renderPending() {
      renderPendingSummary();
      if (!pendingItems.length) {
        $('pendingList').innerHTML = '<div class="section muted">没有待确认条目</div>';
        return;
      }
      const visibleItems = pendingItems.slice(0, 4);
      $('pendingList').innerHTML = visibleItems.map((item, index) => {
        const tone = moneyTone(item);
        const id = item.ui_id || item.id;
        return `
          <article class="pending-row pending-card ${index === 0 ? 'is-front' : ''}" data-id="${esc(id)}" style="--i:${index}">
            <section>
              <div class="pending-title">
                <span class="badge">${esc(item.type || '未知')}</span>
                <span class="amount ${tone === 'income' ? 'income' : tone === 'expense' ? 'expense' : 'neutral-money'}">${signedMoney(item.amount_cents, tone)}</span>
              </div>
              <div class="detail-grid">
                <div><span>时间</span>${esc(item.transaction_time)}</div>
                <div><span>账户</span>${esc(item.account)}</div>
                <div><span>转入账户</span>${esc(item.target_account || '')}</div>
                <div><span>参与人</span>${esc(item.participant || '')}</div>
                <label class="pending-object-field">
                  <span>交易对象</span>
                  <input data-confirm-object="${esc(id)}" value="${esc(item.transaction_object || '')}" placeholder="对方名称、债务人或平台">
                </label>
                <label class="pending-object-field">
                  <span>备注</span>
                  <textarea data-confirm-note="${esc(id)}" rows="3" placeholder="补充说明">${esc(item.note || '')}</textarea>
                </label>
              </div>
            </section>
            <section>
              ${categoryPicker(id, item.type)}
              <div class="confirm-line">
                <select id="cat-${id}">${categoryOptionsHtml(categoriesForType(item.type), item.category, false)}</select>
                <button class="secondary" data-pending-skip="${esc(id)}">跳过</button>
                <button class="primary" data-confirm-id="${esc(id)}">确认</button>
              </div>
            </section>
          </article>`;
      }).join('');
    }

    async function confirmWithCategory(id, category) {
      if (pendingAnimating) return;
      pendingAnimating = true;
      try {
        const objectInput = document.querySelector(`[data-confirm-object="${CSS.escape(String(id))}"]`);
        const noteInput = document.querySelector(`[data-confirm-note="${CSS.escape(String(id))}"]`);
        const item = pendingItems.find(item => String(item.ui_id || item.id) === String(id));
        await api('/api/confirm', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            id: item ? item.id : id,
            source: item?.source,
            category,
            transaction_object: objectInput ? objectInput.value.trim() : '',
            note: noteInput ? noteInput.value.trim() : '',
            learn: false
          })
        });
        const card = document.querySelector(`.pending-card[data-id="${CSS.escape(String(id))}"]`);
        if (card) {
          card.classList.add('is-leaving');
          await new Promise(resolve => setTimeout(resolve, 260));
        }
        await refresh();
      } finally {
        pendingAnimating = false;
      }
    }

    async function confirmPending(id) {
      const category = $(`cat-${id}`).value.trim();
      if (!category) return;
      await confirmWithCategory(id, category);
    }

    function skipPending(id) {
      if (pendingAnimating) return;
      const index = pendingItems.findIndex(item => String(item.ui_id || item.id) === String(id));
      if (index < 0 || pendingItems.length < 2) return;
      pendingSkippedIds = pendingSkippedIds.filter(itemId => String(itemId) !== String(id));
      pendingSkippedIds.push(String(id));
      savePendingSkippedIds();
      const [item] = pendingItems.splice(index, 1);
      pendingItems.push(item);
      renderPending();
    }

    window.confirmPending = confirmPending;
    window.confirmWithCategory = confirmWithCategory;

    $('pendingList').addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-picker]');
      if (toggle) {
        const picker = $(`picker-${toggle.dataset.togglePicker}`);
        if (picker) picker.classList.toggle('hidden');
        return;
      }
      const skip = event.target.closest('[data-pending-skip]');
      if (skip) {
        skipPending(skip.dataset.pendingSkip);
        return;
      }
      const target = event.target.closest('[data-confirm-id]');
      if (!target) return;
      const id = target.dataset.confirmId;
      const category = target.dataset.category || $(`cat-${id}`)?.value.trim();
      if (!category) return;
      confirmWithCategory(id, category).catch(err => $('status').textContent = err.message);
    });

    const titles = {home: '财务总览', entries: '账单', confirm: '待确认分类', assets: '账户', settings: '设置'};
    async function switchView(view) {
      await commitPendingDeletes({refreshAfter: true});
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      const btn = document.querySelector(`nav button[data-view="${view}"]`);
      if (!btn) return;
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
      $(view).classList.remove('hidden');
      $('pageTitle').textContent = titles[view] || '账簿';
      $('periodPanel').classList.toggle('hidden', view !== 'home');
      if (view === 'entries') renderEntries();
      if (view === 'confirm') {
        snapshotPendingSuggestions();
        renderPending();
      }
    }
    document.querySelectorAll('nav button').forEach(btn => btn.onclick = () => switchView(btn.dataset.view).catch(err => alert(err.message)));

    window.addEventListener('pagehide', () => {
      commitPendingDeletes({keepalive: true, silent: true});
    });

    function jumpToEntriesByTone(tone) {
      const range = currentRange();
      entryFilters = {year: '', month: '', day: '', type: '', category: '', account: '', transaction_object: '', tone, start: range.start, end: range.end};
      entryPage = 1;
      switchView('entries');
    }
    $('incomeKpi').onclick = () => jumpToEntriesByTone('income');
    $('expenseKpi').onclick = () => jumpToEntriesByTone('expense');
    function setExpenseCategoryLevel(level) {
      expenseCategoryLevel = level;
      localStorage.setItem('bookkeeping.expenseCategoryLevel', expenseCategoryLevel);
      updateOverview();
    }
    document.querySelector('.level-switch')?.addEventListener('click', event => {
      event.preventDefault();
      setExpenseCategoryLevel(expenseCategoryLevel === 'major' ? 'minor' : 'major');
    });

    document.querySelectorAll('[data-period-mode]').forEach(btn => btn.onclick = () => {
      periodMode = btn.dataset.periodMode;
      if (periodMode === 'year') yearOffset = 0;
      if (periodMode === 'month') monthOffset = 0;
      if (periodMode === 'more') selectedCycleIndex = 0;
      updateOverview();
    });
    $('rangeStartTrigger').onclick = (event) => openDatePicker('start', event.currentTarget);
    $('rangeEndTrigger').onclick = (event) => openDatePicker('end', event.currentTarget);
    $('datePickerYear').onchange = () => {
      pickerMonth = new Date(Number($('datePickerYear').value), pickerMonth.getMonth(), 1);
      renderDatePicker();
    };
    $('datePickerMonth').onchange = () => {
      pickerMonth = new Date(pickerMonth.getFullYear(), Number($('datePickerMonth').value), 1);
      renderDatePicker();
    };
    $('datePickerGrid').onclick = (event) => {
      const target = event.target.closest('[data-date]');
      if (!target || !activeDateTarget) return;
      const range = currentRange();
      customStart = activeDateTarget === 'start' ? target.dataset.date : range.start;
      customEnd = activeDateTarget === 'end' ? target.dataset.date : range.end;
      if (customStart && customEnd && customStart > customEnd) {
        [customStart, customEnd] = [customEnd, customStart];
      }
      periodMode = 'all';
      closeDatePicker();
      updateOverview();
    };
    document.addEventListener('click', (event) => {
      if ($('datePicker').classList.contains('hidden')) return;
      if (event.target.closest('#datePicker') || event.target.closest('.date-trigger')) return;
      closeDatePicker();
    });
    document.querySelectorAll('[data-cycle]').forEach(btn => btn.onclick = () => {
      cycleMode = btn.dataset.cycle;
      selectedCycleIndex = 0;
      updateOverview();
    });
    $('prevCycle').onclick = () => {
      if (periodMode === 'year') yearOffset -= 1;
      else if (periodMode === 'month') monthOffset -= 1;
      else selectedCycleIndex += 1;
      updateOverview();
    };
    $('nextCycle').onclick = () => {
      if (periodMode === 'year') yearOffset += 1;
      else if (periodMode === 'month') monthOffset += 1;
      else selectedCycleIndex = Math.max(0, selectedCycleIndex - 1);
      updateOverview();
    };

    $('quickAdd').onclick = () => $('quickForm').classList.toggle('hidden');
    $('toggleQuickMore').onclick = () => {
      const panel = $('quickMoreFields');
      const expanded = panel.classList.toggle('hidden') === false;
      $('toggleQuickMore').textContent = expanded ? '收起' : '展开';
    };
    function applyTheme(dark) {
      document.body.dataset.theme = dark ? 'dark' : '';
      $('themeToggle').checked = dark;
      localStorage.setItem('bookkeeping.theme', dark ? 'dark' : 'light');
      if (summaryData) updateOverview();
    }
    function applyColorMode(inverted) {
      document.body.dataset.colorInverted = inverted ? 'true' : '';
      $('colorInvert').checked = inverted;
      localStorage.setItem('bookkeeping.colorInverted', inverted ? 'true' : 'false');
      if (summaryData) updateOverview();
    }
    $('themeToggle').onchange = () => applyTheme($('themeToggle').checked);
    $('colorInvert').onchange = () => applyColorMode($('colorInvert').checked);
    $('addCategoryRule').onclick = async () => {
      const category = $('newCategoryName').value.trim();
      if (!category) return;
      await api('/api/category-add', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({type: $('categoryRuleType').value, category})
      });
      $('newCategoryName').value = '';
      await refresh();
    };
    applyTheme(localStorage.getItem('bookkeeping.theme') === 'dark');
    applyColorMode(localStorage.getItem('bookkeeping.colorInverted') === 'true');
    $('search').oninput = () => {
      entryPage = 1;
      renderEntries();
    };
    $('fType').onchange = renderQuickCategoryOptions;
    async function addAccountFromQuick(selectId) {
      const select = $(selectId);
      if (select.value !== '__add_account__') return;
      const name = prompt('新增账户名称');
      if (!name || !name.trim()) {
        renderQuickFormOptions();
        return;
      }
      await api('/api/account-add', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({name: name.trim()})
      });
      accountOptions = await api('/api/account-names');
      renderQuickFormOptions();
      select.value = name.trim();
    }

    $('fAccount').onchange = async () => {
      await addAccountFromQuick('fAccount');
    };
    $('fTargetAccount').onchange = async () => {
      await addAccountFromQuick('fTargetAccount');
    };
    $('fCategory').onchange = async () => {
      if ($('fCategory').value !== '__add_category__') return;
      const category = prompt($('fType').value === '支出' ? '新增分类，格式：一级/二级' : '新增分类名称');
      if (!category || !category.trim()) {
        renderQuickCategoryOptions();
        return;
      }
      await api('/api/category-add', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({type: $('fType').value, category: category.trim()})
      });
      [categoryOptions, categoryTree] = await Promise.all([api('/api/categories'), api('/api/category-tree')]);
      entryTypes = Object.keys(categoryTree);
      renderQuickCategoryOptions();
      $('fCategory').value = category.trim();
    };
    $('saveEntry').onclick = async () => {
      const isTransfer = $('fType').value === '转账';
      if ($('fAccount').value === '__add_account__' || (isTransfer && $('fTargetAccount').value === '__add_account__') || (!isTransfer && $('fCategory').value === '__add_category__')) return;
      await api('/api/add', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          type: $('fType').value,
          amount: $('fAmount').value,
          transaction_time: $('fTime').value ? $('fTime').value.replace('T', ' ') : '',
          account: $('fAccount').value,
          target_account: isTransfer ? $('fTargetAccount').value : '',
          category: isTransfer ? '转账' : $('fCategory').value,
          transaction_object: $('fTransactionObject').value.trim(),
          participant: '自己',
          note: $('fNote').value.trim(),
          learn: $('fLearn').checked
        })
      });
      $('fAmount').value = '';
      $('fTransactionObject').value = '';
      $('fNote').value = '';
      $('fTime').value = nowDatetimeLocal();
      refresh();
    };

    refresh().catch(err => $('status').textContent = err.message);
