import fs from 'fs';
import path from 'path';

const root = process.cwd();
const inv = JSON.parse(fs.readFileSync(path.join(root, 'docs/_tmp_db_inventory.json'), 'utf8'));

/** Isolate one supabase query chain starting at the .from('table') line. */
function isolateFromChain(lines, focusIdx, tableName) {
  const fromRe = new RegExp(`\\.from\\(\\s*['"]${tableName}['"]\\s*\\)`);
  // Find the actual from line nearby
  let fromIdx = focusIdx;
  for (let j = Math.max(0, focusIdx - 3); j <= Math.min(lines.length - 1, focusIdx + 3); j++) {
    if (fromRe.test(lines[j])) {
      fromIdx = j;
      break;
    }
  }

  // Walk backward to start of this builder expression (supabase / client / await)
  let begin = fromIdx;
  for (let j = fromIdx; j >= Math.max(0, fromIdx - 12); j--) {
    const L = lines[j];
    if (
      /(?:await\s+)?(?:supabase|client)\s*\n?/.test(L) ||
      /(?:supabase|client)\s*$/.test(L.trim()) ||
      /(?:supabase|client)\s*\./.test(L) ||
      /^\s*(?:supabase|client)\s*$/.test(L) ||
      /=\s*(?:await\s+)?(?:supabase|client)\b/.test(L) ||
      /\?\s*(?:await\s+)?(?:supabase|client)\b/.test(L) ||
      /:\s*(?:await\s+)?(?:supabase|client)\b/.test(L) ||
      /\(\s*(?:await\s+)?(?:supabase|client)\b/.test(L) ||
      /(?:await\s+)?(?:supabase|client)\s*$/.test(L.trim())
    ) {
      begin = j;
      break;
    }
    // also: line that is just "supabase" then next lines chain
    if (/^\s*(?:supabase|client)\s*$/.test(L)) {
      begin = j;
      break;
    }
    begin = j;
  }

  // Prefer start at supabase/client token line if present in window
  for (let j = fromIdx; j >= begin; j--) {
    if (/(?:supabase|client)/.test(lines[j])) {
      begin = j;
      break;
    }
  }

  // Walk forward collecting only THIS chain: stop when we hit a sibling starting with supabase/client
  // or a closing of Promise.all array element (trailing comma after ;-less chain)
  let end = fromIdx;
  let paren = 0;
  let seenFrom = false;
  for (let j = begin; j < Math.min(lines.length, fromIdx + 40); j++) {
    const L = lines[j];
    if (fromRe.test(L)) seenFrom = true;
    // If after from we see another .from( for a different table on a new supabase call, stop before it
    if (seenFrom && j > fromIdx) {
      if (/^\s*(?:supabase|client)\b/.test(L) || /^\s*(?:await\s+)?(?:supabase|client)\b/.test(L)) {
        end = j - 1;
        break;
      }
      // ternary other branch
      if (/^\s*\?\s*(?:await\s+)?(?:supabase|client)\b/.test(L)) {
        end = j - 1;
        break;
      }
    }
    for (const ch of L) {
      if (ch === '(') paren++;
      if (ch === ')') paren--;
    }
    end = j;
    // End of statement
    if (seenFrom && /;\s*$/.test(L) && paren <= 0) break;
    // End of array element in Promise.all: line ends with ), or ),
    if (seenFrom && paren <= 0 && /\)\s*,\s*$/.test(L)) break;
    // End when next non-chain keyword at paren 0
    if (
      seenFrom &&
      j > fromIdx &&
      paren <= 0 &&
      /^\s*(const|let|var|if|return|\}|\/\/|\]\s*;)/.test(L)
    ) {
      end = j - 1;
      break;
    }
  }

  const chain = lines.slice(begin, end + 1).join('\n');
  return { chain, begin, end, fromIdx };
}

function nearestFunc(lines, idx) {
  for (let j = idx; j >= Math.max(0, idx - 120); j--) {
    const fm =
      lines[j].match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/) ||
      lines[j].match(/(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/) ||
      lines[j].match(/(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/);
    if (fm) return fm[1];
  }
  // React component export default function
  for (let j = idx; j >= Math.max(0, idx - 200); j--) {
    const fm = lines[j].match(/function\s+([A-Z][A-Za-z0-9_]*)\s*\(/);
    if (fm) return fm[1];
  }
  return '';
}

function screenFor(entry, func) {
  const f = entry.file;
  if (f.includes('OrderRoutingEditor')) return 'Order routing editor';
  if (f.includes('OrderCompletion')) return 'Order completion';
  if (f.includes('CreateOrder')) return 'Create order';
  if (f.includes('UserManagement')) return 'User management';
  if (f.includes('dayReport')) return 'Day report';
  if (f.includes('styleReport')) return 'Style report';
  if (f.includes('reportMeta')) return 'Report metadata';
  if (f.includes('transactionReport')) return 'Transaction report';
  if (f.includes('kpiAndProgress')) return 'KPI progress';
  if (f.includes('settingsTableFetchers') || f.includes('settingsStore') || f.includes('settingsRpc'))
    return 'Settings';
  if (f.includes('orderProgress')) return 'Order progress';
  if (f.includes('orderSizeProgress')) return 'Size progress';
  if (f.includes('ganttFabric')) return 'Gantt fabric actuals';
  if (f.includes('useOrderCutFabric')) return 'Cut fabric by route';
  if (f.includes('floorBoard')) return 'Floor board';
  if (f.includes('floorUser')) return 'Floor user access';
  if (f.includes('factoryOrders')) return 'Orders enrich';
  if (f.includes('planningDetail')) return 'Planning detail';
  if (f.includes('reloadOrder')) return 'Reload order';
  if (f.includes('orderForm')) return 'Order form';
  if (f.includes('dashboard')) return 'Dashboard';
  if (f.includes('useOrderAllocations')) return 'Order allocations';
  if (f.includes('ganttSchedule')) return 'Gantt schedule';
  if (f.includes('useOrdersList')) return 'Orders list';
  if (f.includes('buyerOrderCount')) return 'Buyer order count';
  if (f.includes('operationsDb')) return 'Operations DB';
  if (f.includes('fabricComponent')) return 'Fabric components';
  if (f.includes('departmentWorkforce')) return 'Workforce rates';
  if (f.includes('orderFlowMetrics')) return 'Order flow metrics';
  if (f.includes('colorwayCompletion')) return 'Colorway completion';
  if (f.includes('ensureSupport')) return 'Support dropdowns';
  if (f.includes('orderRoutingEditor')) return 'Routing editor load';
  if (f.includes('desktopFulfillment')) return 'Desktop fulfillment';
  if (f.includes('styleOrderDb') || f.includes('saveStyleOrder')) return 'Style order save';
  if (f.includes('mesCapture')) return 'Floor capture';
  if (f.includes('authSession')) return 'Auth session';
  if (f.includes('orderDetailBundle')) return 'Order detail bundle';
  if (f.includes('saveLinePlan')) return 'Save line plan';
  if (f.includes('colorwayRouting')) return 'Colorway routing';
  if (f.includes('departmentResourceSync')) return 'Dept resource sync';
  if (f.includes('queries/resources')) return 'Assigned resources';
  return func || entry.name;
}

const fromResults = [];
for (const e of inv.from) {
  const full = path.join(root, e.file);
  const text = fs.readFileSync(full, 'utf8');
  const lines = text.split(/\r?\n/);
  const idx = e.line - 1;
  const { chain } = isolateFromChain(lines, idx, e.name);

  const hasInsert = /\.insert\s*\(/.test(chain);
  const hasUpdate = /\.update\s*\(/.test(chain);
  const hasUpsert = /\.upsert\s*\(/.test(chain);
  const hasDelete = /\.delete\s*\(/.test(chain) && !/\.select\s*\(/.test(chain);
  let op = 'select';
  if (hasInsert) op = 'insert';
  else if (hasUpdate) op = 'update';
  else if (hasUpsert) op = 'upsert';
  else if (hasDelete) op = 'delete';
  else if (!/\.select\s*\(/.test(chain)) {
    // still treat as select if only .from without explicit write
    op = 'select?';
  }

  const factoryEq = /\.eq\(\s*['"]factory_id['"]\s*,/.test(chain);
  let source = 'N/A';
  if (factoryEq) {
    const m = chain.match(/\.eq\(\s*['"]factory_id['"]\s*,\s*([^)\n]+)\)/);
    source = m ? m[1].trim() : '?';
  }
  const idEq = /\.eq\(\s*['"]id['"]\s*,/.test(chain);
  let idSource = null;
  if (idEq) {
    const m = chain.match(/\.eq\(\s*['"]id['"]\s*,\s*([^)\n]+)\)/);
    idSource = m ? m[1].trim() : '?';
  }
  const func = nearestFunc(lines, idx);
  fromResults.push({
    table: e.name,
    file: e.file.replace(/\\/g, '/'),
    line: e.line,
    op,
    factoryEq,
    source,
    idEq,
    idSource,
    func,
    screen: screenFor(e, func),
    chain,
  });
}

function extractRpcCall(lines, focusIdx, rpcName) {
  // Find line with .rpc('name'
  let startIdx = focusIdx;
  const rpcRe = new RegExp(`\\.rpc\\(\\s*['"]${rpcName}['"]`);
  for (let j = Math.max(0, focusIdx - 2); j <= Math.min(lines.length - 1, focusIdx + 2); j++) {
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

  // Args object: find .rpc('name', { ... }) or .rpc('name')
  const rpcCallMatch = blob.match(new RegExp(`\\.rpc\\(\\s*['"]${rpcName}['"]\\s*(,\\s*)?`));
  if (!rpcCallMatch) {
    return { keys: [], pFactorySource: 'N/A (no p_factory_id)', blob, obj: '' };
  }
  const afterName = blob.slice(rpcCallMatch.index + rpcCallMatch[0].length);
  if (!afterName.trimStart().startsWith('{')) {
    return { keys: [], pFactorySource: 'N/A (no p_factory_id)', blob, obj: '' };
  }
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
    if (ch === '{') d++;
    if (ch === '}') d--;
    if (ch === '\n' || i === obj.length) {
      if (d === 0) {
        const km = lineBuf.match(/^\s*([A-Za-z0-9_]+)\s*:/);
        if (km && !seen.has(km[1])) {
          seen.add(km[1]);
          keys.push(km[1]);
        }
      }
      lineBuf = '';
    } else {
      lineBuf += ch;
    }
  }
  let pFactorySource = 'N/A (no p_factory_id)';
  const pfm = obj.match(/p_factory_id\s*:\s*([^,\n}]+)/);
  if (pfm) pFactorySource = pfm[1].trim();
  return { keys, pFactorySource, blob, obj };
}

const rpcResults = [];
for (const e of inv.rpc) {
  const full = path.join(root, e.file);
  const text = fs.readFileSync(full, 'utf8');
  const lines = text.split(/\r?\n/);
  const idx = e.line - 1;
  const { keys, pFactorySource, blob, obj } = extractRpcCall(lines, idx, e.name);
  const func = nearestFunc(lines, idx);
  rpcResults.push({
    name: e.name,
    file: e.file.replace(/\\/g, '/'),
    line: e.line,
    keys,
    pFactorySource,
    func,
    screen: screenFor(e, func),
    blob,
    obj,
  });
}

// Sort
fromResults.sort((a, b) => a.table.localeCompare(b.table) || a.file.localeCompare(b.file) || a.line - b.line);
rpcResults.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line);

fs.writeFileSync(
  path.join(root, 'docs/_tmp_from_rpc_audit.json'),
  JSON.stringify({ fromResults, rpcResults }, null, 2)
);

console.log('from', fromResults.length, 'rpc', rpcResults.length);
console.log('ops', Object.fromEntries([...new Set(fromResults.map((r) => r.op))].map((o) => [o, fromResults.filter((r) => r.op === o).length])));
console.log('factoryEq yes', fromResults.filter((r) => r.factoryEq).length, 'no', fromResults.filter((r) => !r.factoryEq).length);
console.log('NO factory_id:');
fromResults
  .filter((r) => !r.factoryEq)
  .forEach((r) => console.log(`  ${r.table} ${r.file}:${r.line} idEq=${r.idEq} src=${r.idSource || ''} | ${r.chain.replace(/\n/g, ' / ').slice(0, 160)}`));
console.log('rpc keys empty:', rpcResults.filter((r) => r.keys.length === 0).map((r) => `${r.name}:${r.line}`));
console.log('rpc sample:', rpcResults.slice(0, 3).map((r) => ({ name: r.name, keys: r.keys, p: r.pFactorySource })));
