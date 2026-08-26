#!/usr/bin/env node
/**
 * Cache baseline tool (Phase 0 of docs/pi-agent-cache-and-dsh-plan.md).
 *
 * Three modes:
 *
 *   node scripts/cache-baseline.js stats [--since=YYYY-MM-DD] [--until=YYYY-MM-DD]
 *     Aggregate data/cache-metrics/*.jsonl into a per-provider hit-ratio table.
 *     Works offline; requires no server or LLM.
 *
 *   node scripts/cache-baseline.js cost [--since=YYYY-MM-DD] [--until=YYYY-MM-DD]
 *     Aggregate the same records into an estimated cost report (CNY): totals
 *     plus breakdowns by provider/model, by day and by conversation. Prices are
 *     reference values (see PRICE_TIERS below; DeepSeek changes them over time,
 *     and the src/server/services/cache-metrics.ts table is the authoritative
 *     one — keep the two in sync).
 *
 *   node scripts/cache-baseline.js replay --baseUrl=http://127.0.0.1:PORT
 *     [--userId=web-user] [--conversationId=baseline-<ts>] [--forceProvider=secondary|primary|codex]
 *     [--rounds=6] [--twice] [--message="..."]
 *     Replays a fixed scripted conversation against a RUNNING local server
 *     (non-stream, so each turn completes before the next starts), twice when
 *     --twice is set (first pass warms the provider cache, second pass should
 *     show cache hits). Prints the aggregate stats after each pass.
 *
 * The script never fabricates cache numbers: hitRatio stays "n/a" until the
 * provider actually reports cached tokens.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const METRICS_DIR = path.join(PROJECT_ROOT, 'data', 'cache-metrics');

// Reference CNY-per-million-token prices; mirrors src/server/services/cache-metrics.ts.
const PRICE_TIERS = [
  { match: /reasoner|r1/i, input: 4, cache: 1, output: 16 },
  { match: /chat|v3|deepseek/i, input: 2, cache: 0.5, output: 8 },
  { match: /.*/, input: 2, cache: 0.5, output: 8 },
];

function resolvePriceTier(model) {
  const text = String(model || '').toLowerCase();
  for (const tier of PRICE_TIERS) {
    if (tier.match.test(text)) return tier;
  }
  return PRICE_TIERS[PRICE_TIERS.length - 1];
}

function estimateRecordCostYuan(record) {
  const tier = resolvePriceTier(record.model);
  const paidInput = Number(record.inputTokens) || 0;
  const cacheRead = record.cacheReadTokens !== undefined ? (Number(record.cacheReadTokens) || 0) : 0;
  const output = Number(record.outputTokens) || 0;
  return (paidInput * tier.input + cacheRead * tier.cache + output * tier.output) / 1_000_000;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const item of argv) {
    if (item.startsWith('--')) {
      const eq = item.indexOf('=');
      if (eq > 0) args[item.slice(2, eq)] = item.slice(eq + 1);
      else args[item.slice(2)] = true;
    } else {
      args._.push(item);
    }
  }
  return args;
}

function readRecords(since, until) {
  const files = fs.existsSync(METRICS_DIR)
    ? fs.readdirSync(METRICS_DIR).filter(f => f.endsWith('.jsonl')).sort()
    : [];
  const records = [];
  for (const file of files) {
    const stamp = file.replace(/\.jsonl$/, '');
    if (since && stamp < since) continue;
    if (until && stamp > until) continue;
    const lines = fs.readFileSync(path.join(METRICS_DIR, file), 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        // Tolerate a torn trailing line.
      }
    }
  }
  return records;
}

function aggregate(records) {
  const byProvider = new Map();
  for (const r of records) {
    const key = r.provider + (r.model ? ' / ' + r.model : '');
    if (!byProvider.has(key)) {
      byProvider.set(key, {
        provider: r.provider,
        model: r.model,
        calls: 0,
        callsWithCacheInfo: 0,
        paidInput: 0,
        cacheRead: 0,
        output: 0,
      });
    }
    const s = byProvider.get(key);
    s.calls += 1;
    s.paidInput += Number(r.inputTokens) || 0;
    s.output += Number(r.outputTokens) || 0;
    if (r.cacheReadTokens !== undefined) {
      s.callsWithCacheInfo += 1;
      s.cacheRead += Number(r.cacheReadTokens) || 0;
    }
  }
  return [...byProvider.values()].sort((a, b) => b.paidInput + b.cacheRead - (a.paidInput + a.cacheRead));
}

function printStats(records, label) {
  const rows = aggregate(records);
  const total = { calls: 0, callsWithCacheInfo: 0, paidInput: 0, cacheRead: 0, output: 0 };
  for (const row of rows) {
    total.calls += row.calls;
    total.callsWithCacheInfo += row.callsWithCacheInfo;
    total.paidInput += row.paidInput;
    total.cacheRead += row.cacheRead;
    total.output += row.output;
  }
  console.log(`\n=== ${label || 'Cache stats'} (${records.length} records) ===`);
  if (rows.length === 0) {
    console.log('(no cache-metrics records found; run a chat turn first)');
    return;
  }
  const fmt = n => Number(n || 0).toLocaleString();
  for (const row of rows) {
    const totalInput = row.paidInput + row.cacheRead;
    const ratio = row.callsWithCacheInfo > 0 && totalInput > 0
      ? Math.round((row.cacheRead / totalInput) * 100) + '%'
      : 'n/a';
    console.log(
      `${row.provider.padEnd(14)} ${(row.model || '').padEnd(24)} calls=${String(row.calls).padStart(4)} ` +
      `paid=${fmt(row.paidInput).padStart(9)} cache=${fmt(row.cacheRead).padStart(9)} hit=${ratio}`
    );
  }
  const totalInput = total.paidInput + total.cacheRead;
  const totalRatio = total.callsWithCacheInfo > 0 && totalInput > 0
    ? Math.round((total.cacheRead / totalInput) * 100) + '%'
    : 'n/a';
  console.log(`TOTAL: calls=${total.calls} paid=${fmt(total.paidInput)} cache=${fmt(total.cacheRead)} hit=${totalRatio}`);
}

function printCost(records, label) {
  const fmtYuan = n => '¥' + Number(n || 0).toFixed(4);
  const rows = new Map();
  const byDay = new Map();
  const byConversation = new Map();
  let totalCost = 0;
  let totalCalls = 0;

  for (const r of records) {
    const cost = estimateRecordCostYuan(r);
    totalCost += cost;
    totalCalls += 1;

    const key = r.provider + (r.model ? ' / ' + r.model : '');
    const row = rows.get(key) || { provider: r.provider, model: r.model, calls: 0, cost: 0 };
    row.calls += 1;
    row.cost += cost;
    rows.set(key, row);

    const day = String(r.ts || '').slice(0, 10);
    if (day) {
      const dayRow = byDay.get(day) || { day, calls: 0, cost: 0 };
      dayRow.calls += 1;
      dayRow.cost += cost;
      byDay.set(day, dayRow);
    }

    if (r.conversationId) {
      const convRow = byConversation.get(r.conversationId) || { conversationId: r.conversationId, calls: 0, cost: 0 };
      convRow.calls += 1;
      convRow.cost += cost;
      byConversation.set(r.conversationId, convRow);
    }
  }

  console.log(`\n=== ${label || 'Cost report'} (${records.length} records) ===`);
  if (records.length === 0) {
    console.log('(no cache-metrics records found; run a chat turn first)');
    return;
  }

  const sortByCost = arr => arr.sort((a, b) => b.cost - a.cost);
  for (const row of sortByCost(Array.from(rows.values()))) {
    console.log(
      `${(row.provider || 'unknown').padEnd(14)} ${(row.model || '').padEnd(24)} calls=${String(row.calls).padStart(4)} cost=${fmtYuan(row.cost)}`
    );
  }
  console.log('--- by day ---');
  for (const row of sortByCost(Array.from(byDay.values()))) {
    console.log(`  ${row.day}  calls=${String(row.calls).padStart(4)}  cost=${fmtYuan(row.cost)}`);
  }
  console.log('--- by conversation (top 10) ---');
  for (const row of sortByCost(Array.from(byConversation.values())).slice(0, 10)) {
    console.log(`  ${row.conversationId}  calls=${String(row.calls).padStart(4)}  cost=${fmtYuan(row.cost)}`);
  }
  console.log(`TOTAL: calls=${totalCalls} estimated_cost=${fmtYuan(totalCost)} (参考价，随官方调价变动)`);
}

async function replayTurn(baseUrl, userId, conversationId, message, forceProvider) {
  const body = {
    message,
    userId,
    conversationId,
    stream: false,
    ...(forceProvider ? { forceProvider } : {}),
  };
  const response = await fetch(`${baseUrl}/api/chat-bridge/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`chat failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  return data;
}

// P2-7: read the latest persisted prompt-structure diagnostics (system hash
// stability, history count/dropped chars) from the conversation's run events.
async function fetchLatestPromptDiagnostics(baseUrl, userId, conversationId) {
  try {
    const url = `${baseUrl}/api/chat-bridge/pi/sessions/${encodeURIComponent(conversationId)}?userId=${encodeURIComponent(userId)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.success || !data.state || !Array.isArray(data.state.runEvents)) return null;
    const events = data.state.runEvents.filter(
      e => e.type === 'status' && e.payload && e.payload.promptDiagnostics
    );
    return events.length ? events[events.length - 1].payload.promptDiagnostics : null;
  } catch {
    return null;
  }
}

async function replay(args) {
  const baseUrl = args.baseUrl || 'http://127.0.0.1:3080';
  const userId = args.userId || 'web-user';
  const conversationId = args.conversationId || `baseline-${Date.now()}`;
  const forceProvider = args.forceProvider || '';
  const rounds = Math.max(1, Math.min(20, Number(args.rounds) || 6));
  const showDiagnostics = Boolean(args.diagnostics);
  const baseMessage = args.message || '请简要说明随机效应模型在 Meta 分析中的适用条件，并给出一个具体例子。';
  const turns = Array.from({ length: rounds }, (_, i) =>
    i === 0 ? baseMessage : `${baseMessage} 第 ${i + 1} 轮追问：请补充稳健性检验的建议。`
  );
  console.log(`Replaying ${rounds} turns against ${baseUrl} (user=${userId}, conversation=${conversationId}, provider=${forceProvider || 'auto'})`);
  console.log('Pass 1 (cold)…');
  for (let i = 0; i < turns.length; i++) {
    await replayTurn(baseUrl, userId, conversationId, turns[i], forceProvider);
    if (showDiagnostics) {
      const diag = await fetchLatestPromptDiagnostics(baseUrl, userId, conversationId);
      if (diag) {
        console.log(`  turn ${i + 1} structure: systemHash=${diag.systemHash} stable=${diag.systemStable} history=${diag.historyMessageCount} droppedChars=${diag.historyDroppedChars}`);
      }
    } else {
      console.log(`  turn ${i + 1}/${turns.length} done`);
    }
  }
  printStats(readRecords(), 'After pass 1 (cold)');
  if (args.twice) {
    console.log('\nPass 2 (warm)…');
    for (let i = 0; i < turns.length; i++) {
      await replayTurn(baseUrl, userId, conversationId, turns[i], forceProvider);
      if (showDiagnostics) {
        const diag = await fetchLatestPromptDiagnostics(baseUrl, userId, conversationId);
        if (diag) {
          console.log(`  turn ${i + 1} structure: systemHash=${diag.systemHash} stable=${diag.systemStable} history=${diag.historyMessageCount} droppedChars=${diag.historyDroppedChars}`);
        }
      } else {
        console.log(`  turn ${i + 1}/${turns.length} done`);
      }
    }
    printStats(readRecords(), 'After pass 2 (warm)');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] || 'stats';
  if (mode === 'stats') {
    printStats(readRecords(args.since, args.until), 'Cache stats');
  } else if (mode === 'cost') {
    printCost(readRecords(args.since, args.until), 'Cost report');
  } else if (mode === 'replay') {
    await replay(args);
  } else {
    console.error(`Unknown mode: ${mode} (expected stats | replay)`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('[cache-baseline] failed:', error.message || error);
  process.exitCode = 1;
});
