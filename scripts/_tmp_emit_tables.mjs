import fs from 'fs';

const inv = JSON.parse(fs.readFileSync('docs/_tmp_db_inventory.json', 'utf8'));
const audit = JSON.parse(fs.readFileSync('docs/_tmp_from_rpc_audit.json', 'utf8'));

function extractKeys(blob, rpcName) {
  const rpcCallMatch = blob.match(new RegExp(`\\.rpc\\(\\s*['"]${rpcName}['"]\\s*(,\\s*)?`));
  if (!rpcCallMatch) return { keys: [], p: 'N/A (no p_factory_id)' };
  const afterName = blob.slice(rpcCallMatch.index + rpcCallMatch[0].length);
  if (!afterName.trimStart().startsWith('{')) return { keys: [], p: 'N/A (no p_factory_id)' };
  const startBrace = afterName.indexOf('{');
  let depth = 0;
  let end = -1;
  for (let k = startBrace; k < afterName.length; k++) {
    if (afterName[k] === '{') depth++;
    if (afterName[k] === '}') {
      depth--;
      if (depth === 0) {
        end = k;
        break;
      }
    }
  }
  const obj = afterName.slice(startBrace + 1, end);
  const keys = [];
  const seen = new Set();
  let d = 0;
  let lineBuf = '';
  for (let i = 0; i <= obj.length; i++) {
    const ch = i < obj.length ? obj[i] : '\n';
    if (ch === '\n' || i === obj.length) {
      if (d === 0) {
        // key: value  OR shorthand property (p_defects,)
        const km =
          lineBuf.match(/^\s*([A-Za-z0-9_]+)\s*:/) ||
          lineBuf.match(/^\s*([A-Za-z0-9_]+)\s*,?\s*$/);
        if (km && !seen.has(km[1])) {
          seen.add(km[1]);
          keys.push(km[1]);
        }
      }
      for (const c of lineBuf) {
        if (c === '{') d++;
        if (c === '}') d--;
      }
      lineBuf = '';
    } else {
      lineBuf += ch;
    }
  }
  let p = 'N/A (no p_factory_id)';
  const pfm = obj.match(/p_factory_id\s*:\s*([^,\n}]+)/);
  if (pfm) p = pfm[1].trim();
  return { keys, p };
}

function getBlob(file, line, rpcName) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const idx = line - 1;
  let startIdx = idx;
  const rpcRe = new RegExp(`\\.rpc\\(\\s*['"]${rpcName}['"]`);
  for (let j = Math.max(0, idx - 2); j <= Math.min(lines.length - 1, idx + 2); j++) {
    if (rpcRe.test(lines[j])) {
      startIdx = j;
      break;
    }
  }
  let blob = '';
  let paren = 0;
  let started = false;
  for (let j = startIdx; j < Math.min(lines.length, startIdx + 80); j++) {
    blob += lines[j] + '\n';
    for (const ch of lines[j]) {
      if (ch === '(') {
        paren++;
        started = true;
      }
      if (ch === ')') paren--;
    }
    if (started && paren <= 0) break;
  }
  return blob;
}

for (const e of inv.rpc) {
  const blob = getBlob(e.file, e.line, e.name);
  const { keys, p } = extractKeys(blob, e.name);
  const r = audit.rpcResults.find(
    (x) => x.name === e.name && x.file.replace(/\\/g, '/') === e.file.replace(/\\/g, '/') && x.line === e.line,
  );
  if (r) {
    r.keys = keys;
    r.pFactorySource = p;
  }
}

audit.rpcResults.forEach((r) => {
  r.file = r.file.replace(/\\/g, '/');
});
audit.fromResults.forEach((r) => {
  r.file = r.file.replace(/\\/g, '/');
});

function phrase(expr, file, line) {
  if (!expr || expr.startsWith('N/A')) return 'N/A — RPC has no p_factory_id';
  const e = expr.trim().replace(/\s+/g, ' ');
  // Call-site-specific traces where factoryId is a local, not always a param
  if (file === 'stores/settingsStore.ts') {
    if (line === 605) return 'b.factory_id || nav factoryId';
    if (line === 638) return 'nav store factoryId';
    if (line === 901 || line === 934) return 'sh.factory_id || nav factoryId';
    if (line === 967) return 'nav store factoryId';
    if (line === 1134 || line === 1152) return 'g.factory_id || nav factoryId';
    if (line === 1170) return 'nav store factoryId';
    if (line === 1193) return 'nav store factoryId';
  }
  if (e === 'factoryId') return 'fn param factoryId';
  if (e === 'factory_id') return 'local factory_id var';
  if (e === 'b.factory_id') return 'buyer draft b.factory_id';
  if (e === 'newDept.factory_id') return 'newDept.factory_id';
  if (e === 'newFlow.factory_id') return 'newFlow.factory_id';
  return e;
}
audit.rpcResults.forEach((r) => {
  r.pPhrase = phrase(r.pFactorySource, r.file, r.line);
});

function refineScreen(r) {
  const f = r.file;
  if (r.table === 'factories') return f.includes('CreateOrder') ? 'Create order code' : 'Factory settings';
  if (f.includes('OrderRoutingEditor')) return 'Routing usage check';
  if (f.includes('OrderCompletion')) return 'Order completion';
  if (f.includes('UserManagement')) return 'User management';
  if (f.includes('useOrdersList')) return 'Orders list';
  if (f.includes('buyerOrderCount')) return 'Buyer order count';
  if (f.includes('colorwayCompletion')) return 'Colorway completion';
  if (f.includes('orderFormQueries')) return 'Order form';
  if (f.includes('factoryOrders')) return 'Orders enrich';
  if (f.includes('planningDetail')) return 'Planning detail';
  if (f.includes('reloadOrder')) return 'Reload order';
  if (f.includes('useOrderCutFabric')) return 'Cut fabric by route';
  if (f.includes('ganttFabric')) return 'Gantt fabric actuals';
  if (f.includes('useOrderAllocations')) return 'Order allocations';
  if (f.includes('ganttSchedule')) return 'Gantt schedule';
  if (f.includes('dashboard')) return 'Dashboard';
  if (f.includes('floorBoard')) return 'Floor board';
  if (f.includes('floorUser')) return 'Floor user access';
  if (f.includes('orderRoutingEditor')) return 'Routing editor load';
  if (f.includes('orderFlowMetrics')) return 'Order flow metrics';
  if (f.includes('operationsDb')) return 'Operations DB';
  if (f.includes('fabricComponentDb')) return 'Fabric components';
  if (f.includes('departmentWorkforce')) return 'Workforce rates';
  if (f.includes('ensureSupport')) return 'Support dropdowns';
  if (f.includes('settingsTableFetchers') || f.includes('settingsStore')) return 'Settings';
  if (f.includes('dayReport')) return 'Day report';
  if (f.includes('styleReport')) return 'Style report';
  if (f.includes('reportMeta')) return 'Report metadata';
  if (f.includes('transactionReport')) return 'Transaction report';
  if (f.includes('kpiAndProgress')) return 'KPI progress';
  if (f.includes('orderProgress')) return 'Order progress';
  if (f.includes('orderSizeProgress')) return 'Size progress';
  if (f.includes('queries/resources')) return 'Assigned resources';
  return r.screen;
}
audit.fromResults.forEach((r) => {
  r.screen = refineScreen(r);
});

function rpcScreen(r) {
  const n = r.name;
  const f = r.file;
  if (n === 'get_my_profile') return 'Auth session';
  if (n === 'floor_capture') return 'Floor capture';
  if (n === 'delete_style_order' || n === 'save_style_order') return 'Style order';
  if (n === 'save_line_plan') return 'Line planning';
  if (n === 'save_order_routing') return 'Order routing';
  if (n === 'replace_floor_user_access') return 'Floor user access';
  if (n === 'save_colorway_planning_remarks') return 'Planning remarks';
  if (n.includes('desktop') || f.includes('desktopFulfillment')) return 'Desktop fulfillment';
  if (f.includes('kpiAndProgress') || n.includes('kpi') || n.includes('progress') || n.includes('cut_to_ship'))
    return 'Reports / KPIs';
  if (f.includes('styleReport') || n.includes('audit_report')) return 'Style report';
  if (f.includes('transactionReport') || n.includes('handover')) return 'Handover report';
  if (f.includes('floorBoard')) return 'Floor board';
  if (f.includes('orderProgress') || f.includes('orderSize') || f.includes('orderDetail'))
    return 'Order progress';
  if (f.includes('departmentResource')) return 'Dept resources';
  if (f.includes('fabricComponent')) return 'Fabric components';
  if (n.startsWith('save_') || n.startsWith('ensure_') || f.includes('settings')) return 'Settings';
  return r.screen;
}
audit.rpcResults.forEach((r) => {
  r.screen = rpcScreen(r);
});

audit.fromResults.sort(
  (a, b) => a.table.localeCompare(b.table) || a.file.localeCompare(b.file) || a.line - b.line,
);
audit.rpcResults.sort(
  (a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line,
);

fs.writeFileSync('docs/_tmp_from_rpc_audit.json', JSON.stringify(audit, null, 2));

let md = '### FROM table\n';
md +=
  "| Table | Operation | Columns written | Is `.eq('factory_id', ...)` applied? | Source of that value | file:line | Screen |\n";
md += '|---|---|---|---|---|---|---|\n';
for (const r of audit.fromResults) {
  let applied = r.factoryEq ? 'yes' : 'no';
  let source = r.factoryEq ? r.source : 'N/A';
  if (r.table === 'factories') {
    applied = `factory_id_eq=no, id_eq=${r.idEq ? 'yes' : 'no'}`;
    source = r.idEq ? r.idSource : 'N/A';
  }
  md += `| ${r.table} | ${r.op} | — | ${applied} | ${source} | ${r.file}:${r.line} | ${r.screen} |\n`;
}
md += '\n### RPC table\n';
md +=
  '| RPC name | Argument keys passed (exact) | Where `p_factory_id` value comes from | file:line | Screen / feature |\n';
md += '|---|---|---|---|---|\n';
for (const r of audit.rpcResults) {
  const keys = r.keys.length ? r.keys.join(', ') : '(none)';
  md += `| ${r.name} | ${keys} | ${r.pPhrase} | ${r.file}:${r.line} | ${r.screen} |\n`;
}
fs.writeFileSync('docs/_tmp_from_rpc_tables.md', md);
console.log('from', audit.fromResults.length, 'rpc', audit.rpcResults.length);
console.log(
  'log_desktop_shipment',
  audit.rpcResults.find((r) => r.name === 'log_desktop_shipment').keys,
);
console.log(
  'save_department:713',
  audit.rpcResults.find((r) => r.name === 'save_department' && r.line === 713).keys,
);
console.log('factory yes', audit.fromResults.filter((r) => r.factoryEq).length);
console.log('factory no', audit.fromResults.filter((r) => !r.factoryEq).length);
